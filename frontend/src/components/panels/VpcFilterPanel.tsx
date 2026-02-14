/**
 * VpcFilterPanel.tsx: VPC フィルタサイドバーパネル
 *
 * チェックボックスで VPC 単位の表示/非表示を切り替える。
 */

import type { DiagramNode } from '../../types/diagram'

export function VpcFilterPanel({
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
