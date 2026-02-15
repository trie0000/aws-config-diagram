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
  segHitsRect, MARGIN,
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
// Post-process: center port groups on icon edges
// ============================================================

/**
 * 同じアイコン辺にあるポートグループを辺の中央に寄せる。
 * - 直線パス（bends=0）を含むグループはスキップ
 * - 障害物に衝突する場合はスキップ
 */
interface PortEntry {
  routedIdx: number  // routed配列のindex
  isSrc: boolean     // true=src端, false=dst端
  coord: number      // ポート位置のoffset方向座標 (top/bottom→x, left/right→y)
}

function centerPorts(routed: RoutedEdge[], iconMap: Map<string, IconRect>, obstacles: Rect[]): void {
  const groups = new Map<string, { side: Side; nodeId: string; entries: PortEntry[] }>()

  for (let ri = 0; ri < routed.length; ri++) {
    const r = routed[ri]
    if (r.waypoints.length < 4) continue
    if (!r.sourceNodeId || !r.targetNodeId) continue

    // src端
    const srcKey = `${r.sourceNodeId}:${r.srcSide}`
    if (!groups.has(srcKey)) {
      groups.set(srcKey, { side: r.srcSide, nodeId: r.sourceNodeId, entries: [] })
    }
    const srcIsHoriz = r.srcSide === 'left' || r.srcSide === 'right'
    const srcCoord = srcIsHoriz ? r.waypoints[0].y : r.waypoints[0].x
    groups.get(srcKey)!.entries.push({ routedIdx: ri, isSrc: true, coord: srcCoord })

    // dst端
    const dstKey = `${r.targetNodeId}:${r.dstSide}`
    if (!groups.has(dstKey)) {
      groups.set(dstKey, { side: r.dstSide, nodeId: r.targetNodeId, entries: [] })
    }
    const dstIsHoriz = r.dstSide === 'left' || r.dstSide === 'right'
    const wp = r.waypoints
    const dstCoord = dstIsHoriz ? wp[wp.length - 1].y : wp[wp.length - 1].x
    groups.get(dstKey)!.entries.push({ routedIdx: ri, isSrc: false, coord: dstCoord })
  }

  for (const [, group] of groups) {
    if (group.entries.length < 2) continue

    const icon = iconMap.get(group.nodeId)
    if (!icon) continue

    // 直線パス（bends=0）を含むグループはスキップ
    let hasStraight = false
    for (const entry of group.entries) {
      if (countBends(routed[entry.routedIdx].waypoints) === 0) {
        hasStraight = true
        break
      }
    }
    if (hasStraight) continue

    const isHoriz = group.side === 'left' || group.side === 'right'
    const edgeCenter = isHoriz ? icon.cy : icon.cx
    const halfEdge = (isHoriz ? icon.h : icon.w) / 2 - 2

    // グループの座標範囲
    const coords = group.entries.map(e => e.coord)
    const minCoord = Math.min(...coords)
    const maxCoord = Math.max(...coords)
    const groupCenter = (minCoord + maxCoord) / 2

    let shift = edgeCenter - groupCenter

    // シフト後にポートがアイコン辺を超えないようにクランプ
    const shiftedMin = minCoord + shift
    const shiftedMax = maxCoord + shift
    if (shiftedMin < edgeCenter - halfEdge) {
      shift = (edgeCenter - halfEdge) - minCoord
    }
    if (shiftedMax > edgeCenter + halfEdge) {
      shift = (edgeCenter + halfEdge) - maxCoord
    }

    // シフト量が小さければスキップ
    if (Math.abs(shift) < 1) continue

    // 安全性チェック: シフト後に障害物に衝突しないか
    let safe = true
    for (const entry of group.entries) {
      const wp = routed[entry.routedIdx].waypoints
      const testWp = wp.map(p => ({ ...p }))
      applyShift(testWp, entry.isSrc, group.side, shift)
      // 全セグメントが障害物に衝突しないかチェック
      for (let i = 1; i < testWp.length - 2; i++) {
        for (const obs of obstacles) {
          if (segHitsRect(testWp[i].x, testWp[i].y, testWp[i + 1].x, testWp[i + 1].y, obs, MARGIN)) {
            safe = false
            break
          }
        }
        if (!safe) break
      }
      if (!safe) break
    }
    if (!safe) continue

    // シフト適用
    for (const entry of group.entries) {
      applyShift(routed[entry.routedIdx].waypoints, entry.isSrc, group.side, shift)
    }
  }
}

/**
 * パスのsrc端またはdst端をoffset方向にシフトする。
 * ポート点、stem点、およびstemと同じ軸を共有するエルボー点をまとめて移動。
 */
function applyShift(wp: Point[], isSrc: boolean, side: Side, shift: number): void {
  const isHoriz = side === 'left' || side === 'right'

  if (isSrc) {
    // src端: wp[0]=srcPt, wp[1]=srcStem, wp[2]=elbow(maybe)
    if (isHoriz) {
      // left/right stem → stem は横方向 → offset はy
      wp[0].y += shift
      wp[1].y += shift
      // stemの延長上（元々同じy）にあるエルボーも移動
      if (wp.length > 2 && Math.abs((wp[1].y - shift) - wp[2].y) < 0.5) {
        wp[2].y += shift
      }
    } else {
      // top/bottom stem → stem は縦方向 → offset はx
      wp[0].x += shift
      wp[1].x += shift
      // stemの延長上（同じx）にあるエルボーを移動
      if (wp.length > 2 && Math.abs((wp[1].x - shift) - wp[2].x) < 0.5) {
        wp[2].x += shift
      }
    }
  } else {
    // dst端: wp[last]=dstPt, wp[last-1]=dstStem, wp[last-2]=elbow(maybe)
    const n = wp.length
    if (isHoriz) {
      wp[n - 1].y += shift
      wp[n - 2].y += shift
      if (n > 2 && Math.abs((wp[n - 2].y - shift) - wp[n - 3].y) < 0.5) {
        wp[n - 3].y += shift
      }
    } else {
      wp[n - 1].x += shift
      wp[n - 2].x += shift
      if (n > 2 && Math.abs((wp[n - 2].x - shift) - wp[n - 3].x) < 0.5) {
        wp[n - 3].x += shift
      }
    }
  }
}

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

  centerPorts(routed, iconMap, obstacles)

  return routed
}
