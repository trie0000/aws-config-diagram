/**
 * edgeRouter.ts: 障害物回避付き直交エッジルーティング（オーケストレータ）
 *
 * パイプライン:
 *   1. 障害物グリッド構築（全アイコンノードの矩形をマーク）
 *   2. 各エッジについて独立に BFS で最短直交パスを探索
 *   3. BFS の出発/到着方向からアイコンの接続辺を後決定
 *   4. パスを簡略化（同方向セルをマージして折れ点のみ残す）
 *   5. 交差削減（交差エッジの代替ルートを試行）
 *   6. ポート分散（同一接続点のエッジを辺に沿って分散）
 *   7. エッジナッジ（重なったセグメントを等間隔にオフセット）
 *   8. enforceEdgeRules — 全ルールの最終適用
 *
 * 実装は以下の3モジュールに分割:
 *   - edgeRouter.types.ts — 型定義・定数・共有ユーティリティ
 *   - edgeRouter.bfs.ts — グリッド構築・BFS探索・パス処理
 *   - edgeRouter.postprocess.ts — 交差削減・ポート分散・ナッジ
 *
 * Version: 6.2.0
 * Last Updated: 2026-02-14
 */

import type { DiagramNode, DiagramEdge } from '../../types/diagram'
import type { RoutedEdge } from './edgeRouter.types'
import { CONTAINER_TYPES, nodeIconRect, sideCenter, bestSides, directionToTarget, type Side } from './edgeRouter.types'
import {
  buildObstacleGrid, unblockRect, reblockCells,
  bfsSearch, determineSide, simplifyPath, fallbackRoute,
} from './edgeRouter.bfs'
import { reduceCrossings, spreadPorts, nudgeEdges } from './edgeRouter.postprocess'

// Re-export public API for consumers
export { nodeIconRect, sideCenter, bestSides, directionToTarget, pointsToPath } from './edgeRouter.types'
export type { RoutedEdge, Side } from './edgeRouter.types'

/**
 * 全エッジの障害物回避ルーティングを一括計算する。
 * 各エッジを独立に BFS で最短経路探索。交差は許容し、最短パスを優先する。
 */
export function routeAllEdges(
  nodes: Record<string, DiagramNode>,
  edges: DiagramEdge[],
): RoutedEdge[] {
  // アイコンノード（非コンテナ）の矩形を障害物として収集
  const iconNodes = Object.values(nodes).filter(n => !CONTAINER_TYPES.has(n.type))
  const obstacles = iconNodes.map(n => nodeIconRect(n))

  // グリッド構築（1回のみ、全エッジで共有）
  const grid = buildObstacleGrid(obstacles, nodes)

  const routed: RoutedEdge[] = []

  for (const edge of edges) {
    const src = nodes[edge.sourceNodeId]
    const dst = nodes[edge.targetNodeId]
    if (!src || !dst) {
      routed.push({ edgeId: edge.id, waypoints: [], srcSide: 'right', dstSide: 'left', sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId })
      continue
    }

    const srcRect = nodeIconRect(src)
    const dstRect = nodeIconRect(dst)

    // 始点・終点ノードの障害物を一時的に解除
    const removedSrc = unblockRect(grid, srcRect)
    const removedDst = unblockRect(grid, dstRect)

    try {
      const srcCx = srcRect.x + srcRect.w / 2
      const srcCy = srcRect.y + srcRect.h / 2
      const dstCx = dstRect.x + dstRect.w / 2
      const dstCy = dstRect.y + dstRect.h / 2

      const result = bfsSearch(srcCx, srcCy, dstCx, dstCy, grid)

      if (result) {
        // コンテナノードは BFS グリッド方向が不安定なので相手ノードの方向で辺を決定
        const srcIsContainer = CONTAINER_TYPES.has(src.type)
        const dstIsContainer = CONTAINER_TYPES.has(dst.type)
        let srcSide: Side, dstSide: Side
        if (srcIsContainer || dstIsContainer) {
          srcSide = srcIsContainer ? directionToTarget(srcRect, dstRect) : determineSide(result.gridPath, 'src')
          dstSide = dstIsContainer ? directionToTarget(dstRect, srcRect) : determineSide(result.gridPath, 'dst')
        } else {
          srcSide = determineSide(result.gridPath, 'src')
          dstSide = determineSide(result.gridPath, 'dst')
        }
        const p1 = sideCenter(src, srcSide)
        const p2 = sideCenter(dst, dstSide)
        const waypoints = simplifyPath(result.gridPath, p1, p2, srcSide, dstSide)
        routed.push({ edgeId: edge.id, waypoints, srcSide, dstSide, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId })
      } else {
        const { srcSide, dstSide } = bestSides(src, dst)
        const p1 = sideCenter(src, srcSide)
        const p2 = sideCenter(dst, dstSide)
        routed.push({ edgeId: edge.id, waypoints: fallbackRoute(p1, srcSide, p2, dstSide), srcSide, dstSide, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId })
      }
    } finally {
      reblockCells(grid, removedSrc)
      reblockCells(grid, removedDst)
    }
  }

  // 後処理: 交差削減 → ポート分散 → エッジナッジ
  reduceCrossings(routed, nodes, grid)
  spreadPorts(routed, nodes)
  nudgeEdges(routed)

  // 全ルールの最終適用
  enforceEdgeRules(routed, nodes)

  return routed
}

/** 連続する重複ウェイポイント（距離1px以内）を除去する */
function removeDuplicateWaypoints(r: RoutedEdge): void {
  if (r.waypoints.length < 3) return
  const cleaned: Array<{ x: number; y: number }> = [r.waypoints[0]]
  for (let i = 1; i < r.waypoints.length; i++) {
    const prev = cleaned[cleaned.length - 1]
    const cur = r.waypoints[i]
    if (Math.abs(cur.x - prev.x) > 1 || Math.abs(cur.y - prev.y) > 1) {
      cleaned.push(cur)
    }
  }
  if (cleaned.length >= 2) {
    r.waypoints = cleaned
  }
}

// ============================================================
// enforceEdgeRules — EDGE_ROUTING.md の3ルールを最終適用
// ============================================================

/**
 * 全 RoutedEdge に対して以下のルールを適用する:
 *
 * 1. 出口方向の一致: 始点の辺と最初のセグメント方向を一致させる
 * 2. 到着方向の一致: 終点の辺と最後のセグメント方向を一致させる
 * 3. 出入り分離: spreadPorts のオフセットを保持する（辺方向の座標は維持）
 *
 * 後処理（spreadPorts/nudgeEdges）の結果を尊重しつつ、
 * 辺に垂直な座標（= 辺のどこから出るか）はそのまま保持し、
 * 辺に平行な座標（= 辺のどの面から出るか）のみ正しい辺に揃える。
 */
function enforceEdgeRules(
  routed: RoutedEdge[],
  nodes: Record<string, DiagramNode>,
): void {
  for (const r of routed) {
    if (r.waypoints.length < 2 || !r.sourceNodeId || !r.targetNodeId) continue
    const src = nodes[r.sourceNodeId]
    const dst = nodes[r.targetNodeId]
    if (!src || !dst) continue

    // 連続する重複ウェイポイントを除去
    removeDuplicateWaypoints(r)

    // --- 始点の修正 ---
    enforceStart(r, src, dst)

    // --- 終点の修正 ---
    enforceEnd(r, src, dst)
  }
}

/**
 * 始点を修正。
 * 最初のセグメント方向から正しい出口辺を決定し、辺座標に揃える。
 * spreadPorts のオフセット（辺に沿った方向）は保持する。
 */
function enforceStart(r: RoutedEdge, src: DiagramNode, dst: DiagramNode): void {
  const wp = r.waypoints
  if (wp.length < 2) return

  const srcIsContainer = CONTAINER_TYPES.has(src.type)

  // コンテナ: directionToTarget で辺決定 → L字パスに再構築
  if (srcIsContainer) {
    const correctSide = directionToTarget(nodeIconRect(src), nodeIconRect(dst))
    const correctP = sideCenter(src, correctSide)
    const lastPt = wp[wp.length - 1]
    const isHoriz = (correctSide === 'left' || correctSide === 'right')
    r.srcSide = correctSide
    if (isHoriz) {
      r.waypoints = [correctP, { x: lastPt.x, y: correctP.y }, lastPt]
    } else {
      r.waypoints = [correctP, { x: correctP.x, y: lastPt.y }, lastPt]
    }
    return
  }

  // アイコンノード: 最初のセグメント方向から正しい辺を逆算
  // wp[0]==wp[1] の場合は次の異なる点を探す
  const p0 = wp[0]
  let p1 = wp[1]
  for (let i = 1; i < wp.length; i++) {
    if (Math.abs(wp[i].x - p0.x) > 1 || Math.abs(wp[i].y - p0.y) > 1) {
      p1 = wp[i]
      break
    }
  }
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y

  const rect = nodeIconRect(src)

  let correctSide: Side
  if (Math.abs(dx) > Math.abs(dy)) {
    correctSide = dx > 0 ? 'right' : 'left'
  } else if (Math.abs(dy) > Math.abs(dx)) {
    correctSide = dy > 0 ? 'bottom' : 'top'
  } else {
    return
  }

  // 逆方向チェック: BFS の最初のセグメント方向と、実際の始点位置が矛盾している場合を検出。
  // 例: 始点が bottom辺 (y=192.4) にあるのに correctSide='top'（上に向かう）
  //     → パスがアイコンを突き抜けている。
  const SIDE_TOLERANCE = 3  // 辺判定の許容誤差
  const goesOpposite = (() => {
    // 始点が実際にどの辺にあるかを座標から判定
    const atTop = Math.abs(p0.y - rect.y) < SIDE_TOLERANCE
    const atBottom = Math.abs(p0.y - (rect.y + rect.h)) < SIDE_TOLERANCE
    const atLeft = Math.abs(p0.x - rect.x) < SIDE_TOLERANCE
    const atRight = Math.abs(p0.x - (rect.x + rect.w)) < SIDE_TOLERANCE

    // 始点がある辺と correctSide が矛盾する場合
    if (correctSide === 'top' && atBottom) return true   // bottom辺から出て上に向かう
    if (correctSide === 'bottom' && atTop) return true   // top辺から出て下に向かう
    if (correctSide === 'left' && atRight) return true   // right辺から出て左に向かう
    if (correctSide === 'right' && atLeft) return true   // left辺から出て右に向かう
    return false
  })()

  if (goesOpposite) {
    // BFS の最初のセグメントがアイコン内部に向かっている（逆方向）。
    // パスの2番目以降の方向変化を見て、本来の進行方向を推測する。
    // 例: bottom→UP→LEFT の場合、LEFT が本来の方向 → left辺を使う。
    let betterSide: Side | null = null

    // パスの折れ点を走査し、最初の水平/垂直方向変化を見つける
    for (let i = 1; i < wp.length - 1; i++) {
      const cur = wp[i]
      const next = wp[i + 1]
      const sdx = next.x - cur.x
      const sdy = next.y - cur.y
      if (Math.abs(sdx) > 1 || Math.abs(sdy) > 1) {
        if (Math.abs(sdx) > Math.abs(sdy)) {
          betterSide = sdx > 0 ? 'right' : 'left'
        } else {
          betterSide = sdy > 0 ? 'bottom' : 'top'
        }
        break
      }
    }

    // 折れ点が見つからない場合は bestSides で決定
    if (!betterSide) {
      betterSide = bestSides(src, dst).srcSide
    }

    const betterP = sideCenter(src, betterSide)
    const lastPt = wp[wp.length - 1]
    const isH = (betterSide === 'left' || betterSide === 'right')
    r.srcSide = betterSide
    if (isH) {
      r.waypoints = [betterP, { x: lastPt.x, y: betterP.y }, lastPt]
    } else {
      r.waypoints = [betterP, { x: betterP.x, y: lastPt.y }, lastPt]
    }
    return
  }

  const isHoriz = (correctSide === 'left' || correctSide === 'right')

  // 辺に垂直な座標 = 辺面の位置（固定）
  // 辺に平行な座標 = spreadPorts のオフセットを保持
  if (isHoriz) {
    // 水平辺(left/right): x は辺の位置に固定、y は現在値を保持（出入り分離）
    const edgeX = correctSide === 'right' ? rect.x + rect.w : rect.x
    wp[0] = { x: edgeX, y: p0.y }
    // 2番目の点の y を始点に揃える（水平に出る）
    wp[1] = { x: wp[1].x, y: p0.y }
  } else {
    // 垂直辺(top/bottom): y は辺の位置に固定、x は現在値を保持（出入り分離）
    const edgeY = correctSide === 'bottom' ? rect.y + rect.h : rect.y
    wp[0] = { x: p0.x, y: edgeY }
    // 2番目の点の x を始点に揃える（垂直に出る）
    wp[1] = { x: p0.x, y: wp[1].y }
  }
  r.srcSide = correctSide
}

/**
 * 終点を修正。
 * 最後のセグメント方向から正しい到着辺を決定し、辺座標に揃える。
 * spreadPorts のオフセット（辺に沿った方向）は保持する。
 */
function enforceEnd(r: RoutedEdge, src: DiagramNode, dst: DiagramNode): void {
  const wp = r.waypoints
  if (wp.length < 2) return

  const dstIsContainer = CONTAINER_TYPES.has(dst.type)

  // コンテナ: directionToTarget で辺決定 → L字パスに再構築
  if (dstIsContainer) {
    const correctSide = directionToTarget(nodeIconRect(dst), nodeIconRect(src))
    const correctP = sideCenter(dst, correctSide)
    const firstPt = wp[0]
    const isHoriz = (correctSide === 'left' || correctSide === 'right')
    r.dstSide = correctSide
    if (isHoriz) {
      r.waypoints = [firstPt, { x: firstPt.x, y: correctP.y }, correctP]
    } else {
      r.waypoints = [firstPt, { x: correctP.x, y: firstPt.y }, correctP]
    }
    return
  }

  // アイコンノード: 最後のセグメント方向から正しい到着辺を逆算
  // pEnd==pPrev の場合はさらに前の異なる点を探す
  const last = wp.length - 1
  const pEnd = wp[last]
  let pPrev = wp[last - 1]
  for (let i = last - 1; i >= 0; i--) {
    if (Math.abs(wp[i].x - pEnd.x) > 1 || Math.abs(wp[i].y - pEnd.y) > 1) {
      pPrev = wp[i]
      break
    }
  }
  const dx = pEnd.x - pPrev.x
  const dy = pEnd.y - pPrev.y

  const rect = nodeIconRect(dst)

  // 右から来る(dx>0) → 左辺に到着、下から来る(dy>0) → 上辺に到着
  let correctSide: Side
  if (Math.abs(dx) > Math.abs(dy)) {
    correctSide = dx > 0 ? 'left' : 'right'
  } else if (Math.abs(dy) > Math.abs(dx)) {
    correctSide = dy > 0 ? 'top' : 'bottom'
  } else {
    return
  }

  // 逆方向チェック: 終点位置と到着方向が矛盾している場合を検出。
  const SIDE_TOLERANCE_END = 3
  const goesOpposite = (() => {
    const atTop = Math.abs(pEnd.y - rect.y) < SIDE_TOLERANCE_END
    const atBottom = Math.abs(pEnd.y - (rect.y + rect.h)) < SIDE_TOLERANCE_END
    const atLeft = Math.abs(pEnd.x - rect.x) < SIDE_TOLERANCE_END
    const atRight = Math.abs(pEnd.x - (rect.x + rect.w)) < SIDE_TOLERANCE_END

    if (correctSide === 'top' && atBottom) return true
    if (correctSide === 'bottom' && atTop) return true
    if (correctSide === 'left' && atRight) return true
    if (correctSide === 'right' && atLeft) return true
    return false
  })()

  if (goesOpposite) {
    // パスの末尾近くの折れ点から本来の到着方向を推測する
    let betterSide: Side | null = null
    for (let i = last - 1; i > 0; i--) {
      const prev = wp[i - 1]
      const cur = wp[i]
      const sdx = cur.x - prev.x
      const sdy = cur.y - prev.y
      if (Math.abs(sdx) > 1 || Math.abs(sdy) > 1) {
        // 到着方向: 右に来る→left辺、下に来る→top辺
        if (Math.abs(sdx) > Math.abs(sdy)) {
          betterSide = sdx > 0 ? 'left' : 'right'
        } else {
          betterSide = sdy > 0 ? 'top' : 'bottom'
        }
        break
      }
    }
    if (!betterSide) {
      betterSide = bestSides(src, dst).dstSide
    }

    const betterP = sideCenter(dst, betterSide)
    const firstPt = wp[0]
    const isH = (betterSide === 'left' || betterSide === 'right')
    r.dstSide = betterSide
    if (isH) {
      r.waypoints = [firstPt, { x: firstPt.x, y: betterP.y }, betterP]
    } else {
      r.waypoints = [firstPt, { x: betterP.x, y: firstPt.y }, betterP]
    }
    return
  }

  const isHoriz = (correctSide === 'left' || correctSide === 'right')

  if (isHoriz) {
    const edgeX = correctSide === 'left' ? rect.x : rect.x + rect.w
    wp[last] = { x: edgeX, y: pEnd.y }
    // last-1 が始点(0)の場合は上書きしない（enforceStart の修正を保護）
    if (last - 1 > 0) {
      wp[last - 1] = { x: wp[last - 1].x, y: pEnd.y }
    }
  } else {
    const edgeY = correctSide === 'top' ? rect.y : rect.y + rect.h
    wp[last] = { x: pEnd.x, y: edgeY }
    // last-1 が始点(0)の場合は上書きしない（enforceStart の修正を保護）
    if (last - 1 > 0) {
      wp[last - 1] = { x: pEnd.x, y: wp[last - 1].y }
    }
  }
  r.dstSide = correctSide
}
