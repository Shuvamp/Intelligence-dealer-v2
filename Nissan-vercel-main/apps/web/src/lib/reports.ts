import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import { CLOSED_STAGES, WON_STAGES } from './types'
import type { LeadSource, LeadStage, ReportsData, UserRole } from './types'

// Composite, RLS-scoped reporting data computed from live leads + campaigns + team.
export const getReportsData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReportsData> => {
    const supabase = getSupabaseServerClient()
    const [leadsRes, insRes, usersRes] = await Promise.all([
      supabase.from('leads').select('source, stage, score, budget, assigned_to'),
      supabase
        .from('campaign_insights')
        .select('leads_generated, conversion_rate, cost_per_lead, spend, campaigns(name)')
        .order('leads_generated', { ascending: false }),
      supabase.from('users').select('id, full_name, role'),
    ])
    const leads = (leadsRes.data ?? []) as Array<{
      source: LeadSource; stage: string; score: string; budget: number | null; assigned_to: string | null
    }>

    const won = leads.filter((l) => WON_STAGES.has(l.stage as LeadStage))
    const lost = leads.filter((l) => l.stage === 'lost')
    const open = leads.filter((l) => !CLOSED_STAGES.has(l.stage as LeadStage))
    const closed = won.length + lost.length
    const sum = (rows: Array<{ budget: number | null }>) => rows.reduce((t, l) => t + (l.budget ?? 0), 0)

    // by source
    const srcMap = new Map<LeadSource, { source: LeadSource; count: number; won: number }>()
    for (const l of leads) {
      const a = srcMap.get(l.source) ?? { source: l.source, count: 0, won: 0 }
      a.count++
      if (WON_STAGES.has(l.stage as LeadStage)) a.won++
      srcMap.set(l.source, a)
    }
    const sources = [...srcMap.values()]
      .map((a) => ({ ...a, conversionRate: a.count ? Math.round((a.won / a.count) * 100) : 0 }))
      .sort((x, y) => y.count - x.count)

    // by team member
    const users = new Map((usersRes.data ?? []).map((u: any) => [u.id, u]))
    const teamMap = new Map<string, { name: string; role: UserRole | null; total: number; won: number; hot: number; pipelineValue: number }>()
    for (const l of leads) {
      const key = l.assigned_to ?? 'unassigned'
      const u: any = l.assigned_to ? users.get(l.assigned_to) : null
      const t = teamMap.get(key) ?? { name: u?.full_name ?? 'Unassigned', role: (u?.role ?? null) as UserRole | null, total: 0, won: 0, hot: 0, pipelineValue: 0 }
      t.total++
      if (WON_STAGES.has(l.stage as LeadStage)) t.won++
      if (l.score === 'hot') t.hot++
      if (!CLOSED_STAGES.has(l.stage as LeadStage)) t.pipelineValue += l.budget ?? 0
      teamMap.set(key, t)
    }
    const team = [...teamMap.values()]
      .map((t) => ({ ...t, conversionRate: t.total ? Math.round((t.won / t.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)

    const campaigns = (insRes.data ?? []).map((r: any) => ({
      name: r.campaigns?.name ?? 'Campaign',
      leads: r.leads_generated,
      conversionRate: Number(r.conversion_rate),
      costPerLead: Number(r.cost_per_lead),
      spend: Number(r.spend),
    }))

    return {
      sales: {
        totalLeads: leads.length,
        won: won.length,
        lost: lost.length,
        conversionRate: closed ? Math.round((won.length / closed) * 100) : 0,
        pipelineValue: sum(open),
        wonValue: sum(won),
      },
      sources,
      campaigns,
      team,
    }
  },
)
