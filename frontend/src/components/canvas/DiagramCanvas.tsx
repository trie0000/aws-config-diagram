/**
 * DiagramCanvas.tsx: SVG ベースの構成図 Canvas
 *
 * モックアップ v3 (Light) に準拠したスタイル。
 * - VPC: 緑枠 + 白背景 + 緑テキストラベル
 * - AZ: グレー実線 + 薄グレー背景
 * - Subnet: tier別色枠（緑/青/紫）+ 薄色背景
 * - リソース: オレンジアウトライン矩形アイコン
 * - 接続線: グレー直線
 * - ズーム（ホイール）/ パン（Alt+左ドラッグ or 中ボタン）
 * - ドラッグ&ドロップ / クリック選択
 *
 * Version: 2.0.0
 * Last Updated: 2026-02-13
 */

import { useCallback, useRef, useState, type WheelEvent, type MouseEvent } from 'react'
import type { DiagramState, DiagramNode, DiagramEdge, NodeType } from '../../types/diagram'

// ============================================================
// Props
// ============================================================

interface DiagramCanvasProps {
  state: DiagramState
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onMoveNode: (nodeId: string, x: number, y: number) => void
}

// ============================================================
// スタイル定義（モックアップ v3 Light 準拠）
// ============================================================

/** VPC: 緑枠 + 白背景 */
const VPC_STYLE = { fill: '#ffffff', stroke: '#22c55e', labelColor: '#16a34a' }

/** AZ: グレー実線 + 薄グレー背景 */
const AZ_STYLE = { fill: '#f8fafc', stroke: '#cbd5e1', labelColor: '#64748b' }

/** Subnet tier 別 */
const SUBNET_STYLES: Record<string, { fill: string; stroke: string; labelColor: string }> = {
  Public:   { fill: '#f0fdf4', stroke: '#22c55e', labelColor: '#16a34a' },
  Private:  { fill: '#eff6ff', stroke: '#3b82f6', labelColor: '#2563eb' },
  Isolated: { fill: '#faf5ff', stroke: '#a855f7', labelColor: '#7c3aed' },
}

/** アイコン色 — モックアップではほぼ全てオレンジアウトライン */
const ICON_COLOR = '#ea580c'  // オレンジ（モックアップ準拠）

/** 特殊色のアイコン */
const SPECIAL_ICON_COLORS: Partial<Record<NodeType, string>> = {
  rds: '#2563eb',
  elasticache: '#2563eb',
  redshift: '#2563eb',
  lambda: '#ea580c',
  s3: '#ea580c',
  dynamodb: '#ea580c',
  sqs: '#ea580c',
  sns: '#ea580c',
}

/** アイコン短縮ラベル */
const ICON_LABELS: Record<NodeType, string> = {
  ec2: 'EC2', alb: 'ALB', rds: 'RDS', 'nat-gateway': 'NAT GW',
  igw: 'IGW', ecs: 'ECS', eks: 'EKS', lambda: 'λ',
  elasticache: 'EC', redshift: 'RS', route53: 'R53', cloudfront: 'CF',
  'api-gateway': 'API', s3: 'S3', dynamodb: 'DDB', sqs: 'SQS',
  sns: 'SNS', waf: 'WAF', acm: 'ACM', kms: 'KMS',
  cloudtrail: 'CT', cloudwatch: 'CW', 'vpc-endpoint': 'VPCE',
  'vpc-peering': 'Peer', 'auto-scaling': 'ASG', 'elastic-beanstalk': 'EB',
  'external-system': 'EXT', comment: '💬',
  vpc: 'VPC', subnet: 'Sub', az: 'AZ',
}

const CONTAINER_TYPES = new Set(['vpc', 'az', 'subnet'])

// ============================================================
// Component
// ============================================================

export function DiagramCanvas({ state, selectedNodeId, onSelectNode, onMoveNode }: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  // ズーム / パン
  const [viewBox, setViewBox] = useState({ x: -20, y: -20, w: 1600, h: 1200 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // ドラッグ
  const [dragNodeId, setDragNodeId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: viewBox.x + (clientX - rect.left) * (viewBox.w / rect.width),
      y: viewBox.y + (clientY - rect.top) * (viewBox.h / rect.height),
    }
  }, [viewBox])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.1 : 0.9
    const pt = svgPoint(e.clientX, e.clientY)
    setViewBox(prev => ({
      x: pt.x - (pt.x - prev.x) * factor,
      y: pt.y - (pt.y - prev.y) * factor,
      w: prev.w * factor,
      h: prev.h * factor,
    }))
  }, [svgPoint])

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
      e.preventDefault()
    }
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning) {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const dx = (e.clientX - panStart.x) * (viewBox.w / rect.width)
      const dy = (e.clientY - panStart.y) * (viewBox.h / rect.height)
      setViewBox(prev => ({ ...prev, x: prev.x - dx, y: prev.y - dy }))
      setPanStart({ x: e.clientX, y: e.clientY })
    }
    if (dragNodeId) {
      const pt = svgPoint(e.clientX, e.clientY)
      onMoveNode(dragNodeId, pt.x - dragOffset.x, pt.y - dragOffset.y)
    }
  }, [isPanning, panStart, viewBox, dragNodeId, dragOffset, svgPoint, onMoveNode])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
    setDragNodeId(null)
  }, [])

  const handleNodeMouseDown = useCallback((e: MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (e.button !== 0 || e.altKey) return
    onSelectNode(nodeId)
    const node = state.nodes[nodeId]
    if (node && !CONTAINER_TYPES.has(node.type)) {
      const pt = svgPoint(e.clientX, e.clientY)
      setDragNodeId(nodeId)
      setDragOffset({ x: pt.x - node.position.x, y: pt.y - node.position.y })
    }
  }, [state, svgPoint, onSelectNode])

  const handleBgClick = useCallback(() => { onSelectNode(null) }, [onSelectNode])

  // ノード分類 & ソート
  const nodes = Object.values(state.nodes)
  const containers = nodes.filter(n => CONTAINER_TYPES.has(n.type))
  const icons = nodes.filter(n => !CONTAINER_TYPES.has(n.type))
  const sortedContainers = [...containers].sort((a, b) => {
    const order: Record<string, number> = { vpc: 0, az: 1, subnet: 2 }
    return (order[a.type] ?? 3) - (order[b.type] ?? 3)
  })

  const edges = Object.values(state.edges)

  return (
    <svg
      ref={svgRef}
      className="h-full w-full"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isPanning ? 'grabbing' : dragNodeId ? 'move' : 'default' }}
    >
      {/* SVG Defs（矢印マーカー） */}
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
        </marker>
      </defs>

      {/* 背景 */}
      <rect
        x={viewBox.x - 5000} y={viewBox.y - 5000}
        width={viewBox.w + 10000} height={viewBox.h + 10000}
        fill="#f8fafc"
        onClick={handleBgClick}
      />

      {/* コンテナ（VPC → AZ → Subnet） */}
      {sortedContainers.map(node => (
        <ContainerNode
          key={node.id} node={node}
          isSelected={node.id === selectedNodeId}
          onMouseDown={handleNodeMouseDown}
        />
      ))}

      {/* 接続線 */}
      {edges.map(edge => (
        <EdgeLine key={edge.id} edge={edge} nodes={state.nodes} />
      ))}

      {/* アイコンノード */}
      {icons.map(node => (
        <IconNode
          key={node.id} node={node}
          isSelected={node.id === selectedNodeId}
          onMouseDown={handleNodeMouseDown}
        />
      ))}
    </svg>
  )
}

// ============================================================
// ContainerNode — モックアップ v3 スタイル
// ============================================================

function ContainerNode({
  node, isSelected, onMouseDown,
}: {
  node: DiagramNode
  isSelected: boolean
  onMouseDown: (e: MouseEvent, id: string) => void
}) {
  const { x, y } = node.position
  const { width, height } = node.size

  let style = AZ_STYLE
  if (node.type === 'vpc') style = VPC_STYLE
  else if (node.type === 'subnet') {
    const tier = (node.metadata?.tier as string) ?? 'Private'
    style = SUBNET_STYLES[tier] ?? SUBNET_STYLES.Private
  }

  const r = node.type === 'vpc' ? 12 : 6
  const fontSize = node.type === 'vpc' ? 14 : 11
  const fontWeight = node.type === 'vpc' ? 700 : 500
  const strokeW = isSelected ? 3 : node.type === 'vpc' ? 2 : 1.5

  return (
    <g onMouseDown={(e) => onMouseDown(e, node.id)}>
      {/* 外枠 */}
      <rect
        x={x} y={y} width={width} height={height} rx={r}
        fill={style.fill}
        stroke={isSelected ? '#3b82f6' : style.stroke}
        strokeWidth={strokeW}
      />
      {/* ラベル（枠の内側、左上） */}
      <text
        x={x + 10} y={y + 18}
        fontSize={fontSize} fontWeight={fontWeight}
        fill={style.labelColor}
        style={{ pointerEvents: 'none' }}
      >
        {node.label}
      </text>
    </g>
  )
}

// ============================================================
// IconNode — オレンジアウトライン矩形（モックアップ v3 準拠）
// ============================================================

function IconNode({
  node, isSelected, onMouseDown,
}: {
  node: DiagramNode
  isSelected: boolean
  onMouseDown: (e: MouseEvent, id: string) => void
}) {
  const { x, y } = node.position
  const { width, height } = node.size
  const color = SPECIAL_ICON_COLORS[node.type] ?? ICON_COLOR
  const shortLabel = ICON_LABELS[node.type] ?? node.type.toUpperCase().slice(0, 3)

  const iconSize = Math.min(width, height) * 0.55
  const iconX = x + (width - iconSize) / 2
  const iconY = y + 4

  return (
    <g
      onMouseDown={(e) => onMouseDown(e, node.id)}
      style={{ cursor: 'pointer' }}
    >
      {/* 選択ハイライト（青い点線枠） */}
      {isSelected && (
        <rect
          x={iconX - 4} y={iconY - 4}
          width={iconSize + 8} height={iconSize + 8}
          rx={4} fill="none"
          stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 2"
        />
      )}

      {/* アイコン: アウトライン矩形 */}
      <rect
        x={iconX} y={iconY}
        width={iconSize} height={iconSize}
        rx={4}
        fill="#ffffff"
        stroke={color} strokeWidth={2}
      />

      {/* アイコンテキスト */}
      <text
        x={iconX + iconSize / 2} y={iconY + iconSize / 2}
        textAnchor="middle" dominantBaseline="central"
        fontSize={iconSize * 0.30} fontWeight={700}
        fill={color}
        style={{ pointerEvents: 'none' }}
      >
        {shortLabel}
      </text>

      {/* リソースラベル */}
      <text
        x={x + width / 2} y={iconY + iconSize + 13}
        textAnchor="middle" fontSize={9}
        fill="#475569"
        style={{ pointerEvents: 'none' }}
      >
        {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
      </text>
    </g>
  )
}

// ============================================================
// EdgeLine — 接続線（グレー直線）
// ============================================================

function EdgeLine({
  edge, nodes,
}: {
  edge: DiagramEdge
  nodes: Record<string, DiagramNode>
}) {
  const src = nodes[edge.sourceNodeId]
  const dst = nodes[edge.targetNodeId]
  if (!src || !dst) return null

  // ノード中心座標
  const x1 = src.position.x + src.size.width / 2
  const y1 = src.position.y + src.size.height / 2
  const x2 = dst.position.x + dst.size.width / 2
  const y2 = dst.position.y + dst.size.height / 2

  const isDataFlow = edge.type === 'data-flow'

  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={isDataFlow ? '#94a3b8' : '#cbd5e1'}
        strokeWidth={1.5}
        strokeDasharray={isDataFlow ? undefined : '6 3'}
        markerEnd="url(#arrowhead)"
      />
      {/* ラベル */}
      {edge.label && (
        <text
          x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}
          textAnchor="middle" fontSize={8}
          fill="#94a3b8"
          style={{ pointerEvents: 'none' }}
        >
          {edge.label}
        </text>
      )}
    </g>
  )
}
