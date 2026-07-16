import { ArrowDownRight, Instagram, Facebook, Globe, MessageCircle, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import { Panel, PanelHeader } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import { SIGNAL_META, SeverityBadge } from './intelligence-ui'
import type {
  CampaignHealth, CampaignPerformance, ChannelAnalytic, DemandItem,
  FunnelStage, IntelRecommendation, LostLeadInsight, MarketSignal,
  PostChannel, SourceAnalytic, VelocityWeek,
} from '#/lib/types'
import {
  VelocityChart,
  SourceDonutChart,
  FunnelBarChart,
  DemandBarChart,
  RegionalBarChart,
  ChannelGroupedBar,
  HealthGaugeChart,
} from './charts'

// ─── Signals ─────────────────────────────────────────────────────────────────

export function SignalsPanel({ signals }: { signals: Array<MarketSignal> }) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '120ms' }}>
      <PanelHeader
        kicker="Live signals" title="Top Signals"
        action={<span className="num text-[12px] font-semibold text-muted-foreground">{signals.length} active</span>}
      />
      {signals.length === 0 ? (
        <EmptyRow label="No active signals right now." />
      ) : (
        <ul className="divide-y divide-border">
          {signals.map((s) => {
            const meta = SIGNAL_META[s.kind]
            const Icon = meta.icon
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
                  {s.detail ? <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.detail}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">{meta.label}</span>
                    {s.metric_label && s.metric_value ? (
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

// ─── Recommendations ─────────────────────────────────────────────────────────

const PRIORITY_PILL: Record<IntelRecommendation['priority'], string> = {
  high:   'bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] brand-text',
  medium: 'bg-amber-50 text-amber-700',
  low:    'bg-zinc-100 text-zinc-600',
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
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide', PRIORITY_PILL[r.priority])}>
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

// ─── Lead Source — Donut Chart ────────────────────────────────────────────────

export function SourcePanel({ sources }: { sources: Array<SourceAnalytic> }) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '240ms' }}>
      <PanelHeader kicker="Attribution" title="Lead Source Performance" />
      {sources.length === 0 ? (
        <EmptyRow label="No source data." />
      ) : (
        <div className="px-4 pb-3 pt-1">
          <SourceDonutChart sources={sources} />
          <div className="mt-2 divide-y divide-border rounded-lg border border-border">
            {sources.map((s) => (
              <div key={s.source} className="flex items-center justify-between px-3 py-2 text-[12px]">
                <span className="capitalize font-medium text-foreground">{s.source}</span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span className="num">{s.count} leads</span>
                  <span className={cn('num font-semibold',
                    s.conversionRate >= 20 ? 'text-emerald-600' : s.conversionRate >= 8 ? 'text-amber-600' : 'text-muted-foreground',
                  )}>{s.conversionRate}% won</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ─── Pipeline Funnel — Graduated Horizontal Bar ───────────────────────────────

export function FunnelPanel({ funnel }: { funnel: Array<FunnelStage> }) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '300ms' }}>
      <PanelHeader kicker="Pipeline" title="Funnel by Stage" />
      {funnel.every(s => s.count === 0) ? (
        <EmptyRow label="No pipeline data." />
      ) : (
        <div className="px-4 pb-4 pt-2">
          <FunnelBarChart funnel={funnel} />
        </div>
      )}
    </Panel>
  )
}

// ─── Demand — Vehicle (grouped vertical) or Regional (horizontal) ─────────────

export function DemandPanel({
  title, kicker, items, delay, variant = 'vehicle',
}: {
  title: string; kicker: string; items: Array<DemandItem>; delay: number; variant?: 'vehicle' | 'regional'
}) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: `${delay}ms` }}>
      <PanelHeader kicker={kicker} title={title} />
      {items.length === 0 ? (
        <EmptyRow label="No demand data." />
      ) : (
        <div className="px-4 pb-4 pt-2">
          {variant === 'vehicle' ? <DemandBarChart items={items} /> : <RegionalBarChart items={items} />}
        </div>
      )}
    </Panel>
  )
}

// ─── Campaign Performance table ───────────────────────────────────────────────

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
                    <span className={cn(
                      'num inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12px] font-semibold',
                      c.conversionRate >= 20 ? 'bg-emerald-50 text-emerald-700'
                        : c.conversionRate >= 8 ? 'bg-amber-50 text-amber-700'
                        : 'bg-muted text-muted-foreground',
                    )}>
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

// ─── Lead Velocity — Area Chart ───────────────────────────────────────────────

export function VelocityPanel({ weeks }: { weeks: Array<VelocityWeek> }) {
  const last = weeks[weeks.length - 1]
  const prev = weeks[weeks.length - 2]
  const delta = prev && prev.count > 0
    ? Math.round(((last.count - prev.count) / prev.count) * 100) : null
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '300ms' }}>
      <PanelHeader
        kicker="Lead trend" title="Lead Velocity"
        action={delta !== null ? (
          <span className={cn('inline-flex items-center gap-1 text-[12px] font-semibold', delta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
            {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {delta >= 0 ? '+' : ''}{delta}% WoW
          </span>
        ) : null}
      />
      {weeks.every(w => w.count === 0) ? (
        <EmptyRow label="No lead data in the last 6 weeks." />
      ) : (
        <div className="px-4 pb-4 pt-2">
          <VelocityChart weeks={weeks} />
        </div>
      )}
    </Panel>
  )
}

// ─── Lost Lead Patterns ───────────────────────────────────────────────────────

export function LostLeadPanel({ insight }: { insight: LostLeadInsight }) {
  function fmtINR(n: number) {
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
    return `₹${n.toLocaleString('en-IN')}`
  }
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '360ms' }}>
      <PanelHeader kicker="Deal loss analysis" title="Lost Lead Patterns" />
      {insight.count === 0 ? (
        <EmptyRow label="No lost deals recorded yet." />
      ) : (
        <div className="divide-y divide-border">
          <div className="grid grid-cols-2 gap-px px-5 py-4">
            <Stat label="Lost deals" value={String(insight.count)} />
            <Stat label="Avg budget" value={fmtINR(insight.avgBudget)} />
          </div>
          <div className="grid grid-cols-2 gap-px px-5 py-4">
            <Stat label="Top vehicle lost" value={insight.topVehicle} sub="most lost model" />
            <Stat label="Top source lost"  value={insight.topSource}  sub="most drop-off" />
          </div>
          {/* Loss concentration gradient bar */}
          <div className="px-5 py-4">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">Loss concentration</p>
            <div className="flex items-center gap-3">
              <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, insight.count * 5)}%`,
                    background: 'linear-gradient(90deg, #C3002F 0%, #8B0021 100%)',
                  }}
                />
              </div>
              <span className="num shrink-0 text-[12px] font-semibold text-foreground">{insight.count}</span>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="py-1">
      <div className="text-[11.5px] font-semibold text-muted-foreground/80">{label}</div>
      <div className="num mt-1 text-[20px] font-bold leading-none text-foreground">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

// ─── Channel Effectiveness — Grouped Bar ──────────────────────────────────────

const CHANNEL_META: Record<PostChannel, { label: string; Icon: LucideIcon }> = {
  instagram:       { label: 'Instagram',       Icon: Instagram },
  facebook:        { label: 'Facebook',        Icon: Facebook },
  google_business: { label: 'Google Business', Icon: Globe },
  whatsapp:        { label: 'WhatsApp',        Icon: MessageCircle },
}

export function ChannelPanel({ channels }: { channels: Array<ChannelAnalytic> }) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '420ms' }}>
      <PanelHeader kicker="Campaign channels" title="Channel Effectiveness" />
      {channels.length === 0 ? (
        <EmptyRow label="No campaign posts yet." />
      ) : (
        <div className="px-4 pb-4 pt-2">
          <ChannelGroupedBar channels={channels} />
          <div className="mt-3 flex justify-around border-t border-border pt-3">
            {channels.map(c => {
              const meta = CHANNEL_META[c.channel]
              return (
                <div key={c.channel} className="flex flex-col items-center gap-1">
                  <meta.Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="num text-[11px] text-muted-foreground">{c.postCount}p</span>
                  {c.flaggedCompliance > 0 && (
                    <span className="text-[10px] text-rose-500">{c.flaggedCompliance}⚑</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ─── Campaign Health — Radial Gauge ───────────────────────────────────────────

export function CampaignHealthPanel({ health }: { health: CampaignHealth }) {
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '480ms' }}>
      <PanelHeader kicker="Content pipeline" title="Campaign Health" />
      <div className="divide-y divide-border">
        <div className="px-4 pb-2 pt-3">
          <HealthGaugeChart health={health} />
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-3.5">
          <Chip label="Active campaigns" value={health.activeCampaigns}
            cls="bg-[color-mix(in_oklab,var(--brand)_10%,transparent)] brand-text" />
          <Chip label="Pending approval" value={health.pendingApproval}
            cls={health.pendingApproval > 0 ? 'bg-amber-50 text-amber-700' : 'bg-muted text-muted-foreground'} />
          <Chip label="Drafts" value={health.draft} cls="bg-muted text-muted-foreground" />
          {health.rejected > 0 && <Chip label="Rejected" value={health.rejected} cls="bg-rose-50 text-rose-700" />}
        </div>
      </div>
    </Panel>
  )
}

function Chip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold', cls)}>
      <span className="num">{value}</span>
      <span className="font-medium opacity-80">{label}</span>
    </span>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

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
