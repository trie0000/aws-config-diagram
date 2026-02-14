/**
 * edgeRouter.postprocess.ts: ルーティング後処理
 *
 * 1. 交差削減 — 交差エッジを交差ペナルティ付きBFSで再ルーティング
 * 2. ポート分散 — 同じ接続点に集中するエッジを辺に沿って等間隔に分散
 * 3. エッジナッジ — 重なったセグメントを等間隔にオフセット
 */

import type { DiagramNode } from '../../types/diagram'
import type { RoutedEdge, ObstacleGrid, Side } from './edgeRouter.types'
import { GRID_SIZE, nodeIconRect, sideCenter, findClosestNode } from './edgeRouter.types'
import {
  unblockRect, reblockCells, bfsSearchWithPenalty, determineSide, simplifyPath,
} from './edgeRouter.bfs'

// ============================================================
// Crossing Reduction
// ============================================================

/** 2つの線分が交差するかどうかを判定（直交セグメント前提） */
function segmentsIntersect(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): boolean {
  const aHorizontal = Math.abs(ay1 - ay2) < 1
  const bHorizontal = Math.abs(by1 - by2) < 1

  if (aHorizontal === bHorizontal) return false

  let hx1: number, hx2: number, hy: number
  let vx: number, vy1: number, vy2: number

  if (aHorizontal) {
    hy = ay1
    hx1 = Math.min(ax1, ax2); hx2 = Math.max(ax1, ax2)
    vx = bx1
    vy1 = Math.min(by1, by2); vy2 = Math.max(by1, by2)
  } else {
    hy = by1
    hx1 = Math.min(bx1, bx2); hx2 = Math.max(bx1, bx2)
    vx = ax1
    vy1 = Math.min(ay1, ay2); vy2 = Math.max(ay1, ay2)
  }

  return vx > hx1 && vx < hx2 && hy > vy1 && hy < vy2
}

/** 2つのルーテッドエッジ間の交差数をカウント */
function countPairCrossings(a: RoutedEdge, b: RoutedEdge): number {
  let count = 0
  for (let i = 0; i < a.waypoints.length - 1; i++) {
    const a1 = a.waypoints[i], a2 = a.waypoints[i + 1]
    for (let j = 0; j < b.waypoints.length - 1; j++) {
      const b1 = b.waypoints[j], b2 = b.waypoints[j + 1]
      if (segmentsIntersect(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) {
        count++
      }
    }
  }
  return count
}

/** あるエッジが他全エッジと交差する回数 */
function edgeCrossings(idx: number, routed: RoutedEdge[]): number {
  let total = 0
  for (let j = 0; j < routed.length; j++) {
    if (j === idx) continue
    total += countPairCrossings(routed[idx], routed[j])
  }
  return total
}

/**
 * 他エッジのセグメントが通るグリッドセルに交差ペナルティを設定するマップを構築。
 */
function buildPenaltyMap(
  excludeIdx: number,
  routed: RoutedEdge[],
): Map<string, 'h' | 'v'> {
  const map = new Map<string, 'h' | 'v'>()

  for (let i = 0; i < routed.length; i++) {
    if (i === excludeIdx) continue
    const wp = routed[i].waypoints
    for (let si = 0; si < wp.length - 1; si++) {
      const a = wp[si], b = wp[si + 1]
      const dx = Math.abs(b.x - a.x)
      const dy = Math.abs(b.y - a.y)

      if (dy < 1 && dx >= 1) {
        const y = Math.round(a.y / GRID_SIZE)
        const x1 = Math.min(Math.round(a.x / GRID_SIZE), Math.round(b.x / GRID_SIZE))
        const x2 = Math.max(Math.round(a.x / GRID_SIZE), Math.round(b.x / GRID_SIZE))
        for (let x = x1; x <= x2; x++) {
          map.set(`${x},${y}`, 'h')
        }
      } else if (dx < 1 && dy >= 1) {
        const x = Math.round(a.x / GRID_SIZE)
        const y1 = Math.min(Math.round(a.y / GRID_SIZE), Math.round(b.y / GRID_SIZE))
        const y2 = Math.max(Math.round(a.y / GRID_SIZE), Math.round(b.y / GRID_SIZE))
        for (let y = y1; y <= y2; y++) {
          map.set(`${x},${y}`, 'v')
        }
      }
    }
  }

  return map
}

/**
 * 交差削減: 交差に関与するエッジを交差ペナルティ付き BFS で再ルーティング。
 * 交差数が多いエッジから優先し、結果の交差が減れば採用。
 */
export function reduceCrossings(
  routed: RoutedEdge[],
  nodes: Record<string, DiagramNode>,
  grid: ObstacleGrid,
): void {
  const crossCounts: Array<{ idx: number; count: number }> = []
  for (let i = 0; i < routed.length; i++) {
    if (routed[i].waypoints.length < 2) continue
    const cnt = edgeCrossings(i, routed)
    if (cnt > 0) crossCounts.push({ idx: i, count: cnt })
  }
  if (crossCounts.length === 0) return

  crossCounts.sort((a, b) => b.count - a.count)

  for (const { idx } of crossCounts) {
    const r = routed[idx]
    if (r.waypoints.length < 2) continue

    const beforeCross = edgeCrossings(idx, routed)
    if (beforeCross === 0) continue

    const srcNode = findClosestNode(r.waypoints[0], nodes)
    const dstNode = findClosestNode(r.waypoints[r.waypoints.length - 1], nodes)
    if (!srcNode || !dstNode) continue

    const srcRect = nodeIconRect(srcNode)
    const dstRect = nodeIconRect(dstNode)

    const penaltyMap = buildPenaltyMap(idx, routed)

    const removedSrc = unblockRect(grid, srcRect)
    const removedDst = unblockRect(grid, dstRect)

    try {
      const srcCx = srcRect.x + srcRect.w / 2
      const srcCy = srcRect.y + srcRect.h / 2
      const dstCx = dstRect.x + dstRect.w / 2
      const dstCy = dstRect.y + dstRect.h / 2

      const result = bfsSearchWithPenalty(srcCx, srcCy, dstCx, dstCy, grid, penaltyMap)

      if (result) {
        const srcSide = determineSide(result.gridPath, 'src')
        const dstSide = determineSide(result.gridPath, 'dst')
        const p1 = sideCenter(srcNode, srcSide)
        const p2 = sideCenter(dstNode, dstSide)
        const wp = simplifyPath(result.gridPath, p1, p2)

        const origWp = r.waypoints
        const origSrc = r.srcSide
        const origDst = r.dstSide
        r.waypoints = wp
        r.srcSide = srcSide
        r.dstSide = dstSide
        const afterCross = edgeCrossings(idx, routed)

        if (afterCross >= beforeCross) {
          r.waypoints = origWp
          r.srcSide = origSrc
          r.dstSide = origDst
        }
      }
    } finally {
      reblockCells(grid, removedSrc)
      reblockCells(grid, removedDst)
    }
  }
}

// ============================================================
// Port Spreading
// ============================================================

/** ポート間のオフセット（px） */
const PORT_SPREAD = 12

/**
 * 同じノードの同じ辺に接続する複数エッジの接続点を辺に沿って等間隔に分散。
 * src/dst を区別せず、同じ接続点座標のエッジを1グループとして扱う。
 */
export function spreadPorts(routed: RoutedEdge[]): void {
  if (routed.length < 2) return

  interface PortEntry {
    edgeIdx: number
    end: 'src' | 'dst'
    side: Side
    targetCoord: number
  }

  const portGroups = new Map<string, PortEntry[]>()

  for (let ei = 0; ei < routed.length; ei++) {
    const r = routed[ei]
    if (r.waypoints.length < 2) continue

    const srcPt = r.waypoints[0]
    const dstPt = r.waypoints[r.waypoints.length - 1]

    const srcGroupKey = `port:${Math.round(srcPt.x)}:${Math.round(srcPt.y)}`
    if (!portGroups.has(srcGroupKey)) portGroups.set(srcGroupKey, [])
    portGroups.get(srcGroupKey)!.push({
      edgeIdx: ei,
      end: 'src',
      side: r.srcSide,
      targetCoord: (r.srcSide === 'left' || r.srcSide === 'right') ? dstPt.y : dstPt.x,
    })

    const dstGroupKey = `port:${Math.round(dstPt.x)}:${Math.round(dstPt.y)}`
    if (!portGroups.has(dstGroupKey)) portGroups.set(dstGroupKey, [])
    portGroups.get(dstGroupKey)!.push({
      edgeIdx: ei,
      end: 'dst',
      side: r.dstSide,
      targetCoord: (r.dstSide === 'left' || r.dstSide === 'right') ? srcPt.y : srcPt.x,
    })
  }

  for (const [, entries] of portGroups) {
    if (entries.length < 2) continue

    entries.sort((a, b) => a.targetCoord - b.targetCoord)

    const count = entries.length
    for (let rank = 0; rank < count; rank++) {
      const offset = (rank - (count - 1) / 2) * PORT_SPREAD
      const entry = entries[rank]
      const r = routed[entry.edgeIdx]
      const wp = r.waypoints

      if (entry.end === 'src') {
        const pt = wp[0]
        if (entry.side === 'left' || entry.side === 'right') {
          pt.y += offset
          if (wp.length >= 2 && Math.abs(wp[1].y - (pt.y - offset)) < 1) {
            wp[1].y += offset
          }
        } else {
          pt.x += offset
          if (wp.length >= 2 && Math.abs(wp[1].x - (pt.x - offset)) < 1) {
            wp[1].x += offset
          }
        }
      } else {
        const pt = wp[wp.length - 1]
        if (entry.side === 'left' || entry.side === 'right') {
          pt.y += offset
          if (wp.length >= 2 && Math.abs(wp[wp.length - 2].y - (pt.y - offset)) < 1) {
            wp[wp.length - 2].y += offset
          }
        } else {
          pt.x += offset
          if (wp.length >= 2 && Math.abs(wp[wp.length - 2].x - (pt.x - offset)) < 1) {
            wp[wp.length - 2].x += offset
          }
        }
      }
    }
  }
}

// ============================================================
// Edge Nudging
// ============================================================

interface Segment {
  edgeIdx: number
  segIdx: number
  dir: 'h' | 'v'
  pos: number
  min: number
  max: number
}

/** ナッジ間隔（px） */
const NUDGE_STEP = 10

/** 同一線上判定の許容誤差（px） */
const NUDGE_SNAP = 4

/**
 * 同じ線分上を通る複数エッジのセグメントを等間隔にオフセットする。
 * waypoints を in-place で書き換える。
 */
export function nudgeEdges(routed: RoutedEdge[]): void {
  // 1. 全セグメントを抽出
  const segments: Segment[] = []
  for (let ei = 0; ei < routed.length; ei++) {
    const wp = routed[ei].waypoints
    for (let si = 0; si < wp.length - 1; si++) {
      const a = wp[si], b = wp[si + 1]
      const dx = Math.abs(b.x - a.x)
      const dy = Math.abs(b.y - a.y)
      if (dx < 1 && dy < 1) continue
      if (dy < 1) {
        segments.push({ edgeIdx: ei, segIdx: si, dir: 'h', pos: a.y, min: Math.min(a.x, b.x), max: Math.max(a.x, b.x) })
      } else if (dx < 1) {
        segments.push({ edgeIdx: ei, segIdx: si, dir: 'v', pos: a.x, min: Math.min(a.y, b.y), max: Math.max(a.y, b.y) })
      }
    }
  }

  // 2. 同一方向 + 近い位置 + 範囲重複でグループ化
  const used = new Array(segments.length).fill(false)

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue
    const group = [i]
    used[i] = true
    const si = segments[i]

    for (let j = i + 1; j < segments.length; j++) {
      if (used[j]) continue
      const sj = segments[j]
      if (si.dir !== sj.dir) continue
      if (Math.abs(si.pos - sj.pos) > NUDGE_SNAP) continue
      if (si.max <= sj.min || sj.max <= si.min) continue
      if (si.edgeIdx === sj.edgeIdx && si.segIdx === sj.segIdx) continue
      group.push(j)
      used[j] = true
    }

    if (group.length < 2) continue

    // 3. グループ内のセグメントを等間隔にオフセット
    const count = group.length
    for (let rank = 0; rank < count; rank++) {
      const offset = (rank - (count - 1) / 2) * NUDGE_STEP
      const seg = segments[group[rank]]
      const wp = routed[seg.edgeIdx].waypoints
      const a = wp[seg.segIdx]
      const b = wp[seg.segIdx + 1]

      if (seg.dir === 'h') {
        a.y += offset
        b.y += offset
      } else {
        a.x += offset
        b.x += offset
      }
    }
  }
}
