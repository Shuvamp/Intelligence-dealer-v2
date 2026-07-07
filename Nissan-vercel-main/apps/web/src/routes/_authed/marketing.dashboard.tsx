import { useEffect, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Zap, RefreshCw, Info } from 'lucide-react'
import { getMarketingAnalytics, getChannelStatus, getLinkedInInsights } from '#/lib/marketing'
import type { AnalyticsPreset, AnalyticsRange, AnalyticsCampaignRow } from '#/lib/marketing'
import { DateRangeFilter } from '#/components/marketing/analytics/DateRangeFilter'
import { ChannelFilter, CHANNELS } from '#/components/marketing/analytics/ChannelFilter'
import { PerformanceTrend, ChannelPerformance, ChannelDistribution } from '#/components/marketing/analytics/AnalyticsCharts'
import {
  KpiCards, CampaignLeaderboard, RoiSection, ActivityFeed, NotTracked,
} from '#/components/marketing/analytics/AnalyticsSections'
import {
  ConnectedChannelsCard, LinkedInInsightsPanel, ChannelCampaignsTable,
} from '#/components/marketing/analytics/ChannelPanels'

const PRESETS: ReadonlyArray<AnalyticsPreset> = [
  'today', 'last7', 'last30', 'this_month', 'last_month', 'this_year', 'custom',
]

export const Route = createFileRoute('/_authed/marketing/dashboard')({
  // Date + channel filters live in the URL → shareable; changing either re-runs the loader.
  validateSearch: (s: Record<string, unknown>): AnalyticsRange => ({
    preset: PRESETS.includes(s['preset'] as AnalyticsPreset) ? (s['preset'] as AnalyticsPreset) : 'last30',
    from: typeof s['from'] === 'string' ? s['from'] : undefined,
    to: typeof s['to'] === 'string' ? s['to'] : undefined,
    channel: typeof s['channel'] === 'string' ? s['channel'] : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const connections = await getChannelStatus()
    const connected = connections.filter((c) => c.status === 'connected').map((c) => c.channel)
    // Default channel: explicit choice wins; otherwise auto-focus the only
    // connected channel (e.g. LinkedIn-only), else All.
    const effectiveChannel =
      deps.channel && deps.channel !== 'all' ? deps.channel
      : deps.channel === 'all' ? 'all'
      : connected.length === 1 ? connected[0]!
      : 'all'
    const [analytics, linkedin] = await Promise.all([
      getMarketingAnalytics({ data: { ...deps, channel: effectiveChannel } }),
      effectiveChannel === 'linkedin' ? getLinkedInInsights({ data: deps }) : Promise.resolve(null),
    ])
    return { analytics, connections, linkedin, effectiveChannel }
  },
  component: MarketingDashboard,
})

function MarketingDashboard() {
  const { analytics, connections, linkedin, effectiveChannel } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [selected, setSelected] = useState<AnalyticsCampaignRow | null>(null)

  // Real-time: re-run the loader on an interval so live insight/post updates appear.
  useEffect(() => {
    const id = setInterval(() => { void router.invalidate() }, 60_000)
    return () => clearInterval(id)
  }, [router])

  const setRange = (r: AnalyticsRange) =>
    navigate({ search: (prev) => ({ ...prev, preset: r.preset, from: r.from, to: r.to }), replace: true })
  const setChannel = (channel: string) =>
    navigate({ search: (prev) => ({ ...prev, channel }), replace: true })

  const fmtDate = (iso: string) => iso.substring(0, 10)
  const scoped = effectiveChannel !== 'all'
  const channelLabel = CHANNELS.find((c) => c.key === effectiveChannel)?.label ?? effectiveChannel

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-[5px] bg-[#C3002F] px-2 py-0.5 text-[11px] font-bold tracking-widest text-white">NISSAN</span>
            <span className="text-[13px] font-medium text-[#8C8C8C]">Marketing Intelligence Platform</span>
          </div>
          <h1 className="text-[28px] font-bold text-foreground">Marketing Analytics</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
            <RefreshCw className="h-3 w-3" /> Auto-refreshes every 60s ·
            <span>{fmtDate(analytics.range.start)} → {fmtDate(analytics.range.end)}</span>
          </p>
        </div>
        <Link
          to="/marketing/campaign-planner"
          className="flex items-center gap-2 rounded-[12px] bg-[#C3002F] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#a50027]"
        >
          <Zap className="h-4 w-4" /> New Campaign
        </Link>
      </div>

      {/* Global filters */}
      <DateRangeFilter value={search} onChange={setRange} />
      <ChannelFilter value={effectiveChannel} onChange={setChannel} connections={connections} />

      {scoped ? (
        /* ───────── Single-channel view ───────── */
        <>
          <div className="flex items-center gap-2 rounded-[12px] border border-[#E5E7EB] bg-[#FAFAFA] px-4 py-2.5 text-[12px] text-[#6B7280]">
            <Info className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
            Showing <span className="font-semibold text-[#1A1A1A]">{channelLabel}</span>. Per-channel reach/impressions/engagement aren't tracked — campaign-level insights live under <button onClick={() => setChannel('all')} className="font-semibold text-[#C3002F]">All Channels</button>.
          </div>

          {effectiveChannel === 'linkedin' && linkedin && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2"><LinkedInInsightsPanel data={linkedin} /></div>
              <ConnectedChannelsCard connections={connections} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChannelPerformance data={analytics.channelVolume} />
            <ChannelCampaignsTable rows={analytics.channelCampaigns} channelLabel={channelLabel} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <ActivityFeed items={analytics.activity} filterCampaign={null} onClearFilter={() => {}} />
            {effectiveChannel !== 'linkedin' && <ConnectedChannelsCard connections={connections} />}
            <NotTracked
              title={`${channelLabel} Performance Metrics`}
              lines={['Reach & impressions per channel', 'Engagement & engagement rate', 'Leads attributed per channel']}
            />
          </div>
        </>
      ) : (
        /* ───────── All Channels view ───────── */
        <>
          {!analytics.availability.insights && (
            <div className="flex items-center gap-2 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
              <Info className="h-4 w-4 shrink-0" />
              No campaign insights captured in this period — KPIs and charts below are empty. Try a wider range (e.g. This Year).
            </div>
          )}

          <KpiCards kpis={analytics.kpis} />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2"><PerformanceTrend data={analytics.trend} /></div>
            <RoiSection roi={analytics.roi} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChannelPerformance data={analytics.channelVolume} />
            <ChannelDistribution data={analytics.channelVolume} />
          </div>

          <CampaignLeaderboard
            rows={analytics.leaderboard}
            selectedId={selected?.campaign_id ?? null}
            onSelect={setSelected}
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <ActivityFeed
              items={analytics.activity}
              filterCampaign={selected?.name ?? null}
              onClearFilter={() => setSelected(null)}
            />
            <ConnectedChannelsCard connections={connections} />
            <div className="space-y-5">
              <NotTracked title="Content Performance" lines={['Top / lowest posts', 'Engagement rate per post']} />
              <NotTracked title="Audience Insights" lines={['Followers growth', 'New vs returning', 'Profile views']} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
