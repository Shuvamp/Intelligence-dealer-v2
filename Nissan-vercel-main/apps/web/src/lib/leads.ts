import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import {
  BOARD_COLUMN_FOR_STAGE,
  BOARD_STAGES,
  CLOSED_STAGES,
  WON_STAGES,
  type Lead,
  type LeadBoard,
  type LeadDetail,
  type LeadEventType,
  type LeadMessageChannel,
  type LeadStage,
  type SalesMember,
} from './types'

const SELECT =
  '*, customer:customers!leads_customer_id_fkey(full_name), assignee:users!leads_assigned_to_fkey(full_name)'

function flatten(row: any): Lead {
  const { customer, assignee, ...rest } = row
  return {
    ...rest,
    customer_name: customer?.full_name ?? null,
    assignee_name: assignee?.full_name ?? null,
  }
}

const sum = (rows: Array<Lead>) => rows.reduce((t, l) => t + (l.budget ?? 0), 0)

// Demo/local bypass: login is stubbed (see lib/auth.ts — signIn sets no session
// cookie, getSessionUser returns a hardcoded owner). So server-side there is no
// real Supabase session, and auth.getUser() returns null. Fall back to the
// seeded ABC Nissan owner so board mutations (stage move, assign, notes) work in
// local dev instead of throwing. With a real session, the real user wins.
const DEMO_OWNER_ID = 'user-owner-abc-0001-000000000001'
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111'

async function authCtx(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { userId: DEMO_OWNER_ID, tenantId: DEMO_TENANT_ID }
  const { data } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  return { userId: user.id, tenantId: (data?.tenant_id as string) ?? DEMO_TENANT_ID }
}

// ---- reads ----

export const getLeadBoard = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LeadBoard> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('leads')
      .select(SELECT)
      .order('last_activity_at', { ascending: false })
    const leads = (data ?? []).map(flatten)

    // Bucket by board column, not raw stage — legacy values (qualified,
    // quotation, won) fold onto the nearest of the 7 Phase 2 board columns
    // (see BOARD_COLUMN_FOR_STAGE) so old rows still render somewhere sane
    // without a data backfill.
    const columns = BOARD_STAGES.map((stage) => {
      const ls = leads.filter((l) => BOARD_COLUMN_FOR_STAGE[l.stage] === stage)
      return { stage, leads: ls, count: ls.length, value: sum(ls) }
    })

    const open = leads.filter((l) => !CLOSED_STAGES.has(l.stage))
    const won = leads.filter((l) => WON_STAGES.has(l.stage))
    const lost = leads.filter((l) => l.stage === 'lost')
    const closed = won.length + lost.length
    return {
      columns,
      stats: {
        total: leads.length,
        hot: leads.filter((l) => l.score === 'hot').length,
        warm: leads.filter((l) => l.score === 'warm').length,
        // Cold priority groups together cold + dead score bands.
        cold: leads.filter((l) => l.score === 'cold' || l.score === 'dead').length,
        unassigned: open.filter((l) => !l.assigned_to).length,
        pipelineValue: sum(open),
        wonValue: sum(won),
        winRate: closed ? Math.round((won.length / closed) * 100) : 0,
      },
    }
  },
)

export const getLead = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<LeadDetail | null> => {
    const supabase = getSupabaseServerClient()
    const { data: row } = await supabase.from('leads').select(SELECT).eq('id', data.id).single()
    if (!row) return null
    const lead = flatten(row)

    let customer = null
    if (lead.customer_id) {
      const { data: c } = await supabase.from('customers').select('*').eq('id', lead.customer_id).single()
      customer = c
    }
    const [
      { data: events },
      { data: messages },
      { data: tasks },
      { data: scoreHistory },
    ] = await Promise.all([
      supabase.from('lead_events').select('*').eq('lead_id', data.id).order('created_at', { ascending: false }),
      supabase.from('lead_messages').select('*').eq('lead_id', data.id).order('created_at', { ascending: false }),
      supabase.from('lead_tasks').select('*').eq('lead_id', data.id).order('created_at', { ascending: false }),
      // Phase 6: newest 10 score-change records for the history panel.
      supabase.from('lead_score_history').select('*').eq('lead_id', data.id).order('created_at', { ascending: false }).limit(10),
    ])

    return {
      lead,
      customer,
      events: (events ?? []) as LeadDetail['events'],
      messages: (messages ?? []) as LeadDetail['messages'],
      tasks: (tasks ?? []) as LeadDetail['tasks'],
      score_history: (scoreHistory ?? []) as LeadDetail['score_history'],
    }
  })

export const getSalesTeam = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<SalesMember>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase.from('users').select('id, full_name, role').order('full_name')
    return (data ?? []) as Array<SalesMember>
  },
)

// ---- mutations (write a timeline event + bump last_activity_at) ----

export const updateLeadStage = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      id: string
      stage: LeadStage
      // Display-only, for the SSE broadcast payload — not persisted.
      // Passing them through avoids an extra DB round-trip just to label
      // the toast on other connected clients (PHASE_02, step 5).
      from_stage?: LeadStage
      customer_name?: string | null
      vehicle_interest?: string | null
    }) => d,
  )
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId, userId } = await authCtx(supabase)
    const now = new Date().toISOString()
    await supabase.from('leads').update({ stage: data.stage, last_activity_at: now, updated_at: now }).eq('id', data.id)
    await supabase.from('lead_events').insert({
      tenant_id: tenantId, lead_id: data.id, type: 'stage_change',
      summary: `Moved to ${data.stage.replace('_', ' ')}.`, metadata: { to_stage: data.stage }, created_by: userId,
    })
    // Best-effort SSE broadcast so other connected board/dashboard tabs
    // refresh in real time. Never let a broadcast failure fail the mutation
    // itself — the DB write above is already done and is the source of truth.
    try {
      const apiUrl = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321'
      await fetch(`${apiUrl}/events/stage-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: data.id,
          from_stage: data.from_stage ?? null,
          to_stage: data.stage,
          customer_name: data.customer_name ?? null,
          vehicle_interest: data.vehicle_interest ?? null,
        }),
      })
    } catch {
      // Local dev without the shim running, or prod with no broadcast
      // endpoint wired yet — real-time updates degrade to "refresh to see
      // changes," same as the rest of the app's SSE today.
    }
    return { ok: true as const }
  })

export const assignLead = createServerFn({ method: 'POST' })
  .validator((d: { id: string; assigned_to: string | null; assignee_name?: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId, userId } = await authCtx(supabase)
    const now = new Date().toISOString()
    await supabase.from('leads').update({ assigned_to: data.assigned_to, last_activity_at: now, updated_at: now }).eq('id', data.id)
    await supabase.from('lead_events').insert({
      tenant_id: tenantId, lead_id: data.id, type: 'assignment',
      summary: data.assignee_name ? `Assigned to ${data.assignee_name}.` : 'Lead reassigned.',
      metadata: { assigned_to: data.assigned_to }, created_by: userId,
    })
    return { ok: true as const }
  })

export const addLeadEvent = createServerFn({ method: 'POST' })
  .validator((d: { lead_id: string; type: LeadEventType; summary: string; metadata?: Record<string, unknown> }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId, userId } = await authCtx(supabase)
    await supabase.from('lead_events').insert({
      tenant_id: tenantId, lead_id: data.lead_id, type: data.type,
      summary: data.summary, metadata: data.metadata ?? {}, created_by: userId,
    })
    await supabase.from('leads').update({ last_activity_at: new Date().toISOString() }).eq('id', data.lead_id)
    return { ok: true as const }
  })

// ---- Phase 2 detail-view sections: Messages / Tasks ----
// Call History needs no mutation — it reads lead_events (type='call') directly.
// Documents has no mutation in this phase — placeholder UI only (see types.ts).

export const addLeadMessage = createServerFn({ method: 'POST' })
  .validator(
    (d: { lead_id: string; channel: LeadMessageChannel; body: string; direction?: 'inbound' | 'outbound'; source?: string }) => d,
  )
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId, userId } = await authCtx(supabase)
    await supabase.from('lead_messages').insert({
      tenant_id: tenantId, lead_id: data.lead_id, channel: data.channel,
      direction: data.direction ?? 'outbound', body: data.body,
      source: data.source ?? 'manual', created_by: userId,
    })
    await supabase.from('leads').update({ last_activity_at: new Date().toISOString() }).eq('id', data.lead_id)
    return { ok: true as const }
  })

export const addLeadTask = createServerFn({ method: 'POST' })
  .validator((d: { lead_id: string; title: string; due_at?: string | null; assigned_to?: string | null }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { tenantId, userId } = await authCtx(supabase)
    await supabase.from('lead_tasks').insert({
      tenant_id: tenantId, lead_id: data.lead_id, title: data.title,
      due_at: data.due_at ?? null, assigned_to: data.assigned_to ?? null, created_by: userId,
    })
    return { ok: true as const }
  })

export const completeLeadTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    await supabase
      .from('lead_tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', data.id)
    return { ok: true as const }
  })
