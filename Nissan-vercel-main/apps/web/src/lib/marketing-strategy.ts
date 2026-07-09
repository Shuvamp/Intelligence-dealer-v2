/**
 * Marketing Strategy Advisor API client — Context Planner sub-module.
 * Stateless: POST a context_id, get back Groq-generated growth strategies.
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

export type StrategyPriority = 'high' | 'medium' | 'low'

export interface MarketingStrategy {
  title: string
  category: string
  description: string
  reason: string
  expected_impact: string
  priority: StrategyPriority
}

export interface StrategyResult {
  context_id: string
  status: 'ready' | 'no_analysis'
  engine: 'groq' | 'deterministic' | null
  strategies: Array<MarketingStrategy>
  errors: Array<string>
}

export const suggestStrategies = createServerFn({ method: 'POST' })
  .validator((d: { context_id: string }) => d)
  .handler(async ({ data }): Promise<StrategyResult> => {
    const supabase = getSupabaseServerClient()
    const tenant_id = await tenantId(supabase)

    const res = await fetch(`${AGENT_BASE}/marketing-strategy/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, context_id: data.context_id }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ detail: 'Failed to generate strategies' }))) as { detail?: string }
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to generate strategies')
    }
    return res.json() as Promise<StrategyResult>
  })
