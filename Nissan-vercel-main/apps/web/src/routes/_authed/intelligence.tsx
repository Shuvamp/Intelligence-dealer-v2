import React, { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CheckCheck, Eye, X } from 'lucide-react'
import {
  getIntelligenceOverview, getSignals, getTopRecommendations, getLeadSourceAnalytics,
  getPipelineFunnel, getVehicleDemand, getRegionalDemand, getCampaignPerformance,
  getChannelAnalytics, getCampaignHealth, getLeadVelocity, getLostLeadInsights,
  updateSignalStatus,
} from '#/lib/intelligence'
import { cn } from '#/lib/utils'
import { StatTile, SIGNAL_META, SeverityBadge } from '#/components/intelligence/intelligence-ui'
import {
  SignalsPanel, RecommendationsPanel, SourcePanel, FunnelPanel, DemandPanel, CampaignPanel,
  VelocityPanel, LostLeadPanel, ChannelPanel, CampaignHealthPanel,
} from '#/components/intelligence/intel-sections'
import { Panel, PanelHeader } from '#/components/ui/kit'
import type { MarketSignal, SignalKind, SignalStatus } from '#/lib/types'

export const Route = createFileRoute('/_authed/intelligence')({
  loader: async () => {
    const [
      overview, signals, recommendations, sources, funnel, vehicles, regions, campaigns,
      channelAnalytics, campaignHealth, velocity, lostLeads,
    ] = await Promise.all([
      getIntelligenceOverview(), getSignals(), getTopRecommendations(), getLeadSourceAnalytics(),
      getPipelineFunnel(), getVehicleDemand(), getRegionalDemand(), getCampaignPerformance(),
      getChannelAnalytics(), getCampaignHealth(), getLeadVelocity(), getLostLeadInsights(),
    ])
    return { overview, signals, recommendations, sources, funnel, vehicles, regions, campaigns, channelAnalytics, campaignHealth, velocity, lostLeads }
  },
  component: IntelligencePage,
})

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TabId = 'overview' | 'leads' | 'campaigns' | 'signals'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview',   label: 'Overview' },
  { id: 'leads',      label: 'Lead Intelligence' },
  { id: 'campaigns',  label: 'Campaign Analytics' },
  { id: 'signals',    label: 'Signals' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  return `₹${n.toLocaleString('en-IN')}`
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({
  active, onChange, signalCount,
}: { active: TabId; onChange: (t: TabId) => void; signalCount: number }) {
  return (
    <div className="flex items-end gap-0.5 border-b border-border">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-semibold transition-colors',
            active === tab.id
              ? 'text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-t after:bg-[var(--brand)] after:content-[""]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
          {tab.id === 'signals' && signalCount > 0 && (
            <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand)_15%,transparent)] px-1.5 text-[10.5px] font-bold brand-text">
              {signalCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── Signals tab — full feed with kind filter + action buttons ────────────────

const KIND_FILTERS: Array<{ id: SignalKind | 'all'; label: string }> = [
  { id: 'all',         label: 'All' },
  { id: 'demand',      label: 'Demand' },
  { id: 'intent',      label: 'Intent' },
  { id: 'opportunity', label: 'Opportunity' },
  { id: 'trend',       label: 'Trend' },
  { id: 'risk',        label: 'Risk' },
]

function SignalsTabContent({ signals }: { signals: Array<MarketSignal> }) {
  const router = useRouter()
  const [kindFilter, setKindFilter] = useState<SignalKind | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const filtered = kindFilter === 'all' ? signals : signals.filter((s) => s.kind === kindFilter)

  async function act(id: string, status: SignalStatus) {
    setBusy(id)
    await updateSignalStatus({ data: { id, status } })
    await router.invalidate()
    setBusy(null)
  }

  return (
    <Panel>
      <PanelHeader
        kicker="Live feed"
        title="All Signals"
        action={
          <span className="num text-[12px] font-semibold text-muted-foreground">
            {signals.length} active
          </span>
        }
      />

      {/* Kind filter chips */}
      <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
        {KIND_FILTERS.map((f) => {
          const count = f.id === 'all' ? signals.length : signals.filter((s) => s.kind === f.id).length
          return (
            <button
              key={f.id}
              onClick={() => setKindFilter(f.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12px] font-semibold transition-colors',
                kindFilter === f.id
                  ? 'brand-bg text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              {f.label}
              <span className={cn('num rounded-full px-1.5 text-[10px] font-bold', kindFilter === f.id ? 'bg-white/20 text-white' : 'bg-background text-muted-foreground')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="grid place-items-center py-16 text-[13px] text-muted-foreground">
          No {kindFilter === 'all' ? '' : kindFilter} signals right now.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((s) => {
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
                  {s.detail && (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.detail}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                      {meta.label}
                    </span>
                    {s.metric_label && s.metric_value && (
                      <span className="num inline-flex items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--brand)_10%,transparent)] px-2 py-0.5 text-[11px] font-semibold brand-text">
                        {s.metric_label}: {s.metric_value}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="ml-2 flex shrink-0 items-center gap-1">
                  {s.status === 'open' && (
                    <ActionBtn
                      label="Watch"
                      icon={<Eye className="h-3.5 w-3.5" />}
                      disabled={busy === s.id}
                      onClick={() => act(s.id, 'watching')}
                      cls="text-sky-600 hover:bg-sky-50"
                    />
                  )}
                  {s.status !== 'actioned' && (
                    <ActionBtn
                      label="Done"
                      icon={<CheckCheck className="h-3.5 w-3.5" />}
                      disabled={busy === s.id}
                      onClick={() => act(s.id, 'actioned')}
                      cls="text-emerald-600 hover:bg-emerald-50"
                    />
                  )}
                  <ActionBtn
                    label="Dismiss"
                    icon={<X className="h-3.5 w-3.5" />}
                    disabled={busy === s.id}
                    onClick={() => act(s.id, 'dismissed')}
                    cls="text-muted-foreground hover:bg-muted"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function ActionBtn({
  label, icon, onClick, disabled, cls,
}: { label: string; icon: React.ReactElement; onClick: () => void; disabled: boolean; cls: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40',
        cls,
      )}
    >
      {icon}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function IntelligencePage() {
  const {
    overview, signals, recommendations, sources, funnel, vehicles, regions, campaigns,
    channelAnalytics, campaignHealth, velocity, lostLeads,
  } = Route.useLoaderData()

  const [activeTab, setActiveTab] = useState<TabId>('overview')

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="fade-up">
        <div className="kicker text-muted-foreground/70">Market Intelligence</div>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-foreground">
          Intelligence
        </h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Signals and analytics from your dealership data
        </p>
      </header>

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} signalCount={signals.length} />

      {/* ── Tab: Overview ── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Stat tiles */}
          <div className="fade-up grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Total Leads"      value={overview.totalLeads.toLocaleString('en-IN')} accent="brand" />
            <StatTile label="Conversion Rate"  value={`${overview.conversionRate}%`}               accent="emerald" />
            <StatTile label="Top Source"        value={overview.topSource}  sub="most leads"        accent="sky" />
            <StatTile label="Top Vehicle"       value={overview.topVehicle} sub="most interest"     accent="amber" />
            <StatTile label="Pipeline Value"    value={fmtINR(overview.pipelineValue)} sub="open"   accent="brand" />
            <StatTile label="Best Campaign"     value={overview.bestCampaign} sub="by leads"        accent="emerald" />
          </div>

          {/* Signals + Recommendations */}
          <div className="grid grid-cols-12 gap-5">
            <div className="col-span-12 lg:col-span-7">
              <SignalsPanel signals={signals.slice(0, 5)} />
            </div>
            <div className="col-span-12 lg:col-span-5">
              <RecommendationsPanel recommendations={recommendations} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Lead Intelligence ── */}
      {activeTab === 'leads' && (
        <div className="space-y-5">
          {/* Lead KPIs */}
          <div className="fade-up grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile label="Total Leads"     value={overview.totalLeads.toLocaleString('en-IN')} accent="brand" />
            <StatTile label="Conversion Rate" value={`${overview.conversionRate}%`}               accent="emerald" />
            <StatTile label="Top Source"      value={overview.topSource}  sub="most leads"        accent="sky" />
            <StatTile label="Pipeline Value"  value={fmtINR(overview.pipelineValue)} sub="open"   accent="brand" />
          </div>

          <div className="grid grid-cols-12 gap-5">
            {/* Velocity + Lost Leads */}
            <div className="col-span-12 lg:col-span-7">
              <VelocityPanel weeks={velocity} />
            </div>
            <div className="col-span-12 lg:col-span-5">
              <LostLeadPanel insight={lostLeads} />
            </div>

            {/* Source + Funnel */}
            <div className="col-span-12 lg:col-span-5">
              <SourcePanel sources={sources} />
            </div>
            <div className="col-span-12 lg:col-span-7">
              <FunnelPanel funnel={funnel} />
            </div>

            {/* Vehicle + Regional demand */}
            <div className="col-span-12 lg:col-span-6">
              <DemandPanel title="Vehicle Demand"  kicker="Inventory signal" items={vehicles} delay={0} variant="vehicle" />
            </div>
            <div className="col-span-12 lg:col-span-6">
              <DemandPanel title="Regional Demand" kicker="Geography"        items={regions}  delay={0} variant="regional" />
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Campaign Analytics ── */}
      {activeTab === 'campaigns' && (
        <div className="space-y-5">
          {/* Campaign KPIs */}
          <div className="fade-up grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile label="Active Campaigns"   value={String(campaignHealth.activeCampaigns)}                                                           accent="brand" />
            <StatTile label="Published Posts"    value={String(campaignHealth.published)}       sub={`of ${campaignHealth.totalPosts} total`}             accent="emerald" />
            <StatTile label="Compliance Rate"    value={`${campaignHealth.compliancePassRate}%`} sub="of reviewed posts"                                  accent="sky" />
            <StatTile label="Best Campaign"      value={overview.bestCampaign}                   sub="by leads"                                           accent="amber" />
          </div>

          <div className="grid grid-cols-12 gap-5">
            {/* Channel + Health */}
            <div className="col-span-12 lg:col-span-6">
              <ChannelPanel channels={channelAnalytics} />
            </div>
            <div className="col-span-12 lg:col-span-6">
              <CampaignHealthPanel health={campaignHealth} />
            </div>

            {/* Campaign performance table */}
            <div className="col-span-12">
              <CampaignPanel campaigns={campaigns} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Signals ── */}
      {activeTab === 'signals' && (
        <div className="fade-up">
          <SignalsTabContent signals={signals} />
        </div>
      )}
    </div>
  )
}
