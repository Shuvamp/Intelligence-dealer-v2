/**
 * Marketing Budget Planner API client — Context Planner sub-module.
 * Stateless: POST a context_id + the user's monthly budget (INR), get back a
 * derived recommended budget, its allocation, a budget-fit optimization, a
 * comparison table, an executable task list, and strategic recommendations.
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

export interface RecommendationNote {
  title: string
  detail: string
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
  errors: Array<string>
}

export const planBudget = createServerFn({ method: 'POST' })
  .validator((d: { context_id: string; user_budget: number }) => d)
  .handler(async ({ data }): Promise<BudgetPlanResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/marketing-budget-planner/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, context_id: data.context_id, user_budget: data.user_budget }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to generate budget plan' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to generate budget plan')
    }
    return res.json() as Promise<BudgetPlanResult>
  })
