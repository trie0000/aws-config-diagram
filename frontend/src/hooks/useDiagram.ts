/**
 * useDiagram.ts: DiagramState 管理 hook
 *
 * ファイルアップロード → API → DiagramState の一連を管理する。
 * 元の File オブジェクトも保持（エクスポート時に再送するため）。
 *
 * Version: 1.0.0
 * Last Updated: 2026-02-13
 */

import { useCallback, useState } from 'react'
import type { DiagramState, DiagramNode } from '../types/diagram'
import { parseConfigFile, exportDiagram, type ExportFormat } from '../services/api'

export interface UseDiagramReturn {
  /** 現在の DiagramState（null = 未読み込み） */
  state: DiagramState | null

  /** 読み込み中フラグ */
  loading: boolean

  /** エラーメッセージ */
  error: string | null

  /** 元の JSON ファイル（エクスポート用） */
  file: File | null

  /** ファイルをアップロードして DiagramState を取得 */
  loadFile: (file: File) => Promise<void>

  /** ノード位置を更新（ドラッグ用） */
  updateNodePosition: (nodeId: string, x: number, y: number) => void

  /** 選択中ノード ID */
  selectedNodeId: string | null

  /** ノード選択 */
  selectNode: (nodeId: string | null) => void

  /** 選択中ノード */
  selectedNode: DiagramNode | null

  /** エクスポート */
  doExport: (format: ExportFormat) => Promise<void>

  /** 状態リセット（スタート画面に戻る） */
  reset: () => void
}

export function useDiagram(): UseDiagramReturn {
  const [state, setState] = useState<DiagramState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const loadFile = useCallback(async (f: File) => {
    setLoading(true)
    setError(null)
    try {
      const result = await parseConfigFile(f)
      setState(result)
      setFile(f)
      setSelectedNodeId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'パースに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const updateNodePosition = useCallback((nodeId: string, x: number, y: number) => {
    setState(prev => {
      if (!prev) return prev
      const node = prev.nodes[nodeId]
      if (!node) return prev
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            position: { x, y },
            isUserModified: true,
          },
        },
      }
    })
  }, [])

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
  }, [])

  const selectedNode = state && selectedNodeId ? state.nodes[selectedNodeId] ?? null : null

  const doExport = useCallback(async (format: ExportFormat) => {
    if (!file) return
    try {
      await exportDiagram(file, format)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エクスポートに失敗しました')
    }
  }, [file])

  const reset = useCallback(() => {
    setState(null)
    setFile(null)
    setSelectedNodeId(null)
    setError(null)
  }, [])

  return {
    state,
    loading,
    error,
    file,
    loadFile,
    updateNodePosition,
    selectedNodeId,
    selectNode,
    selectedNode,
    doExport,
    reset,
  }
}
