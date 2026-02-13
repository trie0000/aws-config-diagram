/**
 * App.tsx: AWS Config Diagram Generator - メインアプリケーション
 *
 * モックアップ v3 (Light) に準拠した2画面構成:
 * - P01: スタート画面（アップロード + ステップ説明）
 * - P02: メインエディタ（ツールバー + Canvas + 詳細パネル + ステータスバー）
 *
 * Version: 2.0.0
 * Last Updated: 2026-02-13
 */

import { useCallback, useRef, useState } from 'react'
import { useDiagram } from './hooks/useDiagram'
import { DiagramCanvas } from './components/canvas/DiagramCanvas'
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
            {/* 青い「+」円アイコン（モックアップ P01 準拠） */}
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-blue-500 text-3xl font-light text-blue-500">
              +
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
            {/* ネットワークアイコン（SVG） */}
            <svg className="mb-5 h-14 w-14 text-slate-400" fill="none" viewBox="0 0 56 56" stroke="currentColor" strokeWidth={1.2}>
              <circle cx="28" cy="16" r="8" />
              <circle cx="14" cy="40" r="8" />
              <circle cx="42" cy="40" r="8" />
              <line x1="23" y1="23" x2="17" y2="33" />
              <line x1="33" y1="23" x2="39" y2="33" />
              <line x1="22" y1="40" x2="34" y2="40" />
            </svg>
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

          {/* ステップ説明カード（P01 準拠） */}
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-4">
            <StepCard
              step={1}
              title="JSONをアップロード"
              description="AWS ConfigのJSONをドロップ"
            />
            <StepCard
              step={2}
              title="構成図を自動生成"
              description="VPC / SG / 接続を解析"
            />
            <StepCard
              step={3}
              title="Excel/PPTXでエクスポート"
              description="ドキュメントとして出力"
            />
          </div>
        </div>
      </div>

      {/* フッター */}
      <footer className="py-4 text-center text-xs text-slate-400">
        &copy; 2026 AWS Config Diagram Generator &nbsp;|&nbsp; ローカル完結 &nbsp;|&nbsp; データ外部送信なし
      </footer>
    </div>
  )
}

/** ステップ説明カード */
function StepCard({ step, title, description }: { step: number; title: string; description: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base text-blue-500">
          {step === 1 ? '\u{1F4C4}' : step === 2 ? '\u{1F4BB}' : '\u{1F4E5}'}
        </span>
        <span className="text-sm font-semibold text-slate-700">
          Step {step}: {title}
        </span>
      </div>
      <p className="text-xs text-slate-500">{description}</p>
    </div>
  )
}

// ============================================================
// エディタ画面（P02 準拠）
// ============================================================

function EditorScreen({ diagram }: { diagram: ReturnType<typeof useDiagram> }) {
  const nodeCount = diagram.state ? Object.keys(diagram.state.nodes).length : 0
  const edgeCount = diagram.state ? Object.keys(diagram.state.edges).length : 0
  const [showExportMenu, setShowExportMenu] = useState(false)

  const handleExport = useCallback(
    (format: ExportFormat) => {
      diagram.doExport(format)
      setShowExportMenu(false)
    },
    [diagram],
  )

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      {/* ツールバー（P02 準拠） */}
      <header className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-3">
        {/* 左: ロゴ + ツールボタン群 */}
        <div className="flex items-center gap-1">
          {/* ロゴ「+」ボタン */}
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white transition-colors hover:bg-blue-700"
            title="新規ファイル"
            onClick={diagram.reset}
          >
            +
          </button>

          <ToolbarDivider />

          {/* ファイルメニュー */}
          <span className="px-2 text-xs font-medium text-slate-600">
            {diagram.state?.meta.title ?? 'AWS Config Diagram'}
          </span>

          <ToolbarDivider />

          {/* Undo / Redo（将来実装、UI だけ配置） */}
          <ToolbarButton icon="&#x2190;" title="元に戻す" disabled />
          <ToolbarButton icon="&#x2192;" title="やり直す" disabled />

          <ToolbarDivider />

          {/* レイアウトツール（将来実装） */}
          <ToolbarButton icon="&#x2261;" title="自動レイアウト" disabled />
        </div>

        {/* 右: エクスポート + 閉じる */}
        <div className="flex items-center gap-2">
          {/* 閉じるボタン */}
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
                {/* overlay to close */}
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
              onSelectNode={diagram.selectNode}
              onMoveNode={diagram.updateNodePosition}
            />
          )}
        </div>

        {/* 右パネル: リソース詳細（P02/P04 準拠） */}
        {diagram.selectedNode && (
          <aside className="w-80 overflow-y-auto border-l border-slate-200 bg-white">
            <DetailPanel node={diagram.selectedNode} />
          </aside>
        )}
      </main>

      {/* ステータスバー（P02 準拠） */}
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

function ToolbarButton({ icon, title, disabled }: { icon: string; title: string; disabled?: boolean }) {
  return (
    <button
      className={`flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed text-slate-300'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
      title={title}
      disabled={disabled}
    >
      {icon}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px bg-slate-200" />
}

// ============================================================
// 詳細パネル（P04 準拠）
// ============================================================

function DetailPanel({ node }: { node: ReturnType<typeof useDiagram>['selectedNode'] }) {
  if (!node) return null

  const isAwsConfig = node.source === 'aws-config'

  return (
    <div className="p-4">
      {/* ヘッダー */}
      <div className="flex items-start gap-3">
        {/* アイコン */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-orange-500 bg-white text-xs font-bold text-orange-500">
          {node.type.toUpperCase().slice(0, 3)}
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
        <DetailRow label="ID" value={(node.metadata?.awsResourceId as string) ?? node.id} mono />
        <DetailRow label="Type" value={(node.metadata?.awsResourceType as string) ?? node.type} />
        {node.metadata?.instanceType && (
          <DetailRow label="Instance Type" value={node.metadata.instanceType as string} />
        )}
        {node.metadata?.engine && (
          <DetailRow label="Engine" value={node.metadata.engine as string} />
        )}
        {node.metadata?.tier && (
          <DetailRow label="Tier" value={node.metadata.tier as string} />
        )}
      </DetailSection>

      {/* ネットワーク情報 */}
      {(node.metadata?.vpcId || node.metadata?.subnetId || node.metadata?.availabilityZone) && (
        <DetailSection title="ネットワーク情報">
          {node.metadata?.vpcId && (
            <DetailRow label="VPC" value={node.metadata.vpcId as string} mono />
          )}
          {node.metadata?.subnetId && (
            <DetailRow label="Subnet" value={node.metadata.subnetId as string} mono />
          )}
          {node.metadata?.availabilityZone && (
            <DetailRow label="AZ" value={node.metadata.availabilityZone as string} />
          )}
          {node.metadata?.privateIpAddress && (
            <DetailRow label="Private IP" value={node.metadata.privateIpAddress as string} mono />
          )}
        </DetailSection>
      )}

      {/* メタデータ（全フィールド） */}
      {Object.keys(node.metadata).length > 0 && (
        <DetailSection title="メタデータ">
          {Object.entries(node.metadata)
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

/** 折りたたみセクション */
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

/** キー・バリュー行 */
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
