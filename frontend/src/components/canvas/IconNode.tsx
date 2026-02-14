/**
 * IconNode.tsx: AWS公式PNGアイコンノード
 *
 * アイコン画像 + ラベルテキスト。
 * 選択時・エッジアクティブ時のハイライト表示。
 */

import type { MouseEvent } from 'react'
import type { DiagramNode } from '../../types/diagram'
import { ICON_FILES } from '../../constants/icons'
import { ICON_COLOR, ICON_LABELS, SERVICE_NAMES } from '../../constants/styles'

export function IconNode({
  node, isSelected, isEdgeActive, onMouseDown,
}: {
  node: DiagramNode
  isSelected: boolean
  isEdgeActive?: boolean
  onMouseDown: (e: MouseEvent, id: string) => void
}) {
  const { x, y } = node.position
  const { width, height } = node.size

  const iconFile = ICON_FILES[node.type]
  const iconSize = Math.min(width, height) * 0.65
  const iconX = x + (width - iconSize) / 2
  const iconY = y + 2

  const serviceName = SERVICE_NAMES[node.type] ?? node.type

  return (
    <g
      onMouseDown={(e) => onMouseDown(e, node.id)}
      style={{ cursor: 'pointer' }}
    >
      <title>{`${serviceName}\n${node.label}`}</title>
      {/* エッジ選択時のアクティブ表示（始点・終点アイコン） */}
      {isEdgeActive && (
        <rect
          x={iconX - 6} y={iconY - 6}
          width={iconSize + 12} height={iconSize + 12}
          rx={6} fill="rgba(59,130,246,0.08)"
          stroke="#3b82f6" strokeWidth={2.5}
        />
      )}
      {/* 通常の選択ハイライト */}
      {isSelected && (
        <rect
          x={iconX - 4} y={iconY - 4}
          width={iconSize + 8} height={iconSize + 8}
          rx={4} fill="none"
          stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 2"
        />
      )}

      {iconFile ? (
        <>
          <rect
            x={iconX} y={iconY}
            width={iconSize} height={iconSize}
            fill="transparent"
          />
          <image
            href={`/icons/${iconFile}`}
            x={iconX} y={iconY}
            width={iconSize} height={iconSize}
            style={{ pointerEvents: 'none' }}
          />
        </>
      ) : (
        <>
          <rect
            x={iconX} y={iconY}
            width={iconSize} height={iconSize}
            rx={4}
            fill="#ffffff"
            stroke={ICON_COLOR} strokeWidth={2}
          />
          <text
            x={iconX + iconSize / 2} y={iconY + iconSize / 2}
            textAnchor="middle" dominantBaseline="central"
            fontSize={iconSize * 0.30} fontWeight={700}
            fill={ICON_COLOR}
            style={{ pointerEvents: 'none' }}
          >
            {ICON_LABELS[node.type] ?? node.type.toUpperCase().slice(0, 3)}
          </text>
        </>
      )}

      {/* ラベル */}
      <text
        x={x + width / 2} y={iconY + iconSize + 12}
        textAnchor="middle" fontSize={9}
        fill="#475569"
        style={{ pointerEvents: 'none' }}
      >
        {node.label.length > 22 ? node.label.slice(0, 20) + '\u2026' : node.label}
      </text>
    </g>
  )
}
