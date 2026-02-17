/**
 * edgeRouter.ts: 決定的直交エッジルーティング（オーケストレータ）
 *
 * アルゴリズム:
 *   1. 距離が短いエッジから順に処理
 *   2. 各エッジで全16通り(4×4)の辺パターンを試す
 *   3. 各パターンで直線/L字/Z字候補を生成
 *   4. 除外: 既存パスとの重なり（フォールバックあり）、パス欠陥
 *   5. 選択基準: アイコン貫通少 → 曲がり少 → 交差少 → 距離短
 *   6. ポートは同じ辺に来るエッジごとに中央から外側へ順に分散
 *
 * Version: 15.5.0
 */

import type { DiagramNode, DiagramEdge } from '../../types/diagram'
import type { RoutedEdge, Side, Point } from './edgeRouter.types'
import { CONTAINER_TYPES, nodeIconRect } from './edgeRouter.types'
import {
  generateCandidatePaths,
  countBends, countCrossings, countOverlap, pathLength,
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

/** Phase 1 でのポート最小間隔（重なり防止のみ） */
const MIN_PORT_GAP = 2

class PortTracker {
  /** 各 (nodeId:side) に確定済みのoffset座標リスト */
  private committed = new Map<string, number[]>()

  /** ポート候補を返す: 中央→外側のみ（最小間隔） */
  peekOffsets(nodeId: string, side: Side, icon: IconRect): number[] {
    const key = `${nodeId}:${side}`
    const existing = this.committed.get(key)

    // まだポートがない → 中央のみ
    if (!existing || existing.length === 0) return [0]

    const isHoriz = side === 'left' || side === 'right'
    const halfEdge = (isHoriz ? icon.h : icon.w) / 2 - 2

    const sorted = [...existing].sort((a, b) => a - b)
    const candidates: number[] = []

    // 外側候補のみ: 最小の外側、最大の外側（最小間隔）
    const outerLow = sorted[0] - MIN_PORT_GAP
    if (outerLow >= -halfEdge) candidates.push(outerLow)
    const outerHigh = sorted[sorted.length - 1] + MIN_PORT_GAP
    if (outerHigh <= halfEdge) candidates.push(outerHigh)

    return candidates.length > 0 ? candidates : [0]
  }

  commitOffset(nodeId: string, side: Side, _icon: IconRect, offset: number): void {
    const key = `${nodeId}:${side}`
    const list = this.committed.get(key)
    if (list) {
      list.push(offset)
    } else {
      this.committed.set(key, [offset])
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
// Path defect detection
// ============================================================

/** パスに後戻り（U字）または斜め線がないか検証 */
function hasPathDefect(wp: Point[]): boolean {
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i], b = wp[i + 1]
    // 斜め線チェック: xもyも異なるセグメントは不正
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return true
  }
  for (let i = 0; i < wp.length - 2; i++) {
    const a = wp[i], b = wp[i + 1], c = wp[i + 2]
    // 後戻りチェック: 3点が同軸で方向が反転
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) {
      if ((b.y - a.y) * (c.y - b.y) < 0) return true
    }
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5) {
      if ((b.x - a.x) * (c.x - b.x) < 0) return true
    }
  }
  return false
}

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
// Post-process: spread ports evenly on each icon edge
// ============================================================

interface SpreadPortEntry {
  routedIdx: number
  isSrc: boolean        // true=src端, false=dst端
  offset: number        // アイコン辺中央からのoffset
  hasBend: boolean      // 曲がり角がある（=移動可能）
}

/**
 * 同じアイコン辺のポート群を均等に再配置する。
 *
 * アルゴリズム:
 *   1. 曲がり角がない接続線（直線 bends=0）は「固定」として動かさない
 *   2. 両端の外側ポートをアイコン隅からアイコン辺長の10%離れた位置に設定
 *   3. 固定ポートで区切られた区間ごとに、間のポートを等間隔に配置
 */
function spreadPorts(routed: RoutedEdge[], iconMap: Map<string, IconRect>, _obstacles: Rect[]): void {
  // 1. 各アイコン辺ごとにポートを収集
  const groups = new Map<string, { side: Side; nodeId: string; entries: SpreadPortEntry[] }>()

  for (let ri = 0; ri < routed.length; ri++) {
    const r = routed[ri]
    if (r.waypoints.length < 2) continue
    if (!r.sourceNodeId || !r.targetNodeId) continue

    const srcIcon = iconMap.get(r.sourceNodeId)
    const dstIcon = iconMap.get(r.targetNodeId)
    if (!srcIcon || !dstIcon) continue

    const bends = countBends(r.waypoints)

    // src端
    const srcKey = `${r.sourceNodeId}:${r.srcSide}`
    if (!groups.has(srcKey)) {
      groups.set(srcKey, { side: r.srcSide, nodeId: r.sourceNodeId, entries: [] })
    }
    const srcIsHoriz = r.srcSide === 'left' || r.srcSide === 'right'
    const srcOffset = srcIsHoriz
      ? r.waypoints[0].y - srcIcon.cy
      : r.waypoints[0].x - srcIcon.cx
    groups.get(srcKey)!.entries.push({ routedIdx: ri, isSrc: true, offset: srcOffset, hasBend: bends > 0 })

    // dst端
    const dstKey = `${r.targetNodeId}:${r.dstSide}`
    if (!groups.has(dstKey)) {
      groups.set(dstKey, { side: r.dstSide, nodeId: r.targetNodeId, entries: [] })
    }
    const wp = r.waypoints
    const dstIsHoriz = r.dstSide === 'left' || r.dstSide === 'right'
    const dstOffset = dstIsHoriz
      ? wp[wp.length - 1].y - dstIcon.cy
      : wp[wp.length - 1].x - dstIcon.cx
    groups.get(dstKey)!.entries.push({ routedIdx: ri, isSrc: false, offset: dstOffset, hasBend: bends > 0 })
  }

  // 2. 各グループを処理
  for (const [, group] of groups) {
    if (group.entries.length < 2) continue

    const icon = iconMap.get(group.nodeId)
    if (!icon) continue

    const isHoriz = group.side === 'left' || group.side === 'right'
    const edgeLen = isHoriz ? icon.h : icon.w
    const halfEdge = edgeLen / 2 - 2
    if (halfEdge <= 0) continue  // アイコンが小さすぎる場合はスキップ

    // 隅からのマージン = アイコン辺の長さの10%
    const edgeMargin = edgeLen * 0.1

    // offset順にソート
    const sorted = [...group.entries].sort((a, b) => a.offset - b.offset)

    // 新しいoffset配列を計算
    const newOffsets = computeSpreadOffsets(sorted, halfEdge, edgeMargin)
    if (!newOffsets) continue

    // 変化がなければスキップ
    const maxShift = Math.max(...sorted.map((e, i) => Math.abs(newOffsets[i] - e.offset)))
    if (maxShift < 0.5) continue

    // シフト適用（アイコン辺の範囲内なので安全性チェック不要）
    for (let i = 0; i < sorted.length; i++) {
      const shift = newOffsets[i] - sorted[i].offset
      if (Math.abs(shift) < 0.1) continue
      applyShift(routed[sorted[i].routedIdx].waypoints, sorted[i].isSrc, group.side, shift)
    }
  }
}

/**
 * ポート群の新しいoffset座標を計算する。
 *
 * - 固定ポート（hasBend=false）は動かさない
 * - 両端の外側ポートを隅からマージン以上離す
 * - 固定ポートで区切られた区間ごとに等間隔配置
 *
 * @param edgeMargin 隅からのマージン（アイコン辺長の10%）
 * @returns 新しいoffset配列（sorted と同じ順序）。変更不要なら null。
 */
function computeSpreadOffsets(sorted: SpreadPortEntry[], halfEdge: number, edgeMargin: number): number[] | null {
  const n = sorted.length
  const newOffsets = sorted.map(e => e.offset)

  // 固定ポート（直線、曲がり角なし）のインデックスを収集
  const fixedIndices: number[] = []
  for (let i = 0; i < n; i++) {
    if (!sorted[i].hasBend) fixedIndices.push(i)
  }

  // 境界制約を含む「アンカー」リストを構築
  // アンカー = 位置が確定しているポイント（固定ポート + 両端の境界）
  interface Anchor { sortedIdx: number; offset: number }
  const anchors: Anchor[] = []

  // 左端（最小offset側）のアンカー
  const minBound = -halfEdge + edgeMargin
  if (fixedIndices.length > 0 && fixedIndices[0] === 0) {
    // 一番左が固定 → そのまま
    anchors.push({ sortedIdx: 0, offset: sorted[0].offset })
  } else {
    // 一番左は移動可能 → 隅からマージンの位置に配置
    const firstFixed = fixedIndices.length > 0 ? fixedIndices[0] : -1
    let leftOffset = minBound
    // 最初の固定ポートがある場合、その位置より手前に留める
    if (firstFixed > 0) {
      const maxLeft = sorted[firstFixed].offset - edgeMargin * firstFixed
      leftOffset = Math.min(leftOffset, maxLeft)
    }
    // 境界内に収める
    leftOffset = Math.max(-halfEdge, leftOffset)
    anchors.push({ sortedIdx: 0, offset: leftOffset })
    newOffsets[0] = leftOffset
  }

  // 固定ポートをアンカーに追加
  for (const fi of fixedIndices) {
    anchors.push({ sortedIdx: fi, offset: sorted[fi].offset })
    newOffsets[fi] = sorted[fi].offset
  }

  // 右端（最大offset側）のアンカー
  const maxBound = halfEdge - edgeMargin
  if (fixedIndices.length > 0 && fixedIndices[fixedIndices.length - 1] === n - 1) {
    // 一番右が固定 → そのまま
    anchors.push({ sortedIdx: n - 1, offset: sorted[n - 1].offset })
  } else {
    const lastFixed = fixedIndices.length > 0 ? fixedIndices[fixedIndices.length - 1] : -1
    let rightOffset = maxBound
    // 最後の固定ポートがある場合、その位置より後ろに留める
    if (lastFixed >= 0 && lastFixed < n - 1) {
      const minRight = sorted[lastFixed].offset + edgeMargin * (n - 1 - lastFixed)
      rightOffset = Math.max(rightOffset, minRight)
    }
    // 境界内に収める
    rightOffset = Math.min(halfEdge, rightOffset)
    anchors.push({ sortedIdx: n - 1, offset: rightOffset })
    newOffsets[n - 1] = rightOffset
  }

  // アンカーをsortedIdx順にソート・重複除去
  anchors.sort((a, b) => a.sortedIdx - b.sortedIdx)
  const uniqueAnchors: Anchor[] = []
  for (const a of anchors) {
    if (uniqueAnchors.length === 0 || uniqueAnchors[uniqueAnchors.length - 1].sortedIdx !== a.sortedIdx) {
      uniqueAnchors.push(a)
    }
  }

  // アンカー間の区間で等間隔配置
  for (let ai = 0; ai < uniqueAnchors.length - 1; ai++) {
    const fromIdx = uniqueAnchors[ai].sortedIdx
    const toIdx = uniqueAnchors[ai + 1].sortedIdx
    const fromOffset = uniqueAnchors[ai].offset
    const toOffset = uniqueAnchors[ai + 1].offset
    const count = toIdx - fromIdx

    if (count <= 1) continue  // 隣接するアンカー間にポートがない

    const step = (toOffset - fromOffset) / count
    for (let j = 1; j < count; j++) {
      newOffsets[fromIdx + j] = fromOffset + step * j
    }
  }

  return newOffsets
}

// ============================================================
// Post-process: reassign port positions to minimize crossings
// ============================================================

interface PortGroupEntry {
  routedIdx: number
  isSrc: boolean
  currentOffset: number
}

/** 順列を生成する（要素数5以下を想定） */
function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr]
  const result: T[][] = []
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm])
    }
  }
  return result
}

/**
 * ポートのシフトを waypoints に適用する（applyShift と同様のロジック）。
 * ポート点 + stem点 + 同軸エルボーをまとめて移動。
 */
function shiftPortEnd(wp: Point[], isSrc: boolean, side: Side, shift: number): void {
  const isHoriz = side === 'left' || side === 'right'

  if (isSrc) {
    if (isHoriz) {
      const oldY = wp[0].y
      wp[0].y += shift
      wp[1].y += shift
      if (wp.length > 2 && Math.abs(wp[2].y - oldY) < 0.5) {
        wp[2].y += shift
      }
    } else {
      const oldX = wp[0].x
      wp[0].x += shift
      wp[1].x += shift
      if (wp.length > 2 && Math.abs(wp[2].x - oldX) < 0.5) {
        wp[2].x += shift
      }
    }
  } else {
    const n = wp.length
    if (isHoriz) {
      const oldY = wp[n - 1].y
      wp[n - 1].y += shift
      wp[n - 2].y += shift
      if (n > 2 && Math.abs(wp[n - 3].y - oldY) < 0.5) {
        wp[n - 3].y += shift
      }
    } else {
      const oldX = wp[n - 1].x
      wp[n - 1].x += shift
      wp[n - 2].x += shift
      if (n > 2 && Math.abs(wp[n - 3].x - oldX) < 0.5) {
        wp[n - 3].x += shift
      }
    }
  }
}

/**
 * 同じアイコン辺のポート割り当てを入れ替えて交差を最小化する。
 * ルーティング完了後、centerPorts/spreadPorts の前に実行。
 */
function reassignPorts(routed: RoutedEdge[], iconMap: Map<string, IconRect>, obstacles: Rect[]): void {
  // 1. 各アイコン辺のポートグループを構築
  const groups = new Map<string, { side: Side; entries: PortGroupEntry[] }>()

  for (let ri = 0; ri < routed.length; ri++) {
    const r = routed[ri]
    if (r.waypoints.length < 4) continue
    if (!r.sourceNodeId || !r.targetNodeId) continue

    const srcIcon = iconMap.get(r.sourceNodeId)
    const dstIcon = iconMap.get(r.targetNodeId)
    if (!srcIcon || !dstIcon) continue

    // src端
    const srcIsHoriz = r.srcSide === 'left' || r.srcSide === 'right'
    const srcOffset = srcIsHoriz
      ? r.waypoints[0].y - srcIcon.cy
      : r.waypoints[0].x - srcIcon.cx
    const srcKey = `${r.sourceNodeId}:${r.srcSide}`
    if (!groups.has(srcKey)) groups.set(srcKey, { side: r.srcSide, entries: [] })
    groups.get(srcKey)!.entries.push({ routedIdx: ri, isSrc: true, currentOffset: srcOffset })

    // dst端
    const wp = r.waypoints
    const dstIsHoriz = r.dstSide === 'left' || r.dstSide === 'right'
    const dstOffset = dstIsHoriz
      ? wp[wp.length - 1].y - dstIcon.cy
      : wp[wp.length - 1].x - dstIcon.cx
    const dstKey = `${r.targetNodeId}:${r.dstSide}`
    if (!groups.has(dstKey)) groups.set(dstKey, { side: r.dstSide, entries: [] })
    groups.get(dstKey)!.entries.push({ routedIdx: ri, isSrc: false, currentOffset: dstOffset })
  }

  // 2. 全パスのリストを構築（交差計算用）
  const allPaths = routed.map(r => r.waypoints)

  // 3. 各グループで順列探索
  for (const [, group] of groups) {
    const entries = group.entries
    if (entries.length < 2) continue
    // 6本以上は稀だがスキップ（順列爆発防止）
    if (entries.length > 5) continue

    const offsets = entries.map(e => e.currentOffset)
    const sortedOffsets = [...offsets].sort((a, b) => a - b)

    // 現在の交差数
    let currentCrossings = 0
    for (const entry of entries) {
      const wp = routed[entry.routedIdx].waypoints
      const others = allPaths.filter((_, i) => i !== entry.routedIdx)
      currentCrossings += countCrossings(wp, others)
    }

    // 全順列を試す
    const perms = permutations(sortedOffsets)
    let bestPerm = offsets
    let bestCross = currentCrossings

    for (const perm of perms) {
      // 各エントリに仮の offset を割り当て
      const shifts = entries.map((e, i) => perm[i] - e.currentOffset)

      // waypointsのコピーを作成してシフト
      const testPaths: Point[][] = allPaths.map(wp => wp.map(p => ({ ...p })))
      let safe = true

      for (let i = 0; i < entries.length; i++) {
        if (Math.abs(shifts[i]) < 0.1) continue
        shiftPortEnd(testPaths[entries[i].routedIdx], entries[i].isSrc, group.side, shifts[i])
      }

      // 障害物衝突チェック
      for (let i = 0; i < entries.length; i++) {
        const wp = testPaths[entries[i].routedIdx]
        for (let si = 1; si < wp.length - 2; si++) {
          for (const obs of obstacles) {
            if (segHitsRect(wp[si].x, wp[si].y, wp[si + 1].x, wp[si + 1].y, obs, MARGIN)) {
              safe = false
              break
            }
          }
          if (!safe) break
        }
        if (!safe) break
      }
      if (!safe) continue

      // 交差数を計算
      let testCrossings = 0
      for (const entry of entries) {
        const wp = testPaths[entry.routedIdx]
        const others = testPaths.filter((_, i) => i !== entry.routedIdx)
        testCrossings += countCrossings(wp, others)
      }

      if (testCrossings < bestCross) {
        bestCross = testCrossings
        bestPerm = perm
      }
    }

    // ベストが現在より良ければ適用
    if (bestCross < currentCrossings) {
      for (let i = 0; i < entries.length; i++) {
        const shift = bestPerm[i] - entries[i].currentOffset
        if (Math.abs(shift) < 0.1) continue
        shiftPortEnd(routed[entries[i].routedIdx].waypoints, entries[i].isSrc, group.side, shift)
        entries[i].currentOffset = bestPerm[i]
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
    // 重なりなし候補を優先、全候補が重なる場合はフォールバック（重なり最小）
    interface Scored {
      path: Point[]; srcSide: Side; dstSide: Side
      srcOffset: number; dstOffset: number
      overlap: number; hits: number; bends: number; cross: number; len: number
    }
    function isBetter(a: Scored, b: Scored): boolean {
      if (a.hits !== b.hits) return a.hits < b.hits
      if (a.bends !== b.bends) return a.bends < b.bends
      if (a.cross !== b.cross) return a.cross < b.cross
      return a.len < b.len
    }

    let bestClean: Scored | null = null   // overlap === 0 の最良
    let bestFallback: Scored | null = null // overlap > 0 の最良（overlap最小優先）

    for (const { srcSide, dstSide } of SIDE_COMBINATIONS) {
      const srcOffsets = portTracker.peekOffsets(srcIcon.nodeId, srcSide, srcIcon)
      const dstOffsets = portTracker.peekOffsets(dstIcon.nodeId, dstSide, dstIcon)

      for (const srcOffset of srcOffsets) {
        for (const dstOffset of dstOffsets) {
          const srcPt = sidePoint(srcIcon, srcSide, srcOffset)
          const dstPt = sidePoint(dstIcon, dstSide, dstOffset)

          const candidates = generateCandidatePaths(srcPt, srcSide, dstPt, dstSide, obstacles)

          for (const { path, hits } of candidates) {
            // 後戻り・斜め線のある候補はスキップ（ルール11）
            if (hasPathDefect(path)) continue

            const overlap = countOverlap(path, existingPaths)
            const bends = countBends(path)
            const cross = countCrossings(path, existingPaths)
            const len = pathLength(path)

            const scored: Scored = {
              path, srcSide, dstSide, srcOffset, dstOffset,
              overlap, hits, bends, cross, len,
            }

            if (overlap === 0) {
              // 重なりなし候補（ルール8クリア）
              if (!bestClean || isBetter(scored, bestClean)) {
                bestClean = scored
              }
            } else {
              // フォールバック: overlap最小 → 通常基準
              if (!bestFallback ||
                  overlap < bestFallback.overlap ||
                  (overlap === bestFallback.overlap && isBetter(scored, bestFallback))) {
                bestFallback = scored
              }
            }
          }
        }
      }
    }

    const best = bestClean ?? bestFallback

    const bestPath = best ? best.path : []
    const bestSrcSide = best ? best.srcSide : 'right' as Side
    const bestDstSide = best ? best.dstSide : 'left' as Side
    const bestSrcOffset = best ? best.srcOffset : 0
    const bestDstOffset = best ? best.dstOffset : 0

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

  reassignPorts(routed, iconMap, obstacles)
  spreadPorts(routed, iconMap, obstacles)
  centerPorts(routed, iconMap, obstacles)

  return routed
}
