/**
 * edgeRouter.ts: 障害物回避付き直交エッジルーティング（オーケストレータ）
 *
 * パイプライン:
 *   1. 障害物グリッド構築（全アイコンノードの矩形をマーク）
 *   2. 各エッジについて独立に BFS で最短直交パスを探索
 *   3. BFS の出発/到着方向からアイコンの接続辺を後決定
 *   4. パスを簡略化（同方向セルをマージして折れ点のみ残す）
 *   5. 交差削減（交差エッジの代替ルートを試行）
 *   6. エッジナッジ（重なったセグメントを等間隔にオフセット）
 *   7. ポート分散（同じノード・同じ辺のエッジを均等配置）
 *   8. アイコン貫通防止
 *   9. enforceEdgeRules — 全ルールの最終適用（R0直交/R1出口/R2到着/R3矢印）
 *
 * 実装は以下の3モジュールに分割:
 *   - edgeRouter.types.ts — 型定義・定数・共有ユーティリティ
 *   - edgeRouter.bfs.ts — グリッド構築・BFS探索・パス処理
 *   - edgeRouter.postprocess.ts — 交差削減・ポート分散・ナッジ
 *
 * enforceEdgeRules の設計:
 *   docs/design/ENFORCE_EDGE_RULES_ALGORITHM.md
 *
 * Version: 6.5.0
 * Last Updated: 2026-02-14
 */

import type { DiagramNode, DiagramEdge } from '../../types/diagram'
import type { RoutedEdge } from './edgeRouter.types'
import { CONTAINER_TYPES, nodeIconRect, sideCenter, bestSides, directionToTarget, type Side } from './edgeRouter.types'
import {
  buildObstacleGrid, unblockRect, reblockCells,
  bfsSearch, determineSide, simplifyPath, fallbackRoute,
} from './edgeRouter.bfs'
import { reduceCrossings, spreadPorts, nudgeEdges, deflectFromIcons } from './edgeRouter.postprocess'

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

  // 後処理パイプライン:
  // 1. 交差削減 → エッジナッジ
  reduceCrossings(routed, nodes, grid)
  nudgeEdges(routed)

  // 2. ポート分散（同じノード・同じ辺のエッジを均等配置）
  spreadPorts(routed, nodes)

  // 3. アイコン貫通防止
  deflectFromIcons(routed, nodes)

  // 4. ルール最終適用（R0直交/R1出口/R2到着/R3矢印）
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
// enforceEdgeRules — R0直交/R1出口/R2到着/R3矢印 を最終適用
// 設計書: docs/design/ENFORCE_EDGE_RULES_ALGORITHM.md
// ============================================================

/** R1/R2 違反時のエスケープ/アプローチ距離(px) */
const ESCAPE_LEN = 20

type NormalAxis = 'x' | 'y'

/** srcSide/dstSide → 法線軸 */
function normalAxis(side: Side): NormalAxis {
  return (side === 'top' || side === 'bottom') ? 'y' : 'x'
}

/** R1 検査: firstNormalIdx の法線軸座標が法線方向にあるか */
function isR1OK(side: Side, ptNormal: number, normalValue: number): boolean {
  switch (side) {
    case 'bottom': return ptNormal > normalValue
    case 'top':    return ptNormal < normalValue
    case 'right':  return ptNormal > normalValue
    case 'left':   return ptNormal < normalValue
  }
}

/** R2 検査: lastNormalIdx の法線軸座標が到着方向側にあるか */
function isR2OK(side: Side, ptNormal: number, normalValue: number): boolean {
  // R2: dstSide='top' → 上から到着 → lastNormalIdx は normalValue より小さい
  switch (side) {
    case 'top':    return ptNormal < normalValue
    case 'bottom': return ptNormal > normalValue
    case 'left':   return ptNormal < normalValue
    case 'right':  return ptNormal > normalValue
  }
}

/** escapePt を計算: wp[0] から法線方向に ESCAPE_LEN 離れた点 */
function computeEscapePt(origin: { x: number; y: number }, side: Side): { x: number; y: number } {
  switch (side) {
    case 'bottom': return { x: origin.x, y: origin.y + ESCAPE_LEN }
    case 'top':    return { x: origin.x, y: origin.y - ESCAPE_LEN }
    case 'right':  return { x: origin.x + ESCAPE_LEN, y: origin.y }
    case 'left':   return { x: origin.x - ESCAPE_LEN, y: origin.y }
  }
}

/** approachPt を計算: wp[last] から到着方向（法線の反対）に APPROACH_LEN 離れた点 */
function computeApproachPt(origin: { x: number; y: number }, side: Side): { x: number; y: number } {
  // dstSide='top' → 上から到着 → approachPt は上方向(y-)
  switch (side) {
    case 'top':    return { x: origin.x, y: origin.y - ESCAPE_LEN }
    case 'bottom': return { x: origin.x, y: origin.y + ESCAPE_LEN }
    case 'left':   return { x: origin.x - ESCAPE_LEN, y: origin.y }
    case 'right':  return { x: origin.x + ESCAPE_LEN, y: origin.y }
  }
}

/** 2点間の L字角を計算 */
function lShapeJoin(from: { x: number; y: number }, to: { x: number; y: number }, nAxis: NormalAxis): { x: number; y: number } {
  // 法線軸がy → escapePt(法線=y方向) からtoへ → まず水平に合わせてから垂直
  return nAxis === 'y'
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y }
}

/** 2つの点が同一座標か(1px以内) */
function ptEq(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1
}

/**
 * 全 RoutedEdge に対してルールを適用する。
 *
 * 核心方針: srcSide/dstSide を変更しない。辺を固定してパスを修正する。
 * コンテナ専用分岐なし（アイコンと同じロジック）。
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

    removeDuplicateWaypoints(r)
    enforceStart(r, src)
    enforceEnd(r, dst)
    removeDuplicateWaypoints(r)
  }
}

/**
 * 端点座標をrectの指定辺に投影する（spreadPortsオフセットを保持）
 */
function snapToEdge(
  rect: { x: number; y: number; w: number; h: number },
  side: Side,
  pt: { x: number; y: number },
): { x: number; y: number } {
  switch (side) {
    case 'top':    return { x: clampX(pt.x, rect), y: rect.y }
    case 'bottom': return { x: clampX(pt.x, rect), y: rect.y + rect.h }
    case 'left':   return { x: rect.x, y: clampY(pt.y, rect) }
    case 'right':  return { x: rect.x + rect.w, y: clampY(pt.y, rect) }
  }
}

/** x座標をrect内にクランプ */
function clampX(x: number, rect: { x: number; w: number }): number {
  return Math.max(rect.x, Math.min(x, rect.x + rect.w))
}
/** y座標をrect内にクランプ */
function clampY(y: number, rect: { y: number; h: number }): number {
  return Math.max(rect.y, Math.min(y, rect.y + rect.h))
}

/**
 * enforceStart: 始点をR0/R1準拠にする。
 *
 * 1. wp[0] を srcSide の辺面にスナップ
 * 2. 法線方向に離れる最初の点 (firstNormalIdx) を探す
 * 3. R1検査 → 6a(OK) or 6b(violation)
 */
function enforceStart(r: RoutedEdge, src: DiagramNode): void {
  const wp = r.waypoints
  if (wp.length < 2) return

  const srcRect = nodeIconRect(src)
  const side = r.srcSide
  const nAxis = normalAxis(side)

  // 1. snap wp[0]
  wp[0] = snapToEdge(srcRect, side, wp[0])
  const normalValue = wp[0][nAxis]

  // 2. firstNormalIdx: 法線軸に1px以上離れる最初のWP
  let firstNormalIdx = -1
  for (let i = 1; i < wp.length; i++) {
    if (Math.abs(wp[i][nAxis] - normalValue) > 1) {
      firstNormalIdx = i
      break
    }
  }
  if (firstNormalIdx < 0) return // パスが辺面平行のみ → 何もしない

  // 3. R1検査
  if (isR1OK(side, wp[firstNormalIdx][nAxis], normalValue)) {
    // 6a: R1を満たす — 直交揃え
    const prevPt = wp[firstNormalIdx - 1]
    const parallelAxis: NormalAxis = nAxis === 'y' ? 'x' : 'y'

    wp[firstNormalIdx] = { ...wp[firstNormalIdx], [parallelAxis]: prevPt[parallelAxis] }

    // 次セグメントが斜めになるリスクをチェック
    if (firstNormalIdx + 1 < wp.length) {
      const next = wp[firstNormalIdx + 1]
      const cur = wp[firstNormalIdx]
      const dx = Math.abs(cur.x - next.x)
      const dy = Math.abs(cur.y - next.y)
      if (dx > 1 && dy > 1) {
        // 斜め → L字中継点を挿入
        const relay = nAxis === 'y'
          ? { x: cur.x, y: next.y }
          : { x: next.x, y: cur.y }
        if (!ptEq(relay, cur) && !ptEq(relay, next)) {
          wp.splice(firstNormalIdx + 1, 0, relay)
        }
      }
    }
  } else {
    // 6b: R1違反 — escape パス構築
    const escapePt = computeEscapePt(wp[0], side)

    // 合流先を探す: firstNormalIdx 以降で L字接続可能な点
    let k = wp.length - 1 // デフォルトは終点
    for (let i = firstNormalIdx; i < wp.length; i++) {
      // escapePt と wp[i] が少なくとも1軸で近い = L字で繋がる
      if (Math.abs(escapePt.x - wp[i].x) <= 1 || Math.abs(escapePt.y - wp[i].y) <= 1) {
        k = i
        break
      }
    }
    // 見つからない場合は終点を使う（上のデフォルト）

    const joinPt = lShapeJoin(escapePt, wp[k], nAxis)

    // wp[1..k-1] を [escapePt, joinPt] に置換
    const newSegment: Array<{ x: number; y: number }> = [escapePt]
    if (!ptEq(joinPt, escapePt) && !ptEq(joinPt, wp[k])) {
      newSegment.push(joinPt)
    }
    wp.splice(1, k - 1, ...newSegment)
  }
}

/**
 * enforceEnd: 終点をR0/R2/R3準拠にする。
 *
 * 1. wp[last] を dstSide の辺面にスナップ
 * 2. 法線方向から到着する最後の点 (lastNormalIdx) を探す
 * 3. R2検査 → 6a(OK) or 6b(violation)
 * 4. ensureFinalSegment (R3)
 */
function enforceEnd(r: RoutedEdge, dst: DiagramNode): void {
  const wp = r.waypoints
  if (wp.length < 2) return

  const dstRect = nodeIconRect(dst)
  const side = r.dstSide
  const nAxis = normalAxis(side)
  const last = wp.length - 1

  // 1. snap wp[last]
  wp[last] = snapToEdge(dstRect, side, wp[last])
  const normalValue = wp[last][nAxis]

  // 2. lastNormalIdx: 法線軸に1px以上離れる最後のWP（逆方向走査）
  let lastNormalIdx = -1
  for (let i = last - 1; i >= 0; i--) {
    if (Math.abs(wp[i][nAxis] - normalValue) > 1) {
      lastNormalIdx = i
      break
    }
  }
  if (lastNormalIdx < 0) return // パスが辺面平行のみ → 何もしない

  // 3. R2検査
  if (isR2OK(side, wp[lastNormalIdx][nAxis], normalValue)) {
    // 6a: R2を満たす — 直交揃え
    const nextPt = wp[lastNormalIdx + 1]
    const parallelAxis: NormalAxis = nAxis === 'y' ? 'x' : 'y'

    // lastNormalIdx == 0 の場合は wp[0] を保護（enforceStart の修正を壊さない）
    if (lastNormalIdx > 0) {
      wp[lastNormalIdx] = { ...wp[lastNormalIdx], [parallelAxis]: nextPt[parallelAxis] }

      // 前セグメントが斜めになるリスクをチェック
      if (lastNormalIdx - 1 >= 0 && lastNormalIdx - 1 !== 0) {
        const prev = wp[lastNormalIdx - 1]
        const cur = wp[lastNormalIdx]
        const dx = Math.abs(prev.x - cur.x)
        const dy = Math.abs(prev.y - cur.y)
        if (dx > 1 && dy > 1) {
          // 斜め → L字中継点を挿入
          const relay = nAxis === 'y'
            ? { x: cur.x, y: prev.y }
            : { x: prev.x, y: cur.y }
          if (!ptEq(relay, prev) && !ptEq(relay, cur)) {
            wp.splice(lastNormalIdx, 0, relay)
          }
        }
      }
    }
  } else {
    // 6b: R2違反 — approach パス構築
    const curLast = wp.length - 1
    const approachPt = computeApproachPt(wp[curLast], side)

    // 合流元を探す: lastNormalIdx から 1 へ走査（wp[0]はenforceStart保護）
    let k = Math.min(1, curLast) // デフォルトはwp[1]（enforceStartの修正を保護）
    for (let i = lastNormalIdx; i >= 1; i--) {
      if (Math.abs(approachPt.x - wp[i].x) <= 1 || Math.abs(approachPt.y - wp[i].y) <= 1) {
        k = i
        break
      }
    }

    const joinPt = lShapeJoin(approachPt, wp[k], nAxis)

    // wp[k+1..curLast-1] を [joinPt, approachPt] に置換
    const newSegment: Array<{ x: number; y: number }> = []
    if (!ptEq(joinPt, wp[k]) && !ptEq(joinPt, approachPt)) {
      newSegment.push(joinPt)
    }
    newSegment.push(approachPt)
    wp.splice(k + 1, curLast - 1 - k, ...newSegment)
  }

  // 4. ensureFinalSegment (R3): 最終セグメントが法線方向を向くことを保証
  ensureFinalSegment(wp, nAxis)
}

/**
 * ensureFinalSegment: 最終セグメントが dstSide の法線方向を向くようにする。
 *
 * spreadPorts の中継WP（辺面上の移動）により最終セグメントが辺面平行になるケースを修正。
 * wp[last-1] を除去し、斜めになるなら L字中継を挿入。
 */
function ensureFinalSegment(wp: Array<{ x: number; y: number }>, nAxis: NormalAxis): void {
  let last = wp.length - 1
  if (last < 2) return // 2点パスは対処不要

  // 最終セグメントの法線軸変位
  const normalDelta = Math.abs(wp[last][nAxis] - wp[last - 1][nAxis])
  if (normalDelta > 1) return // 既に法線方向 → OK

  // 最終セグメントが辺面平行 → wp[last-1] を除去
  wp.splice(last - 1, 1)
  last = wp.length - 1
  if (last < 1) return

  // 除去後、wp[last-1]→wp[last] が斜めか検査
  const dx = Math.abs(wp[last - 1].x - wp[last].x)
  const dy = Math.abs(wp[last - 1].y - wp[last].y)
  if (dx > 1 && dy > 1) {
    // 斜め → L字中継点を wp[last] の直前に挿入
    const relay = nAxis === 'y'
      ? { x: wp[last].x, y: wp[last - 1].y }
      : { x: wp[last - 1].x, y: wp[last].y }
    wp.splice(last, 0, relay)
  }
}
