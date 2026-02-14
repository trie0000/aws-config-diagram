/**
 * DetailPanel.tsx: プロパティ詳細サイドバーパネル（P04 準拠）
 *
 * 選択ノードの AWS アイコン + 基本情報 + ネットワーク情報 +
 * メタデータ + 配置情報をアコーディオン形式で表示。
 */

import { useState } from 'react'
import type { DiagramNode, NodeType } from '../../types/diagram'
import { ICON_FILES } from '../../constants/icons'

export function DetailPanel({ node }: { node: DiagramNode }) {
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
