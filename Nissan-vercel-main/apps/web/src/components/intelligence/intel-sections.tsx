import { ArrowDownRight } from 'lucide-react'
import { Panel, PanelHeader } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import { SIGNAL_META, SeverityBadge, MiniBar } from './intelligence-ui'
import { LEAD_STAGE_LABEL } from '#/lib/types'
import type {
  CampaignPerformance, DemandItem, FunnelStage, IntelRecommendation,
  MarketSignal, SourceAnalytic,
} from '#/lib/types'

/** ---- Top Signals (hero) ---- */
export function SignalsPanel({ signals }: { signals: Array<MarketSignal> }) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '120ms' }}>
      <PanelHeader
        kicker="Live signals"
        title="Top Signals"
        action={
          <span className="num text-[12px] font-semibold text-muted-foreground">
            {signals.length} active
          </span>
        }
      />
      {signals.length === 0 ? (
        <EmptyRow label="No active signals right now." />
      ) : (
        <ul className="divide-y divide-border">
          {signals.map((s) => {
            const meta = SIGNAL_META[s.kind]
            const Icon = meta.icon
            const hasMetric = s.metric_label && s.metric_value
            return (
              <li key={s.id} className="flex items-start gap-3.5 px-5 py-4">
                <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg', meta.cls)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13.5px] font-semibold leading-snug text-foreground">{s.title}</p>
                    <SeverityBadge severity={s.severity} />
                  </div>
                  {s.detail ? (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.detail}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                      {meta.label}
                    </span>
                    {hasMetric ? (
                      <span className="num inline-flex items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--brand)_10%,transparent)] px-2 py-0.5 text-[11px] font-semibold brand-text">
                        {s.metric_label}: {s.metric_value}
                      </span>
                    ) : null}
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

/** ---- Top Recommendations ---- */
const PRIORITY_PILL: Record<IntelRecommendation['priority'], string> = {
  high: 'bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] brand-text',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-zinc-100 text-zinc-600',
}

export function RecommendationsPanel({ recommendations }: { recommendations: Array<IntelRecommendation> }) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '180ms' }}>
      <PanelHeader kicker="Next best actions" title="Top Recommendations" />
      {recommendations.length === 0 ? (
        <EmptyRow label="No recommendations yet — gather more lead data." />
      ) : (
        <ul className="divide-y divide-border">
          {recommendations.map((r, i) => (
            <li key={i} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13.5px] font-semibold leading-snug text-foreground">{r.title}</p>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide',
                    PRIORITY_PILL[r.priority],
                  )}
                >
                  {r.priority}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{r.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** ---- Lead Source Performance ---- */
export function SourcePanel({ sources }: { sources: Array<SourceAnalytic> }) {
  const max = sources.reduce((m, s) => Math.max(m, s.count), 0)
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '240ms' }}>
      <PanelHeader kicker="Attribution" title="Lead Source Performance" />
      <div className="px-5 py-3">
        {sources.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">No source data.</p>
        ) : (
          sources.map((s) => (
            <MiniBar
              key={s.source}
              label={s.source}
              value={s.count}
              max={max}
              hint={`${s.count} · ${s.conversionRate}% won`}
            />
          ))
        )}
      </div>
    </Panel>
  )
}

/** ---- Pipeline Funnel ---- */
export function FunnelPanel({ funnel }: { funnel: Array<FunnelStage> }) {
  const max = funnel.reduce((m, s) => Math.max(m, s.count), 0)
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '300ms' }}>
      <PanelHeader kicker="Pipeline" title="Funnel by Stage" />
      <div className="space-y-2.5 px-5 py-4">
        {funnel.map((s) => {
          const pct = max ? Math.round((s.count / max) * 100) : 0
          return (
            <div key={s.stage} className="flex items-center gap-3">
              <span className="w-[88px] shrink-0 text-[12px] font-medium text-muted-foreground">
                {LEAD_STAGE_LABEL[s.stage]}
              </span>
              <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                <div
                  className="flex h-full items-center justify-end rounded-md brand-bg px-2 transition-all"
                  style={{ width: `${Math.max(s.count ? 8 : 0, pct)}%` }}
                >
                  {s.count > 0 && pct >= 22 ? (
                    <span className="num text-[11px] font-bold text-white">{s.count}</span>
                  ) : null}
                </div>
              </div>
              {!(s.count > 0 && pct >= 22) ? (
                <span className="num w-6 shrink-0 text-right text-[12px] font-semibold text-foreground">
                  {s.count}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** ---- Demand (vehicle / regional) ---- */
export function DemandPanel({
  title, kicker, items, delay,
}: { title: string; kicker: string; items: Array<DemandItem>; delay: number }) {
  const max = items.reduce((m, d) => Math.max(m, d.count), 0)
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: `${delay}ms` }}>
      <PanelHeader kicker={kicker} title={title} />
      <div className="px-5 py-3">
        {items.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">No demand data.</p>
        ) : (
          items.slice(0, 8).map((d) => (
            <MiniBar key={d.label} label={d.label} value={d.count} max={max} hint={`${d.hot} hot`} />
          ))
        )}
      </div>
    </Panel>
  )
}

/** ---- Campaign Performance table ---- */
export function CampaignPanel({ campaigns }: { campaigns: Array<CampaignPerformance> }) {
  return (
    <Panel className="fade-up overflow-hidden" style={{ animationDelay: '420ms' }}>
      <PanelHeader kicker="Marketing ROI" title="Campaign Performance" />
      {campaigns.length === 0 ? (
        <EmptyRow label="No campaign insights captured yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                <th className="px-5 py-2.5 font-semibold">Campaign</th>
                <th className="px-3 py-2.5 text-right font-semibold">Reach</th>
                <th className="px-3 py-2.5 text-right font-semibold">Engagement</th>
                <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                <th className="px-3 py-2.5 text-right font-semibold">CPL</th>
                <th className="px-5 py-2.5 text-right font-semibold">Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((c) => (
                <tr key={c.campaign_id} className="text-[12.5px] transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="num px-3 py-3 text-right text-muted-foreground">{fmtCompact(c.reach)}</td>
                  <td className="num px-3 py-3 text-right text-muted-foreground">{fmtCompact(c.engagement)}</td>
                  <td className="num px-3 py-3 text-right font-semibold text-foreground">{c.leads}</td>
                  <td className="num px-3 py-3 text-right text-muted-foreground">{c.roiLabel}</td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={cn(
                        'num inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12px] font-semibold',
                        c.conversionRate >= 20
                          ? 'bg-emerald-50 text-emerald-700'
                          : c.conversionRate >= 8
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {c.conversionRate < 8 ? <ArrowDownRight className="h-3 w-3" /> : null}
                      {c.conversionRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="grid place-items-center px-5 py-12 text-center text-[12.5px] text-muted-foreground/80">
      {label}
    </div>
  )
}

function fmtCompact(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}
