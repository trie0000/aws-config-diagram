/**
 * edgeRouter.ts: 障害物回避付き直交エッジルーティング
 *
 * グリッドBFS で全アイコンノードを障害物として回避しつつ
 * Manhattan ルーティング（水平/垂直のみ）のウェイポイントを生成する。
 *
 * 方針: 各エッジが最短経路を取ることを最優先。
 *        交差は許容するが、後処理で交差ペナルティ付き再ルーティングを行い削減する。
 *
 * パイプライン:
 *   1. 障害物グリッド構築（全アイコンノードの矩形をマーク）
 *   2. 各エッジについて独立に BFS で最短直交パスを探索
 *   3. BFS の出発/到着方向からアイコンの接続辺を後決定
 *   4. パスを簡略化（同方向セルをマージして折れ点のみ残す）
 *   5. 交差削減（交差エッジの代替ルートを試行し、短さを保ちつつ交差を減らす）
 *   6. ポート分散（同一接続点のエッジを辺に沿って分散）
 *   7. エッジナッジ（重なったセグメントを等間隔にオフセット）
 *
 * Version: 4.1.0
 * Last Updated: 2026-02-14
 */

import type { DiagramNode, DiagramEdge } from '../../types/diagram'

// ============================================================
// Types
// ============================================================

type Side = 'top' | 'bottom' | 'left' | 'right'
type Point = { x: number; y: number }

/** ルーティング結果 */
export interface RoutedEdge {
  edgeId: string
  waypoints: Point[]
  srcSide: Side
  dstSide: Side
}

// ============================================================
// Constants
// ============================================================

const CONTAINER_TYPES = new Set(['aws-cloud', 'vpc', 'az', 'subnet'])

/** グリッドセルサイズ（px） — 小さいほど精密だが遅い */
const GRID_SIZE = 20

/** 障害物の周りのマージン（グリッドセル数） */
const OBSTACLE_MARGIN = 1

/** BFS 探索の最大セル数（無限ループ防止） */
const MAX_BFS_CELLS = 20000

/** 折れ曲がりペナルティ（BFS コスト加算、曲がりの少ないルートを優先） */
const BEND_PENALTY = 2

// ============================================================
// Public API
// ============================================================

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
      routed.push({ edgeId: edge.id, waypoints: [], srcSide: 'right', dstSide: 'left' })
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
        const srcSide = determineSide(result.gridPath, 'src')
        const dstSide = determineSide(result.gridPath, 'dst')
        const p1 = sideCenter(src, srcSide)
        const p2 = sideCenter(dst, dstSide)
        const waypoints = simplifyPath(result.gridPath, p1, p2)
        routed.push({ edgeId: edge.id, waypoints, srcSide, dstSide })
      } else {
        const { srcSide, dstSide } = bestSides(src, dst)
        const p1 = sideCenter(src, srcSide)
        const p2 = sideCenter(dst, dstSide)
        routed.push({ edgeId: edge.id, waypoints: fallbackRoute(p1, srcSide, p2, dstSide), srcSide, dstSide })
      }
    } finally {
      reblockCells(grid, removedSrc)
      reblockCells(grid, removedDst)
    }
  }

  // 後処理: 交差削減（交差エッジの代替ルート試行 → 再 spread/nudge）
  reduceCrossings(routed, nodes, grid)

  // 後処理: ポート分散（同じ接続点に集中するエッジの接続位置をずらす）
  spreadPorts(routed)

  // 後処理: エッジナッジ（重なったセグメントを等間隔にオフセット）
  nudgeEdges(routed)

  return routed
}

// ============================================================
// Crossing Reduction — 交差削減の後処理
// ============================================================

/** 2つの線分が交差するかどうかを判定 */
function segmentsIntersect(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): boolean {
  // 一方が水平、他方が垂直の場合のみ交差が発生しうる（直交ルーティング前提）
  const aHorizontal = Math.abs(ay1 - ay2) < 1
  const bHorizontal = Math.abs(by1 - by2) < 1

  // 同方向の平行線は交差しない（重複は交差としてカウントしない）
  if (aHorizontal === bHorizontal) return false

  // A が水平、B が垂直
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

  // 垂直線のX座標が水平線の範囲内 かつ 水平線のY座標が垂直線の範囲内
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

/** 交差ペナルティ（再ルーティング BFS でのみ使用） */
const CROSS_PENALTY = 10

/**
 * 交差削減: 交差に関与するエッジを交差ペナルティ付き BFS で再ルーティング。
 *
 * 1. 全エッジ間の交差を検出
 * 2. 交差数が多いエッジ（交差数降順）から順に再ルーティング
 * 3. 他エッジのセグメント位置に交差ペナルティを設定した BFS で再探索
 * 4. 結果の交差が減れば採用（パスは長くなることがある）
 */
function reduceCrossings(
  routed: RoutedEdge[],
  nodes: Record<string, DiagramNode>,
  grid: ObstacleGrid,
): void {
  // 交差に関与するエッジを交差数降順でソート
  const crossCounts: Array<{ idx: number; count: number }> = []
  for (let i = 0; i < routed.length; i++) {
    if (routed[i].waypoints.length < 2) continue
    const cnt = edgeCrossings(i, routed)
    if (cnt > 0) crossCounts.push({ idx: i, count: cnt })
  }
  if (crossCounts.length === 0) return

  crossCounts.sort((a, b) => b.count - a.count) // 交差が多いエッジから優先

  for (const { idx } of crossCounts) {
    const r = routed[idx]
    if (r.waypoints.length < 2) continue

    const beforeCross = edgeCrossings(idx, routed)
    if (beforeCross === 0) continue

    // src / dst ノードを特定
    const srcNode = findClosestNode(r.waypoints[0], nodes)
    const dstNode = findClosestNode(r.waypoints[r.waypoints.length - 1], nodes)
    if (!srcNode || !dstNode) continue

    const srcRect = nodeIconRect(srcNode)
    const dstRect = nodeIconRect(dstNode)

    // 他エッジのセグメント位置に交差ペナルティマップを構築
    const penaltyMap = buildPenaltyMap(idx, routed)

    // 障害物一時解除
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

        // 仮に置き換えて交差数を確認
        const origWp = r.waypoints
        const origSrc = r.srcSide
        const origDst = r.dstSide
        r.waypoints = wp
        r.srcSide = srcSide
        r.dstSide = dstSide
        const afterCross = edgeCrossings(idx, routed)

        if (afterCross < beforeCross) {
          // 改善 → 採用
        } else {
          // 改善なし → 元に戻す
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

/**
 * 他エッジのセグメントが通るグリッドセルに交差ペナルティを設定するマップを構築。
 * 直交セグメントの各セルに方向情報を記録し、異なる方向で通過するとペナルティ。
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
        // 水平セグメント
        const y = Math.round(a.y / GRID_SIZE)
        const x1 = Math.min(Math.round(a.x / GRID_SIZE), Math.round(b.x / GRID_SIZE))
        const x2 = Math.max(Math.round(a.x / GRID_SIZE), Math.round(b.x / GRID_SIZE))
        for (let x = x1; x <= x2; x++) {
          map.set(`${x},${y}`, 'h')
        }
      } else if (dx < 1 && dy >= 1) {
        // 垂直セグメント
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
 * 交差ペナルティ付き BFS。
 * penaltyMap のセルを異なる方向で通過するとき CROSS_PENALTY を加算。
 */
function bfsSearchWithPenalty(
  srcX: number, srcY: number,
  dstX: number, dstY: number,
  grid: ObstacleGrid,
  penaltyMap: Map<string, 'h' | 'v'>,
): BFSResult | null {
  const startGx = Math.round(srcX / GRID_SIZE)
  const startGy = Math.round(srcY / GRID_SIZE)
  const endGx = Math.round(dstX / GRID_SIZE)
  const endGy = Math.round(dstY / GRID_SIZE)

  if (startGx === endGx && startGy === endGy) {
    return { gridPath: [{ gx: startGx, gy: startGy }, { gx: endGx, gy: endGy }], cost: 0 }
  }

  const visited = new Map<string, number>()
  const parent = new Map<string, { gx: number; gy: number; dir: number }>()
  const queue: BFSNode[] = []

  for (let d = 0; d < 4; d++) {
    const ngx = startGx + DIRS[d].dx
    const ngy = startGy + DIRS[d].dy
    if (grid.occupied.has(`${ngx},${ngy}`)) continue
    const key = `${ngx},${ngy},${d}`
    queue.push({ gx: ngx, gy: ngy, dir: d, cost: 1 })
    visited.set(key, 1)
    parent.set(key, { gx: startGx, gy: startGy, dir: -1 })
  }

  let found = false
  let foundDir = -1
  let foundCost = Infinity
  let iterations = 0

  while (queue.length > 0 && iterations < MAX_BFS_CELLS) {
    iterations++

    let minIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[minIdx].cost) minIdx = i
    }
    const curr = queue.splice(minIdx, 1)[0]

    if (curr.cost >= foundCost) continue

    if (curr.gx === endGx && curr.gy === endGy) {
      found = true
      foundDir = curr.dir
      foundCost = curr.cost
      continue
    }

    for (let d = 0; d < 4; d++) {
      const ngx = curr.gx + DIRS[d].dx
      const ngy = curr.gy + DIRS[d].dy

      if (ngx < grid.minX || ngx > grid.maxX || ngy < grid.minY || ngy > grid.maxY) continue
      if (grid.occupied.has(`${ngx},${ngy}`)) continue

      const bendCost = (curr.dir !== -1 && curr.dir !== d) ? BEND_PENALTY : 0

      // 交差ペナルティ: セルに他エッジの異なる方向セグメントがある場合
      let crossCost = 0
      const cellKey = `${ngx},${ngy}`
      const existing = penaltyMap.get(cellKey)
      if (existing !== undefined) {
        const myDir = (d === 0 || d === 2) ? 'v' : 'h' // 0=N,2=S は垂直移動、1=E,3=W は水平移動
        if (existing !== myDir) {
          crossCost = CROSS_PENALTY
        }
      }

      const newCost = curr.cost + 1 + bendCost + crossCost

      const nkey = `${ngx},${ngy},${d}`
      const existingCost = visited.get(nkey)
      if (existingCost !== undefined && existingCost <= newCost) continue

      visited.set(nkey, newCost)
      parent.set(nkey, { gx: curr.gx, gy: curr.gy, dir: curr.dir })
      queue.push({ gx: ngx, gy: ngy, dir: d, cost: newCost })
    }
  }

  if (!found) return null

  const gridPath: Array<{ gx: number; gy: number }> = []
  let currKey = `${endGx},${endGy},${foundDir}`
  gridPath.push({ gx: endGx, gy: endGy })

  while (parent.has(currKey)) {
    const p = parent.get(currKey)!
    gridPath.push({ gx: p.gx, gy: p.gy })
    currKey = `${p.gx},${p.gy},${p.dir}`
  }
  gridPath.reverse()

  return { gridPath, cost: foundCost }
}

/** ウェイポイント配列の総パス長（マンハッタン距離） */
function pathLength(wp: Point[]): number {
  let len = 0
  for (let i = 1; i < wp.length; i++) {
    len += Math.abs(wp[i].x - wp[i - 1].x) + Math.abs(wp[i].y - wp[i - 1].y)
  }
  return len
}

/** 指定座標に最も近いアイコンノードを探す */
function findClosestNode(
  pt: Point,
  nodes: Record<string, DiagramNode>,
): DiagramNode | null {
  let best: DiagramNode | null = null
  let bestDist = Infinity
  for (const node of Object.values(nodes)) {
    if (CONTAINER_TYPES.has(node.type)) continue
    const r = nodeIconRect(node)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const d = Math.abs(pt.x - cx) + Math.abs(pt.y - cy)
    if (d < bestDist) {
      bestDist = d
      best = node
    }
  }
  return best
}

// ============================================================
// Port Spreading — 同じ接続点に集中するエッジの分散
// ============================================================

/**
 * 同じノードの同じ辺から出る/入る複数エッジの
 * 接続点位置を辺に沿って等間隔に分散させる。
 *
 * src（始点）と dst（終点）を区別せず、同じノード・同じ辺に
 * 接続する矢印はすべて一つのグループとしてまとめて分散する。
 */
function spreadPorts(routed: RoutedEdge[]): void {
  if (routed.length < 2) return

  // 1. ポートグループを構築: 同じ接続点座標のエッジ群（src/dst 混合）
  interface PortEntry {
    edgeIdx: number
    end: 'src' | 'dst'
    side: Side
    // 相手側の座標（ソート基準）
    targetCoord: number
  }

  // キー: 丸めた接続点座標 "port:x:y"
  const portGroups = new Map<string, PortEntry[]>()

  for (let ei = 0; ei < routed.length; ei++) {
    const r = routed[ei]
    if (r.waypoints.length < 2) continue

    const srcPt = r.waypoints[0]
    const dstPt = r.waypoints[r.waypoints.length - 1]

    // src 側: 接続点座標でグループ化（src/dst 区別なし）
    const srcGroupKey = `port:${Math.round(srcPt.x)}:${Math.round(srcPt.y)}`
    if (!portGroups.has(srcGroupKey)) portGroups.set(srcGroupKey, [])
    portGroups.get(srcGroupKey)!.push({
      edgeIdx: ei,
      end: 'src',
      side: r.srcSide,
      targetCoord: (r.srcSide === 'left' || r.srcSide === 'right') ? dstPt.y : dstPt.x,
    })

    // dst 側: 同じキー形式でグループ化
    const dstGroupKey = `port:${Math.round(dstPt.x)}:${Math.round(dstPt.y)}`
    if (!portGroups.has(dstGroupKey)) portGroups.set(dstGroupKey, [])
    portGroups.get(dstGroupKey)!.push({
      edgeIdx: ei,
      end: 'dst',
      side: r.dstSide,
      targetCoord: (r.dstSide === 'left' || r.dstSide === 'right') ? srcPt.y : srcPt.x,
    })
  }

  // 2. 各ポートグループを相手側座標でソートし、辺に沿って等間隔に接続点を再配置
  const PORT_SPREAD = 12 // ポート間のオフセット（px）

  for (const [, entries] of portGroups) {
    if (entries.length < 2) continue

    // 相手側の座標でソート（昇順）
    entries.sort((a, b) => a.targetCoord - b.targetCoord)

    const count = entries.length
    for (let rank = 0; rank < count; rank++) {
      const offset = (rank - (count - 1) / 2) * PORT_SPREAD
      const entry = entries[rank]
      const r = routed[entry.edgeIdx]
      const wp = r.waypoints

      if (entry.end === 'src') {
        const side = entry.side
        const pt = wp[0]
        if (side === 'left' || side === 'right') {
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
        const side = entry.side
        const pt = wp[wp.length - 1]
        if (side === 'left' || side === 'right') {
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

/** セグメントの方向: 水平 or 垂直 */
interface Segment {
  edgeIdx: number       // routed[] 内のインデックス
  segIdx: number        // waypoints 内のセグメントインデックス (i → i+1)
  dir: 'h' | 'v'        // horizontal or vertical
  pos: number           // 固定座標（h: Y座標, v: X座標）
  min: number           // 可変座標の小さい方
  max: number           // 可変座標の大きい方
}

/** ナッジ間隔（px）— strokeWidth(1.5) の 4倍 */
const NUDGE_STEP = 10

/** 同一線上判定の許容誤差（px） */
const NUDGE_SNAP = 4

/**
 * 同じ線分上を通る複数エッジのセグメントを等間隔にオフセットする。
 * waypoints を in-place で書き換える。
 */
function nudgeEdges(routed: RoutedEdge[]): void {
  // 1. 全セグメントを抽出
  const segments: Segment[] = []
  for (let ei = 0; ei < routed.length; ei++) {
    const wp = routed[ei].waypoints
    for (let si = 0; si < wp.length - 1; si++) {
      const a = wp[si], b = wp[si + 1]
      const dx = Math.abs(b.x - a.x)
      const dy = Math.abs(b.y - a.y)
      if (dx < 1 && dy < 1) continue // ゼロ長セグメントをスキップ
      if (dy < 1) {
        // 水平セグメント
        segments.push({ edgeIdx: ei, segIdx: si, dir: 'h', pos: a.y, min: Math.min(a.x, b.x), max: Math.max(a.x, b.x) })
      } else if (dx < 1) {
        // 垂直セグメント
        segments.push({ edgeIdx: ei, segIdx: si, dir: 'v', pos: a.x, min: Math.min(a.y, b.y), max: Math.max(a.y, b.y) })
      }
      // 斜めセグメントは無視（直交ルーティングでは発生しないはず）
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
      // 範囲が重複しているか（少なくとも一部が重なっている）
      if (si.max <= sj.min || sj.max <= si.min) continue
      // 同じエッジの同じセグメントは除外（ありえないが念のため）
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
        // 水平セグメント → Y方向にオフセット
        a.y += offset
        b.y += offset
      } else {
        // 垂直セグメント → X方向にオフセット
        a.x += offset
        b.x += offset
      }
    }
  }
}

// ============================================================
// Grid Construction
// ============================================================

interface ObstacleGrid {
  occupied: Set<string>
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function buildObstacleGrid(
  obstacles: Array<{ x: number; y: number; w: number; h: number }>,
  nodes: Record<string, DiagramNode>,
): ObstacleGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of Object.values(nodes)) {
    if (n.size.width === 0 && n.size.height === 0) continue
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + n.size.width)
    maxY = Math.max(maxY, n.position.y + n.size.height)
  }

  minX -= 100; minY -= 100; maxX += 100; maxY += 100

  const occupied = new Set<string>()

  for (const ob of obstacles) {
    const gx1 = Math.floor((ob.x - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
    const gy1 = Math.floor((ob.y - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
    const gx2 = Math.ceil((ob.x + ob.w + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
    const gy2 = Math.ceil((ob.y + ob.h + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)

    for (let gx = gx1; gx <= gx2; gx++) {
      for (let gy = gy1; gy <= gy2; gy++) {
        occupied.add(`${gx},${gy}`)
      }
    }
  }

  return {
    occupied,
    minX: Math.floor(minX / GRID_SIZE),
    minY: Math.floor(minY / GRID_SIZE),
    maxX: Math.ceil(maxX / GRID_SIZE),
    maxY: Math.ceil(maxY / GRID_SIZE),
  }
}

function unblockRect(
  grid: ObstacleGrid,
  rect: { x: number; y: number; w: number; h: number },
): string[] {
  const removed: string[] = []
  const gx1 = Math.floor((rect.x - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
  const gy1 = Math.floor((rect.y - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
  const gx2 = Math.ceil((rect.x + rect.w + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
  const gy2 = Math.ceil((rect.y + rect.h + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)

  for (let gx = gx1; gx <= gx2; gx++) {
    for (let gy = gy1; gy <= gy2; gy++) {
      const key = `${gx},${gy}`
      if (grid.occupied.has(key)) {
        grid.occupied.delete(key)
        removed.push(key)
      }
    }
  }
  return removed
}

function reblockCells(grid: ObstacleGrid, cells: string[]): void {
  for (const key of cells) {
    grid.occupied.add(key)
  }
}

// ============================================================
// BFS Routing
// ============================================================

interface BFSNode {
  gx: number
  gy: number
  dir: number  // 0=N, 1=E, 2=S, 3=W, -1=start
  cost: number
}

const DIRS = [
  { dx: 0, dy: -1 }, // 0: N (上)
  { dx: 1, dy: 0 },  // 1: E (右)
  { dx: 0, dy: 1 },  // 2: S (下)
  { dx: -1, dy: 0 }, // 3: W (左)
]

interface BFSResult {
  gridPath: Array<{ gx: number; gy: number }>
  cost: number
}

/**
 * BFS 1回で中心→中心の最短直交パスを探索。
 * コスト = 距離 + 折れ曲がりペナルティ（交差ペナルティなし）。
 */
function bfsSearch(
  srcX: number, srcY: number,
  dstX: number, dstY: number,
  grid: ObstacleGrid,
): BFSResult | null {
  const startGx = Math.round(srcX / GRID_SIZE)
  const startGy = Math.round(srcY / GRID_SIZE)
  const endGx = Math.round(dstX / GRID_SIZE)
  const endGy = Math.round(dstY / GRID_SIZE)

  if (startGx === endGx && startGy === endGy) {
    return { gridPath: [{ gx: startGx, gy: startGy }, { gx: endGx, gy: endGy }], cost: 0 }
  }

  // Dijkstra 的 BFS（折れ曲がりペナルティ付き）
  const visited = new Map<string, number>()
  const parent = new Map<string, { gx: number; gy: number; dir: number }>()

  // 4方向全てから開始（方向制約なし）
  const queue: BFSNode[] = []
  for (let d = 0; d < 4; d++) {
    const ngx = startGx + DIRS[d].dx
    const ngy = startGy + DIRS[d].dy
    if (grid.occupied.has(`${ngx},${ngy}`)) continue
    const key = `${ngx},${ngy},${d}`
    queue.push({ gx: ngx, gy: ngy, dir: d, cost: 1 })
    visited.set(key, 1)
    parent.set(key, { gx: startGx, gy: startGy, dir: -1 })
  }

  let found = false
  let foundDir = -1
  let foundCost = Infinity
  let iterations = 0

  while (queue.length > 0 && iterations < MAX_BFS_CELLS) {
    iterations++

    // 最小コストのノードを取得
    let minIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[minIdx].cost) minIdx = i
    }
    const curr = queue.splice(minIdx, 1)[0]

    if (curr.cost >= foundCost) continue

    if (curr.gx === endGx && curr.gy === endGy) {
      found = true
      foundDir = curr.dir
      foundCost = curr.cost
      continue
    }

    for (let d = 0; d < 4; d++) {
      const ngx = curr.gx + DIRS[d].dx
      const ngy = curr.gy + DIRS[d].dy

      if (ngx < grid.minX || ngx > grid.maxX || ngy < grid.minY || ngy > grid.maxY) continue
      if (grid.occupied.has(`${ngx},${ngy}`)) continue

      const bendCost = (curr.dir !== -1 && curr.dir !== d) ? BEND_PENALTY : 0
      const newCost = curr.cost + 1 + bendCost

      const nkey = `${ngx},${ngy},${d}`
      const existing = visited.get(nkey)
      if (existing !== undefined && existing <= newCost) continue

      visited.set(nkey, newCost)
      parent.set(nkey, { gx: curr.gx, gy: curr.gy, dir: curr.dir })
      queue.push({ gx: ngx, gy: ngy, dir: d, cost: newCost })
    }
  }

  if (!found) return null

  // パス復元
  const gridPath: Array<{ gx: number; gy: number }> = []
  let currKey = `${endGx},${endGy},${foundDir}`
  gridPath.push({ gx: endGx, gy: endGy })

  while (parent.has(currKey)) {
    const p = parent.get(currKey)!
    gridPath.push({ gx: p.gx, gy: p.gy })
    currKey = `${p.gx},${p.gy},${p.dir}`
  }
  gridPath.reverse()

  return { gridPath, cost: foundCost }
}

/**
 * BFS パスの最初/最後のセグメント方向からアイコン接続辺を決定する。
 * 「上から来た矢印は上辺に接続」ルール。
 */
function determineSide(
  gridPath: Array<{ gx: number; gy: number }>,
  which: 'src' | 'dst',
): Side {
  if (gridPath.length < 2) return 'right'

  let dx: number, dy: number
  if (which === 'src') {
    // 始点: 最初のセグメントの方向 = 出発辺
    dx = gridPath[1].gx - gridPath[0].gx
    dy = gridPath[1].gy - gridPath[0].gy
  } else {
    // 終点: 最後のセグメントの方向 = 到着辺（到来方向）
    const n = gridPath.length
    dx = gridPath[n - 1].gx - gridPath[n - 2].gx
    dy = gridPath[n - 1].gy - gridPath[n - 2].gy
  }

  // 方向→辺: BFS が出発/到着した方向に対応する辺
  if (which === 'src') {
    // 出発: 右に進んでいる → 右辺から出発
    if (dx > 0) return 'right'
    if (dx < 0) return 'left'
    if (dy > 0) return 'bottom'
    return 'top'
  } else {
    // 到着: 右に進んで到着 → 左辺に到着（左から入ってくる）
    if (dx > 0) return 'left'
    if (dx < 0) return 'right'
    if (dy > 0) return 'top'
    return 'bottom'
  }
}

/** グリッドパスを簡略化: 方向が変わる点（折れ点）のみ残す */
function simplifyPath(
  gridPath: Array<{ gx: number; gy: number }>,
  p1: Point,
  p2: Point,
): Point[] {
  if (gridPath.length <= 1) return [p1, p2]

  const points: Point[] = [p1]

  for (let i = 1; i < gridPath.length - 1; i++) {
    const prev = gridPath[i - 1]
    const curr = gridPath[i]
    const next = gridPath[i + 1]

    const dx1 = curr.gx - prev.gx
    const dy1 = curr.gy - prev.gy
    const dx2 = next.gx - curr.gx
    const dy2 = next.gy - curr.gy

    if (dx1 !== dx2 || dy1 !== dy2) {
      points.push({ x: curr.gx * GRID_SIZE, y: curr.gy * GRID_SIZE })
    }
  }

  points.push(p2)

  // 折れ点を直交化
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const next = points[i + 1]
    const curr = points[i]

    const fromHorizontal = Math.abs(curr.y - prev.y) < Math.abs(curr.x - prev.x)
    if (fromHorizontal) {
      curr.y = prev.y
      curr.x = next.x
    } else {
      curr.x = prev.x
      curr.y = next.y
    }
  }

  return points
}

// ============================================================
// Fallback (旧来の単純ルート)
// ============================================================

function fallbackRoute(
  p1: Point, srcSide: Side,
  p2: Point, dstSide: Side,
): Point[] {
  const points: Point[] = [p1]
  const isHorizontalSrc = srcSide === 'left' || srcSide === 'right'
  const isHorizontalDst = dstSide === 'left' || dstSide === 'right'

  if (isHorizontalSrc && isHorizontalDst) {
    if (p1.y !== p2.y) {
      const midX = (p1.x + p2.x) / 2
      points.push({ x: midX, y: p1.y })
      points.push({ x: midX, y: p2.y })
    }
  } else if (!isHorizontalSrc && !isHorizontalDst) {
    if (p1.x !== p2.x) {
      const midY = (p1.y + p2.y) / 2
      points.push({ x: p1.x, y: midY })
      points.push({ x: p2.x, y: midY })
    }
  } else {
    if (isHorizontalSrc) {
      points.push({ x: p2.x, y: p1.y })
    } else {
      points.push({ x: p1.x, y: p2.y })
    }
  }

  points.push(p2)
  return points
}

// ============================================================
// Shared Utilities (nodeIconRect, sideCenter, bestSides)
// ============================================================

export function nodeIconRect(node: DiagramNode): { x: number; y: number; w: number; h: number } {
  if (CONTAINER_TYPES.has(node.type)) {
    return { x: node.position.x, y: node.position.y, w: node.size.width, h: node.size.height }
  }
  const { x, y } = node.position
  const { width, height } = node.size
  const iconSize = Math.min(width, height) * 0.65
  const iconX = x + (width - iconSize) / 2
  const iconY = y + 2
  return { x: iconX, y: iconY, w: iconSize, h: iconSize }
}

export function sideCenter(node: DiagramNode, side: Side): Point {
  const r = nodeIconRect(node)
  switch (side) {
    case 'top':    return { x: r.x + r.w / 2, y: r.y }
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h }
    case 'left':   return { x: r.x,            y: r.y + r.h / 2 }
    case 'right':  return { x: r.x + r.w,      y: r.y + r.h / 2 }
  }
}

export function bestSides(src: DiagramNode, dst: DiagramNode): { srcSide: Side; dstSide: Side } {
  const sr = nodeIconRect(src)
  const dr = nodeIconRect(dst)
  const srcCx = sr.x + sr.w / 2, srcCy = sr.y + sr.h / 2
  const dstCx = dr.x + dr.w / 2, dstCy = dr.y + dr.h / 2
  const dx = dstCx - srcCx, dy = dstCy - srcCy
  const horizontalGap = Math.max(0, Math.max(sr.x - (dr.x + dr.w), dr.x - (sr.x + sr.w)))
  const verticalGap = Math.max(0, Math.max(sr.y - (dr.y + dr.h), dr.y - (sr.y + sr.h)))

  if (horizontalGap > verticalGap) {
    return dx > 0 ? { srcSide: 'right', dstSide: 'left' } : { srcSide: 'left', dstSide: 'right' }
  } else if (verticalGap > horizontalGap) {
    return dy > 0 ? { srcSide: 'bottom', dstSide: 'top' } : { srcSide: 'top', dstSide: 'bottom' }
  } else {
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx > 0 ? { srcSide: 'right', dstSide: 'left' } : { srcSide: 'left', dstSide: 'right' }
    }
    return dy > 0 ? { srcSide: 'bottom', dstSide: 'top' } : { srcSide: 'top', dstSide: 'bottom' }
  }
}

/** ウェイポイント配列 → SVG path d属性 */
export function pointsToPath(points: Point[]): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`
  }
  return d
}
