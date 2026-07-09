/**
 * AEO Agent API client — Server-side functions (Phase 5).
 * See docs/planner/05_AEO_AGENT.md.
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

export type AeoStatus = 'PASS' | 'WARNING' | 'FAIL'
export type Level = 'high' | 'medium' | 'low'

export interface AeoRecommendation {
  why_ai_may_fail: string
  how_to_improve: string
  expected_impact: Level
}

export interface AeoAgentResult {
  agent: string
  status: AeoStatus
  recommendations: Array<AeoRecommendation>
}

export interface AeoStrength {
  agent: string
  note: string
}

export interface AeoWeakness {
  agent: string
  recommendations: Array<AeoRecommendation>
}

export interface AeoSummary {
  pass_count: number
  warning_count: number
  fail_count: number
  aeo_score: number
}

export interface AeoAnalysisData {
  agents: Array<AeoAgentResult>
  strengths: Array<AeoStrength>
  weaknesses: Array<AeoWeakness>
  summary: AeoSummary
}

export interface AnalysisResult {
  analysis_id: string
  tenant_id: string
  extraction_id: string
  context_id: string
  status: 'queued' | 'analyzing' | 'ready' | 'failed'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis_data: AeoAnalysisData | Record<string, any> | null
  overall_score: number | null
  errors: Array<string>
  created_at: string | null
  updated_at: string | null
  started_at: string | null
  completed_at: string | null
}

export const createAnalysis = createServerFn({ method: 'POST' })
  .validator((d: { extraction_id: string }) => d)
  .handler(async ({ data }): Promise<AnalysisResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/aeo-agent/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, extraction_id: data.extraction_id }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to start AEO analysis' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to start AEO analysis')
    }
    return res.json() as Promise<AnalysisResult>
  })

export const getAnalysis = createServerFn({ method: 'GET' })
  .validator((d: { analysis_id: string }) => d)
  .handler(async ({ data }): Promise<AnalysisResult | null> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/aeo-agent/analyses/${data.analysis_id}?tenant_id=${tenant_id}`)
    if (!res.ok) return null
    return res.json() as Promise<AnalysisResult>
  })

export const listAnalyses = createServerFn({ method: 'GET' })
  .validator((d: { context_id?: string; extraction_id?: string; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<Array<AnalysisResult>> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const params = new URLSearchParams({ tenant_id, limit: String(data.limit ?? 20) })
    if (data.context_id) params.set('context_id', data.context_id)
    if (data.extraction_id) params.set('extraction_id', data.extraction_id)
    const res = await fetch(`${AGENT_BASE}/aeo-agent/analyses?${params}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<AnalysisResult>>
  })
