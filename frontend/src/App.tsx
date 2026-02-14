/**
 * App.tsx: AWS Config Diagram Generator - メインアプリケーション
 *
 * モックアップ v3 (Light) に準拠した2画面構成:
 * - P01: スタート画面（アップロード + ステップ説明）
 * - P02: メインエディタ（ツールバー + Canvas + サイドバー + ステータスバー）
 *
 * サイドバー:
 * - VPC フィルタ: チェックボックスで VPC 単位の表示/非表示
 * - プロパティ: 選択ノードの詳細情報（AWS アイコン付き）
 * - サイドバー自体の表示/非表示切替ボタン
 *
 * Version: 3.0.0
 * Last Updated: 2026-02-13
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDiagram } from './hooks/useDiagram'
import { DiagramCanvas } from './components/canvas/DiagramCanvas'
import { ICON_FILES } from './constants/icons'
import type { DiagramNode, NodeType } from './types/diagram'
import type { ExportFormat } from './services/api'

function App() {
  const diagram = useDiagram()

  // エディタ画面（DiagramState がある場合）
  if (diagram.state) {
    return <EditorScreen diagram={diagram} />
  }

  // スタート画面
  return <StartScreen diagram={diagram} />
}

// ============================================================
// スタート画面（P01 準拠）
// ============================================================

function StartScreen({ diagram }: { diagram: ReturnType<typeof useDiagram> }) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file?.name.endsWith('.json')) {
        diagram.loadFile(file)
      }
    },
    [diagram],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        diagram.loadFile(file)
      }
    },
    [diagram],
  )

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* メインコンテンツ */}
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="w-full max-w-2xl">
          {/* ロゴ + タイトル */}
          <div className="mb-10 text-center">
            {/* クラウド構成アイコン群 */}
            <div className="mx-auto mb-5 flex h-20 w-40 items-center justify-center gap-1">
              <div className="relative flex h-20 w-40 items-end justify-center">
                {/* 背景クラウド */}
                <img src="/icons/aws_cloud.png" alt="" className="absolute left-1/2 top-0 h-14 w-14 -translate-x-1/2 opacity-20" />
                {/* アイコン群 */}
                <div className="relative z-10 flex items-end gap-2 pb-1">
                  <img src="/icons/vpc_icon.png" alt="" className="h-8 w-8 drop-shadow-md" />
                  <img src="/icons/ec2.png" alt="" className="h-10 w-10 drop-shadow-md" />
                  <img src="/icons/rds.png" alt="" className="h-8 w-8 drop-shadow-md" />
                  <img src="/icons/s3.png" alt="" className="h-7 w-7 drop-shadow-md" />
                </div>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-slate-800">
              AWS Config Diagram Generator
            </h1>
            <p className="mt-3 text-sm text-slate-500">
              Config Snapshot JSON からネットワーク構成図を自動生成
            </p>
          </div>

          {/* ドロップゾーン */}
          <div
            className="mx-auto flex max-w-xl cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-8 py-14 transition-colors hover:border-blue-400 hover:bg-blue-50/30"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            {/* クラウド構成図イメージ */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex flex-col items-center gap-1">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <svg className="h-8 w-8 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M4 6h16M4 12h16M4 18h10" />
                    <text x="18" y="19" fontSize="7" fill="currentColor" stroke="none">{'{}'}</text>
                  </svg>
                </div>
                <span className="text-[9px] text-slate-400">JSON</span>
              </div>
              <svg className="h-4 w-8 text-blue-400" viewBox="0 0 32 16" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="0" y1="8" x2="24" y2="8" />
                <polyline points="20,3 26,8 20,13" />
              </svg>
              <div className="flex flex-col items-center gap-1">
                <div className="flex gap-1 rounded-lg border border-orange-200 bg-orange-50/50 p-2">
                  <img src="/icons/vpc_icon.png" alt="" className="h-6 w-6" />
                  <img src="/icons/ec2.png" alt="" className="h-6 w-6" />
                  <img src="/icons/rds.png" alt="" className="h-6 w-6" />
                </div>
                <span className="text-[9px] text-slate-400">構成図</span>
              </div>
              <svg className="h-4 w-8 text-blue-400" viewBox="0 0 32 16" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="0" y1="8" x2="24" y2="8" />
                <polyline points="20,3 26,8 20,13" />
              </svg>
              <div className="flex flex-col items-center gap-1">
                <div className="flex gap-1 rounded-lg border border-green-200 bg-green-50/50 p-2">
                  <svg className="h-6 w-6 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="18" height="18" rx="2" fill="#16a34a" opacity="0.15" />
                    <rect x="5" y="7" width="6" height="1.5" rx="0.5" fill="#16a34a" />
                    <rect x="5" y="10" width="8" height="1.5" rx="0.5" fill="#16a34a" />
                    <rect x="5" y="13" width="5" height="1.5" rx="0.5" fill="#16a34a" />
                    <rect x="13" y="7" width="6" height="1.5" rx="0.5" fill="#16a34a" opacity="0.5" />
                    <rect x="13" y="10" width="6" height="1.5" rx="0.5" fill="#16a34a" opacity="0.5" />
                    <rect x="13" y="13" width="6" height="1.5" rx="0.5" fill="#16a34a" opacity="0.5" />
                  </svg>
                  <svg className="h-6 w-6 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="18" height="18" rx="2" fill="#ea580c" opacity="0.15" />
                    <rect x="5" y="5" width="14" height="3" rx="1" fill="#ea580c" opacity="0.6" />
                    <rect x="5" y="10" width="14" height="9" rx="1" fill="#ea580c" opacity="0.2" />
                    <rect x="7" y="12" width="4" height="3" rx="0.5" fill="#ea580c" opacity="0.5" />
                    <rect x="13" y="12" width="4" height="3" rx="0.5" fill="#ea580c" opacity="0.5" />
                  </svg>
                </div>
                <span className="text-[9px] text-slate-400">Excel / PPTX</span>
              </div>
            </div>
            <p className="text-sm font-medium text-slate-700">
              Config JSON をここにドロップ
            </p>
            <p className="mt-1.5 text-xs text-slate-400">
              またはクリックしてファイルを選択
            </p>
            <p className="mt-3 text-xs text-slate-400">
              対応形式: AWS Config Snapshot JSON (.json)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* ローディング */}
          {diagram.loading && (
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-blue-600">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              パース中...
            </div>
          )}

          {/* エラー */}
          {diagram.error && (
            <div className="mx-auto mt-6 max-w-xl rounded-lg bg-red-50 px-5 py-3 text-sm text-red-600">
              {diagram.error}
            </div>
          )}

          {/* ステップ説明カード */}
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-4">
            <StepCard step={1} title="JSONをアップロード" description="AWS ConfigのJSONをドロップ" icon="/icons/cloudtrail.png" />
            <StepCard step={2} title="構成図を自動生成" description="VPC / SG / 接続を解析" icon="/icons/vpc_icon.png" />
            <StepCard step={3} title="Excel/PPTXでエクスポート" description="ドキュメントとして出力" icon="/icons/cloudwatch.png" />
          </div>
        </div>
      </div>

      <footer className="py-4 text-center text-xs text-slate-400">
        &copy; 2026 AWS Config Diagram Generator &nbsp;|&nbsp; ローカル完結 &nbsp;|&nbsp; データ外部送信なし
      </footer>
    </div>
  )
}

function StepCard({ step, title, description, icon }: { step: number; title: string; description: string; icon?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {icon ? (
          <img src={icon} alt="" className="h-6 w-6 shrink-0" />
        ) : (
          <span className="text-base text-blue-500">
            {step === 1 ? '\u{1F4C4}' : step === 2 ? '\u{1F4BB}' : '\u{1F4E5}'}
          </span>
        )}
        <span className="text-sm font-semibold text-slate-700">
          Step {step}: {title}
        </span>
      </div>
      <p className="text-xs text-slate-500">{description}</p>
    </div>
  )
}

// ============================================================
// エディタ画面（P02 準拠 + サイドバー）
// ============================================================

type SidebarTab = 'vpc' | 'property'

function EditorScreen({ diagram }: { diagram: ReturnType<typeof useDiagram> }) {
  const nodeCount = diagram.state ? Object.keys(diagram.state.nodes).length : 0
  const edgeCount = diagram.state ? Object.keys(diagram.state.edges).length : 0
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('vpc')
  const [hiddenVpcIds, setHiddenVpcIds] = useState<Set<string>>(new Set())

  // キーボードショートカット: Cmd+Z / Cmd+Shift+Z
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          diagram.redo()
        } else {
          diagram.undo()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [diagram])

  // VPC ノードのリストを取得
  const vpcNodes = useMemo(() => {
    if (!diagram.state) return []
    return Object.values(diagram.state.nodes)
      .filter(n => n.type === 'vpc')
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [diagram.state])

  const toggleVpcVisibility = useCallback((vpcId: string) => {
    setHiddenVpcIds(prev => {
      const next = new Set(prev)
      if (next.has(vpcId)) {
        next.delete(vpcId)
      } else {
        next.add(vpcId)
      }
      return next
    })
  }, [])

  const handleExport = useCallback(
    (format: ExportFormat) => {
      diagram.doExport(format)
      setShowExportMenu(false)
    },
    [diagram],
  )

  // ノード選択時にプロパティタブに自動切替
  const handleSelectNode = useCallback((nodeId: string | null) => {
    diagram.selectNode(nodeId)
    if (nodeId && sidebarOpen) {
      setSidebarTab('property')
    }
  }, [diagram, sidebarOpen])

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      {/* ツールバー */}
      <header className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-3">
        <div className="flex items-center gap-1">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white transition-colors hover:bg-blue-700"
            title="新規ファイル"
            onClick={diagram.reset}
          >
            +
          </button>

          <ToolbarDivider />

          <span className="px-2 text-xs font-medium text-slate-600">
            {diagram.state?.meta.title ?? 'AWS Config Diagram'}
          </span>

          <ToolbarDivider />

          <ToolbarButton icon="&#x2190;" title="元に戻す (⌘Z)" disabled={!diagram.canUndo} onClick={diagram.undo} />
          <ToolbarButton icon="&#x2192;" title="やり直す (⌘⇧Z)" disabled={!diagram.canRedo} onClick={diagram.redo} />

          <ToolbarDivider />

          <ToolbarButton icon="&#x2261;" title="自動レイアウト" disabled />

          <ToolbarDivider />

          <label className="flex items-center gap-1.5 px-1 text-xs text-slate-600 select-none cursor-pointer" title="コンテナ（VPC/Subnet等）のリサイズ時に内側のノードも連動して拡大縮小する">
            <input
              type="checkbox"
              checked={diagram.syncChildResize}
              onChange={(e) => diagram.setSyncChildResize(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            子ノード連動
          </label>
        </div>

        <div className="flex items-center gap-2">
          {/* サイドバー開閉ボタン */}
          <button
            className={`flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors ${
              sidebarOpen ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100'
            }`}
            title={sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}
            onClick={() => setSidebarOpen(prev => !prev)}
          >
            {/* サイドバーアイコン */}
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="2" width="14" height="12" rx="2" />
              <line x1="10" y1="2" x2="10" y2="14" />
            </svg>
          </button>

          <button
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100"
            onClick={diagram.reset}
          >
            閉じる
          </button>

          {/* エクスポートドロップダウン */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
              onClick={() => setShowExportMenu(prev => !prev)}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a.5.5 0 01.5.5v5.793l2.146-2.147a.5.5 0 01.708.708l-3 3a.5.5 0 01-.708 0l-3-3a.5.5 0 11.708-.708L7.5 7.293V1.5A.5.5 0 018 1zM2.5 10a.5.5 0 01.5.5v2.5h10v-2.5a.5.5 0 011 0v3a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-3a.5.5 0 01.5-.5z" />
              </svg>
              エクスポート &#x25BE;
            </button>

            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => handleExport('xlsx')}
                  >
                    <span className="text-green-600">&#x25A0;</span> Excel (.xlsx)
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => handleExport('pptx')}
                  >
                    <span className="text-orange-500">&#x25A0;</span> PowerPoint (.pptx)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* メインエリア */}
      <main className="flex flex-1 overflow-hidden">
        {/* SVG Canvas */}
        <div className="relative flex-1 overflow-hidden bg-slate-50">
          {diagram.state && (
            <DiagramCanvas
              state={diagram.state}
              selectedNodeId={diagram.selectedNodeId}
              onSelectNode={handleSelectNode}
              onMoveNode={diagram.updateNodePosition}
              onResizeNode={diagram.updateNodeSize}
              onCommitSnapshot={diagram.commitSnapshot}
              hiddenVpcIds={hiddenVpcIds}
            />
          )}
        </div>

        {/* サイドバー（表示/非表示切替可能） */}
        {sidebarOpen && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
            {/* タブヘッダー */}
            <div className="flex shrink-0 border-b border-slate-200">
              <button
                className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${
                  sidebarTab === 'vpc'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
                onClick={() => setSidebarTab('vpc')}
              >
                VPC フィルタ
              </button>
              <button
                className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${
                  sidebarTab === 'property'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
                onClick={() => setSidebarTab('property')}
              >
                プロパティ
              </button>
            </div>

            {/* タブコンテンツ */}
            <div className="flex-1 overflow-y-auto">
              {sidebarTab === 'vpc' ? (
                <VpcFilterPanel
                  vpcNodes={vpcNodes}
                  hiddenVpcIds={hiddenVpcIds}
                  onToggle={toggleVpcVisibility}
                />
              ) : diagram.selectedNode ? (
                <DetailPanel node={diagram.selectedNode} />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-xs text-slate-400">
                  リソースをクリックして詳細を表示
                </div>
              )}
            </div>
          </aside>
        )}
      </main>

      {/* ステータスバー */}
      <footer className="flex h-7 items-center justify-between border-t border-slate-200 bg-white px-4 text-xs text-slate-400">
        <span>Nodes: {nodeCount} | Edges: {edgeCount}</span>
        <span>Grid: ON | Snap: ON</span>
        <span>Zoom: 100% &middot; ローカル完結</span>
      </footer>
    </div>
  )
}

// ============================================================
// ツールバー部品
// ============================================================

function ToolbarButton({ icon, title, disabled, onClick }: { icon: string; title: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      className={`flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed text-slate-300'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px bg-slate-200" />
}

// ============================================================
// VPC フィルタパネル
// ============================================================

function VpcFilterPanel({
  vpcNodes,
  hiddenVpcIds,
  onToggle,
}: {
  vpcNodes: DiagramNode[]
  hiddenVpcIds: Set<string>
  onToggle: (vpcId: string) => void
}) {
  if (vpcNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-slate-400">
        VPC が見つかりません
      </div>
    )
  }

  return (
    <div className="p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        表示する VPC
      </p>
      <div className="space-y-2">
        {vpcNodes.map(vpc => {
          const isVisible = !hiddenVpcIds.has(vpc.id)
          const region = (vpc.metadata?.region as string) || ''
          const cidr = (vpc.metadata?.cidr as string) || ''
          return (
            <label
              key={vpc.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5 transition-colors hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={isVisible}
                onChange={() => onToggle(vpc.id)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <img src="/icons/vpc_icon.png" alt="" className="h-5 w-5 shrink-0" />
                  <span className="truncate text-sm font-medium text-slate-700">
                    {vpc.label}
                  </span>
                </div>
                <div className="mt-1 flex gap-2 text-[10px] text-slate-400">
                  {region && <span>{region}</span>}
                  {cidr && <span className="font-mono">{cidr}</span>}
                </div>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// 詳細パネル（P04 準拠 + AWS アイコン）
// ============================================================

function DetailPanel({ node }: { node: DiagramNode }) {
  const isAwsConfig = node.source === 'aws-config'
  const iconFile = ICON_FILES[node.type as NodeType]
  const meta = node.metadata as Record<string, unknown>

  return (
    <div className="p-4">
      {/* ヘッダー */}
      <div className="flex items-start gap-3">
        {/* AWS アイコン */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
          {iconFile ? (
            <img src={`/icons/${iconFile}`} alt={node.type} className="h-7 w-7" />
          ) : (
            <span className="text-xs font-bold text-orange-500">
              {node.type.toUpperCase().slice(0, 3)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-800">{node.label}</h2>
          <p className="text-xs text-slate-500">
            {(node.metadata?.awsResourceType as string) ?? node.type.toUpperCase()}
          </p>
        </div>
        {/* ソースバッジ */}
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            isAwsConfig
              ? 'border-green-300 bg-green-50 text-green-700'
              : 'border-blue-300 bg-blue-50 text-blue-700'
          }`}
        >
          {isAwsConfig ? 'AWS Config' : 'ユーザー追加'}
        </span>
      </div>

      {/* 基本情報セクション */}
      <DetailSection title="基本情報" defaultOpen>
        <DetailRow label="ID" value={String(meta.awsResourceId ?? node.id)} mono />
        <DetailRow label="Type" value={String(meta.awsResourceType ?? node.type)} />
        {meta.instanceType != null && (
          <DetailRow label="Instance Type" value={String(meta.instanceType)} />
        )}
        {meta.engine != null && (
          <DetailRow label="Engine" value={String(meta.engine)} />
        )}
        {meta.tier != null && (
          <DetailRow label="Tier" value={String(meta.tier)} />
        )}
      </DetailSection>

      {/* ネットワーク情報 */}
      {(meta.vpcId || meta.subnetId || meta.availabilityZone) ? (
        <DetailSection title="ネットワーク情報">
          {meta.vpcId != null && (
            <DetailRow label="VPC" value={String(meta.vpcId)} mono />
          )}
          {meta.subnetId != null && (
            <DetailRow label="Subnet" value={String(meta.subnetId)} mono />
          )}
          {meta.availabilityZone != null && (
            <DetailRow label="AZ" value={String(meta.availabilityZone)} />
          )}
          {meta.privateIpAddress != null && (
            <DetailRow label="Private IP" value={String(meta.privateIpAddress)} mono />
          )}
        </DetailSection>
      ) : null}

      {/* メタデータ */}
      {Object.keys(meta).length > 0 && (
        <DetailSection title="メタデータ">
          {Object.entries(meta)
            .filter(([k]) => !['awsResourceId', 'awsResourceType', 'vpcId', 'subnetId', 'availabilityZone', 'privateIpAddress', 'instanceType', 'engine', 'tier'].includes(k))
            .map(([key, value]) => (
              <DetailRow
                key={key}
                label={key}
                value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                mono
              />
            ))}
        </DetailSection>
      )}

      {/* 配置情報 */}
      <DetailSection title="配置">
        <DetailRow label="Position" value={`(${Math.round(node.position.x)}, ${Math.round(node.position.y)})`} mono />
        <DetailRow label="Size" value={`${Math.round(node.size.width)}\u00D7${Math.round(node.size.height)}`} mono />
        <DetailRow label="Modified" value={node.isUserModified ? 'はい' : 'いいえ'} />
      </DetailSection>
    </div>
  )
}

// ============================================================
// 詳細パネル部品
// ============================================================

function DetailSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <button
        className="flex w-full items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="text-[10px]">{open ? '\u25BC' : '\u25B6'}</span>
        {title}
      </button>
      {open && <dl className="mt-2 space-y-1.5">{children}</dl>}
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={`truncate text-right ${mono ? 'font-mono' : ''} text-slate-700`}>
        {value}
      </dd>
    </div>
  )
}

export default App
