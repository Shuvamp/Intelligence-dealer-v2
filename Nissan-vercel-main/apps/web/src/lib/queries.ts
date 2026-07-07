import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import { resolveAnalyticsRange } from './marketing'
import type { AnalyticsRange } from './marketing'
import {
  BOARD_COLUMN_FOR_STAGE, BOARD_STAGES, CLOSED_STAGES, LEAD_STAGE_LABEL, WON_STAGES,
} from './types'
import type {
  AuditRow, CampaignPost, Customer, LeadStage, NotificationRow,
} from './types'

export interface DashboardMetrics {
  hotLeads: number
  testDrives: number
  campaignsScheduled: number
  pipelineValue: number
}

export interface DashboardData {
  customerCount: number
  unreadNotifications: number
  notifications: Array<NotificationRow>
  activity: Array<AuditRow>
  metrics: DashboardMetrics
}

// All reads go through the request-scoped client, so RLS restricts everything
// to the caller's tenant automatically.
export const getDashboardData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardData> => {
    const supabase = getSupabaseServerClient()

    const [{ count }, notifRes, auditRes, leadsRes, testDrivesRes, scheduledRes] =
      await Promise.all([
        supabase.from('customers').select('*', { count: 'exact', head: true }),
        supabase
          .from('notifications')
          .select('id, title, message, status, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase
          .from('audit_logs')
          .select('id, action, entity_type, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase.from('leads').select('score, stage, budget'),
        supabase.from('lead_events').select('*', { count: 'exact', head: true }).eq('type', 'test_drive'),
        supabase.from('campaign_posts').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
      ])

    const notifications = (notifRes.data ?? []) as Array<NotificationRow>
    const leads = (leadsRes.data ?? []) as Array<{ score: string; stage: string; budget: number | null }>
    const open = leads.filter((l) => !CLOSED_STAGES.has(l.stage as LeadStage))
    return {
      customerCount: count ?? 0,
      unreadNotifications: notifications.filter((n) => n.status === 'unread').length,
      notifications,
      activity: (auditRes.data ?? []) as Array<AuditRow>,
      metrics: {
        hotLeads: open.filter((l) => l.score === 'hot').length,
        testDrives: testDrivesRes.count ?? 0,
        campaignsScheduled: scheduledRes.count ?? 0,
        pipelineValue: open.reduce((t, l) => t + (l.budget ?? 0), 0),
      },
    }
  },
)

// ── Lead conversion analytics (date-scoped by lead.created_at) ────────────────
// Same closed-won math as intelligence.ts, but filtered to a period so the
// dashboard can show day / week / month conversion. Funnel groups by board
// column (BOARD_COLUMN_FOR_STAGE) so legacy stages fold onto the 7 live columns.

export interface FunnelStep {
  stage: LeadStage
  label: string
  count: number
}

export interface ConversionTrendPoint {
  date: string   // YYYY-MM-DD
  leads: number  // leads created that day
  won: number    // of those, currently in a won stage
}

export interface LeadConversionAnalytics {
  range: { preset: string; start: string; end: string }
  totalLeads: number
  won: number
  lost: number
  open: number          // in-progress (not closed)
  hot: number
  conversionRate: number // won / (won + lost), %
  pipelineValue: number  // sum(budget) of open leads
  wonValue: number       // sum(budget) of won leads
  funnel: Array<FunnelStep>
  trend: Array<ConversionTrendPoint>
}

type ConvLeadRow = { stage: string; score: string; budget: number | null; created_at: string }

export const getLeadConversionAnalytics = createServerFn({ method: 'GET' })
  .validator((d: AnalyticsRange) => d)
  .handler(async ({ data }): Promise<LeadConversionAnalytics> => {
    const supabase = getSupabaseServerClient()
    const { start, end } = resolveAnalyticsRange(data)
    const startIso = start.toISOString()
    const endIso = end.toISOString()

    const { data: rows } = await supabase
      .from('leads')
      .select('stage, score, budget, created_at')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
    const leads = (rows ?? []) as Array<ConvLeadRow>

    const isWon = (s: string) => WON_STAGES.has(s as LeadStage)
    const won = leads.filter((l) => isWon(l.stage)).length
    const lost = leads.filter((l) => l.stage === 'lost').length
    const open = leads.filter((l) => !CLOSED_STAGES.has(l.stage as LeadStage))

    const funnel: Array<FunnelStep> = BOARD_STAGES.map((stage) => ({
      stage,
      label: LEAD_STAGE_LABEL[stage],
      count: leads.filter((l) => BOARD_COLUMN_FOR_STAGE[l.stage as LeadStage] === stage).length,
    }))

    // Daily trend — leads created per day, and how many of them are won today.
    const byDay = new Map<string, { leads: number; won: number }>()
    for (const l of leads) {
      const day = l.created_at.substring(0, 10)
      const b = byDay.get(day) ?? { leads: 0, won: 0 }
      b.leads++
      if (isWon(l.stage)) b.won++
      byDay.set(day, b)
    }
    const trend: Array<ConversionTrendPoint> = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, leads: v.leads, won: v.won }))

    return {
      range: { preset: data.preset, start: startIso, end: endIso },
      totalLeads: leads.length,
      won,
      lost,
      open: open.length,
      hot: leads.filter((l) => l.score === 'hot').length,
      conversionRate: won + lost ? Math.round((won / (won + lost)) * 100) : 0,
      pipelineValue: open.reduce((t, l) => t + (l.budget ?? 0), 0),
      wonValue: leads.filter((l) => isWon(l.stage)).reduce((t, l) => t + (l.budget ?? 0), 0),
      funnel,
      trend,
    }
  })

// ── Marketing pulse — operational "today / upcoming / reminders" ──────────────
// Real data: campaign_posts (scheduled/published) + pending approvals. Notifications
// come with the _authed dashboard context, so they aren't re-fetched here.

export interface MarketingPulse {
  today: Array<CampaignPost>       // scheduled for or published today
  upcoming: Array<CampaignPost>    // scheduled after today, soonest first
  publishedToday: number
  scheduledToday: number
  pendingApproval: number
}

export const getMarketingPulse = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MarketingPulse> => {
    const supabase = getSupabaseServerClient()
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString()
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString()

    const [schedRes, pubRes, approvalRes] = await Promise.all([
      supabase
        .from('campaign_posts')
        .select('*, campaign:campaigns(name)')
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', dayStart)
        .order('scheduled_at', { ascending: true }),
      supabase
        .from('campaign_posts')
        .select('*, campaign:campaigns(name)')
        .eq('status', 'published')
        .gte('published_at', dayStart)
        .lte('published_at', dayEnd),
      supabase
        .from('campaign_posts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_approval'),
    ])

    const flatten = (arr: Array<any> | null): Array<CampaignPost> =>
      (arr ?? []).map(({ campaign, ...rest }) => ({ ...rest, campaign_name: campaign?.name ?? null }))

    const scheduled = flatten(schedRes.data)
    const publishedToday = flatten(pubRes.data)
    const scheduledToday = scheduled.filter((p) => (p.scheduled_at ?? '') <= dayEnd)
    const upcoming = scheduled.filter((p) => (p.scheduled_at ?? '') > dayEnd)

    return {
      today: [...publishedToday, ...scheduledToday],
      upcoming,
      publishedToday: publishedToday.length,
      scheduledToday: scheduledToday.length,
      pendingApproval: approvalRes.count ?? 0,
    }
  },
)

export const getCustomers = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<Customer>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('customers')
      .select(
        'id, full_name, phone, email, preferred_vehicle, source_channel, location_id, created_at',
      )
      .order('created_at', { ascending: false })
    return (data ?? []) as Array<Customer>
  },
)
