/**
 * useDiagram.ts: DiagramState 管理 hook
 *
 * ファイルアップロード → API → DiagramState の一連を管理する。
 * 元の File オブジェクトも保持（エクスポート時に再送するため）。
 * Undo/Redo 対応（履歴スタック方式）。
 *
 * Version: 2.0.0
 * Last Updated: 2026-02-13
 */

import { useCallback, useRef, useState } from 'react'
import type { DiagramState, DiagramNode } from '../types/diagram'
import { parseConfigFile, exportDiagram, type ExportFormat } from '../services/api'

/** コンテナ型ノード（子ノードを持ちうる） */
const CONTAINER_TYPES = new Set(['aws-cloud', 'vpc', 'az', 'subnet'])

/** Undo/Redo 履歴の最大保持数 */
const MAX_HISTORY = 50

/** nodeId の全子孫ノード ID を再帰的に収集する */
function getDescendantIds(nodes: Record<string, DiagramNode>, parentId: string): string[] {
  const result: string[] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId === parentId) {
      result.push(node.id)
      result.push(...getDescendantIds(nodes, node.id))
    }
  }
  return result
}

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

  /** ノード位置を更新（ドラッグ用 — コンテナ移動時は子も連動） */
  updateNodePosition: (nodeId: string, x: number, y: number) => void

  /** ノードサイズを更新（リサイズ用 — syncChildResize 有効時はコンテナ子ノードも比例縮小） */
  updateNodeSize: (nodeId: string, width: number, height: number) => void

  /** ドラッグ/リサイズ開始時にスナップショットを保存 */
  commitSnapshot: () => void

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

  /** Undo */
  undo: () => void

  /** Redo */
  redo: () => void

  /** Undo 可能か */
  canUndo: boolean

  /** Redo 可能か */
  canRedo: boolean

  /** コンテナリサイズ時に子ノードを連動させるか */
  syncChildResize: boolean

  /** syncChildResize の切替 */
  setSyncChildResize: (value: boolean) => void
}

export function useDiagram(): UseDiagramReturn {
  const [state, setState] = useState<DiagramState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [syncChildResize, setSyncChildResize] = useState(true)

  // Undo/Redo 履歴
  const undoStack = useRef<DiagramState[]>([])
  const redoStack = useRef<DiagramState[]>([])
  // 強制再レンダリング用
  const [, forceRender] = useState(0)

  /** 現在の state のスナップショットを Undo 履歴に保存 */
  const commitSnapshot = useCallback(() => {
    setState(prev => {
      if (prev) {
        undoStack.current = [...undoStack.current.slice(-(MAX_HISTORY - 1)), prev]
        redoStack.current = []
        forceRender(n => n + 1)
      }
      return prev
    })
  }, [])

  const undo = useCallback(() => {
    const stack = undoStack.current
    if (stack.length === 0) return
    setState(prev => {
      if (prev) {
        redoStack.current = [...redoStack.current, prev]
      }
      const restored = stack[stack.length - 1]
      undoStack.current = stack.slice(0, -1)
      forceRender(n => n + 1)
      return restored
    })
  }, [])

  const redo = useCallback(() => {
    const stack = redoStack.current
    if (stack.length === 0) return
    setState(prev => {
      if (prev) {
        undoStack.current = [...undoStack.current, prev]
      }
      const restored = stack[stack.length - 1]
      redoStack.current = stack.slice(0, -1)
      forceRender(n => n + 1)
      return restored
    })
  }, [])

  const loadFile = useCallback(async (f: File) => {
    setLoading(true)
    setError(null)
    try {
      const result = await parseConfigFile(f)
      setState(result)
      setFile(f)
      setSelectedNodeId(null)
      undoStack.current = []
      redoStack.current = []
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

      const dx = x - node.position.x
      const dy = y - node.position.y

      const updatedNodes = { ...prev.nodes }
      updatedNodes[nodeId] = {
        ...node,
        position: { x, y },
        isUserModified: true,
      }

      if (CONTAINER_TYPES.has(node.type)) {
        const descendantIds = getDescendantIds(prev.nodes, nodeId)
        for (const childId of descendantIds) {
          const child = prev.nodes[childId]
          if (child) {
            updatedNodes[childId] = {
              ...child,
              position: {
                x: child.position.x + dx,
                y: child.position.y + dy,
              },
              isUserModified: true,
            }
          }
        }
      }

      return { ...prev, nodes: updatedNodes }
    })
  }, [])

  const syncChildResizeRef = useRef(syncChildResize)
  syncChildResizeRef.current = syncChildResize

  const updateNodeSize = useCallback((nodeId: string, width: number, height: number) => {
    setState(prev => {
      if (!prev) return prev
      const node = prev.nodes[nodeId]
      if (!node) return prev

      const newW = Math.max(80, width)
      const newH = Math.max(40, height)
      const oldW = node.size.width
      const oldH = node.size.height

      // コンテナの場合: syncChildResize が有効なら子孫ノードの位置・サイズを比例スケーリング
      if (syncChildResizeRef.current && CONTAINER_TYPES.has(node.type) && oldW > 0 && oldH > 0) {
        const scaleX = newW / oldW
        const scaleY = newH / oldH
        const originX = node.position.x
        const originY = node.position.y

        const updatedNodes = { ...prev.nodes }
        updatedNodes[nodeId] = {
          ...node,
          size: { width: newW, height: newH },
          isUserModified: true,
        }

        const descendantIds = getDescendantIds(prev.nodes, nodeId)
        for (const childId of descendantIds) {
          const child = prev.nodes[childId]
          if (child) {
            const relX = child.position.x - originX
            const relY = child.position.y - originY
            updatedNodes[childId] = {
              ...child,
              position: {
                x: originX + relX * scaleX,
                y: originY + relY * scaleY,
              },
              size: {
                width: child.size.width * scaleX,
                height: child.size.height * scaleY,
              },
              isUserModified: true,
            }
          }
        }

        return { ...prev, nodes: updatedNodes }
      }

      // 非コンテナ: サイズのみ更新
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            size: { width: newW, height: newH },
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
    undoStack.current = []
    redoStack.current = []
  }, [])

  return {
    state,
    loading,
    error,
    file,
    loadFile,
    updateNodePosition,
    updateNodeSize,
    commitSnapshot,
    selectedNodeId,
    selectNode,
    selectedNode,
    doExport,
    reset,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    syncChildResize,
    setSyncChildResize,
  }
}
