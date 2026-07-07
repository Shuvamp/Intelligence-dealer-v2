import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import { BOARD_COLUMN_FOR_STAGE, BOARD_STAGES, CLOSED_STAGES, WON_STAGES } from './types'
import type {
  CampaignPerformance, DemandItem, FunnelStage, IntelligenceOverview, IntelRecommendation,
  LeadSource, LeadStage, MarketSignal, SignalStatus, SourceAnalytic,
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
