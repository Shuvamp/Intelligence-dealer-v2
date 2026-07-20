/**
 * Marketing Budget Planner API client — Context Planner sub-module.
 * Stateless: POST a context_id + the user's monthly budget (INR), get back a
 * derived recommended budget, its allocation, a budget-fit optimization, a
 * comparison table, an executable task list, and strategic recommendations.
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

export type BudgetPriority = 'high' | 'medium' | 'low'
export type OptimizedStatus = 'included' | 'deferred' | 'excluded'

export interface BudgetSummary {
  currency: string
  recommended_budget: number
  user_budget: number
  recommended_budget_display: string
  user_budget_display: string
  optimized_total: number
  optimized_total_display: string
  fits_recommended: boolean
  explanation: string
  optimization_note: string
}

export interface BudgetLine {
  activity: string
  amount: number
  amount_display: string
  share_pct: number
  priority: BudgetPriority
  rationale: string
}

export interface OptimizedLine {
  activity: string
  amount: number
  amount_display: string
  priority: BudgetPriority
  status: OptimizedStatus
  note: string
}

export interface ComparisonRow {
  metric: string
  recommended: string
  optimized: string
}

export interface ExecutionTask {
  task_name: string
  category: string
  priority: BudgetPriority
  estimated_cost: number
  estimated_cost_display: string
  expected_impact: string
}

export type InsightCategory = 'best_channel' | 'optimization' | 'growth' | 'risk' | 'tip'

export interface RecommendationNote {
  category: InsightCategory
  title: string
  detail: string
}

export type MarketingObjective =
  | 'lead_generation'
  | 'vehicle_sales'
  | 'brand_awareness'
  | 'website_traffic'
  | 'customer_engagement'

export interface BusinessImpact {
  expected_leads: number
  expected_leads_display: string
  website_traffic: number
  website_traffic_display: string
  test_drive_bookings: number
  test_drive_bookings_display: string
  customer_enquiries: number
  customer_enquiries_display: string
  vehicle_sales: number
  vehicle_sales_display: string
  estimated_roi_pct: number
  estimated_roi_display: string
  reach: number
  reach_display: string
  impressions: number
  impressions_display: string
}

export interface BusinessImpactBlock {
  recommended: BusinessImpact
  optimized: BusinessImpact
}

export interface BudgetPlanResult {
  context_id: string
  status: 'ready' | 'no_analysis'
  engine: 'groq' | 'deterministic' | null
  currency: string
  recommended_budget: number
  user_budget: number
  budget_summary: BudgetSummary | null
  recommended_budget_breakdown: Array<BudgetLine>
  optimized_budget_breakdown: Array<OptimizedLine>
  comparison_table: Array<ComparisonRow>
  execution_plan: Array<ExecutionTask>
  recommendations: Array<RecommendationNote>
  business_impact: BusinessImpactBlock | null
  errors: Array<string>
}

export interface PlanBudgetInput {
  context_id: string
  user_budget: number
  objective?: MarketingObjective
  campaign_duration_days?: number
  target_audience?: string
  vehicle_category?: string
  preferred_channels?: Array<string>
  region?: string
  skip_llm?: boolean
}

export const planBudget = createServerFn({ method: 'POST' })
  .validator((d: PlanBudgetInput) => d)
  .handler(async ({ data }): Promise<BudgetPlanResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/marketing-budget-planner/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id,
        context_id: data.context_id,
        user_budget: data.user_budget,
        objective: data.objective,
        campaign_duration_days: data.campaign_duration_days,
        target_audience: data.target_audience,
        vehicle_category: data.vehicle_category,
        preferred_channels: data.preferred_channels,
        region: data.region,
        skip_llm: data.skip_llm ?? false,
      }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to generate budget plan' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to generate budget plan')
    }
    return res.json() as Promise<BudgetPlanResult>
  })
