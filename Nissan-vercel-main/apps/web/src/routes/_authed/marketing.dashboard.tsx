import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Zap, RefreshCw, Info } from 'lucide-react'
import {
  getMarketingAnalytics, getChannelStatus, getLinkedInInsights, getInstagramInsights, getCampaigns,
  resolveAnalyticsRange, refreshInstagramAnalytics,
} from '#/lib/marketing'
import type { AnalyticsPreset, AnalyticsRange, AnalyticsCampaignRow } from '#/lib/marketing'
import { CHANNELS } from '#/components/marketing/analytics/ChannelFilter'
import { ChannelPerformance, ChannelDistribution } from '#/components/marketing/analytics/AnalyticsCharts'
import { ActivityFeed, NotTracked } from '#/components/marketing/analytics/AnalyticsSections'
import {
  ConnectedChannelsCard, LinkedInInsightsPanel, InstagramInsightsPanel, ChannelCampaignsTable,
} from '#/components/marketing/analytics/ChannelPanels'
import { DashboardFilters } from '#/components/marketing/dashboard/DashboardFilters'
import { KpiRow } from '#/components/marketing/dashboard/KpiRow'
import { AiInsightsPanel } from '#/components/marketing/dashboard/AiInsightsPanel'
import { TopPerformingPosts, CampaignPerformanceTable, PostPerformanceTable } from '#/components/marketing/dashboard/Tables'
import {
  ReachTrendChart, EngagementOverviewChart, ContentTypePerformance,
  BestTimeHeatmap, AudienceGrowthChart, EngagementFunnel,
} from '#/components/marketing/dashboard/Charts'
import { MarketingRouteError } from '#/components/marketing/RouteError'

const PRESETS: ReadonlyArray<AnalyticsPreset> = [
  'today', 'last7', 'last30', 'this_month', 'last_month', 'this_year', 'custom',
]

const MEDIA_LABEL: Record<string, string> = { IMAGE: 'Images', VIDEO: 'Videos', CAROUSEL_ALBUM: 'Carousels' }

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
    // getCampaigns takes nothing from the channel status, so it rides along with it
    // instead of queueing behind a full round trip. Everything in the Promise.all
    // below genuinely reads `effectiveChannel`, so that stage has to stay downstream.
    const [connections, campaigns] = await Promise.all([getChannelStatus(), getCampaigns()])
    const connected = connections.filter((c) => c.status === 'connected').map((c) => c.channel)
    // Default channel: explicit choice wins; otherwise auto-focus the only
    // connected channel (e.g. LinkedIn-only), else All.
    const effectiveChannel =
      deps.channel && deps.channel !== 'all' ? deps.channel
      : deps.channel === 'all' ? 'all'
      : connected.length === 1 ? connected[0]!
      : 'all'
    // Previous period, same length, immediately before the current range —
    // powers the "vs previous period" deltas on the new KPI cards. Reuses
    // resolveAnalyticsRange (already exported) instead of re-deriving date math.
    const { start, end } = resolveAnalyticsRange(deps)
    const spanMs = end.getTime() - start.getTime()
    const prevRange: AnalyticsRange = {
      preset: 'custom',
      from: new Date(start.getTime() - spanMs - 1).toISOString(),
      to: new Date(start.getTime() - 1).toISOString(),
    }
    const fetchInstagram = effectiveChannel === 'instagram' || effectiveChannel === 'all'
    const [analytics, linkedin, instagram, prevAnalytics, prevInstagram] = await Promise.all([
      getMarketingAnalytics({ data: { ...deps, channel: effectiveChannel } }),
      effectiveChannel === 'linkedin' ? getLinkedInInsights({ data: deps }) : Promise.resolve(null),
      fetchInstagram ? getInstagramInsights({ data: deps }) : Promise.resolve(null),
      getMarketingAnalytics({ data: { ...prevRange, channel: effectiveChannel } }),
      fetchInstagram ? getInstagramInsights({ data: prevRange }) : Promise.resolve(null),
    ])
    return { analytics, connections, linkedin, instagram, campaigns, prevAnalytics, prevInstagram, effectiveChannel }
  },
  component: MarketingDashboard,
  pendingComponent: DashboardSkeleton,
  errorComponent: ({ reset }) => <MarketingRouteError title="Could not load the marketing dashboard" reset={reset} />,
})

function DashboardSkeleton() {
  return (
    <div className="min-h-full bg-[#F4F5F7]">
      <div className="mx-auto max-w-[1400px] space-y-5 p-6">
        <div className="h-16 animate-pulse rounded-[16px] bg-[#E9EAEE]" />
        <div className="h-12 animate-pulse rounded-[16px] bg-[#E9EAEE]" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-[16px] bg-[#E9EAEE]" />)}
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[320px] animate-pulse rounded-[16px] bg-[#E9EAEE]" />)}
        </div>
      </div>
    </div>
  )
}

function MarketingDashboard() {
  const { analytics, connections, linkedin, instagram, campaigns, prevAnalytics, prevInstagram, effectiveChannel } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [selected, setSelected] = useState<AnalyticsCampaignRow | null>(null)
  const [compareEnabled, setCompareEnabled] = useState(true)
  const [campaignFilter, setCampaignFilter] = useState('')
  const [contentTypeFilter, setContentTypeFilter] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')

  // Real-time: re-run the loader on an interval so live insight/post updates appear.
  // Note this only re-reads what the backend poller has already stored — use
  // "Refresh now" to pull fresh like/comment counts from Instagram immediately.
  // A hidden tab kept polling forever, and this loader is the expensive one —
  // up to five analytics calls per tick. Skip the tick while hidden, and re-run
  // it once on refocus so a returning tab never shows stale numbers.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void router.invalidate() }
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [router])

  const [refreshing, setRefreshing] = useState(false)
  const instagramConnected = connections.some((c) => c.channel === 'instagram' && c.status === 'connected')
  const onRefreshNow = async () => {
    setRefreshing(true)
    try {
      await refreshInstagramAnalytics()
      await router.invalidate()
    } catch (e) {
      console.error('[marketing.dashboard] instagram refresh failed', e)
    } finally {
      setRefreshing(false)
    }
  }

  const setRange = (r: AnalyticsRange) =>
    navigate({ search: (prev) => ({ ...prev, preset: r.preset, from: r.from, to: r.to }), replace: true })
  const setChannel = (channel: string) =>
    navigate({ search: (prev) => ({ ...prev, channel }), replace: true })

  const fmtDate = (iso: string) => iso.substring(0, 10)
  const scoped = effectiveChannel !== 'all'
  const channelLabel = CHANNELS.find((c) => c.key === effectiveChannel)?.label ?? effectiveChannel

  const campaignsById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns])
  const campaignOptions = useMemo(() => campaigns.map((c) => ({ value: c.id, label: c.name })), [campaigns])
  const vehicleOptions = useMemo(
    () => [...new Set(campaigns.flatMap((c) => c.vehicles ?? []))].map((v) => ({ value: v, label: v })),
    [campaigns],
  )
  const contentTypeOptions = useMemo(() => {
    const types = new Set((instagram?.posts ?? []).map((p) => p.mediaType).filter((t): t is string => !!t))
    return [...types].map((t) => ({ value: t, label: MEDIA_LABEL[t] ?? t }))
  }, [instagram])

  const filteredLeaderboard = useMemo(
    () => analytics.leaderboard.filter((row) => {
      if (campaignFilter && row.campaign_id !== campaignFilter) return false
      if (vehicleFilter && !campaignsById.get(row.campaign_id)?.vehicles?.includes(vehicleFilter)) return false
      return true
    }),
    [analytics.leaderboard, campaignFilter, vehicleFilter, campaignsById],
  )
  const filteredPosts = useMemo(
    () => (instagram?.posts ?? []).filter((p) => !contentTypeFilter || p.mediaType === contentTypeFilter),
    [instagram, contentTypeFilter],
  )
  const filteredTopPosts = useMemo(
    () => (instagram?.topPosts ?? []).filter((p) => !contentTypeFilter || p.mediaType === contentTypeFilter),
    [instagram, contentTypeFilter],
  )

  const onExport = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Total Reach', String(analytics.kpis.reach)],
      ['Impressions', String(analytics.kpis.impressions)],
      ['Likes', String(instagram?.likes ?? 'N/A')],
      ['Comments', String(instagram?.comments ?? 'N/A')],
      ['Leads', String(analytics.kpis.leads)],
      [],
      ['Campaign', 'Posts', 'Reach', 'Engagement', 'Leads'],
      ...filteredLeaderboard.map((r) => [r.name, String(campaignsById.get(r.campaign_id)?.postCount ?? ''), String(r.reach), String(r.engagement), String(r.leads)]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `marketing-report-${fmtDate(analytics.range.start)}_${fmtDate(analytics.range.end)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // The analytics body is identical for the Instagram-scoped view and the
  // All-Channels view — one definition, rendered in both branches.
  const body = (
    <>
      {/* Row — reach trend + engagement overview + AI insights rail */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <ReachTrendChart data={analytics.trend} />
        <EngagementOverviewChart data={analytics.trend} />
        <AiInsightsPanel posts={filteredPosts} bestCampaign={analytics.roi.bestCampaign} />
      </div>

      {/* Row — top posts + campaign performance + content type mix */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <TopPerformingPosts posts={filteredTopPosts} />
        <CampaignPerformanceTable leaderboard={filteredLeaderboard} campaigns={campaigns} />
        <ContentTypePerformance posts={filteredPosts} />
      </div>

      {/* Row — best time to post + audience growth + engagement funnel */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <BestTimeHeatmap posts={filteredPosts} />
        <AudienceGrowthChart data={instagram?.audience ?? []} />
        <EngagementFunnel
          impressions={analytics.kpis.impressions}
          reach={analytics.kpis.reach}
          likes={instagram?.likes ?? null}
          comments={instagram?.comments ?? null}
          leads={analytics.kpis.leads}
        />
      </div>

      {/* Row — full-width post performance table */}
      <PostPerformanceTable posts={filteredPosts} />
    </>
  )

  return (
    <div className="min-h-full bg-[#F4F5F7]">
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
        <div className="flex items-center gap-2">
          {instagramConnected && (
            <button
              onClick={onRefreshNow}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-[12px] border border-[#E5E7EB] bg-white px-4 py-2 text-[13px] font-semibold text-[#1A1A1A] transition hover:bg-[#F5F5F5] disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
          )}
          <Link
            to="/marketing/campaign-planner"
            className="flex items-center gap-2 rounded-[12px] bg-[#C3002F] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#a50027]"
          >
            <Zap className="h-4 w-4" /> New Campaign
          </Link>
        </div>
      </div>

      {/* Global filters */}
      <DashboardFilters
        range={search} onRangeChange={setRange}
        channel={effectiveChannel} onChannelChange={setChannel} connections={connections}
        compareEnabled={compareEnabled} onCompareToggle={() => setCompareEnabled((v) => !v)}
        campaignOptions={campaignOptions} campaign={campaignFilter} onCampaignChange={setCampaignFilter}
        contentTypeOptions={contentTypeOptions} contentType={contentTypeFilter} onContentTypeChange={setContentTypeFilter}
        vehicleOptions={vehicleOptions} vehicle={vehicleFilter} onVehicleChange={setVehicleFilter}
        onExport={onExport}
      />

      {scoped ? (
        /* ───────── Single-channel view (unchanged from prior release) ───────── */
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

          {effectiveChannel === 'instagram' && instagram && (
            <>
              <InstagramInsightsPanel data={instagram} showTopPosts={false} />
              {body}
            </>
          )}

          {effectiveChannel !== 'instagram' && (
            <>
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
          )}
        </>
      ) : (
        /* ───────── All Channels — executive Instagram analytics dashboard ───────── */
        <>
          {!analytics.availability.insights && (
            <div className="flex items-center gap-2 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
              <Info className="h-4 w-4 shrink-0" />
              No campaign insights captured in this period — KPIs and charts below are empty. Try a wider range (e.g. This Year).
            </div>
          )}

          {/* Row 1 — 8 executive KPIs */}
          <KpiRow
            kpis={analytics.kpis}
            prevKpis={compareEnabled ? prevAnalytics.kpis : { ...analytics.kpis, reach: 0, impressions: 0, leads: 0 }}
            instagram={instagram}
            prevInstagram={compareEnabled ? prevInstagram : null}
          />

          {body}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ActivityFeed
              items={analytics.activity}
              filterCampaign={selected?.name ?? null}
              onClearFilter={() => setSelected(null)}
            />
            <ChannelDistribution data={analytics.channelVolume} />
          </div>
        </>
      )}
    </div>
    </div>
  )
}
