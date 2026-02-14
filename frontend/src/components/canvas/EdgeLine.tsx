/**
 * EdgeLine.tsx: 接続線（直交ルーティング）
 *
 * 事前計算済みの RoutedEdge をそのまま描画する。
 * RoutedEdge がない場合は bestSides + fallbackRoute でフォールバック。
 *
 * ルール適用は edgeRouter.ts の enforceEdgeRules() が担当。
 * このコンポーネントは描画のみ。
 */

import type { MouseEvent } from 'react'
import type { DiagramNode, DiagramEdge } from '../../types/diagram'
import { bestSides, sideCenter, pointsToPath, type RoutedEdge } from './edgeRouter'

type Side = 'top' | 'bottom' | 'left' | 'right'

export function EdgeLine({
  edge, nodes, highlighted, onEdgeClick, routedEdge,
}: {
  edge: DiagramEdge
  nodes: Record<string, DiagramNode>
  highlighted: boolean
  onEdgeClick: (e: MouseEvent, edgeId: string) => void
  routedEdge?: RoutedEdge
}) {
  const src = nodes[edge.sourceNodeId]
  const dst = nodes[edge.targetNodeId]
  if (!src || !dst) return null

  // 事前計算済みルートを使用（なければフォールバック）
  let waypoints: Array<{ x: number; y: number }>
  if (routedEdge && routedEdge.waypoints.length >= 2) {
    waypoints = routedEdge.waypoints
  } else {
    const sides = bestSides(src, dst)
    const p1 = sideCenter(src, sides.srcSide)
    const p2 = sideCenter(dst, sides.dstSide)
    waypoints = fallbackRoute(p1, sides.srcSide, p2, sides.dstSide)
  }
  const pathD = pointsToPath(waypoints)

  const isDataFlow = edge.type === 'data-flow'

  const strokeColor = isDataFlow ? '#94a3b8' : '#cbd5e1'
  const strokeW = highlighted ? 3.5 : 1.5
  const labelFontSize = highlighted ? 10 : 8
  const labelWeight = highlighted ? 700 : 400

  // ラベル位置（ルートの中間点あたり）
  const midIdx = Math.floor(waypoints.length / 2)
  const labelPt = waypoints[midIdx] ?? waypoints[0]

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => onEdgeClick(e, edge.id)}
      data-edge-id={edge.id}
      data-src-side={routedEdge?.srcSide ?? ''}
      data-dst-side={routedEdge?.dstSide ?? ''}
    >
      {/* 透明な太いヒットエリア（クリックしやすくする） */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
      />
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeW}
        strokeDasharray={isDataFlow ? undefined : '6 3'}
        markerEnd={highlighted ? "url(#arrowhead-lg)" : "url(#arrowhead)"}
        style={{ pointerEvents: 'none' }}
      />
      {edge.label && (
        <text
          x={labelPt.x} y={labelPt.y - 8}
          textAnchor="middle" fontSize={labelFontSize}
          fontWeight={labelWeight}
          fill="#94a3b8"
          style={{ pointerEvents: 'none' }}
        >
          {edge.label}
        </text>
      )}
    </g>
  )
}

// ============================================================
// Fallback route（edgeRouter が RoutedEdge を返さなかった場合）
// ============================================================

function fallbackRoute(
  p1: { x: number; y: number }, srcSide: Side,
  p2: { x: number; y: number }, dstSide: Side,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [p1]
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
