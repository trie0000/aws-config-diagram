/**
 * edgeRouter.ts: 決定的直交エッジルーティング（オーケストレータ）
 *
 * アルゴリズム:
 *   1. 距離が短いエッジから順に処理
 *   2. 各エッジで全16通り(4×4)の辺パターンを試す
 *   3. 各パターンで直線/L字/Z字候補を生成
 *   4. 選択基準: アイコン貫通なし → 曲がり少 → 交差少 → 距離短
 *   5. ポートは同じ辺に来るエッジごとに中央から外側へ順に分散
 *
 * Version: 15.1.0
 */

import type { DiagramNode, DiagramEdge } from '../../types/diagram'
import type { RoutedEdge, Side, Point } from './edgeRouter.types'
import { CONTAINER_TYPES, nodeIconRect } from './edgeRouter.types'
import {
  generateCandidatePaths,
  countBends, countCrossings, pathLength,
} from './edgeRouter.bfs'
import type { Rect } from './edgeRouter.bfs'

// Re-export public API for consumers
export { nodeIconRect, sideCenter, bestSides, directionToTarget, pointsToPath } from './edgeRouter.types'
export type { RoutedEdge, Side } from './edgeRouter.types'

// ============================================================
// Icon Rect
// ============================================================

interface IconRect {
  nodeId: string
  x: number; y: number; w: number; h: number
  cx: number; cy: number
}

function collectIconRects(nodes: Record<string, DiagramNode>): IconRect[] {
  const rects: IconRect[] = []
  for (const [id, n] of Object.entries(nodes)) {
    if (CONTAINER_TYPES.has(n.type)) continue
    const r = nodeIconRect(n)
    rects.push({ nodeId: id, ...r, cx: r.x + r.w / 2, cy: r.y + r.h / 2 })
  }
  return rects
}

// ============================================================
// Distance
// ============================================================

function iconDistance(edge: DiagramEdge, icons: Map<string, IconRect>): number {
  const src = icons.get(edge.sourceNodeId)
  const dst = icons.get(edge.targetNodeId)
  if (!src || !dst) return Infinity
  const dx = src.cx - dst.cx
  const dy = src.cy - dst.cy
  return Math.sqrt(dx * dx + dy * dy)
}

// ============================================================
// Port Tracker
// ============================================================

const PORT_GAP = 12

class PortTracker {
  private counts = new Map<string, number>()

  private calcOffset(n: number, side: Side, icon: IconRect, flip = false): number {
    if (n === 0) return 0
    const rank = Math.ceil(n / 2)
    const baseSign = n % 2 === 1 ? -1 : 1
    const sign = flip ? -baseSign : baseSign
    const offset = sign * rank * PORT_GAP
    const isHoriz = side === 'left' || side === 'right'
    const halfEdge = (isHoriz ? icon.h : icon.w) / 2 - 2
    return Math.max(-halfEdge, Math.min(halfEdge, offset))
  }

  /** 次に割り当てるoffset候補を返す（正と負の両方向） */
  peekOffsets(nodeId: string, side: Side, icon: IconRect): number[] {
    const key = `${nodeId}:${side}`
    const n = this.counts.get(key) ?? 0
    const primary = this.calcOffset(n, side, icon)
    if (n === 0) return [primary]  // 中央は1つだけ
    const flipped = this.calcOffset(n, side, icon, true)
    if (flipped === primary) return [primary]
    return [primary, flipped]
  }

  commitOffset(nodeId: string, side: Side, icon: IconRect, offset: number): void {
    const key = `${nodeId}:${side}`
    const n = this.counts.get(key) ?? 0
    this.counts.set(key, n + 1)
    // offset方向が反転していたら追加でカウントを進める
    const expected = this.calcOffset(n, side, icon)
    if (Math.abs(offset - expected) > 0.5) {
      // 反転offset採用 → 実質2つ分のスロットを使う
      this.counts.set(key, n + 2)
    }
  }
}

function sidePoint(icon: IconRect, side: Side, offset: number): Point {
  switch (side) {
    case 'top':    return { x: icon.cx + offset, y: icon.y }
    case 'bottom': return { x: icon.cx + offset, y: icon.y + icon.h }
    case 'left':   return { x: icon.x,           y: icon.cy + offset }
    case 'right':  return { x: icon.x + icon.w,  y: icon.cy + offset }
  }
}

// ============================================================
// All 16 side combinations
// ============================================================

const ALL_SIDES: Side[] = ['top', 'bottom', 'left', 'right']

function allSideCombinations(): Array<{ srcSide: Side; dstSide: Side }> {
  const result: Array<{ srcSide: Side; dstSide: Side }> = []
  for (const srcSide of ALL_SIDES) {
    for (const dstSide of ALL_SIDES) {
      result.push({ srcSide, dstSide })
    }
  }
  return result
}

const SIDE_COMBINATIONS = allSideCombinations()

// ============================================================
// Main
// ============================================================

export function routeAllEdges(
  nodes: Record<string, DiagramNode>,
  edges: DiagramEdge[],
): RoutedEdge[] {
  const icons = collectIconRects(nodes)
  const iconMap = new Map<string, IconRect>()
  for (const ic of icons) iconMap.set(ic.nodeId, ic)

  const sortedEdges = [...edges].sort((a, b) => iconDistance(a, iconMap) - iconDistance(b, iconMap))

  const obstacles: Rect[] = icons.map(ic => ({ x: ic.x, y: ic.y, w: ic.w, h: ic.h }))

  const routed: RoutedEdge[] = []
  const existingPaths: Point[][] = []
  const portTracker = new PortTracker()

  for (const edge of sortedEdges) {
    const srcIcon = iconMap.get(edge.sourceNodeId)
    const dstIcon = iconMap.get(edge.targetNodeId)

    if (!srcIcon || !dstIcon) {
      routed.push({
        edgeId: edge.id,
        waypoints: [],
        srcSide: 'right',
        dstSide: 'left',
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })
      continue
    }

    // 全16通りの辺パターン × 各パターンで直線/L字/Z字候補
    let bestPath: Point[] | null = null
    let bestSrcSide: Side = 'right'
    let bestDstSide: Side = 'left'
    let bestHits = Infinity
    let bestBends = Infinity
    let bestCross = Infinity
    let bestLen = Infinity

    let bestSrcOffset = 0
    let bestDstOffset = 0

    for (const { srcSide, dstSide } of SIDE_COMBINATIONS) {
      const srcOffsets = portTracker.peekOffsets(srcIcon.nodeId, srcSide, srcIcon)
      const dstOffsets = portTracker.peekOffsets(dstIcon.nodeId, dstSide, dstIcon)

      for (const srcOffset of srcOffsets) {
        for (const dstOffset of dstOffsets) {
          const srcPt = sidePoint(srcIcon, srcSide, srcOffset)
          const dstPt = sidePoint(dstIcon, dstSide, dstOffset)

          const candidates = generateCandidatePaths(srcPt, srcSide, dstPt, dstSide, obstacles)

          for (const { path, hits } of candidates) {
            const bends = countBends(path)
            const cross = countCrossings(path, existingPaths)
            const len = pathLength(path)

            // 選択基準: hits少 → bends少 → cross少 → len短
            if (hits < bestHits ||
                (hits === bestHits && bends < bestBends) ||
                (hits === bestHits && bends === bestBends && cross < bestCross) ||
                (hits === bestHits && bends === bestBends && cross === bestCross && len < bestLen)) {
              bestPath = path
              bestSrcSide = srcSide
              bestDstSide = dstSide
              bestSrcOffset = srcOffset
              bestDstOffset = dstOffset
              bestHits = hits
              bestBends = bends
              bestCross = cross
              bestLen = len
            }
          }
        }
      }
    }

    if (!bestPath) {
      // ありえないが念のため
      bestPath = []
    }

    portTracker.commitOffset(srcIcon.nodeId, bestSrcSide, srcIcon, bestSrcOffset)
    portTracker.commitOffset(dstIcon.nodeId, bestDstSide, dstIcon, bestDstOffset)

    existingPaths.push(bestPath)

    routed.push({
      edgeId: edge.id,
      waypoints: bestPath,
      srcSide: bestSrcSide,
      dstSide: bestDstSide,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
    })
  }

  return routed
}
