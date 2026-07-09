/**
 * Company Summary API client — Server-side functions (Phase 3).
 * See docs/planner/03_COMPANY_SUMMARY.md.
 */
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'

const AGENT_BASE = (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'

const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111'

async function tenantId(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return DEMO_TENANT_ID
  const { data } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  return (data?.tenant_id as string) ?? DEMO_TENANT_ID
}

export interface SummaryResult {
  summary_id: string
  tenant_id: string
  extraction_id: string
  context_id: string
  status: 'pending' | 'ready' | 'failed'
  company_name: string | null
  website: string | null
  region: string | null
  industry: string | null
  products: Array<string>
  services: Array<string>
  description: string | null
  verdict: string | null
  errors: Array<string>
  created_at: string | null
  updated_at: string | null
}

// Synchronous — one bounded Groq call, unlike the async extraction endpoint.
export const createSummary = createServerFn({ method: 'POST' })
  .validator((d: { extraction_id: string }) => d)
  .handler(async ({ data }): Promise<SummaryResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/company-summary/summaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, extraction_id: data.extraction_id }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to generate summary' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to generate summary')
    }
    return res.json() as Promise<SummaryResult>
  })

export const getSummary = createServerFn({ method: 'GET' })
  .validator((d: { summary_id: string }) => d)
  .handler(async ({ data }): Promise<SummaryResult | null> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/company-summary/summaries/${data.summary_id}?tenant_id=${tenant_id}`)
    if (!res.ok) return null
    return res.json() as Promise<SummaryResult>
  })

export const listSummaries = createServerFn({ method: 'GET' })
  .validator((d: { context_id?: string; extraction_id?: string; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<Array<SummaryResult>> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const params = new URLSearchParams({ tenant_id, limit: String(data.limit ?? 20) })
    if (data.context_id) params.set('context_id', data.context_id)
    if (data.extraction_id) params.set('extraction_id', data.extraction_id)
    const res = await fetch(`${AGENT_BASE}/company-summary/summaries?${params}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<SummaryResult>>
  })
