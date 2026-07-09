import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import type {
  Campaign,
  CampaignObjective,
  CampaignPlanInput,
  CampaignPlanResult,
  CampaignPost,
  CampaignScorecard,
  CampaignStatus,
  CampaignSummary,
  ContentStatus,
  MarketingOverview,
  MediaAsset,
  MonthOpportunity,
  MonthPlan,
  OpportunityKind,
  PublishingItem,
  PublishStatus,
  PostChannel,
  PostStatus,
  PublishResult,
  RecommendedCampaign,
  SelectedAsset,
} from './types'
import type { DuckAssetRow } from './analytics.duckdb'

const FASTAPI_URL = (() => {
  const raw = (
    (typeof process !== 'undefined' && process.env['FASTAPI_URL']) || 'http://localhost:8000'
  ).replace(/\/$/, '')
  // Tolerate a scheme-less env value (e.g. "host.up.railway.app"): fetch/new URL
  // require a protocol, so default a bare host to https://.
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`
})()

const DEFAULT_CHANNELS = ['Instagram', 'Facebook', 'X']

type BatchItemIn = { idx: number; date?: string; theme?: string; vehicle?: string | null; offer?: string | null }
type BatchItemOut = { headline: string; subheadline: string; caption: string; hashtags: string[]; cta: string; ai: boolean }

// Server-side helper: one FastAPI call → AI content for many days/events.
// Returns [] on failure so callers can persist structure and let the user
// generate content later in Content Studio (never throws).
async function fetchBatchContent(
  brief: { campaign_name?: string; goal?: string; vehicles?: Array<string>; channels?: Array<string> },
  items: Array<BatchItemIn>,
): Promise<Array<BatchItemOut>> {
  if (items.length === 0) return []
  try {
    const res = await fetch(`${FASTAPI_URL}/marketing/content/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels: DEFAULT_CHANNELS, ...brief, items }),
    })
    if (!res.ok) throw new Error(`batch ${res.status}`)
    const json = (await res.json()) as { items: Array<BatchItemOut> }
    return json.items ?? []
  } catch (e) {
    console.error('[fetchBatchContent] failed:', e)
    return []
  }
}

function toDateStr(v: unknown): string | null {
  if (!v) return null
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  return String(v).substring(0, 10)
}

// Demo-mode fallback: auth.ts is a stub (signIn is a no-op) so no real Supabase
// session exists. All server functions need a tenantId for DuckDB ops and RLS.
const DEMO_CTX = { userId: 'demo-owner-id', tenantId: '11111111-1111-1111-1111-111111111111' }

async function authCtx(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return DEMO_CTX
  const { data } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  // data?.tenant_id can be undefined (user in auth but missing from users table).
  // undefined is NOT null in DuckDB's Node binding — it skips the ?-slot, shifting
  // all subsequent params left and leaving the last placeholder unbound.
  return { userId: user.id, tenantId: (data?.tenant_id ?? DEMO_CTX.tenantId) as string }
}

// =====================================================================
// AGENT 1 — Campaign Planning: festival / holiday / regional occasions.
// Fetches from Calendarific API (country=IN) using CALENDARIFIC_API_KEY.
// Returns empty opportunities on API failure.
// =====================================================================


const MONTH_LABEL = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]


export const getMonthPlan = createServerFn({ method: 'GET' })
  .validator((d: { month: number; year: number }) => d)
  .handler(async ({ data }): Promise<MonthPlan> => {
    const month = Math.min(12, Math.max(1, data.month || 1))
    const year = data.year || new Date().getFullYear()
    try {
      const res = await fetch(`${FASTAPI_URL}/marketing/calendar/month-plan?month=${month}&year=${year}`)
      if (res.ok) {
        const json = await res.json() as { opportunities: MonthPlan['opportunities'] }
        return { month, label: MONTH_LABEL[month], opportunities: json.opportunities ?? [] }
      }
    } catch { /* fall through */ }
    return { month, label: MONTH_LABEL[month], opportunities: [] }
  })

// =====================================================================
// AGENT 2 — Marketing Strategy (basic): prioritized campaign ideas.
// Rule-based over a simple inventory/objective heuristic for V1.
// =====================================================================
export const getRecommendedCampaigns = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<RecommendedCampaign>> => {
    try {
      const res = await fetch(`${FASTAPI_URL}/marketing/campaigns/recommended`)
      if (res.ok) return res.json() as Promise<Array<RecommendedCampaign>>
    } catch { /* fall through */ }
    return []
  },
)

// =====================================================================
// Reads — campaigns, calendar, approval queue, scorecard, overview
// =====================================================================
export const getMarketingOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MarketingOverview> => {
    const supabase = getSupabaseServerClient()
    const [camps, posts, insights] = await Promise.all([
      supabase.from('campaigns').select('status'),
      supabase.from('campaign_posts').select('status, published_at'),
      supabase.from('campaign_insights').select('leads_generated, spend'),
    ])
    const postRows = posts.data ?? []
    const ins = insights.data ?? []
    const leads = ins.reduce((t: number, r: any) => t + (r.leads_generated ?? 0), 0)
    const spend = ins.reduce((t: number, r: any) => t + Number(r.spend ?? 0), 0)
    return {
      activeCampaigns: (camps.data ?? []).filter((c: any) => c.status === 'active').length,
      contentInPipeline: postRows.filter((p: any) => ['draft', 'pending_approval', 'approved'].includes(p.status)).length,
      pendingApproval: postRows.filter((p: any) => p.status === 'pending_approval').length,
      publishedThisMonth: postRows.filter((p: any) => p.status === 'published').length,
      leadsAttributed: leads,
      costPerLead: leads ? Math.round(spend / leads) : 0,
    }
  },
)

// =====================================================================
// Executive analytics dashboard — REAL DATA ONLY.
// Sources: campaign_insights (campaign-level reach/impressions/engagement/
// leads/spend/CPL/conversion), campaign_posts (real per-channel publish
// volume + activity), leads (CRM leads in range). Metrics with no real
// source (likes/comments/shares/page-views/CTR, per-channel reach, per-post
// engagement, audience growth) are returned null/empty — never fabricated.
// =====================================================================

export type AnalyticsPreset =
  | 'today' | 'last7' | 'last30' | 'this_month' | 'last_month' | 'this_year' | 'custom'

export interface AnalyticsRange {
  preset: AnalyticsPreset
  from?: string   // ISO date (custom)
  to?: string     // ISO date (custom)
  channel?: string  // 'all' | instagram | facebook | linkedin | google_business | whatsapp
}

export interface AnalyticsKpis {
  reach: number
  impressions: number
  engagement: number
  leads: number
  conversions: number
  spend: number
  costPerLead: number
  conversionRate: number   // %
  engagementRate: number   // % = engagement / impressions
  // Not tracked — no real source. UI renders these as "N/A".
  likes: number | null
  comments: number | null
  shares: number | null
  pageViews: number | null
  ctr: number | null
}

export interface AnalyticsTrendPoint {
  date: string             // YYYY-MM-DD
  reach: number
  impressions: number
  engagement: number
}

export interface AnalyticsCampaignRow {
  campaign_id: string
  name: string
  reach: number
  impressions: number
  engagement: number
  leads: number
  spend: number
  costPerLead: number
  conversionRate: number
}

export interface AnalyticsChannelVolume {
  channel: string
  total: number        // posts created in range
  published: number    // posts published in range
}

export interface AnalyticsActivityItem {
  id: string
  kind: 'published' | 'scheduled' | 'approved' | 'generated' | 'draft' | 'other'
  title: string
  channel: string | null
  campaign: string | null
  status: string
  at: string | null
}

export interface AnalyticsChannelCampaign {
  campaign_id: string
  name: string
  total: number       // posts on this channel created in range
  published: number   // posts on this channel published in range
}

export interface MarketingAnalytics {
  range: { preset: AnalyticsPreset; start: string; end: string }
  channel: string                       // 'all' or the scoped channel key
  kpis: AnalyticsKpis
  trend: Array<AnalyticsTrendPoint>
  leaderboard: Array<AnalyticsCampaignRow>
  channelVolume: Array<AnalyticsChannelVolume>
  channelCampaigns: Array<AnalyticsChannelCampaign>  // populated only when scoped
  roi: {
    spend: number
    leads: number
    costPerLead: number
    conversionRate: number
    conversions: number
    bestCampaign: { name: string; leads: number; reach: number } | null
  }
  activity: Array<AnalyticsActivityItem>
  totals: { campaigns: number; postsPublished: number; leadsCRM: number; insightRows: number }
  availability: {
    insights: boolean          // any campaign_insights rows in range
    scoped: boolean            // a single channel is selected (insight KPIs N/A)
    perChannelMetrics: false   // reach/engagement per channel not tracked
    perPostMetrics: false      // engagement per post not tracked
    audience: false            // followers / page views / visitors not tracked
  }
}

// Resolve a preset (+ optional custom range) to [start, end] Date bounds.
export function resolveAnalyticsRange(r: AnalyticsRange): { start: Date; end: Date } {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  const minus = (days: number) => { const s = startOfDay(now); s.setDate(s.getDate() - days); return s }
  switch (r.preset) {
    case 'today':      return { start: startOfDay(now), end: endOfDay(now) }
    case 'last7':      return { start: minus(6), end: endOfDay(now) }
    case 'last30':     return { start: minus(29), end: endOfDay(now) }
    case 'this_month': return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) }
    case 'last_month': return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    }
    case 'this_year':  return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) }
    case 'custom':     return {
      start: r.from ? new Date(`${r.from.substring(0, 10)}T00:00:00`) : minus(29),
      end: r.to ? new Date(`${r.to.substring(0, 10)}T23:59:59.999`) : endOfDay(now),
    }
    default:           return { start: minus(29), end: endOfDay(now) }
  }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0
const round1 = (v: number): number => Math.round(v * 10) / 10

export const getMarketingAnalytics = createServerFn({ method: 'GET' })
  .validator((d: AnalyticsRange) => d)
  .handler(async ({ data }): Promise<MarketingAnalytics> => {
    const supabase = getSupabaseServerClient()
    const { start, end } = resolveAnalyticsRange(data)
    const startIso = start.toISOString()
    const endIso = end.toISOString()
    const inRange = (iso?: string | null) => !!iso && iso >= startIso && iso <= endIso

    const [campsRes, insRes, postsRes, leadsRes] = await Promise.all([
      supabase.from('campaigns').select('id, name, status, channels'),
      supabase.from('campaign_insights').select('*').gte('captured_at', startIso).lte('captured_at', endIso),
      supabase.from('campaign_posts').select('id, title, campaign_id, channel, status, published_at, created_at, vehicle'),
      supabase.from('leads').select('id, created_at').gte('created_at', startIso).lte('created_at', endIso),
    ])

    const camps = (campsRes.data ?? []) as Array<{ id: string; name: string; status: string; channels: string[] | null }>
    const nameById = new Map(camps.map((c) => [c.id, c.name]))
    const ins = (insRes.data ?? []) as Array<Record<string, unknown>>
    const posts = (postsRes.data ?? []) as Array<{
      id: string; title: string | null; campaign_id: string | null; channel: string
      status: string; published_at: string | null; created_at: string; vehicle: string | null
    }>
    const leadsCRM = (leadsRes.data ?? []).length

    // ── KPIs (real, from insights) ──────────────────────────────────────────
    const sum = (k: string) => ins.reduce((t, r) => t + num(r[k]), 0)
    const reach = sum('reach')
    const impressions = sum('impressions')
    const engagement = sum('engagement')
    const leads = sum('leads_generated')
    const conversions = sum('conversions')
    const spend = sum('spend')
    const costPerLead = leads ? Math.round(spend / leads) : 0
    const conversionRate = leads ? round1((conversions / leads) * 100) : 0
    const engagementRate = impressions ? round1((engagement / impressions) * 100) : 0

    const kpis: AnalyticsKpis = {
      reach, impressions, engagement, leads, conversions, spend, costPerLead,
      conversionRate, engagementRate,
      likes: null, comments: null, shares: null, pageViews: null, ctr: null,
    }

    // ── Performance trend (real insights grouped by capture date) ───────────
    const byDay = new Map<string, AnalyticsTrendPoint>()
    for (const r of ins) {
      const day = String(r['captured_at'] ?? '').substring(0, 10)
      if (!day) continue
      const p = byDay.get(day) ?? { date: day, reach: 0, impressions: 0, engagement: 0 }
      p.reach += num(r['reach'])
      p.impressions += num(r['impressions'])
      p.engagement += num(r['engagement'])
      byDay.set(day, p)
    }
    const trend = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))

    // ── Campaign leaderboard (real, aggregated per campaign) ────────────────
    const byCampaign = new Map<string, AnalyticsCampaignRow>()
    for (const r of ins) {
      const cid = String(r['campaign_id'] ?? '')
      if (!cid) continue
      const row = byCampaign.get(cid) ?? {
        campaign_id: cid, name: nameById.get(cid) ?? 'Unknown campaign',
        reach: 0, impressions: 0, engagement: 0, leads: 0, spend: 0, costPerLead: 0, conversionRate: 0,
      }
      row.reach += num(r['reach'])
      row.impressions += num(r['impressions'])
      row.engagement += num(r['engagement'])
      row.leads += num(r['leads_generated'])
      row.spend += num(r['spend'])
      byCampaign.set(cid, row)
    }
    const leaderboard = [...byCampaign.values()].map((r) => ({
      ...r,
      costPerLead: r.leads ? Math.round(r.spend / r.leads) : 0,
      conversionRate: r.impressions ? round1((r.engagement / r.impressions) * 100) : 0,
    })).sort((a, b) => b.reach - a.reach)

    // ── Channel publish volume (REAL — post counts per channel) ─────────────
    const byChannel = new Map<string, AnalyticsChannelVolume>()
    for (const p of posts) {
      const createdIn = inRange(p.created_at)
      const publishedIn = p.status === 'published' && inRange(p.published_at)
      if (!createdIn && !publishedIn) continue
      const v = byChannel.get(p.channel) ?? { channel: p.channel, total: 0, published: 0 }
      if (createdIn) v.total += 1
      if (publishedIn) v.published += 1
      byChannel.set(p.channel, v)
    }
    const channelVolume = [...byChannel.values()].sort((a, b) => b.total - a.total)

    // ── Recent activity feed (real posts in range) ──────────────────────────
    const statusKind = (s: string): AnalyticsActivityItem['kind'] =>
      s === 'published' ? 'published'
      : s === 'scheduled' ? 'scheduled'
      : s === 'approved' ? 'approved'
      : s === 'generated' || s === 'pending_approval' ? 'generated'
      : s === 'draft' ? 'draft' : 'other'
    const activity: Array<AnalyticsActivityItem> = posts
      .filter((p) => inRange(p.published_at) || inRange(p.created_at))
      .sort((a, b) => String(b.published_at ?? b.created_at).localeCompare(String(a.published_at ?? a.created_at)))
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        kind: statusKind(p.status),
        title: p.title || p.vehicle || 'Untitled post',
        channel: p.channel ?? null,
        campaign: p.campaign_id ? (nameById.get(p.campaign_id) ?? null) : null,
        status: p.status,
        at: p.published_at ?? p.created_at,
      }))

    // ── ROI (real) ──────────────────────────────────────────────────────────
    const best = [...byCampaign.values()].sort((a, b) => b.leads - a.leads)[0]
    const postsPublished = posts.filter((p) => p.status === 'published' && inRange(p.published_at)).length

    // ── Channel scoping (real, post-level) ──────────────────────────────────
    // campaign_insights has no channel dimension, so when a single channel is
    // selected we only narrow what IS per-channel real: post volume, the
    // campaigns active on that channel, and the activity feed.
    const channelKey = data.channel && data.channel !== 'all' ? data.channel : null
    let outChannelVolume = channelVolume
    let outActivity = activity
    let channelCampaigns: Array<AnalyticsChannelCampaign> = []
    if (channelKey) {
      outChannelVolume = channelVolume.filter((c) => c.channel === channelKey)
      outActivity = activity.filter((a) => a.channel === channelKey)
      const m = new Map<string, AnalyticsChannelCampaign>()
      for (const p of posts) {
        if (p.channel !== channelKey) continue
        const createdIn = inRange(p.created_at)
        const publishedIn = p.status === 'published' && inRange(p.published_at)
        if (!createdIn && !publishedIn) continue
        const cid = p.campaign_id ?? 'none'
        const row = m.get(cid) ?? { campaign_id: cid, name: cid === 'none' ? 'Unlinked posts' : (nameById.get(cid) ?? 'Unknown campaign'), total: 0, published: 0 }
        if (createdIn) row.total += 1
        if (publishedIn) row.published += 1
        m.set(cid, row)
      }
      channelCampaigns = [...m.values()].sort((a, b) => b.total - a.total)
    }

    return {
      range: { preset: data.preset, start: startIso, end: endIso },
      channel: channelKey ?? 'all',
      kpis,
      trend,
      leaderboard,
      channelVolume: outChannelVolume,
      channelCampaigns,
      roi: {
        spend, leads, costPerLead, conversionRate, conversions,
        bestCampaign: best ? { name: best.name, leads: best.leads, reach: best.reach } : null,
      },
      activity: outActivity,
      totals: { campaigns: camps.length, postsPublished, leadsCRM, insightRows: ins.length },
      availability: { insights: ins.length > 0, scoped: !!channelKey, perChannelMetrics: false, perPostMetrics: false, audience: false },
    }
  })

// LinkedIn insights — REAL likes/comments per published post (socialActions),
// proxied from FastAPI. reach/impressions/followers/page-views are null (the
// member API doesn't expose them — org + Marketing Developer Platform only).
export interface LinkedInInsights {
  connected: boolean
  handle: string | null
  last_sync: string | null
  postsTracked: number
  postsWithStats: number
  likes: number
  comments: number
  engagement: number
  avgEngagementPerPost: number
  reach: number | null
  impressions: number | null
  shares: number | null
  engagementRate: number | null
  followersGrowth: number | null
  profileViews: number | null
  topPosts: Array<{ urn: string; title: string; caption: string | null; likes: number; comments: number; at: string | null }>
  posts: Array<{ urn: string; title: string; caption: string | null; likes: number; comments: number; at: string | null }>
}

export const getLinkedInInsights = createServerFn({ method: 'GET' })
  .validator((d: AnalyticsRange) => d)
  .handler(async ({ data }): Promise<LinkedInInsights> => {
    const empty: LinkedInInsights = {
      connected: false, handle: null, last_sync: null, postsTracked: 0, postsWithStats: 0,
      likes: 0, comments: 0, engagement: 0, avgEngagementPerPost: 0,
      reach: null, impressions: null, shares: null, engagementRate: null,
      followersGrowth: null, profileViews: null, topPosts: [], posts: [],
    }
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      if (!tenantId) return empty
      const { start, end } = resolveAnalyticsRange(data)
      const qs = new URLSearchParams({
        tenant_id: tenantId,
        date_from: start.toISOString(),
        date_to: end.toISOString(),
      })
      const res = await fetch(`${FASTAPI_URL}/api/linkedin/insights?${qs.toString()}`)
      if (!res.ok) return empty
      return (await res.json()) as LinkedInInsights
    } catch (e) {
      console.error('[getLinkedInInsights] failed:', e)
      return empty
    }
  })

// getCampaigns: primary source is DuckDB (where Campaign Planner writes),
// with live post counts cross-queried from Supabase campaign_posts.
export const getCampaigns = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CampaignSummary>> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)

    // Post counts from Supabase (real generated content)
    const { data: postRows } = await supabase
      .from('campaign_posts')
      .select('campaign_id, status')
    const byId = (postRows ?? []) as Array<{ campaign_id: string | null; status: PostStatus }>

    try {
      const { listCampaigns } = await import('./analytics.duckdb')
      const rows = await listCampaigns(tenantId)
      if (rows.length > 0) {
        return rows.map((r) => {
          const parsedAssets: SelectedAsset[] = r.selected_assets
            ? (() => { try { return JSON.parse(r.selected_assets as string) } catch { return [] } })()
            : []
          const parsedLogo: SelectedAsset | null = r.selected_logo
            ? (() => { try { return JSON.parse(r.selected_logo as string) } catch { return null } })()
            : null
          return {
            id: r.campaign_id,
            tenant_id: r.tenant_id,
            location_id: null,
            name: r.name,
            theme: r.theme ?? null,
            objective: (r.objective as CampaignObjective) ?? 'awareness',
            status: (r.status as CampaignStatus) ?? 'draft',
            channels: (r.channels as string[] | null) ?? [],
            start_date: toDateStr(r.start_date),
            end_date: toDateStr(r.end_date),
            budget: null,
            color: r.campaign_color ?? null,
            campaign_hashtags: (r.campaign_hashtags as string[] | null) ?? [],
            created_at: '',
            updated_at: '',
            postCount: byId.filter((p) => p.campaign_id === r.campaign_id).length,
            publishedCount: byId.filter((p) => p.campaign_id === r.campaign_id && p.status === 'published').length,
            selected_assets: parsedAssets,
            selected_logo: parsedLogo,
            vehicles: parsedAssets.length > 0
              ? [...new Set(parsedAssets.map((a) => a.vehicle))]
              : (r.vehicle ? (r.vehicle as string).split(',').filter(Boolean) : []),
            posting_time: r.posting_time ?? null,
            goal: r.goal ?? null,
          }
        })
      }
    } catch { /* fall through to Supabase */ }

    // Supabase fallback (campaigns manually created via API)
    const { data: camps } = await supabase
      .from('campaigns').select('*').order('created_at', { ascending: false })
    return (camps ?? []).map((c: any) => ({
      ...c,
      postCount: byId.filter((p) => p.campaign_id === c.id).length,
      publishedCount: byId.filter((p) => p.campaign_id === c.id && p.status === 'published').length,
    }))
  },
)

// Read campaigns from the persistent DuckDB file (.duckdb/analytics.duckdb).
// Returns [] on first run (empty DB) or if DuckDB is unavailable — caller falls back to Supabase.
export const getDuckCampaigns = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CampaignSummary>> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      if (!tenantId) return []
      const { listCampaigns } = await import('./analytics.duckdb')
      const rows = await listCampaigns(tenantId)
      return rows.map((r) => {
        const parsedAssets: SelectedAsset[] = r.selected_assets
          ? (() => { try { return JSON.parse(r.selected_assets as string) } catch { return [] } })()
          : []
        const parsedLogo: SelectedAsset | null = r.selected_logo
          ? (() => { try { return JSON.parse(r.selected_logo as string) } catch { return null } })()
          : null
        return {
          id: r.campaign_id,
          tenant_id: r.tenant_id,
          location_id: null,
          name: r.name,
          theme: r.theme ?? null,
          objective: (r.objective as CampaignObjective) ?? 'awareness',
          status: (r.status as CampaignStatus) ?? 'draft',
          channels: (r.channels as string[] | null) ?? [],
          start_date: toDateStr(r.start_date),
          end_date: toDateStr(r.end_date),
          budget: null,
          color: r.campaign_color ?? null,
          campaign_hashtags: (r.campaign_hashtags as string[] | null) ?? [],
          created_at: '',
          updated_at: '',
          postCount: r.post_count,
          publishedCount: r.published_count,
          selected_assets: parsedAssets,
          selected_logo: parsedLogo,
          vehicles: parsedAssets.length > 0
            ? [...new Set(parsedAssets.map((a) => a.vehicle))]
            : (r.vehicle ? (r.vehicle as string).split(',').filter(Boolean) : []),
          posting_time: r.posting_time ?? null,
          goal: r.goal ?? null,
        }
      })
    } catch {
      return []
    }
  },
)

export const getDuckCampaignDays = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<import('./types').CampaignDay>> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      if (!tenantId) return []
      const { listAllCampaignDays } = await import('./analytics.duckdb')
      const rows = await listAllCampaignDays(tenantId)
      return rows.map((r) => ({
        campaign_id: r.campaign_id,
        date: typeof r.day_date === 'string' ? r.day_date.substring(0, 10) : String(r.day_date).substring(0, 10),
        day_num: r.day_num,
        theme: r.theme,
        vehicle: r.vehicle ?? undefined,
        headline: r.headline ?? undefined,
        subheadline: r.subheadline ?? undefined,
        caption: r.caption ?? undefined,
        hashtags: r.hashtags ?? undefined,
        cta: r.cta ?? undefined,
        offer: r.offer ?? undefined,
        content_status: (r.content_status as import('./types').ContentStatus) ?? 'pending',
        poster_url: r.poster_url ?? undefined,
      }))
    } catch {
      return []
    }
  },
)

// Direct post lookup by campaign_id — works for DuckDB-backed campaigns
// because it skips the Supabase campaigns table entirely.
export const getCampaignPosts = createServerFn({ method: 'GET' })
  .validator((d: { campaign_id: string }) => d)
  .handler(async ({ data }): Promise<Array<CampaignPost>> => {
    const supabase = getSupabaseServerClient()
    const { data: posts } = await supabase
      .from('campaign_posts')
      .select('*')
      .eq('campaign_id', data.campaign_id)
      .order('created_at', { ascending: false })
    return (posts ?? []) as Array<CampaignPost>
  })

export const getCampaign = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ campaign: Campaign; posts: Array<CampaignPost>; scorecard: CampaignScorecard | null } | null> => {
    const supabase = getSupabaseServerClient()
    const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', data.id).single()
    if (!campaign) return null
    const { data: posts } = await supabase.from('campaign_posts').select('*').eq('campaign_id', data.id).order('created_at', { ascending: false })
    const { data: ins } = await supabase.from('campaign_insights').select('*').eq('campaign_id', data.id).order('captured_at', { ascending: false }).limit(1).maybeSingle()
    return {
      campaign,
      posts: (posts ?? []) as Array<CampaignPost>,
      scorecard: ins ? ({ ...ins, campaign_name: campaign.name } as CampaignScorecard) : null,
    }
  })

export const getContentCalendar = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CampaignPost>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('campaign_posts')
      .select('*, campaign:campaigns(name)')
      .not('scheduled_at', 'is', null)
      .order('scheduled_at', { ascending: true })
    return (data ?? []).map((r: any) => {
      const { campaign, ...rest } = r
      return { ...rest, campaign_name: campaign?.name ?? null }
    })
  },
)

export const getApprovalQueue = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CampaignPost>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('campaign_posts')
      .select('*, campaign:campaigns(name)')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true })
    return (data ?? []).map((r: any) => {
      const { campaign, ...rest } = r
      return { ...rest, campaign_name: campaign?.name ?? null }
    })
  },
)

export const getCampaignScorecard = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<CampaignScorecard | null> => {
    const supabase = getSupabaseServerClient()
    const { data: ins } = await supabase.from('campaign_insights').select('*').eq('campaign_id', data.id).order('captured_at', { ascending: false }).limit(1).maybeSingle()
    if (!ins) return null
    const { data: c } = await supabase.from('campaigns').select('name').eq('id', data.id).single()
    return { ...ins, campaign_name: c?.name ?? 'Campaign' } as CampaignScorecard
  })

// =====================================================================
// AGENT 8 — Marketing Copilot (basic): rule-based NL recommendation.
// =====================================================================
export const marketingCopilot = createServerFn({ method: 'GET' })
  .validator((d: { question: string }) => d)
  .handler(async ({ data }): Promise<{ answer: string }> => {
    const supabase = getSupabaseServerClient()
    const { data: ins } = await supabase
      .from('campaign_insights')
      .select('campaign_id, leads_generated, conversion_rate, cost_per_lead, campaigns(name)')
      .order('leads_generated', { ascending: false })
    const rows = (ins ?? []) as any[]
    const q = data.question.toLowerCase()
    if (rows.length === 0) return { answer: 'No campaign performance data yet. Launch a campaign to see recommendations.' }
    const best = rows[0]
    const name = best.campaigns?.name ?? 'your top campaign'
    if (q.includes('best') || q.includes('perform')) {
      return { answer: `“${name}” performed best — ${best.leads_generated} leads at a ${Number(best.conversion_rate)}% conversion rate and ₹${best.cost_per_lead} cost per lead.` }
    }
    if (q.includes('next') || q.includes('should')) {
      return { answer: `Run a Magnite-focused festive campaign next — it’s your highest-intent vehicle. Mirror the structure of “${name}”, which delivered your best cost per lead.` }
    }
    if (q.includes('vehicle') || q.includes('promote')) {
      return { answer: 'Promote the Magnite (compact SUV) — it drives the most leads — and bundle the X-Trail for the premium SUV segment.' }
    }
    return { answer: `Your strongest campaign is “${name}” (${best.leads_generated} leads). Double down on that vehicle and festive timing.` }
  })

// =====================================================================
// Mutations — AGENTS 3,4,5,6 (Content / Poster / Compliance / Publishing)
// =====================================================================
export const createCampaign = createServerFn({ method: 'POST' })
  .validator((d: { name: string; theme?: string; objective?: string; channels?: Array<string>; start_date?: string; end_date?: string; budget?: number; color?: string; campaign_hashtags?: Array<string> }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { randomUUID } = await import('node:crypto')
    const id = randomUUID()
    const { upsertCampaign } = await import('./analytics.duckdb')
    await upsertCampaign({
      campaign_id: id, tenant_id: tenantId, name: data.name,
      objective: data.objective ?? 'awareness', status: 'draft',
      start_date: data.start_date ?? null, end_date: data.end_date ?? null,
      post_count: 0, published_count: 0, channels: data.channels ?? [],
      theme: data.theme ?? null, campaign_color: data.color ?? null,
      campaign_hashtags: data.campaign_hashtags ?? [],
      posting_time: null,
      vehicle: null,
      goal: null,
    })
    const campaign: CampaignSummary = {
      id, tenant_id: tenantId, location_id: null, name: data.name,
      theme: data.theme ?? null, objective: (data.objective ?? 'awareness') as CampaignObjective,
      status: 'draft', channels: data.channels ?? [],
      start_date: data.start_date ?? null, end_date: data.end_date ?? null,
      budget: data.budget ?? null, color: data.color ?? null,
      campaign_hashtags: data.campaign_hashtags ?? [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      postCount: 0, publishedCount: 0,
    }
    return { ok: true as const, campaign }
  })

export const deleteCampaignById = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { deleteCampaign } = await import('./analytics.duckdb')
    await deleteCampaign(data.id, tenantId)
    return { ok: true as const }
  })

// AGENT 3 — Content Generation: proxies to FastAPI /marketing/content/generate.
export const generateContent = createServerFn({ method: 'POST' })
  .validator((d: { campaign_id?: string; channel: PostChannel; vehicle: string; offer?: string; objective?: string; theme?: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId, userId } = await authCtx(supabase)

    const theme = data.theme ?? 'New Arrival'
    let ai: { headline?: string; subheadline?: string; caption?: string; hashtags?: string[]; cta?: string } | null = null
    try {
      const res = await fetch(`${FASTAPI_URL}/marketing/content/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle: data.vehicle, channel: data.channel, theme, offer: data.offer ?? null, objective: data.objective ?? null }),
      })
      if (res.ok) ai = await res.json()
    } catch { /* fall through to templates */ }

    const offerLine = data.offer ? ` ${data.offer}.` : ''
    const headline    = ai?.headline    ?? `Drive the Nissan ${data.vehicle}`
    const subheadline = ai?.subheadline ?? `Experience ${theme} today`
    const caption     = ai?.caption     ?? `🚗 The Nissan ${data.vehicle} is here.${offerLine} ${theme} — book your test drive today.`
    const hashtags    = ai?.hashtags    ?? ['#Nissan', `#Nissan${data.vehicle.replace(/\s+/g, '')}`, '#TestDrive', '#DriveNissan']
    const cta         = ai?.cta         ?? (data.objective === 'lead_gen' ? 'Book a Test Drive' : data.objective === 'offer' ? 'Claim This Offer' : 'Enquire Now')

    const { randomUUID } = await import('node:crypto')
    const postId = randomUUID()
    const { insertCampaignPost } = await import('./analytics.duckdb')
    await insertCampaignPost({
      post_id: postId,
      tenant_id: tenantId,
      campaign_id: data.campaign_id ?? null,
      title: headline,
      headline,
      subheadline,
      caption,
      cta,
      hashtags,
      channel: data.channel,
      status: 'draft',
      compliance: 'unchecked',
      vehicle: data.vehicle,
      offer: data.offer ?? null,
      created_by: userId,
    })
    return { ok: true as const, id: postId, headline, subheadline, caption, hashtags, cta }
  })

// AGENT 5 — Brand Compliance (basic rule checks).
export const runCompliance = createServerFn({ method: 'POST' })
  .validator((d: { post_id: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { data: post } = await supabase.from('campaign_posts').select('caption, hashtags, offer').eq('id', data.post_id).single()
    const flags: Array<string> = []
    const caption = post?.caption ?? ''
    const tags = (post?.hashtags ?? []) as Array<string>
    if (!/nissan/i.test(caption) && !tags.some((t) => /nissan/i.test(t))) flags.push('Missing Nissan branding')
    if (caption.length > 280) flags.push('Caption too long for the channel')
    const compliance = flags.length ? 'flagged' : 'approved'
    await supabase.from('campaign_posts').update({ compliance, updated_at: new Date().toISOString() }).eq('id', data.post_id)
    return { ok: true as const, compliance, flags }
  })

async function setStatus(post_id: string, status: PostStatus, extra: Record<string, unknown> = {}) {
  const supabase = getSupabaseServerClient()
  await authCtx(supabase)
  await supabase.from('campaign_posts').update({ status, updated_at: new Date().toISOString(), ...extra }).eq('id', post_id)
  return { ok: true as const, status }
}

export const submitForApproval = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => setStatus(data.id, 'pending_approval'))

export const approvePost = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { userId } = await authCtx(supabase)
    return setStatus(data.id, 'approved', { approved_by: userId })
  })

export const rejectPost = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => setStatus(data.id, 'rejected'))

export const requestChangesPost = createServerFn({ method: 'POST' })
  .validator((d: { id: string; feedback?: string }) => d)
  .handler(async ({ data }) => setStatus(data.id, 'draft'))

export const schedulePost = createServerFn({ method: 'POST' })
  .validator((d: { id: string; scheduled_at: string }) => d)
  .handler(async ({ data }) => setStatus(data.id, 'scheduled', { scheduled_at: data.scheduled_at }))

// AGENT 6 — Publishing (MOCKED): marks published, no real channel push.
export const publishPost = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => setStatus(data.id, 'published', { published_at: new Date().toISOString() }))

export const getPublishingQueue = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CampaignPost>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('campaign_posts')
      .select('*, campaign:campaigns(name)')
      .in('status', ['approved', 'scheduled'])
      .order('created_at', { ascending: true })
    return (data ?? []).map((r: any) => {
      const { campaign, ...rest } = r
      return { ...rest, campaign_name: campaign?.name ?? null }
    })
  },
)

export const getPublishedLog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CampaignPost>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('campaign_posts')
      .select('*, campaign:campaigns(name)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)
    return (data ?? []).map((r: any) => {
      const { campaign, ...rest } = r
      return { ...rest, campaign_name: campaign?.name ?? null }
    })
  },
)

// =====================================================================
// Media Library — DuckDB-backed (marketing_assets table)
// =====================================================================
import type { ChannelConnection, LinkedInProfileResult } from './types'

function duckAssetToMediaAsset(r: DuckAssetRow): MediaAsset {
  return {
    id: r.id, tenant_id: r.tenant_id, name: r.name,
    asset_type: r.asset_type, vehicle: r.vehicle ?? null,
    sub_category: r.sub_category ?? null, file_url: r.file_url,
    file_size: r.file_size ?? null, metadata: r.metadata ?? null,
    created_at: typeof r.created_at === 'string' ? r.created_at : String(r.created_at),
  }
}

export const getMediaAssets = createServerFn({ method: 'GET' })
  .validator((d: { asset_type?: string; vehicle?: string; search?: string } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<Array<MediaAsset>> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { listAssets } = await import('./analytics.duckdb')
    const rows = await listAssets(tenantId, data as { asset_type?: string; vehicle?: string; search?: string })
    return rows.map(duckAssetToMediaAsset)
  })

export const uploadAsset = createServerFn({ method: 'POST' })
  .validator((d: {
    file_b64: string; filename: string; name: string
    asset_type: 'vehicle' | 'logo' | 'background' | 'brand_asset'
    vehicle?: string; sub_category?: string; file_size?: number
  }) => d)
  .handler(async ({ data }): Promise<MediaAsset> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { randomUUID } = await import('node:crypto')
    const ext = (data.filename.split('.').pop() ?? 'jpg').toLowerCase()
    const bytes = Buffer.from(data.file_b64, 'base64')

    // Local dev runs against the DuckDB shim, which has no Storage API — write to
    // disk (writable locally). Real Supabase → Storage bucket (Vercel's FS is
    // read-only, so disk writes there fail with ENOENT).
    const sbUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
    const isLocalShim = /localhost|127\.0\.0\.1/.test(sbUrl)

    let fileUrl: string
    if (isLocalShim) {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const fname = `${randomUUID()}.${ext}`
      const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads')
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
      fs.writeFileSync(path.join(uploadsDir, fname), bytes)
      fileUrl = `/uploads/${fname}`
    } else {
      const objectPath = `${tenantId}/${randomUUID()}.${ext}`
      const contentType =
        ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
        : ext === 'svg' ? 'image/svg+xml'
        : ext === 'gif' ? 'image/gif'
        : 'image/jpeg'
      const { error: upErr } = await supabase.storage
        .from('media')
        .upload(objectPath, bytes, { contentType, upsert: false })
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`)
      fileUrl = supabase.storage.from('media').getPublicUrl(objectPath).data.publicUrl
    }

    const row: DuckAssetRow = {
      id: randomUUID(), tenant_id: tenantId, name: data.name,
      asset_type: data.asset_type, vehicle: data.vehicle ?? null,
      sub_category: data.sub_category ?? null,
      file_url: fileUrl, file_size: data.file_size ?? bytes.length,
      metadata: null, created_at: new Date().toISOString(),
    }
    const { upsertAsset } = await import('./analytics.duckdb')
    await upsertAsset(row)
    return duckAssetToMediaAsset(row)
  })

export const deleteAsset = createServerFn({ method: 'POST' })
  .validator((d: { assetId: string; file_url: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    // Remove the underlying file (best-effort; the DB row removal below is the
    // source of truth). Local dev files are on disk (/uploads/...); prod files
    // are Supabase Storage objects (.../object/public/media/<objectPath>).
    try {
      if (data.file_url.startsWith('/uploads/')) {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const filePath = path.resolve(process.cwd(), 'public', data.file_url.replace(/^\//, ''))
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } else {
        const marker = '/media/'
        const idx = data.file_url.indexOf(marker)
        if (idx !== -1) {
          await supabase.storage.from('media').remove([data.file_url.slice(idx + marker.length)])
        }
      }
    } catch {
      /* best-effort */
    }
    const { deleteAssetRow } = await import('./analytics.duckdb')
    await deleteAssetRow(data.assetId, tenantId)
    return { ok: true }
  })

export const getAssets = createServerFn({ method: 'GET' })
  .validator((d: { vehicle?: string; asset_type?: string } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<Array<MediaAsset>> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { listAssets } = await import('./analytics.duckdb')
    const rows = await listAssets(tenantId, data as { vehicle?: string; asset_type?: string })
    return rows.map(duckAssetToMediaAsset)
  })

// =====================================================================
// Connected Channels — OAuth integration for Instagram, Facebook, etc.
// =====================================================================
const MOCK_CHANNEL_STATUS: Array<ChannelConnection> = [
  { channel: 'instagram', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'facebook', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'google_business', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'whatsapp', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'linkedin', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'x', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'youtube', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'telegram', status: 'disconnected', handle: null, last_sync: null },
  { channel: 'threads', status: 'disconnected', handle: null, last_sync: null },
]

/**
 * Fetch channel connection status from Supabase.
 * Maps database records to ChannelConnection format.
 */
export const getChannelStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<ChannelConnection>> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)

      // Connections are persisted by the FastAPI backend in a local store
      // (no cloud Supabase needed for the connected-channels feature).
      const response = await fetch(`${FASTAPI_URL}/api/channels?tenant_id=${tenantId}`)
      if (!response.ok) {
        console.error('[getChannelStatus] backend error:', response.statusText)
        return MOCK_CHANNEL_STATUS
      }
      const connections = (await response.json()) as Array<ChannelConnection>
      return Array.isArray(connections) && connections.length > 0
        ? connections
        : MOCK_CHANNEL_STATUS
    } catch (e) {
      console.error('[getChannelStatus] Error (is the API on :8000?):', e)
      return MOCK_CHANNEL_STATUS
    }
  },
)

export const getInstagramConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    // Uses the /auth/instagram/login flow which returns full JSON payload
    // (facebook_user_id, page_id, instagram_business_account_id, access_token)
    // and stores it in localStorage via the callback HTML page.
    return `${FASTAPI_URL}/auth/instagram/login?tenant_id=${tenantId}`
  },
)

/**
 * Disconnect Instagram channel.
 */
export const disconnectInstagram = createServerFn({ method: 'POST' })
  .validator((d: { channel_id: string }) => d)
  .handler(async ({ data }): Promise<{ status: string; message: string }> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)

      // Call FastAPI endpoint to disconnect
      const response = await fetch(`${FASTAPI_URL}/api/instagram/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          channel_id: data.channel_id,
        }),
      })

      if (!response.ok) {
        throw new Error(`Disconnect failed: ${response.statusText}`)
      }

      const result = await response.json()
      return result as { status: string; message: string }
    } catch (e) {
      console.error('[disconnectInstagram] Error:', e)
      throw new Error(`Failed to disconnect Instagram: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
)

export const syncChannelConnection = createServerFn({ method: 'POST' })
  .validator((d: { channel: string }) => d)
  .handler(async ({ data }): Promise<{ status: string; last_sync: string }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const endpoint = data.channel === 'linkedin'
      ? `${FASTAPI_URL}/api/linkedin/sync`
      : `${FASTAPI_URL}/api/instagram/sync`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, string>
      throw new Error(body['detail'] ?? `Sync failed: ${response.statusText}`)
    }
    return response.json() as Promise<{ status: string; last_sync: string }>
  })

export const getLinkedInConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    return `${FASTAPI_URL}/auth/linkedin/login?tenant_id=${tenantId}`
  },
)

/**
 * Check LinkedIn connection + validate the stored token live.
 * Drives the "check before OAuth" flow: returns state + profile.
 */
export const getLinkedInProfile = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LinkedInProfileResult> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      const response = await fetch(`${FASTAPI_URL}/api/linkedin/profile?tenant_id=${tenantId}`)
      if (!response.ok) {
        return { state: 'error', profile: null }
      }
      return (await response.json()) as LinkedInProfileResult
    } catch (e) {
      console.error('[getLinkedInProfile] Error (is the API on :8000?):', e)
      return { state: 'error', profile: null }
    }
  },
)

export const disconnectLinkedIn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ status: string; message: string }> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      const response = await fetch(`${FASTAPI_URL}/api/linkedin/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      })
      if (!response.ok) {
        throw new Error(`Disconnect failed: ${response.statusText}`)
      }
      return response.json() as Promise<{ status: string; message: string }>
    } catch (e) {
      throw new Error(`Failed to disconnect LinkedIn: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
)

/**
 * Publish a creative to every connected channel (LinkedIn real; IG/FB graceful).
 * Returns a per-platform status map. One platform's failure does not block others.
 */
export const publishToConnectedChannels = createServerFn({ method: 'POST' })
  .validator((d: {
    caption: string
    image_url?: string
    image_base64?: string
    title?: string
    description?: string
    platforms?: Array<string>
  }) => d)
  .handler(async ({ data }): Promise<PublishResult> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const response = await fetch(`${FASTAPI_URL}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, ...data }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, string>
      throw new Error(body['detail'] ?? `Publish failed: ${response.statusText}`)
    }
    return (await response.json()) as PublishResult
  })

/**
 * Publish an approved group (a campaign = all its days, or one event) to the
 * caller's CONNECTED social channels via the FastAPI fan-out, then flip the
 * DuckDB publish status so the Publishing queue reflects it.
 *
 * - Loads the group's posts from the DuckDB publishing store.
 * - For each post, POST /api/publish with the selected platforms. The backend
 *   re-validates each channel's connection and skips disconnected ones, so a
 *   disconnected channel is never actually pushed to.
 * - Aggregates a per-channel success/skipped/error tally across all posts.
 * One platform failing never blocks the others or the status flip.
 */
export const publishGroupToConnected = createServerFn({ method: 'POST' })
  .validator((d: { kind: 'campaign' | 'event'; group_id: string; platforms: Array<string> }) => d)
  .handler(async ({ data }): Promise<{
    perChannel: Record<string, { success: number; skipped: number; error: number; message: string | null }>
    postCount: number
  }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)

    const { listPublishingDb, publishCampaignDb, publishEventDb } = await import('./analytics.duckdb')
    const all = await listPublishingDb(tenantId)
    const posts = all.filter((r) => r.kind === data.kind && r.group_id === data.group_id)

    const perChannel: Record<string, { success: number; skipped: number; error: number; message: string | null }> = {}
    const bump = (plat: string, key: 'success' | 'skipped' | 'error', msg?: string | null) => {
      perChannel[plat] ??= { success: 0, skipped: 0, error: 0, message: null }
      perChannel[plat][key] += 1
      // Keep the first error message / skip reason surfaced for this channel.
      if (!perChannel[plat].message && msg && key !== 'success') perChannel[plat].message = msg
    }

    for (const p of posts) {
      const poster = p.poster_url ?? null
      const body: Record<string, unknown> = {
        tenant_id: tenantId,
        caption: [p.caption, (p.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n'),
        title: p.headline ?? p.theme ?? '',
        description: p.subheadline ?? '',
        platforms: data.platforms,
      }
      // Gemini posters are data: URLs (the backend can't fetch those) — send
      // them inline as base64; backend-hosted http(s) URLs go through image_url.
      if (poster?.startsWith('data:')) body['image_base64'] = poster
      else if (poster) body['image_url'] = poster

      try {
        const res = await fetch(`${FASTAPI_URL}/api/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => res.statusText)
          for (const plat of data.platforms) bump(plat, 'error', `Publish API ${res.status}: ${detail}`)
          continue
        }
        const json = (await res.json()) as PublishResult
        for (const [plat, r] of Object.entries(json)) {
          const key = r.status === 'success' ? 'success' : r.status === 'error' ? 'error' : 'skipped'
          bump(plat, key, r.error ?? r.reason ?? null)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Network error reaching publish API'
        for (const plat of data.platforms) bump(plat, 'error', msg)
      }
    }

    // Move the group into the Published column regardless of per-channel outcome
    // (preserves the existing publishCampaign/publishEvent queue behaviour).
    if (data.kind === 'campaign') await publishCampaignDb(data.group_id, tenantId)
    else await publishEventDb(data.group_id, tenantId)

    return { perChannel, postCount: posts.length }
  })

// =====================================================================
// =====================================================================
// Campaign Planner Agent
// =====================================================================

const GOAL_TO_OBJECTIVE: Record<string, CampaignObjective> = {
  'Lead Generation': 'lead_gen',
  'Test Drive Booking': 'lead_gen',
  'Brand Awareness': 'awareness',
  'Sales Promotion': 'offer',
  'Service Promotion': 'awareness',
  'Customer Retention': 'awareness',
}

export const generateCampaignPlan = createServerFn({ method: 'POST' })
  .validator((d: CampaignPlanInput) => d)
  .handler(async ({ data }): Promise<CampaignPlanResult> => {
    const res = await fetch(`${FASTAPI_URL}/marketing/campaigns/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign_name: data.campaign_name,
        campaign_type: data.campaign_type,
        vehicles: data.vehicles ?? [],
        goal: data.goal,
        start_date: data.start_date,
        end_date: data.end_date,
        posting_time: data.posting_time ?? null,
        notes: data.notes ?? null,
        selected_assets:
          data.selected_assets?.map((a) => ({
            vehicle: a.vehicle,
            asset_id: a.asset_id,
            file_url: a.file_url ?? null,
          })) ?? [],
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new Error(`[FastAPI] campaign plan failed: ${res.status} ${errText}`)
    }
    const json = (await res.json()) as {
      days: Array<{
        day_num: number
        date: string
        theme: string
        vehicle?: string | null
        asset_id?: string | null
      }>
    }
    return {
      campaign_name: data.campaign_name,
      campaign_type: data.campaign_type,
      vehicles: data.vehicles,
      goal: data.goal,
      start_date: data.start_date,
      end_date: data.end_date,
      posting_time: data.posting_time,
      campaign_color: data.campaign_color ?? null,
      selected_assets: data.selected_assets ?? [],
      selected_logo: data.selected_logo ?? null,
      days: json.days.map((d) => ({
        date: d.date,
        day_num: d.day_num,
        theme: d.theme,
        vehicle: d.vehicle ?? undefined,
      })),
    }
  })

export const createCampaignFromPlan = createServerFn({ method: 'POST' })
  .validator((d: CampaignPlanResult) => d)
  .handler(async ({ data }): Promise<{ ok: true; campaign_id: string; day_count: number }> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      const { randomUUID } = await import('node:crypto')
      const campaignId = randomUUID()
      const { upsertCampaign, upsertCampaignDays } = await import('./analytics.duckdb')
      const vehicleList = data.selected_assets?.length
        ? [...new Set(data.selected_assets.map((a) => a.vehicle))]
        : (data.vehicles ?? [])
      await upsertCampaign({
        campaign_id: campaignId,
        tenant_id: tenantId,
        name: data.campaign_name,
        objective: GOAL_TO_OBJECTIVE[data.goal] ?? 'awareness',
        status: 'draft',
        start_date: data.start_date ?? null,
        end_date: data.end_date ?? null,
        post_count: data.days.length,
        published_count: 0,
        channels: [],
        theme: null,
        campaign_color: data.campaign_color ?? null,
        campaign_hashtags: [],
        posting_time: data.posting_time ?? null,
        vehicle: vehicleList.join(',') || null,
        goal: data.goal ?? null,
        selected_assets: data.selected_assets?.length
          ? JSON.stringify(data.selected_assets)
          : null,
        selected_logo: data.selected_logo
          ? JSON.stringify(data.selected_logo)
          : null,
      })
      if (data.days.length > 0) {
        await upsertCampaignDays(data.days.map((d2) => ({
          campaign_id: campaignId,
          tenant_id: tenantId,
          day_date: d2.date,
          day_num: Number(d2.day_num),
          theme: String(d2.theme),
          vehicle: d2.vehicle ?? null,
        })))

        // Batch-generate post content for every day in one move, then persist
        // it onto each campaign_day. Wizard waits for this to finish.
        const { updateDayContent } = await import('./analytics.duckdb')
        const content = await fetchBatchContent(
          { campaign_name: data.campaign_name, goal: data.goal, vehicles: vehicleList },
          data.days.map((d2, i) => ({
            idx: i,
            date: d2.date,
            theme: d2.theme,
            vehicle: d2.vehicle ?? null,
          })),
        )
        for (let i = 0; i < content.length; i++) {
          const c = content[i]
          const day = data.days[i]
          if (!c || !day) continue
          await updateDayContent(campaignId, tenantId, day.date, {
            headline: c.headline,
            subheadline: c.subheadline,
            caption: c.caption,
            hashtags: c.hashtags,
            cta: c.cta,
            content_status: 'generated',
          })
        }
      }
      return { ok: true, campaign_id: campaignId, day_count: data.days.length }
    } catch (e) {
      console.error('[createCampaignFromPlan] failed:', e)
      throw e
    }
  })

// =====================================================================
// Monthly Events — calendar opportunities + AI post content (auto on view).
// Fetches Calendarific opportunities, persists them, and batch-generates
// post content for any event still pending. Idempotent: already-generated
// events are skipped (no repeat Gemini spend).
// =====================================================================

export const getMonthEvents = createServerFn({ method: 'GET' })
  .validator((d: { month: number; year: number }) => d)
  .handler(async ({ data }): Promise<MonthPlan> => {
    const month = Math.min(12, Math.max(1, data.month || 1))
    const year = data.year || new Date().getFullYear()
    const empty: MonthPlan = { month, label: MONTH_LABEL[month], opportunities: [] }
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      if (!tenantId) return empty

      // 1. Live calendar opportunities (Calendarific via FastAPI)
      let live: Array<MonthOpportunity> = []
      try {
        const res = await fetch(`${FASTAPI_URL}/marketing/calendar/month-plan?month=${month}&year=${year}`)
        if (res.ok) {
          const json = (await res.json()) as { opportunities: Array<MonthOpportunity> }
          live = json.opportunities ?? []
        }
      } catch { /* fall back to persisted rows */ }

      const { upsertOpportunities, listOpportunities, updateOpportunityContent } = await import('./analytics.duckdb')
      const oppId = (o: { date: string; name: string }) => `${tenantId}_${o.date}_${o.name.replace(/\s+/g, '_')}`

      // 2. Persist metadata (idempotent; preserves existing content)
      if (live.length > 0) {
        await upsertOpportunities(live.map((o) => ({
          id: oppId(o), tenant_id: tenantId, month, year,
          date: o.date, name: o.name, kind: o.kind, theme: o.theme, suggestion: o.suggestion,
        })))
      }

      // 3. Read persisted rows (carry content + status)
      const rows = await listOpportunities(tenantId, month, year)
      if (rows.length === 0) return { ...empty, opportunities: live }

      // 4. Generate content for still-pending events — one batch call
      const pending = rows.filter((r) => (r.content_status ?? 'pending') === 'pending')
      if (pending.length > 0) {
        const content = await fetchBatchContent(
          { campaign_name: `${MONTH_LABEL[month]} Events`, goal: 'Brand Awareness' },
          pending.map((r, i) => ({ idx: i, date: r.date, theme: r.name, vehicle: null })),
        )
        for (let i = 0; i < content.length; i++) {
          const c = content[i]; const r = pending[i]
          if (!c || !r) continue
          await updateOpportunityContent(r.id, tenantId, {
            headline: c.headline, subheadline: c.subheadline, caption: c.caption,
            hashtags: c.hashtags, cta: c.cta, content_status: 'generated',
          })
          Object.assign(r, {
            headline: c.headline, subheadline: c.subheadline, caption: c.caption,
            hashtags: c.hashtags, cta: c.cta, content_status: 'generated',
          })
        }
      }

      // 5. Return merged opportunities (with content)
      return {
        month, label: MONTH_LABEL[month],
        opportunities: rows.map((r) => ({
          id: r.id,
          date: typeof r.date === 'string' ? r.date.substring(0, 10) : String(r.date).substring(0, 10),
          name: r.name,
          kind: (r.kind as OpportunityKind) ?? 'dealership',
          theme: r.theme,
          suggestion: r.suggestion,
          headline: r.headline ?? undefined,
          subheadline: r.subheadline ?? undefined,
          caption: r.caption ?? undefined,
          hashtags: r.hashtags ?? undefined,
          cta: r.cta ?? undefined,
          content_status: (r.content_status as ContentStatus) ?? 'pending',
          poster_url: r.poster_url ?? undefined,
        })),
      }
    } catch (e) {
      console.error('[getMonthEvents] failed:', e)
      return empty
    }
  })

// =====================================================================
// Content review — persist human edits + per-field AI suggestions.
// =====================================================================

export const saveDayContent = createServerFn({ method: 'POST' })
  .validator((d: {
    campaign_id: string; day_date: string
    headline?: string; subheadline?: string; caption?: string
    hashtags?: Array<string>; cta?: string; content_status?: ContentStatus
    selected_channels?: Array<string>
  }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { updateDayContent } = await import('./analytics.duckdb')
    await updateDayContent(data.campaign_id, tenantId, data.day_date, {
      headline: data.headline, subheadline: data.subheadline, caption: data.caption,
      hashtags: data.hashtags, cta: data.cta, content_status: data.content_status ?? 'edited',
      selected_channels: data.selected_channels,
    })
    return { ok: true }
  })

export const saveEventContent = createServerFn({ method: 'POST' })
  .validator((d: {
    id: string
    headline?: string; subheadline?: string; caption?: string
    hashtags?: Array<string>; cta?: string; content_status?: ContentStatus
    selected_channels?: Array<string>
  }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { updateOpportunityContent } = await import('./analytics.duckdb')
    await updateOpportunityContent(data.id, tenantId, {
      headline: data.headline, subheadline: data.subheadline, caption: data.caption,
      hashtags: data.hashtags, cta: data.cta, content_status: data.content_status ?? 'edited',
      selected_channels: data.selected_channels,
    })
    return { ok: true }
  })

export const suggestField = createServerFn({ method: 'POST' })
  .validator((d: {
    field: string; vehicle?: string; theme?: string
    channel?: string; campaign_name?: string; current?: string
  }) => d)
  .handler(async ({ data }): Promise<{ value: string | Array<string> }> => {
    const empty = data.field === 'hashtags' ? [] : ''
    try {
      const res = await fetch(`${FASTAPI_URL}/marketing/content/suggest-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: data.field,
          vehicle: data.vehicle ?? 'Nissan',
          theme: data.theme ?? '',
          channel: data.channel ?? 'social media',
          campaign_name: data.campaign_name ?? '',
          current: data.current ?? '',
        }),
      })
      if (!res.ok) return { value: empty }
      const json = (await res.json()) as { value: string | Array<string> }
      return { value: json.value ?? empty }
    } catch {
      return { value: empty }
    }
  })

// Generate (or regenerate) all content fields for ONE campaign day.
export const generateDayContent = createServerFn({ method: 'POST' })
  .validator((d: {
    campaign_id: string; day_date: string; theme?: string; vehicle?: string
    campaign_name?: string; goal?: string
  }) => d)
  .handler(async ({ data }): Promise<BatchItemOut | null> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const out = await fetchBatchContent(
      { campaign_name: data.campaign_name, goal: data.goal, vehicles: data.vehicle ? [data.vehicle] : [] },
      [{ idx: 0, date: data.day_date, theme: data.theme, vehicle: data.vehicle ?? null }],
    )
    const c = out[0]
    if (!c) return null
    const { updateDayContent } = await import('./analytics.duckdb')
    await updateDayContent(data.campaign_id, tenantId, data.day_date, {
      headline: c.headline, subheadline: c.subheadline, caption: c.caption,
      hashtags: c.hashtags, cta: c.cta, content_status: 'generated',
    })
    return c
  })

// Generate (or regenerate) all content fields for ONE calendar event.
export const generateEventContent = createServerFn({ method: 'POST' })
  .validator((d: { id: string; name?: string; date?: string }) => d)
  .handler(async ({ data }): Promise<BatchItemOut | null> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const out = await fetchBatchContent(
      { campaign_name: 'Monthly Events', goal: 'Brand Awareness' },
      [{ idx: 0, date: data.date, theme: data.name, vehicle: null }],
    )
    const c = out[0]
    if (!c) return null
    const { updateOpportunityContent } = await import('./analytics.duckdb')
    await updateOpportunityContent(data.id, tenantId, {
      headline: c.headline, subheadline: c.subheadline, caption: c.caption,
      hashtags: c.hashtags, cta: c.cta, content_status: 'generated',
    })
    return c
  })

// =====================================================================
// AI Poster — Gemini 3 image: real car photo composited on a festive scene.
// =====================================================================

export const generatePosterImage = createServerFn({ method: 'POST' })
  .validator((d: {
    kind: 'day' | 'event'
    campaign_id?: string; day_date?: string; day_num?: number; event_id?: string
    title?: string; theme: string; headline: string
    vehicle?: string; asset_url?: string | null
    logo_url?: string | null         // user-selected logo — passed as-is to Gemini
    instructions?: string            // extra user art-direction / refine comment
    mode?: 'create' | 'refine'
    base_poster_url?: string | null  // existing poster to edit when mode='refine'
    force_regenerate?: boolean       // skip FastAPI disk cache; always call Gemini
  }) => d)
  .handler(async ({ data }): Promise<{ ok: true; url: string; path: string }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const nodePath = await import('node:path')
    const { readFile } = await import('node:fs/promises')

    const mode = data.mode ?? 'create'
    let imageB64: string | null = null
    let imageMime = 'image/jpeg'
    let logoB64: string | null = null
    let logoMime = 'image/png'

    if (mode === 'refine' && data.base_poster_url) {
      // Refine: the input image is the EXISTING poster (served by FastAPI).
      try {
        const res = await fetch(data.base_poster_url)
        if (res.ok) {
          imageB64 = Buffer.from(await res.arrayBuffer()).toString('base64')
          imageMime = res.headers.get('content-type')?.includes('png') ? 'image/png' : 'image/jpeg'
        }
      } catch (e) {
        console.warn('[generatePosterImage] base poster fetch failed:', e)
      }
      if (!imageB64) throw new Error('Could not load the existing poster to refine — regenerate it first.')
    } else {
      // Create: resolve the car photo — campaign asset for days; most recent
      // vehicle upload for events (and as day fallback). Uploads stay web-side.
      let assetUrl = data.asset_url ?? null
      if (!assetUrl) {
        try {
          const { listAssets } = await import('./analytics.duckdb')
          const assets = await listAssets(tenantId, { asset_type: 'vehicle' })
          assetUrl = assets[0]?.file_url ?? null
        } catch { /* generate without a car photo */ }
      }
      if (assetUrl?.startsWith('/')) {
        try {
          const filePath = nodePath.resolve(process.cwd(), 'public', assetUrl.replace(/^\//, ''))
          const buf = await readFile(filePath)
          imageB64 = buf.toString('base64')
          imageMime = assetUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        } catch (e) {
          console.warn('[generatePosterImage] asset read failed, text-only generation:', e)
        }
      }

      // Load user-selected logo — highest priority branding, must arrive before car photo.
      const logoUrl = data.logo_url ?? null
      if (logoUrl?.startsWith('/')) {
        try {
          const logoPath = nodePath.resolve(process.cwd(), 'public', logoUrl.replace(/^\//, ''))
          const buf = await readFile(logoPath)
          logoB64 = buf.toString('base64')
          logoMime = logoUrl.toLowerCase().endsWith('.jpg') || logoUrl.toLowerCase().endsWith('.jpeg')
            ? 'image/jpeg' : 'image/png'
        } catch (e) {
          console.warn('[generatePosterImage] logo read failed, generating without logo:', e)
        }
      }
    }

    // FastAPI generates + SAVES the poster under a structured backend folder.
    const res = await fetch(`${FASTAPI_URL}/marketing/poster/banner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: data.kind === 'day' ? 'campaign' : 'event',
        title: data.title ?? '',
        theme: data.theme,
        headline: data.headline,
        vehicle: data.vehicle ?? null,
        image_b64: imageB64,
        image_mime: imageMime,
        logo_b64: logoB64,
        logo_mime: logoMime,
        instructions: data.instructions ?? null,
        mode,
        force_regenerate: data.force_regenerate ?? false,
        campaign_id: data.campaign_id ?? null,
        event_id: data.event_id ?? null,
        day_num: data.day_num ?? null,
        day_date: data.day_date ?? null,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText)
      throw new Error(`Poster generation failed: ${detail.slice(0, 200)}`)
    }
    const json = (await res.json()) as { image_b64: string; mime: string; path: string }

    // Absolute backend URL (served by FastAPI /posters) — persisted on the row.
    // ?v= busts the browser cache when a refine overwrites the same file.
    const posterUrl = json.path ? `${FASTAPI_URL}${json.path}?v=${Date.now()}` : ''
    if (posterUrl) {
      try {
        const { updateDayContent, updateOpportunityContent } = await import('./analytics.duckdb')
        if (data.kind === 'day' && data.campaign_id && data.day_date) {
          await updateDayContent(data.campaign_id, tenantId, data.day_date, { poster_url: posterUrl })
        } else if (data.kind === 'event' && data.event_id) {
          await updateOpportunityContent(data.event_id, tenantId, { poster_url: posterUrl })
        }
      } catch (e) {
        // DB write failed — poster is on disk, frontend cache still gets the data URL below
        console.warn('[generatePosterImage] poster_url DB write failed:', e)
      }
    }

    // Data URL for instant display; absolute path for persistence/reload.
    return { ok: true, url: `data:${json.mime};base64,${json.image_b64}`, path: posterUrl }
  })

// =====================================================================
// Publishing pipeline — approve (→ queue), reject, publish. DuckDB-backed.
// =====================================================================

// Normalise a stored posting time ("10:00 AM" / "22:00" / "9:5") → "HH:MM".
function parseTimeToHHMM(s?: string | null): string {
  if (!s) return '10:00'
  const t = s.trim()
  let m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (m) {
    let h = parseInt(m[1]!, 10) % 12
    if (/[Pp]/.test(m[3]!)) h += 12
    return `${String(h).padStart(2, '0')}:${m[2]}`
  }
  m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (m) return `${m[1]!.padStart(2, '0')}:${m[2]}`
  return '10:00'
}

export const approveCampaign = createServerFn({ method: 'POST' })
  .validator((d: { campaign_id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { listCampaigns, approveCampaignDb } = await import('./analytics.duckdb')
    const camps = await listCampaigns(tenantId)
    const camp = camps.find((c) => c.campaign_id === data.campaign_id)
    const postTime = parseTimeToHHMM(camp?.posting_time)
    await approveCampaignDb(data.campaign_id, tenantId, postTime)
    return { ok: true }
  })

export const rejectCampaign = createServerFn({ method: 'POST' })
  .validator((d: { campaign_id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { rejectCampaignDb } = await import('./analytics.duckdb')
    await rejectCampaignDb(data.campaign_id, tenantId)
    return { ok: true }
  })

export const publishCampaign = createServerFn({ method: 'POST' })
  .validator((d: { campaign_id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { publishCampaignDb } = await import('./analytics.duckdb')
    await publishCampaignDb(data.campaign_id, tenantId)
    return { ok: true }
  })

export const approveEvent = createServerFn({ method: 'POST' })
  .validator((d: { id: string; post_time?: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { approveEventDb } = await import('./analytics.duckdb')
    await approveEventDb(data.id, tenantId, parseTimeToHHMM(data.post_time))
    return { ok: true }
  })

export const rejectEvent = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { rejectEventDb } = await import('./analytics.duckdb')
    await rejectEventDb(data.id, tenantId)
    return { ok: true }
  })

export const publishEvent = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const { publishEventDb } = await import('./analytics.duckdb')
    await publishEventDb(data.id, tenantId)
    return { ok: true }
  })

export const getPublishing = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<PublishingItem>> => {
    try {
      const supabase = getSupabaseServerClient()
      const { tenantId } = await authCtx(supabase)
      if (!tenantId) return []
      const { listPublishingDb } = await import('./analytics.duckdb')
      const rows = await listPublishingDb(tenantId)
      return rows.map((r) => ({
        kind: r.kind,
        group_id: r.group_id,
        title: r.title ?? (r.kind === 'event' ? 'Event' : 'Campaign'),
        day_num: r.day_num,
        date: typeof r.date === 'string' ? r.date.substring(0, 10) : String(r.date).substring(0, 10),
        theme: r.theme ?? undefined,
        vehicle: r.vehicle ?? undefined,
        headline: r.headline ?? null,
        caption: r.caption ?? null,
        hashtags: r.hashtags ?? null,
        cta: r.cta ?? null,
        scheduled_at: r.scheduled_at ?? null,
        publish_status: (r.publish_status as PublishStatus) ?? 'queued',
        published_at: r.published_at ?? null,
      }))
    } catch (e) {
      console.error('[getPublishing] failed:', e)
      return []
    }
  },
)

// =====================================================================
// DuckDB Analytics — snapshot campaign planner page to analytical store
// =====================================================================

export const snapshotCampaignPlannerPage = createServerFn({ method: 'POST' })
  .validator((d: {
    month: number
    year: number
    campaigns: Array<{
      id: string; name: string; objective: string; status: string
      start_date: string | null; end_date: string | null
      postCount: number; publishedCount: number; channels: string[]
    }>
    opportunities: Array<{
      date: string; name: string; kind: string; theme: string; suggestion: string
    }>
  }) => d)
  .handler(async ({ data }) => {
    const { upsertCampaigns, upsertOpportunities } = await import('./analytics.duckdb')
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)

    await upsertCampaigns(
      data.campaigns.map((c) => ({
        campaign_id: c.id,
        tenant_id: tenantId,
        name: c.name,
        objective: c.objective,
        status: c.status,
        start_date: c.start_date ?? null,
        end_date: c.end_date ?? null,
        post_count: c.postCount,
        published_count: c.publishedCount,
        channels: c.channels ?? [],
        theme: null,
        campaign_color: null,
        campaign_hashtags: [],
        posting_time: null,
        vehicle: null,
        goal: null,
      })),
    )

    await upsertOpportunities(
      data.opportunities.map((o) => ({
        id: `${tenantId}_${o.date}_${o.name.replace(/\s+/g, '_')}`,
        tenant_id: tenantId,
        month: data.month,
        year: data.year,
        date: o.date,
        name: o.name,
        kind: o.kind,
        theme: o.theme,
        suggestion: o.suggestion,
      })),
    )

    return { ok: true, campaigns_saved: data.campaigns.length, opportunities_saved: data.opportunities.length }
  })

export const queryCampaignAnalytics = createServerFn({ method: 'GET' })
  .validator((d: { month?: number; year?: number }) => d)
  .handler(async () => {
    const { listCampaigns, queryObjectiveBreakdown } = await import('./analytics.duckdb')
    const supabase = getSupabaseServerClient()
    const { tenantId } = await authCtx(supabase)
    const [rows, breakdown] = await Promise.all([
      listCampaigns(tenantId),
      queryObjectiveBreakdown(tenantId),
    ])
    return { rows, breakdown }
  })

// ── Campaign wizard AI-suggest helpers (FastAPI / NVIDIA NIM) ────────────────

export const suggestCampaignDescription = createServerFn({ method: 'POST' })
  .validator((d: { campaign_name: string; campaign_type: string; occasion?: string }) => d)
  .handler(async ({ data }): Promise<string | null> => {
    try {
      const res = await fetch(`${FASTAPI_URL}/marketing/campaign/suggest-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_name: data.campaign_name,
          campaign_type: data.campaign_type,
          occasion: data.occasion ?? '',
        }),
      })
      if (!res.ok) return null
      const json = await res.json() as { description: string | null }
      return json.description ?? null
    } catch {
      return null
    }
  })

export const suggestCampaignHashtags = createServerFn({ method: 'POST' })
  .validator((d: { campaign_name: string; campaign_type: string; region?: string; occasion?: string }) => d)
  .handler(async ({ data }): Promise<string[] | null> => {
    try {
      const res = await fetch(`${FASTAPI_URL}/marketing/campaign/suggest-hashtags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_name: data.campaign_name,
          campaign_type: data.campaign_type,
          region: data.region ?? 'Tamil Nadu',
          occasion: data.occasion ?? '',
        }),
      })
      if (!res.ok) return null
      const json = await res.json() as { hashtags: string[] }
      return Array.isArray(json.hashtags) ? json.hashtags : null
    } catch {
      return null
    }
  })
