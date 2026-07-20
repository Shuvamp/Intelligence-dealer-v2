/**
 * Recommendation Engine API client — Server-side functions (Phase 6).
 * See docs/planner/06_RECOMMENDATION_ENGINE.md.
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

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
export type Priority = 'high' | 'medium' | 'low'
export type ImpactLevel = 'high' | 'medium' | 'low' | 'not_applicable'
export type DifficultyLevel = 'high' | 'medium' | 'low' | 'unknown'
export type Source = 'seo' | 'aeo'

export interface RecommendationItem {
  severity: Severity
  priority: Priority
  problem: string
  reason: string
  fix: string
  estimated_time: string
  expected_seo_impact: ImpactLevel
  expected_aeo_impact: ImpactLevel
  difficulty: DifficultyLevel
  category: string
  source: Source
}

export interface SeverityGroups {
  critical: Array<RecommendationItem>
  high: Array<RecommendationItem>
  medium: Array<RecommendationItem>
  low: Array<RecommendationItem>
}

export interface RecommendationSummary {
  total_count: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  seo_score: number
  aeo_score: number
  combined_score: number
  combined_grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

export interface RecommendationReportData {
  company_name: string | null
  recommendations: Array<RecommendationItem>
  groups: SeverityGroups
  summary: RecommendationSummary
}

export interface ReportResult {
  report_id: string
  tenant_id: string
  extraction_id: string
  context_id: string
  seo_analysis_id: string
  aeo_analysis_id: string
  status: 'queued' | 'generating' | 'ready' | 'failed'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report_data: RecommendationReportData | Record<string, any> | null
  combined_score: number | null
  errors: Array<string>
  created_at: string | null
  updated_at: string | null
  started_at: string | null
  completed_at: string | null
}

export const createReport = createServerFn({ method: 'POST' })
  .validator((d: { extraction_id: string }) => d)
  .handler(async ({ data }): Promise<ReportResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/recommendation-engine/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, extraction_id: data.extraction_id }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to generate recommendation report' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to generate recommendation report')
    }
    return res.json() as Promise<ReportResult>
  })

export const getReport = createServerFn({ method: 'GET' })
  .validator((d: { report_id: string }) => d)
  .handler(async ({ data }): Promise<ReportResult | null> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/recommendation-engine/reports/${data.report_id}?tenant_id=${tenant_id}`)
    if (!res.ok) return null
    return res.json() as Promise<ReportResult>
  })

export const listReports = createServerFn({ method: 'GET' })
  .validator((d: { context_id?: string; extraction_id?: string; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<Array<ReportResult>> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const params = new URLSearchParams({ tenant_id, limit: String(data.limit ?? 20) })
    if (data.context_id) params.set('context_id', data.context_id)
    if (data.extraction_id) params.set('extraction_id', data.extraction_id)
    const res = await fetch(`${AGENT_BASE}/recommendation-engine/reports?${params}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<ReportResult>>
  })
