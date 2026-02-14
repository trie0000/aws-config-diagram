/**
 * edgeRouter.postprocess.ts: ルーティング後処理
 *
 * 1. 交差削減 — 交差エッジを交差ペナルティ付きBFSで再ルーティング
 * 2. ポート分散 — 同じ接続点に集中するエッジを辺に沿って等間隔に分散
 * 3. エッジナッジ — 重なったセグメントを等間隔にオフセット
 */

import type { DiagramNode } from '../../types/diagram'
import type { RoutedEdge, ObstacleGrid, Side } from './edgeRouter.types'
import { GRID_SIZE, CONTAINER_TYPES, nodeIconRect, sideCenter, directionToTarget, findClosestNode } from './edgeRouter.types'
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

    // sourceNodeId/targetNodeId があれば正確なノードを参照、なければ fallback
    const srcNode = (r.sourceNodeId && nodes[r.sourceNodeId]) || findClosestNode(r.waypoints[0], nodes)
    const dstNode = (r.targetNodeId && nodes[r.targetNodeId]) || findClosestNode(r.waypoints[r.waypoints.length - 1], nodes)
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
        // コンテナノードは directionToTarget で辺を決定
        const srcIsContainer = CONTAINER_TYPES.has(srcNode.type)
        const dstIsContainer = CONTAINER_TYPES.has(dstNode.type)
        const srcSide: Side = srcIsContainer ? directionToTarget(srcRect, dstRect) : determineSide(result.gridPath, 'src')
        const dstSide: Side = dstIsContainer ? directionToTarget(dstRect, srcRect) : determineSide(result.gridPath, 'dst')
        const p1 = sideCenter(srcNode, srcSide)
        const p2 = sideCenter(dstNode, dstSide)
        const wp = simplifyPath(result.gridPath, p1, p2, srcSide, dstSide)

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

/**
 * ポート分散の使用範囲: アイコン辺の中央何%を使うか（0.0〜1.0）
 * 0.6 = 辺の中央60%を使用（両端20%ずつは余白）
 */
const PORT_RANGE_RATIO = 0.6

/**
 * 同じノードの同じ辺に接続する全エッジの接続点を辺に沿って均等分散。
 *
 * グルーピング: ノードID + 辺（src/dst を区別しない）
 *   → 同じ辺に出る線と入る線がある場合も同一グループとして分散する
 *
 * 配置ルール: 辺の中央 PORT_RANGE_RATIO の範囲に均等配置
 *   - 1本: 辺の中央
 *   - 2本以上: 辺の中央60%に均等分散
 *
 * enforceEdgeRules の後に呼ぶこと（辺座標が確定した後に分散する）。
 */
export function spreadPorts(routed: RoutedEdge[], nodes: Record<string, DiagramNode>): void {
  if (routed.length === 0) return

  interface PortEntry {
    edgeIdx: number
    end: 'src' | 'dst'
    side: Side
    /** ソート用: 相手ノードの座標（辺に沿った方向） */
    targetCoord: number
  }

  // ノードID + 辺 でグルーピング（src/dst を区別しない — 同じ辺の全エッジを1グループ）
  const portGroups = new Map<string, PortEntry[]>()

  for (let ei = 0; ei < routed.length; ei++) {
    const r = routed[ei]
    if (r.waypoints.length < 2) continue

    const dstPt = r.waypoints[r.waypoints.length - 1]
    const srcPt = r.waypoints[0]

    // src 側: このエッジの始点が sourceNode の srcSide 辺に接続
    if (r.sourceNodeId) {
      const key = `${r.sourceNodeId}:${r.srcSide}`
      if (!portGroups.has(key)) portGroups.set(key, [])
      portGroups.get(key)!.push({
        edgeIdx: ei,
        end: 'src',
        side: r.srcSide,
        targetCoord: (r.srcSide === 'left' || r.srcSide === 'right') ? dstPt.y : dstPt.x,
      })
    }

    // dst 側: このエッジの終点が targetNode の dstSide 辺に接続
    if (r.targetNodeId) {
      const key = `${r.targetNodeId}:${r.dstSide}`
      if (!portGroups.has(key)) portGroups.set(key, [])
      portGroups.get(key)!.push({
        edgeIdx: ei,
        end: 'dst',
        side: r.dstSide,
        targetCoord: (r.dstSide === 'left' || r.dstSide === 'right') ? srcPt.y : srcPt.x,
      })
    }
  }

  for (const [groupKey, entries] of portGroups) {
    // 1本でも中央に配置する（enforceEdgeRulesが非中央座標を設定する場合があるため）
    // ターゲット座標でソート（辺に沿った順番、2本以上の場合に交差を防ぐ）
    entries.sort((a, b) => a.targetCoord - b.targetCoord)

    // ノード情報から辺の長さを取得
    // groupKey = "nodeId:side" — nodeId に ':' を含む場合があるので最後の ':' で分割
    const lastColon = groupKey.lastIndexOf(':')
    const nodeId = groupKey.substring(0, lastColon)
    const node = nodes[nodeId]
    if (!node) continue

    const rect = nodeIconRect(node)
    const side = entries[0].side
    const isHoriz = (side === 'left' || side === 'right')
    const edgeLen = isHoriz ? rect.h : rect.w

    // 辺の中心座標（絶対値）
    const centerCoord = isHoriz
      ? rect.y + rect.h / 2   // left/right: y中心
      : rect.x + rect.w / 2   // top/bottom: x中心

    // 使用範囲: 辺の中央 PORT_RANGE_RATIO
    const usableRange = edgeLen * PORT_RANGE_RATIO
    const count = entries.length

    for (let rank = 0; rank < count; rank++) {
      // N本を均等配置: center ± usableRange/2
      const offset = count === 1 ? 0 : (rank / (count - 1) - 0.5) * usableRange
      const absPos = centerCoord + offset
      const entry = entries[rank]
      const r = routed[entry.edgeIdx]
      const wp = r.waypoints

      // 端点だけ移動する。隣接WPは動かさず、直交性維持のため中継WPを挿入する。
      // これにより、BFSが障害物回避で決めた中間経路を破壊しない。
      //
      // 中継WP挿入条件:
      //   1. 移動量がある（absPos と現在値の差 > 0.5）
      //   2. 隣接WPが端点と同軸（移動する軸の座標が同じ）
      //      - isHoriz (left/right): yを移動 → 隣接WPとxが同じ（垂直セグメント）場合に中継
      //      - !isHoriz (top/bottom): xを移動 → 隣接WPとxが同じ（垂直セグメント）場合に中継
      if (entry.end === 'src') {
        const pt = wp[0]
        const adj = wp[1]
        if (isHoriz) {
          // left/right辺: yを移動。隣接WPとxが同じ（水平→垂直の直線）なら中継挿入
          const sameAxis = Math.abs(adj.x - pt.x) < 1
          if (Math.abs(pt.y - absPos) > 0.5 && wp.length >= 2 && sameAxis) {
            wp.splice(1, 0, { x: pt.x, y: adj.y })
          }
          pt.y = absPos
        } else {
          // top/bottom辺: xを移動。隣接WPとxが同じ（垂直の直線）なら中継挿入
          const sameAxis = Math.abs(adj.x - pt.x) < 1
          if (Math.abs(pt.x - absPos) > 0.5 && wp.length >= 2 && sameAxis) {
            wp.splice(1, 0, { x: adj.x, y: pt.y })
          }
          pt.x = absPos
        }
      } else {
        const lastIdx = wp.length - 1
        const pt = wp[lastIdx]
        const adj = wp[lastIdx - 1]
        if (isHoriz) {
          // left/right辺: yを移動
          const sameAxis = Math.abs(adj.x - pt.x) < 1
          if (Math.abs(pt.y - absPos) > 0.5 && wp.length >= 2 && sameAxis) {
            wp.splice(lastIdx, 0, { x: pt.x, y: adj.y })
          }
          wp[wp.length - 1].y = absPos
        } else {
          // top/bottom辺: xを移動。隣接WPとxが同じなら中継挿入
          const sameAxis = Math.abs(adj.x - pt.x) < 1
          if (Math.abs(pt.x - absPos) > 0.5 && wp.length >= 2 && sameAxis) {
            wp.splice(lastIdx, 0, { x: adj.x, y: pt.y })
          }
          wp[wp.length - 1].x = absPos
        }
      }
    }
  }
}

// ============================================================
// Icon Deflection — アイコン貫通防止
// ============================================================

/**
 * 線分 (ax,ay)→(bx,by) が矩形 r（+ buffer マージン）と交差するか判定。
 * buffer を指定すると矩形を各辺 buffer px 拡張して判定する。
 * これにより、アイコン境界ぴったりを通る線もヒットとして検出できる。
 */
function segmentIntersectsRect(
  ax: number, ay: number, bx: number, by: number,
  r: { x: number; y: number; w: number; h: number },
  buffer = 0,
): boolean {
  const rx1 = r.x - buffer
  const ry1 = r.y - buffer
  const rx2 = r.x + r.w + buffer
  const ry2 = r.y + r.h + buffer
  // 水平セグメント
  if (Math.abs(ay - by) < 1) {
    const y = ay
    if (y <= ry1 || y >= ry2) return false
    const minX = Math.min(ax, bx)
    const maxX = Math.max(ax, bx)
    return maxX > rx1 && minX < rx2
  }
  // 垂直セグメント
  if (Math.abs(ax - bx) < 1) {
    const x = ax
    if (x <= rx1 || x >= rx2) return false
    const minY = Math.min(ay, by)
    const maxY = Math.max(ay, by)
    return maxY > ry1 && minY < ry2
  }
  return false
}

/**
 * 全エッジの全セグメントをチェックし、第三者のアイコン矩形を貫通する
 * セグメントがあれば、アイコンの外側を迂回するウェイポイントを挿入する。
 *
 * spreadPorts の後に呼ぶこと。
 */
export function deflectFromIcons(
  routed: RoutedEdge[],
  nodes: Record<string, DiagramNode>,
): void {
  // 全アイコンノードの矩形を収集
  const iconRects: Array<{ nodeId: string; rect: { x: number; y: number; w: number; h: number } }> = []
  for (const [id, n] of Object.entries(nodes)) {
    if (CONTAINER_TYPES.has(n.type)) continue
    iconRects.push({ nodeId: id, rect: nodeIconRect(n) })
  }

  const MARGIN = 8   // 迂回マージン (px)
  const DETECT = 2    // 検出バッファ (px) — アイコン境界ぴったりも検出する

  for (const r of routed) {
    const wp = r.waypoints
    if (wp.length < 2) continue

    // エッジの始点/終点ノードは除外（自分自身のアイコンは貫通して当然）
    const skipNodes = new Set<string>()
    if (r.sourceNodeId) skipNodes.add(r.sourceNodeId)
    if (r.targetNodeId) skipNodes.add(r.targetNodeId)

    // セグメントを前から走査（spliceでインデックスが変わるため毎回ループ）
    let si = 0
    let maxIter = 200 // 無限ループ防止
    while (si < wp.length - 1 && maxIter-- > 0) {
      const a = wp[si]
      const b = wp[si + 1]

      let deflected = false
      for (const { nodeId, rect } of iconRects) {
        if (skipNodes.has(nodeId)) continue
        if (!segmentIntersectsRect(a.x, a.y, b.x, b.y, rect, DETECT)) continue

        // 垂直セグメントがアイコンを貫通 → 左右に迂回
        if (Math.abs(a.x - b.x) < 1) {
          const cx = rect.x + rect.w / 2
          // セグメントがアイコンの左半分を通るなら左に、右なら右に迂回
          const goLeft = a.x <= cx
          const detourX = goLeft ? rect.x - MARGIN : rect.x + rect.w + MARGIN
          const topY = rect.y - MARGIN
          const botY = rect.y + rect.h + MARGIN
          // aがrectの上にいるか下にいるかで迂回方向を決定
          if (a.y < rect.y) {
            // 上から下へ通過: aの下でrectの上端を回る
            wp.splice(si + 1, 0,
              { x: a.x, y: topY },
              { x: detourX, y: topY },
              { x: detourX, y: botY },
              { x: b.x, y: botY },
            )
          } else {
            // 下から上へ通過
            wp.splice(si + 1, 0,
              { x: a.x, y: botY },
              { x: detourX, y: botY },
              { x: detourX, y: topY },
              { x: b.x, y: topY },
            )
          }
          deflected = true
          break
        }

        // 水平セグメントがアイコンを貫通 → 上下に迂回
        if (Math.abs(a.y - b.y) < 1) {
          const cy = rect.y + rect.h / 2
          const goUp = a.y <= cy
          const detourY = goUp ? rect.y - MARGIN : rect.y + rect.h + MARGIN
          const leftX = rect.x - MARGIN
          const rightX = rect.x + rect.w + MARGIN
          if (a.x < rect.x) {
            wp.splice(si + 1, 0,
              { x: leftX, y: a.y },
              { x: leftX, y: detourY },
              { x: rightX, y: detourY },
              { x: rightX, y: b.y },
            )
          } else {
            wp.splice(si + 1, 0,
              { x: rightX, y: a.y },
              { x: rightX, y: detourY },
              { x: leftX, y: detourY },
              { x: leftX, y: b.y },
            )
          }
          deflected = true
          break
        }
      }

      // deflectedした場合は同じsiで再チェック（新しいセグメントも貫通する可能性）
      if (!deflected) si++
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
