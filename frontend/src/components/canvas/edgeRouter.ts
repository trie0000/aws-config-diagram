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
 * Version: 15.2.0
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
  /** 各 (nodeId:side) に確定済みのoffset座標リスト */
  private committed = new Map<string, number[]>()

  /** ポート候補を返す: 外側 + 既存ポート間の隙間 */
  peekOffsets(nodeId: string, side: Side, icon: IconRect): number[] {
    const key = `${nodeId}:${side}`
    const existing = this.committed.get(key)

    // まだポートがない → 中央のみ
    if (!existing || existing.length === 0) return [0]

    const isHoriz = side === 'left' || side === 'right'
    const halfEdge = (isHoriz ? icon.h : icon.w) / 2 - 2

    const sorted = [...existing].sort((a, b) => a - b)
    const candidates: number[] = []

    // 外側候補: 最小の外側、最大の外側
    const outerLow = sorted[0] - PORT_GAP
    if (outerLow >= -halfEdge) candidates.push(outerLow)
    const outerHigh = sorted[sorted.length - 1] + PORT_GAP
    if (outerHigh <= halfEdge) candidates.push(outerHigh)

    // 隙間候補: 隣り合うポートの中間点
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1] - sorted[i]
      if (gap >= PORT_GAP) {
        candidates.push((sorted[i] + sorted[i + 1]) / 2)
      }
    }

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
// Post-process: align elbow positions for parallel edges
// ============================================================

interface ElbowEntry {
  routedIdx: number
  isSrc: boolean
  elbowIdx: number  // index in waypoints array
  coord: number     // current elbow coordinate (x or y depending on side)
  axis: 'x' | 'y'  // which axis to adjust
}

/**
 * src端のstem直後の曲がり角を特定する。
 *
 * パス構造: [srcPt(0), srcStem(1), elbow(2), next(3), ...]
 * left/right stem(横) → stem→elbow は横(same y), elbow→next は縦(same x) → 調整軸 x
 * top/bottom stem(縦) → stem→elbow は縦(same x), elbow→next は横(same y) → 調整軸 y
 */
function findElbowFromSrc(wp: Point[], srcSide: Side): ElbowEntry | null {
  if (wp.length < 4) return null
  const stem = wp[1]
  const elbow = wp[2]
  const next = wp[3]

  if (srcSide === 'left' || srcSide === 'right') {
    if (Math.abs(stem.y - elbow.y) < 0.5 && Math.abs(elbow.x - next.x) < 0.5) {
      return { routedIdx: -1, isSrc: true, elbowIdx: 2, coord: elbow.x, axis: 'x' }
    }
  } else {
    if (Math.abs(stem.x - elbow.x) < 0.5 && Math.abs(elbow.y - next.y) < 0.5) {
      return { routedIdx: -1, isSrc: true, elbowIdx: 2, coord: elbow.y, axis: 'y' }
    }
  }
  return null
}

/**
 * dst端のstem直前の曲がり角を特定する。
 *
 * パス構造: [..., prev(n-4), elbow(n-3), dstStem(n-2), dstPt(n-1)]
 * left/right stem(横) → elbow→stem は横(same y), prev→elbow は縦(same x) → 調整軸 x
 * top/bottom stem(縦) → elbow→stem は縦(same x), prev→elbow は横(same y) → 調整軸 y
 */
function findElbowFromDst(wp: Point[], dstSide: Side): ElbowEntry | null {
  if (wp.length < 4) return null
  const n = wp.length
  const elbow = wp[n - 3]
  const stem = wp[n - 2]
  const prev = wp[n - 4]

  if (dstSide === 'left' || dstSide === 'right') {
    if (Math.abs(elbow.y - stem.y) < 0.5 && Math.abs(prev.x - elbow.x) < 0.5) {
      return { routedIdx: -1, isSrc: false, elbowIdx: n - 3, coord: elbow.x, axis: 'x' }
    }
  } else {
    if (Math.abs(elbow.x - stem.x) < 0.5 && Math.abs(prev.y - elbow.y) < 0.5) {
      return { routedIdx: -1, isSrc: false, elbowIdx: n - 3, coord: elbow.y, axis: 'y' }
    }
  }
  return null
}

/**
 * elbowのシフトに連動して動かすべき隣接点のインデックスを収集する。
 *
 * elbowを axis='x' で shift する場合、elbow と同じ x を持つ隣接点も動かす。
 * elbowを axis='y' で shift する場合、elbow と同じ y を持つ隣接点も動かす。
 *
 * 重要: src端点(wp[0])とdst端点(wp[last])はアイコン上のポートなので
 * 絶対に動かしてはならない。stem点(wp[1], wp[last-1])も同様。
 * 探索範囲を [2, wp.length-3] に制限する。
 */
function collectCoaxialIndices(wp: Point[], elbowIdx: number, axis: 'x' | 'y'): number[] {
  const indices: number[] = [elbowIdx]
  const elbow = wp[elbowIdx]

  // 探索範囲: stem/端点を除く内部点のみ (index 2 ~ wp.length-3)
  const minIdx = 2
  const maxIdx = wp.length - 3

  // 前方向で同軸の点を探す（stem/端点には踏み込まない）
  for (let i = elbowIdx - 1; i >= minIdx; i--) {
    if (axis === 'x' && Math.abs(wp[i].x - elbow.x) < 0.5) {
      indices.push(i)
    } else if (axis === 'y' && Math.abs(wp[i].y - elbow.y) < 0.5) {
      indices.push(i)
    } else {
      break
    }
  }

  // 後方向で同軸の点を探す（stem/端点には踏み込まない）
  for (let i = elbowIdx + 1; i <= maxIdx; i++) {
    if (axis === 'x' && Math.abs(wp[i].x - elbow.x) < 0.5) {
      indices.push(i)
    } else if (axis === 'y' && Math.abs(wp[i].y - elbow.y) < 0.5) {
      indices.push(i)
    } else {
      break
    }
  }

  return indices
}

/**
 * 同じアイコン辺に接続されたエッジ群の曲がり角座標をPORT_GAP間隔に揃える。
 * ルーティング完了後のポスト処理。
 */
function alignElbows(routed: RoutedEdge[], obstacles: Rect[]): void {
  const groups = new Map<string, { axis: 'x' | 'y'; entries: ElbowEntry[] }>()

  for (let ri = 0; ri < routed.length; ri++) {
    const r = routed[ri]
    if (r.waypoints.length < 4) continue

    // src側の曲がり角
    const srcElbow = findElbowFromSrc(r.waypoints, r.srcSide)
    if (srcElbow) {
      srcElbow.routedIdx = ri
      const key = `${r.sourceNodeId}:${r.srcSide}`
      if (!groups.has(key)) groups.set(key, { axis: srcElbow.axis, entries: [] })
      const g = groups.get(key)!
      if (g.axis === srcElbow.axis) g.entries.push(srcElbow)
    }

    // dst側の曲がり角
    const dstElbow = findElbowFromDst(r.waypoints, r.dstSide)
    if (dstElbow) {
      dstElbow.routedIdx = ri
      const key = `${r.targetNodeId}:${r.dstSide}`
      if (!groups.has(key)) groups.set(key, { axis: dstElbow.axis, entries: [] })
      const g = groups.get(key)!
      if (g.axis === dstElbow.axis) g.entries.push(dstElbow)
    }
  }

  for (const [, group] of groups) {
    if (group.entries.length < 2) continue

    // 現在の曲がり角座標をソート
    const sorted = [...group.entries].sort((a, b) => a.coord - b.coord)
    const coords = sorted.map(e => e.coord)

    // 曲がり角の最大間隔がPORT_GAP×4を超える場合はスキップ
    // （異なる宛先への遠いエッジを無理に揃えない）
    const maxGap = coords[coords.length - 1] - coords[0]
    if (maxGap > PORT_GAP * 4) continue

    // 現在の中央値を基準にPORT_GAP間隔で再配置
    const center = (coords[0] + coords[coords.length - 1]) / 2
    const totalSpan = (sorted.length - 1) * PORT_GAP
    const startCoord = center - totalSpan / 2

    const newCoords = sorted.map((_, i) => startCoord + i * PORT_GAP)

    // 全エントリの移動量が0なら何もしない
    const maxShift = Math.max(...sorted.map((e, i) => Math.abs(newCoords[i] - e.coord)))
    if (maxShift < 0.5) continue

    // 安全性チェック: 新位置で障害物に衝突しないか
    let safe = true
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]
      const shift = newCoords[i] - entry.coord
      if (Math.abs(shift) < 0.1) continue

      const wp = routed[entry.routedIdx].waypoints
      const testWp = wp.map(p => ({ ...p }))

      // elbow と同軸の全ての隣接点をまとめてシフト
      const coaxial = collectCoaxialIndices(wp, entry.elbowIdx, group.axis)
      for (const ci of coaxial) {
        if (group.axis === 'x') testWp[ci].x += shift
        else testWp[ci].y += shift
      }

      // 内部セグメントの衝突チェック（stem除外: index 1 ~ len-2）
      for (let si = 1; si < testWp.length - 2; si++) {
        for (const obs of obstacles) {
          if (segHitsRect(testWp[si].x, testWp[si].y, testWp[si + 1].x, testWp[si + 1].y, obs, MARGIN)) {
            safe = false
            break
          }
        }
        if (!safe) break
      }
      if (!safe) break
    }
    if (!safe) continue

    // 安全な場合、実際にwaypointsを書き換え
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]
      const shift = newCoords[i] - entry.coord
      if (Math.abs(shift) < 0.1) continue

      const wp = routed[entry.routedIdx].waypoints
      const coaxial = collectCoaxialIndices(wp, entry.elbowIdx, group.axis)
      for (const ci of coaxial) {
        if (group.axis === 'x') wp[ci].x += shift
        else wp[ci].y += shift
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
            // 後戻り・斜め線のある候補はスキップ
            if (hasPathDefect(path)) continue

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
  alignElbows(routed, obstacles)

  return routed
}
