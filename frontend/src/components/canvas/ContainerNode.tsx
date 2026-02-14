/**
 * ContainerNode.tsx: コンテナノード（AWS Cloud / VPC / AZ / Subnet）
 *
 * モックアップ v3 スタイル + リサイズハンドル（8方向）。
 */

import type { MouseEvent } from 'react'
import type { DiagramNode } from '../../types/diagram'
import { CLOUD_STYLE, VPC_STYLE, AZ_STYLE, SUBNET_STYLES, HANDLE_SIZE } from '../../constants/styles'

// ============================================================
// ResizeHandle
// ============================================================

function ResizeHandle({
  x, y, size, cursor, onMouseDown,
}: {
  x: number
  y: number
  size: number
  cursor: string
  onMouseDown: (e: MouseEvent) => void
}) {
  return (
    <rect
      x={x} y={y} width={size} height={size}
      fill="#ffffff"
      stroke="#3b82f6"
      strokeWidth={size * 0.15}
      rx={size * 0.2}
      style={{ cursor }}
      onMouseDown={onMouseDown}
    />
  )
}

// ============================================================
// ContainerNode
// ============================================================

export function ContainerNode({
  node, isSelected, onMouseDown, onResizeMouseDown, showResizeHandles, viewScale,
}: {
  node: DiagramNode
  isSelected: boolean
  onMouseDown: (e: MouseEvent, id: string) => void
  onResizeMouseDown: (e: MouseEvent, id: string, handle: string) => void
  showResizeHandles: boolean
  viewScale: number
}) {
  const { x, y } = node.position
  const { width, height } = node.size

  let style = AZ_STYLE
  if (node.type === 'aws-cloud') style = CLOUD_STYLE
  else if (node.type === 'vpc') style = VPC_STYLE
  else if (node.type === 'subnet') {
    const tier = (node.metadata?.tier as string) ?? 'Private'
    style = SUBNET_STYLES[tier] ?? SUBNET_STYLES.Private
  }

  const isCloud = node.type === 'aws-cloud'
  const isVpc = node.type === 'vpc'
  const r = isCloud ? 16 : isVpc ? 12 : 6
  const fontSize = isCloud ? 16 : isVpc ? 14 : 11
  const fontWeight = isCloud || isVpc ? 700 : 500
  const strokeW = isSelected ? 3 : isCloud ? 2.5 : isVpc ? 2 : 1.5

  const labelY = isCloud ? y + 24 : y + 18
  const labelX = isCloud ? x + 14 : x + 10

  // リサイズハンドルのサイズ（ビュースケールに合わせる）
  const hs = HANDLE_SIZE * viewScale

  return (
    <g onMouseDown={(e) => onMouseDown(e, node.id)} style={{ cursor: 'pointer' }}>
      {/* 外枠 */}
      <rect
        x={x} y={y} width={width} height={height} rx={r}
        fill={style.fill}
        stroke={isSelected ? '#3b82f6' : style.stroke}
        strokeWidth={strokeW}
        strokeDasharray={isCloud ? '8 4' : undefined}
      />
      {/* ラベル */}
      <text
        x={labelX} y={labelY}
        fontSize={fontSize} fontWeight={fontWeight}
        fill={style.labelColor}
        style={{ pointerEvents: 'none' }}
      >
        {node.label}
      </text>

      {/* リサイズハンドル（選択時のみ表示） */}
      {showResizeHandles && (
        <>
          {/* 四隅のハンドル */}
          <ResizeHandle x={x - hs / 2} y={y - hs / 2} size={hs} cursor="nwse-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 'nw')} />
          <ResizeHandle x={x + width - hs / 2} y={y - hs / 2} size={hs} cursor="nesw-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 'ne')} />
          <ResizeHandle x={x - hs / 2} y={y + height - hs / 2} size={hs} cursor="nesw-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 'sw')} />
          <ResizeHandle x={x + width - hs / 2} y={y + height - hs / 2} size={hs} cursor="nwse-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 'se')} />
          {/* 辺の中央ハンドル */}
          <ResizeHandle x={x + width / 2 - hs / 2} y={y - hs / 2} size={hs} cursor="ns-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 'n')} />
          <ResizeHandle x={x + width / 2 - hs / 2} y={y + height - hs / 2} size={hs} cursor="ns-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 's')} />
          <ResizeHandle x={x - hs / 2} y={y + height / 2 - hs / 2} size={hs} cursor="ew-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 'w')} />
          <ResizeHandle x={x + width - hs / 2} y={y + height / 2 - hs / 2} size={hs} cursor="ew-resize"
            onMouseDown={(e) => onResizeMouseDown(e, node.id, 'e')} />
        </>
      )}
    </g>
  )
}
