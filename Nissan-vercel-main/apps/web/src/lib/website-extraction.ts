/**
 * Website Extraction API client — Server-side functions (Phase 2).
 * See docs/planner/02_WEBSITE_EXTRACTION_ENGINE.md.
 */
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'

const AGENT_BASE = (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'

async function tenantId(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  if (!data?.tenant_id) throw new Error('User has no tenant')
  return data.tenant_id as string
}

export interface ExtractionResult {
  extraction_id: string
  tenant_id: string
  context_id: string
  url: string | null
  status: 'queued' | 'crawling' | 'parsing' | 'extracting' | 'building' | 'ready' | 'failed'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraction_data: Record<string, any> | null
  errors: Array<string>
  created_at: string | null
  updated_at: string | null
  started_at: string | null
  completed_at: string | null
}

export const createExtraction = createServerFn({ method: 'POST' })
  .validator((d: { context_id: string }) => d)
  .handler(async ({ data }): Promise<ExtractionResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/website-extraction/extractions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, context_id: data.context_id }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to start extraction' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to start extraction')
    }
    return res.json() as Promise<ExtractionResult>
  })

export const getExtraction = createServerFn({ method: 'GET' })
  .validator((d: { extraction_id: string }) => d)
  .handler(async ({ data }): Promise<ExtractionResult | null> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/website-extraction/extractions/${data.extraction_id}?tenant_id=${tenant_id}`)
    if (!res.ok) return null
    return res.json() as Promise<ExtractionResult>
  })

export const listExtractions = createServerFn({ method: 'GET' })
  .validator((d: { context_id?: string; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<Array<ExtractionResult>> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const params = new URLSearchParams({ tenant_id, limit: String(data.limit ?? 20) })
    if (data.context_id) params.set('context_id', data.context_id)
    const res = await fetch(`${AGENT_BASE}/website-extraction/extractions?${params}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<ExtractionResult>>
  })
