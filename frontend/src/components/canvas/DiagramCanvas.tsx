/**
 * DiagramCanvas.tsx: SVG ベースの構成図 Canvas
 *
 * モックアップ v3 (Light) に準拠したスタイル。
 * - VPC: 緑枠 + 白背景 + 緑テキストラベル
 * - AZ: グレー実線 + 薄グレー背景
 * - Subnet: tier別色枠（緑/青/紫）+ 薄色背景
 * - リソース: AWS公式PNGアイコン
 * - 接続線: グレー直線
 * - ズーム（ホイール）/ パン（左ドラッグ背景 or 中ボタン）
 * - ドラッグ&ドロップ / クリック選択
 * - コンテナリサイズ（角ハンドル）
 * - スクロールバー（縦横）
 * - ミニマップ（左上 — 固定サイズ、表示範囲ドラッグ可能）
 *
 * Version: 4.0.0
 * Last Updated: 2026-02-13
 */

import { useCallback, useRef, useState, useMemo, useEffect, type WheelEvent, type MouseEvent } from 'react'
import type { DiagramState, DiagramNode, DiagramEdge, NodeType } from '../../types/diagram'
import { ICON_FILES } from '../../constants/icons'
import { routeAllEdges, pointsToPath, nodeIconRect, sideCenter, bestSides, type RoutedEdge } from './edgeRouter'

// ============================================================
// Props
// ============================================================

interface DiagramCanvasProps {
  state: DiagramState
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onResizeNode?: (nodeId: string, width: number, height: number) => void
  /** ドラッグ/リサイズ開始時に呼ばれる（Undo用スナップショット保存） */
  onCommitSnapshot?: () => void
  /** 非表示にする VPC ノード ID のセット */
  hiddenVpcIds?: Set<string>
}

// ============================================================
// スタイル定義（モックアップ v3 Light 準拠）
// ============================================================

/** AWS Cloud: オレンジ枠 + 薄オレンジ背景 */
const CLOUD_STYLE = { fill: '#fffbf5', stroke: '#f97316', labelColor: '#ea580c' }

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

/** アイコンフォールバック短縮ラベル（PNG がないタイプ用） */
const ICON_LABELS: Partial<Record<NodeType, string>> = {
  'vpc-peering': 'Peer',
  'external-system': 'EXT',
  comment: '\u{1F4AC}',
}

/** アイコンフォールバック色 */
const ICON_COLOR = '#ea580c'

/** NodeType → AWS サービス名マッピング */
const SERVICE_NAMES: Partial<Record<NodeType, string>> = {
  ec2: 'Amazon EC2',
  alb: 'Elastic Load Balancing',
  rds: 'Amazon RDS',
  'nat-gateway': 'NAT Gateway',
  igw: 'Internet Gateway',
  ecs: 'Amazon ECS',
  eks: 'Amazon EKS',
  lambda: 'AWS Lambda',
  elasticache: 'Amazon ElastiCache',
  redshift: 'Amazon Redshift',
  route53: 'Amazon Route 53',
  cloudfront: 'Amazon CloudFront',
  'api-gateway': 'Amazon API Gateway',
  s3: 'Amazon S3',
  dynamodb: 'Amazon DynamoDB',
  sqs: 'Amazon SQS',
  sns: 'Amazon SNS',
  waf: 'AWS WAF',
  acm: 'AWS Certificate Manager',
  kms: 'AWS KMS',
  cloudtrail: 'AWS CloudTrail',
  cloudwatch: 'Amazon CloudWatch',
  'vpc-endpoint': 'VPC Endpoint',
  'vpc-peering': 'VPC Peering',
  'auto-scaling': 'Auto Scaling',
  'elastic-beanstalk': 'AWS Elastic Beanstalk',
  'external-system': 'External System',
}

const CONTAINER_TYPES = new Set(['aws-cloud', 'vpc', 'az', 'subnet'])

/** リサイズハンドルのサイズ */
const HANDLE_SIZE = 8

/** スナップガイドライン: 位置が揃ったと判定する閾値（px） */
const SNAP_THRESHOLD = 5

/** ミニマップ設定 */
const MINIMAP_W = 200
const MINIMAP_H = 140
const MINIMAP_MARGIN = 12

// ============================================================
// Component
// ============================================================

export function DiagramCanvas({ state, selectedNodeId, onSelectNode, onMoveNode, onResizeNode, onCommitSnapshot, hiddenVpcIds }: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ズーム / パン
  const [viewBox, setViewBox] = useState({ x: -20, y: -20, w: 1600, h: 1200 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // ドラッグ
  const [dragNodeId, setDragNodeId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  // リサイズ
  const [resizeNodeId, setResizeNodeId] = useState<string | null>(null)
  const [resizeHandle, setResizeHandle] = useState<string>('') // 'se', 'sw', 'ne', 'nw', 'e', 'w', 'n', 's'
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, nodeX: 0, nodeY: 0, nodeW: 0, nodeH: 0 })

  // エッジ選択
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  // ミニマップドラッグ
  const [minimapDrag, setMinimapDrag] = useState(false)
  const minimapDragOffsetRef = useRef({ x: 0, y: 0 }) // 青枠内クリック時のオフセット

  // スナップガイドライン
  const [snapLines, setSnapLines] = useState<Array<{ axis: 'x' | 'y'; pos: number }>>([])

  // スクロールバードラッグ
  const [scrollDragAxis, setScrollDragAxis] = useState<'x' | 'y' | null>(null)
  const [scrollDragStart, setScrollDragStart] = useState({ mouse: 0, scroll: 0 })

  // viewBox を ref に保持（ドラッグ中にリアルタイムで参照するため）
  const viewBoxRef = useRef(viewBox)
  viewBoxRef.current = viewBox

  // アイコンノード一覧 ref（スナップガイドライン計算でドラッグ中に参照する）
  const iconsRef = useRef<DiagramNode[]>([])
  // コンテナノード一覧 ref（リサイズ時のスナップ用）
  const containersRef = useRef<DiagramNode[]>([])

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const vb = viewBoxRef.current
    return {
      x: vb.x + (clientX - rect.left) * (vb.w / rect.width),
      y: vb.y + (clientY - rect.top) * (vb.h / rect.height),
    }
  }, [])

  // コンテンツ境界を計算（ノード配置範囲 + パディング = キャンバス最大範囲）
  const contentBounds = useMemo(() => {
    const allNodes = Object.values(state.nodes)
    if (allNodes.length === 0) return { x: 0, y: 0, w: 1600, h: 1200 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of allNodes) {
      if (n.size.width === 0 && n.size.height === 0) continue
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + n.size.width)
      maxY = Math.max(maxY, n.position.y + n.size.height)
    }
    const pad = 200
    return {
      x: minX - pad,
      y: minY - pad,
      w: (maxX - minX) + 2 * pad,
      h: (maxY - minY) + 2 * pad,
    }
  }, [state.nodes])

  // viewBox を contentBounds 内にクランプする関数
  const clampViewBox = useCallback((vb: { x: number; y: number; w: number; h: number }) => {
    const cb = contentBounds
    // ビューポートが contentBounds より大きい場合はセンタリング
    let x = vb.x, y = vb.y
    if (vb.w >= cb.w) {
      x = cb.x + (cb.w - vb.w) / 2
    } else {
      x = Math.max(cb.x, Math.min(x, cb.x + cb.w - vb.w))
    }
    if (vb.h >= cb.h) {
      y = cb.y + (cb.h - vb.h) / 2
    } else {
      y = Math.max(cb.y, Math.min(y, cb.y + cb.h - vb.h))
    }
    return { x, y, w: vb.w, h: vb.h }
  }, [contentBounds])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    // タッチパッド対応: deltaY の大きさに応じた滑らかなズーム
    // タッチパッドのピンチは小さな deltaY を高頻度で送るため、感度を抑える
    const sensitivity = 0.002  // 小さいほど滑らか
    const clampedDelta = Math.max(-50, Math.min(50, e.deltaY))
    const factor = 1 + clampedDelta * sensitivity
    const pt = svgPoint(e.clientX, e.clientY)
    setViewBox(prev => clampViewBox({
      x: pt.x - (pt.x - prev.x) * factor,
      y: pt.y - (pt.y - prev.y) * factor,
      w: prev.w * factor,
      h: prev.h * factor,
    }))
  }, [svgPoint, clampViewBox])

  // 背景クリック or 中ボタンでパン開始
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 1) {
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
      e.preventDefault()
    } else if (e.button === 0) {
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
    }
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    // リサイズ中
    if (resizeNodeId && onResizeNode) {
      const pt = svgPoint(e.clientX, e.clientY)
      const dx = pt.x - resizeStart.x
      const dy = pt.y - resizeStart.y
      const { nodeX, nodeY, nodeW, nodeH } = resizeStart
      let newX = nodeX, newY = nodeY, newW = nodeW, newH = nodeH

      if (resizeHandle.includes('e')) { newW = nodeW + dx }
      if (resizeHandle.includes('w')) { newX = nodeX + dx; newW = nodeW - dx }
      if (resizeHandle.includes('s')) { newH = nodeH + dy }
      if (resizeHandle.includes('n')) { newY = nodeY + dy; newH = nodeH - dy }

      newW = Math.max(80, newW)
      newH = Math.max(40, newH)

      // リサイズ時のスナップガイドライン: ドラッグ辺を他コンテナの辺に吸着
      // 各軸で最も近い候補1つだけにスナップする
      const lines: Array<{ axis: 'x' | 'y'; pos: number }> = []
      let bestSnapDx = SNAP_THRESHOLD, bestSnapXTarget = 0, snapXAxis: 'e' | 'w' | null = null
      let bestSnapDy = SNAP_THRESHOLD, bestSnapYTarget = 0, snapYAxis: 'n' | 's' | null = null

      for (const other of containersRef.current) {
        if (other.id === resizeNodeId) continue
        const ox = other.position.x, oy = other.position.y
        const oRight = ox + other.size.width, oBottom = oy + other.size.height

        // X軸スナップ（右辺 or 左辺）
        if (resizeHandle.includes('e')) {
          const edgeX = newX + newW
          for (const target of [ox, oRight]) {
            const d = Math.abs(edgeX - target)
            if (d < bestSnapDx) { bestSnapDx = d; bestSnapXTarget = target; snapXAxis = 'e' }
          }
        }
        if (resizeHandle.includes('w')) {
          for (const target of [ox, oRight]) {
            const d = Math.abs(newX - target)
            if (d < bestSnapDx) { bestSnapDx = d; bestSnapXTarget = target; snapXAxis = 'w' }
          }
        }

        // Y軸スナップ（下辺 or 上辺）
        if (resizeHandle.includes('s')) {
          const edgeY = newY + newH
          for (const target of [oy, oBottom]) {
            const d = Math.abs(edgeY - target)
            if (d < bestSnapDy) { bestSnapDy = d; bestSnapYTarget = target; snapYAxis = 's' }
          }
        }
        if (resizeHandle.includes('n')) {
          for (const target of [oy, oBottom]) {
            const d = Math.abs(newY - target)
            if (d < bestSnapDy) { bestSnapDy = d; bestSnapYTarget = target; snapYAxis = 'n' }
          }
        }
      }

      // 最良スナップを適用
      if (snapXAxis === 'e') {
        newW += bestSnapXTarget - (newX + newW)
        lines.push({ axis: 'x', pos: bestSnapXTarget })
      } else if (snapXAxis === 'w') {
        const shift = bestSnapXTarget - newX
        newX += shift; newW -= shift
        lines.push({ axis: 'x', pos: bestSnapXTarget })
      }
      if (snapYAxis === 's') {
        newH += bestSnapYTarget - (newY + newH)
        lines.push({ axis: 'y', pos: bestSnapYTarget })
      } else if (snapYAxis === 'n') {
        const shift = bestSnapYTarget - newY
        newY += shift; newH -= shift
        lines.push({ axis: 'y', pos: bestSnapYTarget })
      }
      setSnapLines(lines)

      newW = Math.max(80, newW)
      newH = Math.max(40, newH)

      // 位置調整（nw, n, w ハンドルの場合）
      if (resizeHandle.includes('w') && newW > 80) {
        onMoveNode(resizeNodeId, newX, newY)
      } else if (resizeHandle.includes('n') && newH > 40) {
        onMoveNode(resizeNodeId, newX, newY)
      }

      onResizeNode(resizeNodeId, newW, newH)
      return
    }

    if (dragNodeId) {
      const pt = svgPoint(e.clientX, e.clientY)
      let newX = pt.x - dragOffset.x
      let newY = pt.y - dragOffset.y

      // スナップガイドライン計算
      const dragNode = state.nodes[dragNodeId]
      if (dragNode) {
        const dragRect = nodeIconRect({ ...dragNode, position: { x: newX, y: newY } } as DiagramNode)
        const dragCx = dragRect.x + dragRect.w / 2
        const dragCy = dragRect.y + dragRect.h / 2
        const lines: Array<{ axis: 'x' | 'y'; pos: number }> = []
        let snappedX = false
        let snappedY = false

        // 最も近いスナップ候補を見つける
        let bestDx = SNAP_THRESHOLD, bestSnapX = 0
        let bestDy = SNAP_THRESHOLD, bestSnapY = 0

        for (const other of iconsRef.current) {
          if (other.id === dragNodeId) continue
          const otherRect = nodeIconRect(other)
          const otherCx = otherRect.x + otherRect.w / 2
          const otherCy = otherRect.y + otherRect.h / 2

          const dx = Math.abs(dragCx - otherCx)
          const dy = Math.abs(dragCy - otherCy)

          if (dx < bestDx) { bestDx = dx; bestSnapX = otherCx; snappedX = true }
          if (dy < bestDy) { bestDy = dy; bestSnapY = otherCy; snappedY = true }
        }

        if (snappedX) {
          newX += bestSnapX - dragCx
          lines.push({ axis: 'x', pos: bestSnapX })
        }
        if (snappedY) {
          newY += bestSnapY - dragCy
          lines.push({ axis: 'y', pos: bestSnapY })
        }
        setSnapLines(lines)
      }

      onMoveNode(dragNodeId, newX, newY)
    } else if (isPanning) {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const vb = viewBoxRef.current
      const dx = (e.clientX - panStart.x) * (vb.w / rect.width)
      const dy = (e.clientY - panStart.y) * (vb.h / rect.height)
      setViewBox(prev => clampViewBox({ ...prev, x: prev.x - dx, y: prev.y - dy }))
      setPanStart({ x: e.clientX, y: e.clientY })
    }
  }, [isPanning, panStart, dragNodeId, dragOffset, svgPoint, onMoveNode, resizeNodeId, resizeHandle, resizeStart, onResizeNode, clampViewBox, state.nodes])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
    setDragNodeId(null)
    setResizeNodeId(null)
    setResizeHandle('')
    setSnapLines([])
  }, [])

  const handleNodeMouseDown = useCallback((e: MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    onSelectNode(nodeId)
    setSelectedEdgeId(null)
    const node = state.nodes[nodeId]
    if (node) {
      onCommitSnapshot?.()
      const pt = svgPoint(e.clientX, e.clientY)
      setDragNodeId(nodeId)
      setDragOffset({ x: pt.x - node.position.x, y: pt.y - node.position.y })
      setIsPanning(false)
    }
  }, [state, svgPoint, onSelectNode, onCommitSnapshot])

  const handleResizeMouseDown = useCallback((e: MouseEvent, nodeId: string, handle: string) => {
    e.stopPropagation()
    e.preventDefault()
    const node = state.nodes[nodeId]
    if (!node) return
    onCommitSnapshot?.()
    const pt = svgPoint(e.clientX, e.clientY)
    setResizeNodeId(nodeId)
    setResizeHandle(handle)
    setResizeStart({
      x: pt.x, y: pt.y,
      nodeX: node.position.x, nodeY: node.position.y,
      nodeW: node.size.width, nodeH: node.size.height,
    })
    setIsPanning(false)
    setDragNodeId(null)
  }, [state, svgPoint, onCommitSnapshot])

  const handleEdgeClick = useCallback((e: MouseEvent, edgeId: string) => {
    e.stopPropagation()
    onSelectNode(null)
    setSelectedEdgeId(edgeId)
  }, [onSelectNode])

  const handleBgClick = useCallback(() => { onSelectNode(null); setSelectedEdgeId(null) }, [onSelectNode])

  // VPC フィルタ
  const isNodeVisible = useCallback((node: DiagramNode): boolean => {
    if (!hiddenVpcIds || hiddenVpcIds.size === 0) return true
    if (node.type === 'vpc' && hiddenVpcIds.has(node.id)) return false
    let current: DiagramNode | undefined = node
    while (current?.parentId) {
      if (current.parentId.startsWith('node-') && hiddenVpcIds.has(current.parentId)) return false
      current = state.nodes[current.parentId]
      if (current?.type === 'vpc' && hiddenVpcIds.has(current.id)) return false
    }
    return true
  }, [hiddenVpcIds, state.nodes])

  // ノード分類 & ソート（全てメモ化して無駄な再計算を防ぐ）
  const nodes = useMemo(() => Object.values(state.nodes).filter(isNodeVisible), [state.nodes, isNodeVisible])
  const containers = useMemo(() => nodes.filter(n => CONTAINER_TYPES.has(n.type)), [nodes])
  const icons = useMemo(() => nodes.filter(n => !CONTAINER_TYPES.has(n.type)), [nodes])
  iconsRef.current = icons
  containersRef.current = containers
  const sortedContainers = useMemo(() => [...containers].sort((a, b) => {
    const order: Record<string, number> = { 'aws-cloud': 0, vpc: 1, az: 2, subnet: 3 }
    return (order[a.type] ?? 4) - (order[b.type] ?? 4)
  }), [containers])

  // エッジ: 両端が可視の場合のみ表示
  const visibleNodeIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])
  const edges = useMemo(() =>
    Object.values(state.edges).filter(
      e => visibleNodeIds.has(e.sourceNodeId) && visibleNodeIds.has(e.targetNodeId)
    ), [state.edges, visibleNodeIds])

  // 全エッジの障害物回避ルーティングを一括計算
  const routedEdges = useMemo(() => {
    if (edges.length === 0) return new Map<string, RoutedEdge>()
    const results = routeAllEdges(state.nodes, edges)
    const map = new Map<string, RoutedEdge>()
    for (const r of results) map.set(r.edgeId, r)
    return map
  }, [state.nodes, edges])

  // =============================================
  // スクロールバー計算（contentBounds を固定範囲として使用）
  // =============================================
  const scrollInfo = useMemo(() => {
    const cb = contentBounds

    return {
      // 水平スクロールバー
      hThumbLeft: ((viewBox.x - cb.x) / cb.w) * 100,
      hThumbWidth: (viewBox.w / cb.w) * 100,
      // 垂直スクロールバー
      vThumbTop: ((viewBox.y - cb.y) / cb.h) * 100,
      vThumbHeight: (viewBox.h / cb.h) * 100,
      // スクロール範囲（固定）
      startX: cb.x, startY: cb.y, rangeW: cb.w, rangeH: cb.h,
    }
  }, [contentBounds, viewBox])

  // スクロールバー水平ドラッグ
  const handleScrollbarMouseDown = useCallback((axis: 'x' | 'y', e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setScrollDragAxis(axis)
    setScrollDragStart({
      mouse: axis === 'x' ? e.clientX : e.clientY,
      scroll: axis === 'x' ? viewBox.x : viewBox.y,
    })
  }, [viewBox])

  // =============================================
  // ミニマップ（固定サイズ — contentBounds を常に表示）
  // =============================================
  const minimapRef = useRef<HTMLDivElement>(null)

  // ミニマップの viewBox は contentBounds に固定（ズーム/パンで変わらない）
  const minimapTransform = useMemo(() => {
    const cb = contentBounds
    const scale = Math.min(MINIMAP_W / cb.w, MINIMAP_H / cb.h)
    // SVG preserveAspectRatio="xMidYMid meet" によるオフセットを計算
    const renderedW = cb.w * scale
    const renderedH = cb.h * scale
    const offsetX = (MINIMAP_W - renderedW) / 2
    const offsetY = (MINIMAP_H - renderedH) / 2
    return { allX: cb.x, allY: cb.y, allW: cb.w, allH: cb.h, scale, offsetX, offsetY }
  }, [contentBounds])

  // ミニマップ上のピクセル座標 → ワールド座標に変換
  const minimapToWorld = useCallback((clientX: number, clientY: number) => {
    const mmEl = minimapRef.current
    if (!mmEl) return { x: 0, y: 0 }
    const rect = mmEl.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const { allX, allY, scale, offsetX, offsetY } = minimapTransform
    return {
      x: allX + (mx - offsetX) / scale,
      y: allY + (my - offsetY) / scale,
    }
  }, [minimapTransform])

  const handleMinimapDragMove = useCallback((e: globalThis.MouseEvent) => {
    const world = minimapToWorld(e.clientX, e.clientY)
    // オフセットを差し引いて相対移動
    setViewBox(prev => clampViewBox({
      ...prev,
      x: world.x - minimapDragOffsetRef.current.x,
      y: world.y - minimapDragOffsetRef.current.y,
    }))
  }, [minimapToWorld, clampViewBox])

  const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setMinimapDrag(true)
    const world = minimapToWorld(e.clientX, e.clientY)
    const vb = viewBoxRef.current

    // クリック位置が現在の青枠内かどうか判定
    const insideX = world.x >= vb.x && world.x <= vb.x + vb.w
    const insideY = world.y >= vb.y && world.y <= vb.y + vb.h
    if (insideX && insideY) {
      // 青枠内クリック → オフセットを記憶（相対ドラッグ）
      minimapDragOffsetRef.current = { x: world.x - vb.x, y: world.y - vb.y }
    } else {
      // 青枠外クリック → クリック位置を青枠の左上にセット
      minimapDragOffsetRef.current = { x: 0, y: 0 }
      setViewBox(prev => clampViewBox({
        ...prev,
        x: world.x,
        y: world.y,
      }))
    }
  }, [minimapToWorld, clampViewBox])

  // グローバル mouse move/up for scrollbar & minimap
  useEffect(() => {
    const handleGlobalMouseMove = (e: globalThis.MouseEvent) => {
      if (scrollDragAxis) {
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        if (scrollDragAxis === 'x') {
          const trackW = rect.width - 14
          const delta = e.clientX - scrollDragStart.mouse
          const scrollDelta = (delta / trackW) * scrollInfo.rangeW
          setViewBox(prev => clampViewBox({ ...prev, x: scrollDragStart.scroll + scrollDelta }))
        } else {
          const trackH = rect.height - 14
          const delta = e.clientY - scrollDragStart.mouse
          const scrollDelta = (delta / trackH) * scrollInfo.rangeH
          setViewBox(prev => clampViewBox({ ...prev, y: scrollDragStart.scroll + scrollDelta }))
        }
      }
      if (minimapDrag) {
        handleMinimapDragMove(e)
      }
    }
    const handleGlobalMouseUp = () => {
      setScrollDragAxis(null)
      setMinimapDrag(false)
    }
    if (scrollDragAxis || minimapDrag) {
      window.addEventListener('mousemove', handleGlobalMouseMove)
      window.addEventListener('mouseup', handleGlobalMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove)
        window.removeEventListener('mouseup', handleGlobalMouseUp)
      }
    }
  }, [scrollDragAxis, scrollDragStart, scrollInfo, minimapDrag, handleMinimapDragMove, clampViewBox])

  // =============================================
  // Render
  // =============================================
  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        className="h-full w-full"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: resizeNodeId ? 'nwse-resize' : isPanning ? 'grabbing' : dragNodeId ? 'move' : 'grab' }}
      >
        {/* SVG Defs */}
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

        {/* コンテナ */}
        {sortedContainers.map(node => (
          <ContainerNode
            key={node.id} node={node}
            isSelected={node.id === selectedNodeId}
            onMouseDown={handleNodeMouseDown}
            onResizeMouseDown={handleResizeMouseDown}
            showResizeHandles={node.id === selectedNodeId && !!onResizeNode}
            viewScale={viewBox.w / (containerRef.current?.getBoundingClientRect().width ?? 1600)}
          />
        ))}

        {/* 接続線（非ハイライトを先に描画、ハイライトを後に描画して前面に） */}
        {edges.filter(e => {
          if (selectedEdgeId && e.id === selectedEdgeId) return false
          if (selectedNodeId && e.sourceNodeId === selectedNodeId) return false
          return true
        }).map(edge => (
          <EdgeLine key={edge.id} edge={edge} nodes={state.nodes} highlighted={false} onEdgeClick={handleEdgeClick} routedEdge={routedEdges.get(edge.id)} />
        ))}
        {edges.filter(e => {
          if (selectedEdgeId && e.id === selectedEdgeId) return true
          if (selectedNodeId && e.sourceNodeId === selectedNodeId) return true
          return false
        }).map(edge => (
          <EdgeLine key={edge.id} edge={edge} nodes={state.nodes} highlighted={true} onEdgeClick={handleEdgeClick} routedEdge={routedEdges.get(edge.id)} />
        ))}

        {/* アイコンノード */}
        {icons.map(node => {
          // エッジ選択中は、そのエッジの始点・終点アイコンもアクティブ表示
          const selectedEdge = selectedEdgeId ? state.edges[selectedEdgeId] : null
          const isEdgeEndpoint = selectedEdge
            ? (node.id === selectedEdge.sourceNodeId || node.id === selectedEdge.targetNodeId)
            : false
          return (
            <IconNode
              key={node.id} node={node}
              isSelected={node.id === selectedNodeId}
              isEdgeActive={isEdgeEndpoint}
              onMouseDown={handleNodeMouseDown}
            />
          )
        })}

        {/* スナップガイドライン（ドラッグ中のみ表示） */}
        {snapLines.map((line, i) => (
          line.axis === 'x' ? (
            <line
              key={`snap-${i}`}
              x1={line.pos} y1={contentBounds.y}
              x2={line.pos} y2={contentBounds.y + contentBounds.h}
              stroke="#f43f5e" strokeWidth={0.8} strokeDasharray="4 4"
              style={{ pointerEvents: 'none' }}
            />
          ) : (
            <line
              key={`snap-${i}`}
              x1={contentBounds.x} y1={line.pos}
              x2={contentBounds.x + contentBounds.w} y2={line.pos}
              stroke="#f43f5e" strokeWidth={0.8} strokeDasharray="4 4"
              style={{ pointerEvents: 'none' }}
            />
          )
        ))}
      </svg>

      {/* 水平スクロールバー */}
      <div
        className="absolute bottom-0 left-0 z-10"
        style={{ right: 14, height: 14, background: '#f1f5f9', borderTop: '1px solid #e2e8f0' }}
      >
        <div
          className="absolute top-1 rounded-full transition-colors"
          style={{
            left: `${scrollInfo.hThumbLeft}%`,
            width: `${Math.max(scrollInfo.hThumbWidth, 4)}%`,
            height: 8,
            background: scrollDragAxis === 'x' ? '#94a3b8' : '#cbd5e1',
            cursor: 'pointer',
          }}
          onMouseDown={(e) => handleScrollbarMouseDown('x', e)}
        />
      </div>

      {/* 垂直スクロールバー */}
      <div
        className="absolute right-0 top-0 z-10"
        style={{ bottom: 14, width: 14, background: '#f1f5f9', borderLeft: '1px solid #e2e8f0' }}
      >
        <div
          className="absolute left-1 rounded-full transition-colors"
          style={{
            top: `${scrollInfo.vThumbTop}%`,
            height: `${Math.max(scrollInfo.vThumbHeight, 4)}%`,
            width: 8,
            background: scrollDragAxis === 'y' ? '#94a3b8' : '#cbd5e1',
            cursor: 'pointer',
          }}
          onMouseDown={(e) => handleScrollbarMouseDown('y', e)}
        />
      </div>

      {/* 右下角のスクロールバー交差部分 */}
      <div
        className="absolute bottom-0 right-0 z-10"
        style={{ width: 14, height: 14, background: '#f1f5f9', borderTop: '1px solid #e2e8f0', borderLeft: '1px solid #e2e8f0' }}
      />

      {/* ミニマップ（左上 — 固定サイズ） */}
      <div
        ref={minimapRef}
        className="absolute z-20 cursor-crosshair overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
        style={{
          top: MINIMAP_MARGIN,
          left: MINIMAP_MARGIN,
          width: MINIMAP_W,
          height: MINIMAP_H,
        }}
        onMouseDown={handleMinimapMouseDown}
      >
        <svg
          width={MINIMAP_W}
          height={MINIMAP_H}
          viewBox={`${minimapTransform.allX} ${minimapTransform.allY} ${minimapTransform.allW} ${minimapTransform.allH}`}
          style={{ pointerEvents: 'none' }}
        >
          {/* ミニマップ背景 */}
          <rect
            x={minimapTransform.allX} y={minimapTransform.allY}
            width={minimapTransform.allW} height={minimapTransform.allH}
            fill="#f8fafc"
          />

          {/* コンテナの縮小表示 */}
          {sortedContainers.map(node => {
            let fill = '#e2e8f0'
            if (node.type === 'aws-cloud') fill = '#fed7aa'
            else if (node.type === 'vpc') fill = '#bbf7d0'
            else if (node.type === 'subnet') fill = '#dbeafe'
            return (
              <rect
                key={node.id}
                x={node.position.x} y={node.position.y}
                width={node.size.width} height={node.size.height}
                fill={fill}
                stroke="#94a3b8"
                strokeWidth={Math.max(1, 2 / minimapTransform.scale)}
                rx={2 / minimapTransform.scale}
              />
            )
          })}

          {/* アイコンノードの縮小表示 */}
          {icons.map(node => (
            <rect
              key={node.id}
              x={node.position.x + node.size.width * 0.2}
              y={node.position.y + node.size.height * 0.2}
              width={node.size.width * 0.6}
              height={node.size.height * 0.6}
              fill="#f97316"
              rx={2 / minimapTransform.scale}
            />
          ))}

          {/* 現在の表示範囲 */}
          <rect
            x={viewBox.x} y={viewBox.y}
            width={viewBox.w} height={viewBox.h}
            fill="rgba(59,130,246,0.10)"
            stroke="#3b82f6"
            strokeWidth={Math.max(2, 4 / minimapTransform.scale)}
            rx={2 / minimapTransform.scale}
          />
        </svg>
      </div>
    </div>
  )
}

// ============================================================
// ContainerNode — モックアップ v3 スタイル + リサイズハンドル
// ============================================================

function ContainerNode({
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
// IconNode — AWS公式PNGアイコン
// ============================================================

function IconNode({
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
        <>
          <rect
            x={iconX - 6} y={iconY - 6}
            width={iconSize + 12} height={iconSize + 12}
            rx={6} fill="rgba(59,130,246,0.08)"
            stroke="#3b82f6" strokeWidth={2.5}
          />
        </>
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

// ============================================================
// EdgeLine — 接続線（直交ルーティング: 縦横の直線のみ）
// ============================================================

type Side = 'top' | 'bottom' | 'left' | 'right'

/** 直交ルーティングのウェイポイントを生成（フォールバック用、edgeRouter が失敗した場合） */
function orthogonalRoute(
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

function EdgeLine({
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
    const { srcSide, dstSide } = bestSides(src, dst)
    const p1 = sideCenter(src, srcSide)
    const p2 = sideCenter(dst, dstSide)
    waypoints = orthogonalRoute(p1, srcSide, p2, dstSide)
  }
  const pathD = pointsToPath(waypoints)

  const isDataFlow = edge.type === 'data-flow'

  // ハイライト時は太くするだけ（色は変えない）
  const strokeColor = isDataFlow ? '#94a3b8' : '#cbd5e1'
  const strokeW = highlighted ? 3.5 : 1.5
  const labelFontSize = highlighted ? 10 : 8
  const labelWeight = highlighted ? 700 : 400

  // ラベル位置（ルートの中間点あたり）
  const midIdx = Math.floor(waypoints.length / 2)
  const labelPt = waypoints[midIdx] ?? waypoints[0]

  return (
    <g style={{ cursor: 'pointer' }} onClick={(e) => onEdgeClick(e, edge.id)}>
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
        markerEnd="url(#arrowhead)"
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
