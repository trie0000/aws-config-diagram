/**
 * edgeRouter.bfs.ts: ピクセル座標ベースの直交経路探索
 *
 * アルゴリズム:
 *   1. src辺面 → 法線方向にSTEM_LEN延伸（出口点）
 *   2. dst辺面 → 法線方向にSTEM_LEN延伸（入口点）
 *   3. 出口点→入口点をL字/Z字パターンで接続
 *   4. 全候補を返し、呼び出し元でスコアリング
 *
 * Version: 15.0.0
 */

import type { Side, Point } from './edgeRouter.types'

// ============================================================
// Types
// ============================================================

export interface Rect {
  x: number; y: number; w: number; h: number
}

export interface PathCandidate {
  path: Point[]
  hits: number  // 障害物貫通セグメント数（stemは除く）
}

// ============================================================
// Constants
// ============================================================

export const MARGIN = 8
const STEM_LEN = 20

// ============================================================
// Segment-Rect intersection
// ============================================================

export function segHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect, margin: number): boolean {
  const rx1 = r.x - margin
  const ry1 = r.y - margin
  const rx2 = r.x + r.w + margin
  const ry2 = r.y + r.h + margin

  if (Math.abs(ay - by) < 0.5) {
    if (ay <= ry1 || ay >= ry2) return false
    const minX = Math.min(ax, bx)
    const maxX = Math.max(ax, bx)
    return maxX > rx1 && minX < rx2
  }
  if (Math.abs(ax - bx) < 0.5) {
    if (ax <= rx1 || ax >= rx2) return false
    const minY = Math.min(ay, by)
    const maxY = Math.max(ay, by)
    return maxY > ry1 && minY < ry2
  }
  return false
}

/**
 * 中間経路（stemを除く）が障害物と交差するセグメント数を返す。
 * path = [srcPt, srcStem, ..., dstStem, dstPt]
 * チェック対象: index 1..length-3 のセグメント（srcStem→...→dstStem）
 */
function countObstacleHits(path: Point[], obstacles: Rect[], margin: number): number {
  let hits = 0
  for (let i = 1; i < path.length - 2; i++) {
    const a = path[i], b = path[i + 1]
    for (const r of obstacles) {
      if (segHitsRect(a.x, a.y, b.x, b.y, r, margin)) {
        hits++
        break // 1セグメントにつき1カウント
      }
    }
  }
  return hits
}

// ============================================================
// Stem point
// ============================================================

function stemPoint(pt: Point, side: Side, len: number): Point {
  switch (side) {
    case 'top':    return { x: pt.x, y: pt.y - len }
    case 'bottom': return { x: pt.x, y: pt.y + len }
    case 'left':   return { x: pt.x - len, y: pt.y }
    case 'right':  return { x: pt.x + len, y: pt.y }
  }
}

// ============================================================
// Path candidates: straight, L-shape, Z-shape
// ============================================================

function simplify(path: Point[]): Point[] {
  if (path.length <= 2) return path
  const result: Point[] = [path[0]]
  for (let i = 1; i < path.length - 1; i++) {
    if (i === 1 || i === path.length - 2) {
      result.push(path[i])
      continue
    }
    const prev = result[result.length - 1]
    const curr = path[i]
    const next = path[i + 1]
    const sameX = Math.abs(prev.x - curr.x) < 0.5 && Math.abs(curr.x - next.x) < 0.5
    const sameY = Math.abs(prev.y - curr.y) < 0.5 && Math.abs(curr.y - next.y) < 0.5
    if (!sameX && !sameY) {
      result.push(curr)
    }
  }
  result.push(path[path.length - 1])
  return result
}

// ============================================================
// Public API
// ============================================================

/**
 * 全候補パスを生成して返す。スコアリングは呼び出し元で行う。
 */
export function generateCandidatePaths(
  srcPt: Point, srcSide: Side,
  dstPt: Point, dstSide: Side,
  obstacles: Rect[],
): PathCandidate[] {
  const srcStem = stemPoint(srcPt, srcSide, STEM_LEN)
  const dstStem = stemPoint(dstPt, dstSide, STEM_LEN)

  const rawCandidates: Point[][] = []

  // 直線（同一軸上）
  if (Math.abs(srcStem.x - dstStem.x) < 0.5 || Math.abs(srcStem.y - dstStem.y) < 0.5) {
    rawCandidates.push([srcPt, srcStem, dstStem, dstPt])
  }

  // L字（2通り）
  rawCandidates.push([srcPt, srcStem, { x: dstStem.x, y: srcStem.y }, dstStem, dstPt])
  rawCandidates.push([srcPt, srcStem, { x: srcStem.x, y: dstStem.y }, dstStem, dstPt])

  // Z字（2通り）
  const midX = (srcStem.x + dstStem.x) / 2
  const midY = (srcStem.y + dstStem.y) / 2
  rawCandidates.push([srcPt, srcStem, { x: midX, y: srcStem.y }, { x: midX, y: dstStem.y }, dstStem, dstPt])
  rawCandidates.push([srcPt, srcStem, { x: srcStem.x, y: midY }, { x: dstStem.x, y: midY }, dstStem, dstPt])

  return rawCandidates.map(raw => {
    const path = simplify(raw)
    const hits = countObstacleHits(path, obstacles, MARGIN)
    return { path, hits }
  })
}

// ============================================================
// Scoring utilities (exported for edgeRouter.ts)
// ============================================================

export function countBends(path: Point[]): number {
  if (path.length < 3) return 0
  let bends = 0
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1], curr = path[i], next = path[i + 1]
    const d1h = Math.abs(curr.x - prev.x) > 0.5
    const d2h = Math.abs(next.x - curr.x) > 0.5
    if (d1h !== d2h) bends++
  }
  return bends
}

function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aHoriz = Math.abs(a1.y - a2.y) < 0.5
  const bHoriz = Math.abs(b1.y - b2.y) < 0.5
  if (aHoriz === bHoriz) return false

  const [h1, h2, v1, v2] = aHoriz ? [a1, a2, b1, b2] : [b1, b2, a1, a2]
  const hY = h1.y
  const hMinX = Math.min(h1.x, h2.x)
  const hMaxX = Math.max(h1.x, h2.x)
  const vX = v1.x
  const vMinY = Math.min(v1.y, v2.y)
  const vMaxY = Math.max(v1.y, v2.y)

  return vX > hMinX && vX < hMaxX && hY >= vMinY && hY <= vMaxY
}

export function countCrossings(path: Point[], existingPaths: Point[][]): number {
  let count = 0
  for (let i = 0; i < path.length - 1; i++) {
    for (const other of existingPaths) {
      for (let j = 0; j < other.length - 1; j++) {
        if (segmentsCross(path[i], path[i + 1], other[j], other[j + 1])) {
          count++
        }
      }
    }
  }
  return count
}

export function pathLength(path: Point[]): number {
  let len = 0
  for (let i = 0; i < path.length - 1; i++) {
    len += Math.abs(path[i + 1].x - path[i].x) + Math.abs(path[i + 1].y - path[i].y)
  }
  return len
}

/**
 * 候補パスが既存パスとセグメント重なりを持つ数を返す。
 * 同方向（水平-水平 or 垂直-垂直）で座標範囲が重複する場合を重なりとする。
 * stem セグメント（index 0 と last）は除外する。
 */
export function countOverlap(path: Point[], existingPaths: Point[][]): number {
  let count = 0
  for (let i = 1; i < path.length - 2; i++) {
    const a1 = path[i], a2 = path[i + 1]
    const aHoriz = Math.abs(a1.y - a2.y) < 0.5
    const aVert = Math.abs(a1.x - a2.x) < 0.5
    if (!aHoriz && !aVert) continue

    let segOverlap = false
    for (const other of existingPaths) {
      if (segOverlap) break
      for (let j = 1; j < other.length - 2; j++) {
        const b1 = other[j], b2 = other[j + 1]

        if (aHoriz) {
          // 水平-水平: y座標が同一 かつ x範囲が重複
          if (Math.abs(b1.y - b2.y) > 0.5) continue
          if (Math.abs(a1.y - b1.y) > 0.5) continue
          const aMinX = Math.min(a1.x, a2.x)
          const aMaxX = Math.max(a1.x, a2.x)
          const bMinX = Math.min(b1.x, b2.x)
          const bMaxX = Math.max(b1.x, b2.x)
          if (aMaxX > bMinX && aMinX < bMaxX) {
            segOverlap = true
            break
          }
        } else if (aVert) {
          // 垂直-垂直: x座標が同一 かつ y範囲が重複
          if (Math.abs(b1.x - b2.x) > 0.5) continue
          if (Math.abs(a1.x - b1.x) > 0.5) continue
          const aMinY = Math.min(a1.y, a2.y)
          const aMaxY = Math.max(a1.y, a2.y)
          const bMinY = Math.min(b1.y, b2.y)
          const bMaxY = Math.max(b1.y, b2.y)
          if (aMaxY > bMinY && aMinY < bMaxY) {
            segOverlap = true
            break
          }
        }
      }
    }
    if (segOverlap) count++
  }
  return count
}

