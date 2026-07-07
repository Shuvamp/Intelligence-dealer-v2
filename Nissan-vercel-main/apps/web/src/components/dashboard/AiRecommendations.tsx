import { Sparkles, AlertTriangle, ArrowUpRight, Zap } from 'lucide-react'
import { Panel } from '#/components/ui/kit'
import type { IntelRecommendation } from '#/lib/types'

const PRIORITY: Record<
  IntelRecommendation['priority'],
  { icon: typeof Zap; ring: string; chip: string; label: string }
> = {
  high: {
    icon: AlertTriangle,
    ring: 'text-rose-600 bg-rose-50',
    chip: 'text-rose-700',
    label: 'High priority',
  },
  medium: {
    icon: ArrowUpRight,
    ring: 'text-amber-600 bg-amber-50',
    chip: 'text-amber-700',
    label: 'Recommended',
  },
  low: {
    icon: Zap,
    ring: 'text-zinc-500 bg-zinc-100',
    chip: 'text-zinc-600',
    label: 'Watch',
  },
}

export function AiRecommendations({
  recommendations,
}: {
  recommendations: Array<IntelRecommendation>
}) {
  return (
    <Panel className="fade-up overflow-hidden" style={{ animationDelay: '160ms' }}>
      <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-[color-mix(in_oklab,var(--brand)_7%,transparent)] to-transparent px-5 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-[18px] w-[18px] brand-text" />
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
            AI Recommendations
          </h3>
        </div>
        <span className="kicker text-muted-foreground/60">Agent Registry</span>
      </div>

      {recommendations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--brand)_10%,transparent)]">
            <Sparkles className="h-4 w-4 brand-text" />
          </span>
          <p className="text-[13.5px] font-medium text-foreground">No recommendations yet</p>
          <p className="max-w-xs text-[12px] leading-relaxed text-muted-foreground">
            As leads and campaigns accumulate, the intelligence agents will surface
            prioritized actions here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {recommendations.map((rec) => {
            const meta = PRIORITY[rec.priority]
            const Icon = meta.icon
            return (
              <li
                key={rec.title}
                className="flex items-start gap-3.5 px-5 py-3.5 transition hover:bg-muted/40"
              >
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${meta.ring}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium leading-snug text-foreground">{rec.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{rec.detail}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className={`font-semibold ${meta.chip}`}>{meta.label}</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="text-muted-foreground">Intelligence Engine</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
