/**
 * StartScreen.tsx: スタート画面（P01 準拠）
 *
 * JSONファイルのドロップ/選択 → パース → エディタ画面遷移。
 * ステップ説明カードを表示。
 */

import { useCallback, useRef } from 'react'
import type { useDiagram } from '../hooks/useDiagram'

export function StartScreen({ diagram }: { diagram: ReturnType<typeof useDiagram> }) {
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
