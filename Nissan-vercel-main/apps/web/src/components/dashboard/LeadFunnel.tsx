import { Filter } from 'lucide-react'
import { Panel, PanelHeader } from '#/components/ui/kit'
import type { LeadConversionAnalytics } from '#/lib/queries'

// Horizontal funnel — one bar per board stage, width scaled to the largest
// stage. `lost` is shown apart (it's an exit, not a funnel step). Step-to-step
// drop-off % is annotated so you can see where leads leak.
export function LeadFunnel({ data }: { data: LeadConversionAnalytics }) {
  const steps = data.funnel.filter((s) => s.stage !== 'lost')
  const lost = data.funnel.find((s) => s.stage === 'lost')?.count ?? 0
  const max = Math.max(1, ...steps.map((s) => s.count))
  const empty = steps.every((s) => s.count === 0)

  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '120ms' }}>
      <PanelHeader
        title="Lead Conversion Funnel"
        kicker="Pipeline"
        action={<span className="text-[11px] text-muted-foreground">{lost} lost</span>}
      />
      <div className="p-5">
        {empty ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-center">
            <Filter className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-[13px] text-muted-foreground">No leads in this period.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {steps.map((s, i) => {
              const prev = i > 0 ? steps[i - 1]!.count : null
              const drop = prev && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : null
              const pct = Math.round((s.count / max) * 100)
              return (
                <li key={s.stage}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-foreground">{s.label}</span>
                    <span className="flex items-center gap-2">
                      {drop !== null && drop > 0 ? (
                        <span className="text-[11px] text-rose-500">−{drop}%</span>
                      ) : null}
                      <span className="num font-semibold text-foreground">{s.count}</span>
                    </span>
                  </div>
                  <div className="h-6 overflow-hidden rounded-md bg-muted">
                    <div
                      className="h-full rounded-md brand-bg transition-all"
                      style={{ width: `${Math.max(pct, s.count > 0 ? 6 : 0)}%`, opacity: 0.55 + (i / steps.length) * 0.45 }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}
