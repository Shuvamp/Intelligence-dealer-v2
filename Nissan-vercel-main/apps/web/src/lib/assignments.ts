/**
 * Assignment API client — Server-side functions for assignment operations
 */

import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'

// Agent-service base: FastAPI in prod (VITE_AGENT_API_URL); shim in local dev.
const AGENT_BASE =
  (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'

// Per-executive lead ceiling used for the utilization bars. The agent-service
// never exposed this via a real endpoint on FastAPI (those /api/executives etc.
// routes only ever existed in the Node dev shim), so the dashboard reads the
// same source of truth as the rest of the app — Supabase — directly.
const MAX_LEAD_LIMIT = 15

// Demo/local bypass mirrors lib/leads.ts: login is stubbed, so server-side
// there is no real Supabase session. Fall back to the seeded ABC Nissan tenant
// so the dashboard renders instead of showing "No executives found".
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111'

async function tenantId(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return DEMO_TENANT_ID
  const { data } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  return (data?.tenant_id as string) ?? DEMO_TENANT_ID
}

// leads.score is an enum (hot/warm/cold/dead); the history badge only styles
// hot/warm/cold, so dead + anything unknown folds onto cold.
function historyScore(score: string | null): 'hot' | 'warm' | 'cold' {
  return score === 'hot' || score === 'warm' ? score : 'cold'
}

async function callAssignmentAPI(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) {
  const supabase = getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token

  if (!token) throw new Error('No access token')

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(`${AGENT_BASE}${endpoint}`, options)

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`)
  }

  return response.json()
}

// Sales executives + their live load, read straight from Supabase: users with
// role=sales_executive in the caller's tenant, each with a count of the leads
// currently assigned to them.
export const fetchExecutives = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const supabase = getSupabaseServerClient()
    const tid = await tenantId(supabase)
    const [{ data: execs }, { data: leads }] = await Promise.all([
      supabase
        .from('users')
        .select('id, full_name')
        .eq('tenant_id', tid)
        .eq('role', 'sales_executive')
        .order('full_name'),
      supabase.from('leads').select('assigned_to').eq('tenant_id', tid),
    ])
    const counts: Record<string, number> = {}
    for (const l of (leads ?? []) as Array<{ assigned_to: string | null }>) {
      if (l.assigned_to) counts[l.assigned_to] = (counts[l.assigned_to] ?? 0) + 1
    }
    return ((execs ?? []) as Array<{ id: string; full_name: string }>).map((e) => ({
      id: e.id,
      name: e.full_name,
      status: 'active' as const,
      current_lead_count: counts[e.id] ?? 0,
      max_lead_limit: MAX_LEAD_LIMIT,
    }))
  } catch (err) {
    console.error('fetchExecutives error:', err)
    return []
  }
})

export const fetchDashboardStats = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const supabase = getSupabaseServerClient()
    const tid = await tenantId(supabase)
    const [{ data: execs }, { data: leads }] = await Promise.all([
      supabase.from('users').select('id').eq('tenant_id', tid).eq('role', 'sales_executive'),
      supabase.from('leads').select('assigned_to').eq('tenant_id', tid),
    ])
    const execIds = new Set(((execs ?? []) as Array<{ id: string }>).map((e) => e.id))
    const rows = (leads ?? []) as Array<{ assigned_to: string | null }>
    const currentLoad = rows.filter((l) => l.assigned_to && execIds.has(l.assigned_to)).length
    const totalExecutives = execIds.size
    const totalCapacity = totalExecutives * MAX_LEAD_LIMIT
    return {
      total_executives: totalExecutives,
      total_capacity: totalCapacity,
      current_load: currentLoad,
      utilization_percent: totalCapacity ? Math.round((currentLoad / totalCapacity) * 100) : 0,
      total_assignments: rows.filter((l) => l.assigned_to).length,
      total_completions: 0,
      unread_notifications: 0,
      executives: [],
    }
  } catch (err) {
    console.error('fetchDashboardStats error:', err)
    return null
  }
})

// Recent assignments: most-recently-active assigned leads, joined to the
// customer (for the name) and the assignee (for the executive name).
export const fetchAssignmentHistory = createServerFn({ method: 'GET' })
  .validator((d: number | undefined) => d ?? 50)
  .handler(async ({ data: limit }) => {
    try {
      const supabase = getSupabaseServerClient()
      const tid = await tenantId(supabase)
      const { data } = await supabase
        .from('leads')
        .select(
          'id, score, assigned_to, vehicle_interest, last_activity_at, updated_at, customer:customers!leads_customer_id_fkey(full_name), assignee:users!leads_assigned_to_fkey(full_name)',
        )
        .eq('tenant_id', tid)
        .not('assigned_to', 'is', null)
        .order('last_activity_at', { ascending: false })
        .limit(limit)
      return ((data ?? []) as any[]).map((l) => ({
        assignment_id: l.id,
        lead_id: l.id,
        customer_name: l.customer?.full_name ?? null,
        vehicle: l.vehicle_interest ?? null,
        executive_name: l.assignee?.full_name ?? 'Unassigned',
        executive_id: l.assigned_to,
        score: historyScore(l.score),
        assigned_at: l.last_activity_at ?? l.updated_at,
      }))
    } catch (err) {
      console.error('fetchAssignmentHistory error:', err)
      return []
    }
  })

// No notifications table is wired to Supabase yet; return empty so the panel
// renders its "No notifications" empty state instead of erroring.
export const fetchNotifications = createServerFn({ method: 'GET' })
  .validator((d: { unreadOnly: boolean; limit: number } | undefined) => d ?? { unreadOnly: false, limit: 20 })
  .handler(async () => {
    return [] as any[]
  })

export const assignLead = createServerFn({ method: 'POST' })
  .validator((d: { lead_id: string; score: string }) => d)
  .handler(async ({ data }) => {
    try {
      return await callAssignmentAPI('/api/assign-lead', 'POST', data)
    } catch (err) {
      console.error('assignLead error:', err)
      return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

export const completeLead = createServerFn({ method: 'POST' })
  .validator((d: { lead_id: string; executive_id: string }) => d)
  .handler(async ({ data }) => {
    try {
      return await callAssignmentAPI('/api/complete-lead', 'POST', data)
    } catch (err) {
      console.error('completeLead error:', err)
      return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

export const deactivateExecutive = createServerFn({ method: 'POST' })
  .validator((d: { executive_id: string }) => d)
  .handler(async ({ data }) => {
    try {
      return await callAssignmentAPI('/api/deactivate-executive', 'POST', data)
    } catch (err) {
      console.error('deactivateExecutive error:', err)
      return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

export const markNotificationRead = createServerFn({ method: 'POST' })
  .validator((d: string) => d)
  .handler(async ({ data: notificationId }) => {
    try {
      return await callAssignmentAPI(`/api/notifications/${notificationId}/read`, 'POST')
    } catch (err) {
      console.error('markNotificationRead error:', err)
      return { success: false }
    }
  })
