/**
 * Context Planner API client — Server-side functions (Phase 1).
 * See docs/planner/01_CONTEXT_PLANNER.md.
 */
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'

// Agent-service base: FastAPI in prod (VITE_AGENT_API_URL); shim-adjacent
// FastAPI in local dev.
const AGENT_BASE = (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'

// Login is stubbed in local dev, so server-side there is often no real
// Supabase session — mirrors lib/assignments.ts's fallback.
async function tenantId(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  if (!data?.tenant_id) throw new Error('User has no tenant')
  return data.tenant_id as string
}

export interface CreateContextInput {
  input_type: 'url' | 'manual'
  url?: string
  company_name?: string
  website?: string
  region?: string
  industry?: string
  products?: string
  services?: string
  description?: string
}

export interface ContextResult {
  context_id: string
  tenant_id: string
  input_type: 'url' | 'manual'
  status: 'pending' | 'ready' | 'invalid' | 'failed'
  url: string | null
  normalized_url: string | null
  company_name: string | null
  website: string | null
  region: string | null
  industry: string | null
  products: string | null
  services: string | null
  description: string | null
  errors: Array<string>
  created_at: string | null
  updated_at: string | null
}

export const createContext = createServerFn({ method: 'POST' })
  .validator((d: CreateContextInput) => d)
  .handler(async ({ data }): Promise<ContextResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/context-planner/contexts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, ...data }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to create context' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to create context')
    }
    return res.json() as Promise<ContextResult>
  })

export const listContexts = createServerFn({ method: 'GET' })
  .validator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<Array<ContextResult>> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const params = new URLSearchParams({ tenant_id, limit: String(data.limit ?? 20) })
    const res = await fetch(`${AGENT_BASE}/context-planner/contexts?${params}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<ContextResult>>
  })

// Added for Phase 4 (SEO Agent) — its dedicated report page needs to fetch a
// single context by id directly (e.g. after a page reload), which nothing
// before it needed since Phase 1-3's UI only ever showed a list.
export const getContext = createServerFn({ method: 'GET' })
  .validator((d: { context_id: string }) => d)
  .handler(async ({ data }): Promise<ContextResult | null> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/context-planner/contexts/${data.context_id}?tenant_id=${tenant_id}`)
    if (!res.ok) return null
    return res.json() as Promise<ContextResult>
  })
