/**
 * Report Generator API client — Server-side functions (Phase 7).
 * See docs/planner/07_REPORT_GENERATOR.md.
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

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'
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

export interface OverallScoreSection {
  combined_score: number
  combined_grade: Grade
  seo_score: number
  aeo_score: number
}

export interface StrengthItem {
  source: Source
  title: string
  detail: string
}

export interface WeaknessItem {
  source: Source
  title: string
  detail: string
}

export interface TechnicalDetails {
  has_sitemap: boolean
  has_robots_txt: boolean
  has_ssl: boolean
  has_privacy_policy: boolean
  has_terms: boolean
  meta_title: string | null
  meta_description: string | null
  schema_markup_types: Array<string>
  cms: string | null
  ecommerce_platform: string | null
  frameworks: Array<string>
  analytics: Array<string>
  pages_crawled_count: number
}

export interface ReportSummary {
  total_recommendations: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  priority_fix_count: number
  strength_count: number
  weakness_count: number
}

export interface ReportMeta {
  company_name: string | null
  website: string | null
  generated_at: string
  engine: 'groq' | 'deterministic'
}

export interface ReportData {
  executive_summary: string
  company_overview: string
  website_summary: string
  seo_summary: string
  aeo_summary: string
  overall_score: OverallScoreSection
  strengths: Array<StrengthItem>
  weaknesses: Array<WeaknessItem>
  priority_fixes: Array<RecommendationItem>
  technical_details: TechnicalDetails
  recommendations: Array<RecommendationItem>
  summary: ReportSummary
  meta: ReportMeta
}

export interface ReportResult {
  report_id: string
  tenant_id: string
  extraction_id: string
  context_id: string
  recommendation_report_id: string
  seo_analysis_id: string
  aeo_analysis_id: string
  company_summary_id: string | null
  status: 'queued' | 'generating' | 'ready' | 'failed'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report_data: ReportData | Record<string, any> | null
  markdown_content: string | null
  overall_score: number | null
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

    const res = await fetch(`${AGENT_BASE}/report-generator/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, extraction_id: data.extraction_id }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to generate report' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to generate report')
    }
    return res.json() as Promise<ReportResult>
  })

export const getReport = createServerFn({ method: 'GET' })
  .validator((d: { report_id: string }) => d)
  .handler(async ({ data }): Promise<ReportResult | null> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/report-generator/reports/${data.report_id}?tenant_id=${tenant_id}`)
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
    const res = await fetch(`${AGENT_BASE}/report-generator/reports?${params}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<ReportResult>>
  })
