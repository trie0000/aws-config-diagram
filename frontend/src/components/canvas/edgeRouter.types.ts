/**
 * edgeRouter.types.ts: エッジルーティング共通型・定数・ユーティリティ
 *
 * Version: 12.0.0
 */

import type { DiagramNode } from '../../types/diagram'

// ============================================================
// Types
// ============================================================

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Point = { x: number; y: number }

export interface RoutedEdge {
  edgeId: string
  waypoints: Point[]
  srcSide: Side
  dstSide: Side
  sourceNodeId?: string
  targetNodeId?: string
}

// ============================================================
// Constants
// ============================================================

export const CONTAINER_TYPES = new Set(['aws-cloud', 'vpc', 'az', 'subnet'])

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

/**
 * コンテナノード用: ソース矩形からターゲット矩形への最適な出口辺を返す。
 */
export function directionToTarget(
  srcRect: { x: number; y: number; w: number; h: number },
  dstRect: { x: number; y: number; w: number; h: number },
): Side {
  const dstCx = dstRect.x + dstRect.w / 2
  const dstCy = dstRect.y + dstRect.h / 2

  const distLeft = dstCx - srcRect.x
  const distRight = dstCx - (srcRect.x + srcRect.w)
  const distTop = dstCy - srcRect.y
  const distBottom = dstCy - (srcRect.y + srcRect.h)

  const candidates: Array<{ side: Side; dist: number }> = []
  if (distLeft < 0)   candidates.push({ side: 'left',   dist: Math.abs(distLeft) })
  if (distRight > 0)  candidates.push({ side: 'right',  dist: Math.abs(distRight) })
  if (distTop < 0)    candidates.push({ side: 'top',    dist: Math.abs(distTop) })
  if (distBottom > 0) candidates.push({ side: 'bottom', dist: Math.abs(distBottom) })

  if (candidates.length === 0) {
    const srcCx = srcRect.x + srcRect.w / 2
    const srcCy = srcRect.y + srcRect.h / 2
    const dx = dstCx - srcCx
    const dy = dstCy - srcCy
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left'
    }
    return dy > 0 ? 'bottom' : 'top'
  }

  candidates.sort((a, b) => a.dist - b.dist)
  return candidates[0].side
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
