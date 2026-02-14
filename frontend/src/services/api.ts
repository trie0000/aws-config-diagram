/**
 * api.ts: FastAPI バックエンド通信クライアント
 *
 * localhost:8000 の FastAPI と通信する。
 * 外部サーバーへのデータ送信は一切行わない。
 *
 * Version: 1.0.0
 * Last Updated: 2026-02-13
 */

import type { DiagramState } from '../types/diagram'

/** API ベース URL（Vite プロキシ経由: 空文字 = 同一オリジン → /api → localhost:8000） */
const API_BASE = import.meta.env.VITE_API_BASE ?? ''

/** API レスポンスエラー */
export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(`API Error ${status}: ${detail}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

// ============================================================
// ヘルスチェック
// ============================================================

export interface HealthResponse {
  status: string
  version: string
}

/** サーバーの死活確認 */
export async function healthCheck(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`)
  if (!res.ok) {
    throw new ApiError(res.status, 'Health check failed')
  }
  return res.json()
}

// ============================================================
// Config JSON パース → DiagramState
// ============================================================

/**
 * Config JSON ファイルを送信し、レイアウト計算済み DiagramState を取得する。
 *
 * @param file - AWS Config JSON ファイル
 * @returns レイアウト計算済み DiagramState
 */
export async function parseConfigFile(file: File): Promise<DiagramState> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/api/parse`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, body.detail ?? 'Parse failed')
  }

  return res.json()
}

// ============================================================
// エクスポート（ファイルダウンロード）
// ============================================================

export type ExportFormat = 'xlsx' | 'pptx'

/**
 * Config JSON → Excel/PPTX ファイルをダウンロードする。
 *
 * ブラウザのダウンロードダイアログを表示する。
 *
 * @param file   - 元の Config JSON ファイル
 * @param format - 出力形式 ('xlsx' | 'pptx')
 */
export async function exportDiagram(
  file: File,
  format: ExportFormat,
): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/api/export/${format}`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, body.detail ?? 'Export failed')
  }

  // レスポンスを Blob に変換してダウンロード
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)

  // Content-Disposition からファイル名を取得（なければデフォルト）
  const disposition = res.headers.get('Content-Disposition')
  let filename = `diagram.${format}`
  if (disposition) {
    const match = disposition.match(/filename="?([^";\n]+)"?/)
    if (match) {
      filename = match[1]
    }
  }

  // <a> タグでダウンロード
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
