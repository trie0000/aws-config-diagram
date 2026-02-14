/**
 * edgeRouter.types.ts: エッジルーティング共通型・定数・ユーティリティ
 */

import type { DiagramNode } from '../../types/diagram'

// ============================================================
// Types
// ============================================================

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Point = { x: number; y: number }

/** ルーティング結果 */
export interface RoutedEdge {
  edgeId: string
  waypoints: Point[]
  srcSide: Side
  dstSide: Side
  /** 元のエッジのソース/ターゲットノードID（reduceCrossings で正確なノードを参照するため） */
  sourceNodeId?: string
  targetNodeId?: string
}

/** 障害物グリッド */
export interface ObstacleGrid {
  occupied: Set<string>
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** BFS ノード */
export interface BFSNode {
  gx: number
  gy: number
  dir: number  // 0=N, 1=E, 2=S, 3=W, -1=start
  cost: number
}

/** BFS 結果 */
export interface BFSResult {
  gridPath: Array<{ gx: number; gy: number }>
  cost: number
}

// ============================================================
// Constants
// ============================================================

export const CONTAINER_TYPES = new Set(['aws-cloud', 'vpc', 'az', 'subnet'])

/** グリッドセルサイズ（px） — 小さいほど精密だが遅い */
export const GRID_SIZE = 20

/** 障害物の周りのマージン（グリッドセル数） */
export const OBSTACLE_MARGIN = 1

/** BFS 探索の最大セル数（無限ループ防止） */
export const MAX_BFS_CELLS = 20000

/** 折れ曲がりペナルティ（BFS コスト加算、曲がりの少ないルートを優先） */
export const BEND_PENALTY = 2

/** 交差ペナルティ（再ルーティング BFS でのみ使用） */
export const CROSS_PENALTY = 10

/** BFS 方向定義: N, E, S, W */
export const DIRS = [
  { dx: 0, dy: -1 }, // 0: N (上)
  { dx: 1, dy: 0 },  // 1: E (右)
  { dx: 0, dy: 1 },  // 2: S (下)
  { dx: -1, dy: 0 }, // 3: W (左)
]

// ============================================================
// Shared Utilities
// ============================================================

/** ノードのアイコン矩形（非コンテナ: 中央のアイコン領域、コンテナ: 全体） */
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

/** ノードの指定辺の中央座標 */
export function sideCenter(node: DiagramNode, side: Side): Point {
  const r = nodeIconRect(node)
  switch (side) {
    case 'top':    return { x: r.x + r.w / 2, y: r.y }
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h }
    case 'left':   return { x: r.x,            y: r.y + r.h / 2 }
    case 'right':  return { x: r.x + r.w,      y: r.y + r.h / 2 }
  }
}

/** 2ノード間の最適接続辺を決定 */
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

/** 指定座標に最も近いアイコンノードを探す */
export function findClosestNode(
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
