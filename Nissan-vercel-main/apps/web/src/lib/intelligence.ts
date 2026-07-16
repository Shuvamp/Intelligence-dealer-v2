import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import { BOARD_COLUMN_FOR_STAGE, BOARD_STAGES, CLOSED_STAGES, WON_STAGES } from './types'
import type {
  CampaignHealth, CampaignPerformance, ChannelAnalytic, DemandItem, FunnelStage,
  IntelligenceOverview, IntelRecommendation, LeadSource, LeadStage, LostLeadInsight,
  MarketSignal, PostChannel, SignalStatus, SourceAnalytic, VelocityWeek,
} from './types'

type LeadRow = {
  source: LeadSource; stage: string; score: string; budget: number | null
  vehicle_interest: string | null; location_id: string | null
}

async function fetchLeads(supabase: ReturnType<typeof getSupabaseServerClient>): Promise<Array<LeadRow>> {
  const { data } = await supabase.from('leads').select('source, stage, score, budget, vehicle_interest, location_id')
  return (data ?? []) as Array<LeadRow>
}

const topKey = (counts: Record<string, number>, fallback = '—') => {
  const e = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return e ? e[0] : fallback
}

export const getIntelligenceOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<IntelligenceOverview> => {
    const supabase = getSupabaseServerClient()
    const leads = await fetchLeads(supabase)
    const { data: ins } = await supabase
      .from('campaign_insights')
      .select('leads_generated, campaigns(name)')
      .order('leads_generated', { ascending: false })
      .limit(1)
    const won = leads.filter((l) => WON_STAGES.has(l.stage as LeadStage)).length
    const lost = leads.filter((l) => l.stage === 'lost').length
    const closed = won + lost
    const bySource: Record<string, number> = {}
    const byVehicle: Record<string, number> = {}
    for (const l of leads) {
      bySource[l.source] = (bySource[l.source] ?? 0) + 1
      if (l.vehicle_interest) byVehicle[l.vehicle_interest] = (byVehicle[l.vehicle_interest] ?? 0) + 1
    }
    const open = leads.filter((l) => !CLOSED_STAGES.has(l.stage as LeadStage))
    return {
      totalLeads: leads.length,
      conversionRate: closed ? Math.round((won / closed) * 100) : 0,
      topSource: topKey(bySource),
      topVehicle: topKey(byVehicle),
      pipelineValue: open.reduce((t, l) => t + (l.budget ?? 0), 0),
      bestCampaign: (ins?.[0] as any)?.campaigns?.name ?? '—',
    }
  },
)

export const getLeadSourceAnalytics = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<SourceAnalytic>> => {
    const supabase = getSupabaseServerClient()
    const leads = await fetchLeads(supabase)
    const map = new Map<LeadSource, SourceAnalytic>()
    for (const l of leads) {
      const a = map.get(l.source) ?? { source: l.source, count: 0, hot: 0, won: 0, conversionRate: 0 }
      a.count++
      if (l.score === 'hot') a.hot++
      if (WON_STAGES.has(l.stage as LeadStage)) a.won++
      map.set(l.source, a)
    }
    return [...map.values()]
      .map((a) => ({ ...a, conversionRate: a.count ? Math.round((a.won / a.count) * 100) : 0 }))
      .sort((x, y) => y.count - x.count)
  },
)

export const getPipelineFunnel = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<FunnelStage>> => {
    const supabase = getSupabaseServerClient()
    const leads = await fetchLeads(supabase)
    // Group by board column (Phase 2), not raw stage, so legacy values
    // (qualified/quotation/won) fold onto the 7 current columns instead of
    // showing as separate, no-longer-reachable funnel steps.
    return BOARD_STAGES.map((stage) => ({
      stage,
      count: leads.filter((l) => BOARD_COLUMN_FOR_STAGE[l.stage as LeadStage] === stage).length,
    }))
  },
)

export const getVehicleDemand = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<DemandItem>> => {
    const supabase = getSupabaseServerClient()
    const leads = await fetchLeads(supabase)
    const map = new Map<string, DemandItem>()
    for (const l of leads) {
      const key = l.vehicle_interest ?? 'Unspecified'
      const d = map.get(key) ?? { label: key, count: 0, hot: 0 }
      d.count++
      if (l.score === 'hot') d.hot++
      map.set(key, d)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  },
)

export const getRegionalDemand = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<DemandItem>> => {
    const supabase = getSupabaseServerClient()
    const leads = await fetchLeads(supabase)
    const { data: locs } = await supabase.from('locations').select('id, name')
    const names = new Map((locs ?? []).map((l: any) => [l.id, l.name]))
    const map = new Map<string, DemandItem>()
    for (const l of leads) {
      const key = ((l.location_id && names.get(l.location_id)) || 'Unassigned') as string
      const d = map.get(key) ?? { label: key, count: 0, hot: 0 }
      d.count++
      if (l.score === 'hot') d.hot++
      map.set(key, d)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  },
)

export const getCampaignPerformance = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CampaignPerformance>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('campaign_insights')
      .select('campaign_id, reach, engagement, leads_generated, cost_per_lead, conversion_rate, campaigns(name)')
      .order('leads_generated', { ascending: false })
    return (data ?? []).map((r: any) => ({
      campaign_id: r.campaign_id,
      name: r.campaigns?.name ?? 'Campaign',
      reach: r.reach,
      engagement: r.engagement,
      leads: r.leads_generated,
      costPerLead: Number(r.cost_per_lead),
      conversionRate: Number(r.conversion_rate),
      roiLabel: `₹${Number(r.cost_per_lead).toLocaleString('en-IN')}/lead`,
    }))
  },
)

const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
export const getSignals = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<MarketSignal>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('market_signals')
      .select('*')
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
    return ((data ?? []) as Array<MarketSignal>).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
  },
)

export const getTopRecommendations = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<IntelRecommendation>> => {
    const supabase = getSupabaseServerClient()
    const leads = await fetchLeads(supabase)
    const recs: Array<IntelRecommendation> = []
    const byVehicle: Record<string, number> = {}
    const bySourceConv: Record<string, { c: number; w: number }> = {}
    for (const l of leads) {
      if (l.vehicle_interest) byVehicle[l.vehicle_interest] = (byVehicle[l.vehicle_interest] ?? 0) + 1
      const s = (bySourceConv[l.source] ??= { c: 0, w: 0 })
      s.c++
      if (WON_STAGES.has(l.stage as LeadStage)) s.w++
    }
    const topVeh = topKey(byVehicle)
    if (topVeh !== '—') recs.push({ title: `Prioritize ${topVeh} stock & promotion`, detail: `${topVeh} is your highest-demand model this period — keep inventory and ad spend weighted to it.`, priority: 'high' })

    const bestSource = Object.entries(bySourceConv).filter(([, v]) => v.c >= 2).sort((a, b) => (b[1].w / b[1].c) - (a[1].w / a[1].c))[0]
    if (bestSource) recs.push({ title: `Shift budget toward ${bestSource[0]}`, detail: `${bestSource[0]} converts best among your active sources — increase its share of marketing spend.`, priority: 'medium' })

    const closing = leads.filter((l) => l.stage === 'quotation' || l.stage === 'negotiation').length
    if (closing) recs.push({ title: `${closing} deal${closing > 1 ? 's' : ''} near closing`, detail: 'Leads sitting in Quotation/Negotiation — a focused follow-up sprint can convert them this week.', priority: 'high' })
    return recs
  },
)

export const updateSignalStatus = createServerFn({ method: 'POST' })
  .validator((d: { id: string; status: SignalStatus }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    await supabase.from('market_signals').update({ status: data.status, updated_at: new Date().toISOString() }).eq('id', data.id)
    return { ok: true as const }
  })

// ─── Channel Analytics ─────────────────────────────────────────────────────────
// Per-channel breakdown: post health + campaign attribution from campaigns.channels[].
export const getChannelAnalytics = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<ChannelAnalytic>> => {
    const supabase = getSupabaseServerClient()
    const [postsRes, campaignsRes, insightsRes] = await Promise.all([
      supabase.from('campaign_posts').select('channel, status, compliance'),
      supabase.from('campaigns').select('id, channels'),
      supabase.from('campaign_insights').select('campaign_id, reach, leads_generated, spend'),
    ])
    const posts = (postsRes.data ?? []) as Array<{ channel: PostChannel; status: string; compliance: string }>
    const campaigns = (campaignsRes.data ?? []) as Array<{ id: string; channels: Array<string> }>
    const insights = (insightsRes.data ?? []) as Array<{ campaign_id: string; reach: number; leads_generated: number; spend: number }>

    const ALL_CHANNELS: Array<PostChannel> = ['instagram', 'facebook', 'google_business', 'whatsapp']
    return ALL_CHANNELS.map((channel) => {
      const cp = posts.filter((p) => p.channel === channel)
      const cc = campaigns.filter((c) => Array.isArray(c.channels) && c.channels.includes(channel))
      const ids = new Set(cc.map((c) => c.id))
      const ci = insights.filter((i) => ids.has(i.campaign_id))
      const totalLeads = ci.reduce((t, i) => t + i.leads_generated, 0)
      const totalSpend = ci.reduce((t, i) => t + Number(i.spend), 0)
      return {
        channel,
        postCount: cp.length,
        publishedCount: cp.filter((p) => p.status === 'published').length,
        pendingCount: cp.filter((p) => p.status === 'pending_approval').length,
        approvedCompliance: cp.filter((p) => p.compliance === 'approved').length,
        flaggedCompliance: cp.filter((p) => p.compliance === 'flagged').length,
        campaignCount: cc.length,
        reach: ci.reduce((t, i) => t + i.reach, 0),
        leads: totalLeads,
        avgCpl: totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0,
      }
    }).filter((c) => c.postCount > 0 || c.campaignCount > 0)
  },
)

// ─── Campaign Content Health ───────────────────────────────────────────────────
// Post-pipeline snapshot: status distribution + compliance pass rate.
export const getCampaignHealth = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CampaignHealth> => {
    const supabase = getSupabaseServerClient()
    const [postsRes, campsRes] = await Promise.all([
      supabase.from('campaign_posts').select('status, compliance'),
      supabase.from('campaigns').select('status'),
    ])
    const posts = (postsRes.data ?? []) as Array<{ status: string; compliance: string }>
    const camps = (campsRes.data ?? []) as Array<{ status: string }>
    const checked = posts.filter((p) => p.compliance !== 'unchecked')
    const passRate = checked.length > 0
      ? Math.round((checked.filter((p) => p.compliance === 'approved').length / checked.length) * 100)
      : 0
    return {
      totalPosts: posts.length,
      published: posts.filter((p) => p.status === 'published').length,
      pendingApproval: posts.filter((p) => p.status === 'pending_approval').length,
      draft: posts.filter((p) => p.status === 'draft').length,
      rejected: posts.filter((p) => p.status === 'rejected').length,
      compliancePassRate: passRate,
      activeCampaigns: camps.filter((c) => c.status === 'active').length,
      totalCampaigns: camps.length,
    }
  },
)

// ─── Lead Velocity Trend ───────────────────────────────────────────────────────
// For each lead, derive its ISO week start (Monday) from created_at,
// then aggregate into 6 weekly buckets. The date in the row drives the bucketing.
export const getLeadVelocity = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<VelocityWeek>> => {
    const supabase = getSupabaseServerClient()
    const sixWeeksAgo = new Date()
    sixWeeksAgo.setUTCDate(sixWeeksAgo.getUTCDate() - 42)

    const { data } = await supabase
      .from('leads')
      .select('created_at, score')
      .gte('created_at', sixWeeksAgo.toISOString())

    const leads = (data ?? []) as Array<{ created_at: string; score: string }>

    // Given any date, return its Monday (ISO week start) at midnight UTC.
    function isoWeekStart(date: Date): Date {
      const d = new Date(date)
      const day = d.getUTCDay()                 // 0=Sun … 6=Sat
      const toMonday = day === 0 ? -6 : 1 - day // shift back to Monday
      d.setUTCDate(d.getUTCDate() + toMonday)
      d.setUTCHours(0, 0, 0, 0)
      return d
    }

    // Aggregate each lead into its ISO week bucket using created_at directly.
    const buckets = new Map<string, { start: Date; count: number; hot: number }>()
    for (const lead of leads) {
      const ws = isoWeekStart(new Date(lead.created_at))
      const key = ws.toISOString().slice(0, 10)          // "2026-04-28"
      const b = buckets.get(key) ?? { start: ws, count: 0, hot: 0 }
      b.count++
      if (lead.score === 'hot') b.hot++
      buckets.set(key, b)
    }

    // Build the 6-week series anchored to the current ISO week.
    // Weeks with no leads get count=0 — gaps are preserved intentionally.
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const fmt = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`

    const thisWeek = isoWeekStart(new Date())
    const weeks: Array<VelocityWeek> = []

    for (let w = 5; w >= 0; w--) {
      const ws = new Date(thisWeek)
      ws.setUTCDate(ws.getUTCDate() - w * 7)
      const we = new Date(ws)
      we.setUTCDate(we.getUTCDate() + 6)

      const key = ws.toISOString().slice(0, 10)
      const b = buckets.get(key)
      const label = w === 0 ? `${fmt(ws)} – Today` : `${fmt(ws)} – ${fmt(we)}`
      weeks.push({ weekLabel: label, count: b?.count ?? 0, hot: b?.hot ?? 0 })
    }

    return weeks
  },
)

// ─── Lost Lead Insights ────────────────────────────────────────────────────────
// Patterns in lost deals: top vehicle, top source, average budget.
export const getLostLeadInsights = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LostLeadInsight> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('leads')
      .select('source, vehicle_interest, budget')
      .eq('stage', 'lost')
    const lost = (data ?? []) as Array<{ source: string; vehicle_interest: string | null; budget: number | null }>
    if (lost.length === 0) return { count: 0, topVehicle: '—', topSource: '—', avgBudget: 0 }
    const byVehicle: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    for (const l of lost) {
      if (l.vehicle_interest) byVehicle[l.vehicle_interest] = (byVehicle[l.vehicle_interest] ?? 0) + 1
      bySource[l.source] = (bySource[l.source] ?? 0) + 1
    }
    const topVehicle = Object.entries(byVehicle).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    const topSource = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    const avgBudget = Math.round(lost.reduce((t, l) => t + (l.budget ?? 0), 0) / lost.length)
    return { count: lost.length, topVehicle, topSource, avgBudget }
  },
)
