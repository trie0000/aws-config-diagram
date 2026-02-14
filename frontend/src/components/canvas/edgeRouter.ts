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
 *
 * 実装は以下の3モジュールに分割:
 *   - edgeRouter.types.ts — 型定義・定数・共有ユーティリティ
 *   - edgeRouter.bfs.ts — グリッド構築・BFS探索・パス処理
 *   - edgeRouter.postprocess.ts — 交差削減・ポート分散・ナッジ
 *
 * Version: 5.0.0
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
  spreadPorts(routed)
  nudgeEdges(routed)

  // コンテナエッジの始点/終点を directionToTarget で強制修正
  // （後処理が BFS 方向で上書きする可能性があるため、最後に再適用）
  for (const r of routed) {
    if (r.waypoints.length < 2 || !r.sourceNodeId || !r.targetNodeId) continue
    const src = nodes[r.sourceNodeId]
    const dst = nodes[r.targetNodeId]
    if (!src || !dst) continue

    const srcIsContainer = CONTAINER_TYPES.has(src.type)
    const dstIsContainer = CONTAINER_TYPES.has(dst.type)
    if (!srcIsContainer && !dstIsContainer) continue

    const srcRect = nodeIconRect(src)
    const dstRect = nodeIconRect(dst)

    if (srcIsContainer && r.waypoints.length >= 2) {
      const correctSide = directionToTarget(srcRect, dstRect)
      r.srcSide = correctSide
      const newP1 = sideCenter(src, correctSide)
      r.waypoints[0] = newP1
      // 2番目のwaypointを辺方向に揃える（始点→次の点が辺方向に直進するようにする）
      const isHoriz = (correctSide === 'left' || correctSide === 'right')
      if (isHoriz) {
        r.waypoints[1] = { x: r.waypoints[1].x, y: newP1.y }
      } else {
        r.waypoints[1] = { x: newP1.x, y: r.waypoints[1].y }
      }
    }

    if (dstIsContainer && r.waypoints.length >= 2) {
      const correctSide = directionToTarget(dstRect, srcRect)
      r.dstSide = correctSide
      const newP2 = sideCenter(dst, correctSide)
      const last = r.waypoints.length - 1
      r.waypoints[last] = newP2
      // 最後の1つ前のwaypointを辺方向に揃える
      const isHoriz = (correctSide === 'left' || correctSide === 'right')
      if (isHoriz) {
        r.waypoints[last - 1] = { x: r.waypoints[last - 1].x, y: newP2.y }
      } else {
        r.waypoints[last - 1] = { x: newP2.x, y: r.waypoints[last - 1].y }
      }
    }
  }

  return routed
}
