/**
 * EditorScreen.tsx: メインエディタ画面（P02 準拠）
 *
 * ツールバー + SVG Canvas + サイドバー（VPCフィルタ/プロパティ）+ ステータスバー。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { useDiagram } from '../hooks/useDiagram'
import type { ExportFormat } from '../services/api'
import { DiagramCanvas } from './canvas/DiagramCanvas'
import { VpcFilterPanel } from './panels/VpcFilterPanel'
import { DetailPanel } from './panels/DetailPanel'

type SidebarTab = 'vpc' | 'property'

export function EditorScreen({ diagram }: { diagram: ReturnType<typeof useDiagram> }) {
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
