import type { SubscriptionPlan } from './types'

export interface PlanInfo {
  key: SubscriptionPlan
  name: string
  price: string // monthly, ₹
  tagline: string
  modules: Array<string> // module names this plan unlocks
  features: Array<string>
  highlight?: boolean
}

// Pricing tiers (spec §6). Module access is gated by plan rank (see spine §6 / nav gating).
export const PLANS: Array<PlanInfo> = [
  {
    key: 'starter',
    name: 'Starter',
    price: '$5',
    tagline: 'Lead management for a single showroom.',
    modules: ['Dashboard', 'Customers', 'Leads'],
    features: ['Unified lead inbox', 'Lead scoring & assignment', 'Pipeline & follow-ups', '1 location'],
  },
  {
    key: 'growth',
    name: 'Growth',
    price: '$10',
    tagline: 'Add AI marketing automation.',
    modules: ['Dashboard', 'Customers', 'Leads', 'Marketing', 'Reports'],
    features: ['Everything in Starter', 'Marketing command center', 'AI content & posters', 'Approval & publishing', 'Reports'],
    highlight: true,
  },
  {
    key: 'intelligence',
    name: 'Intelligence',
    price: '$20',
    tagline: 'Full intelligence + executive copilot.',
    modules: ['Dashboard', 'Customers', 'Leads', 'Marketing', 'Intelligence', 'Copilot', 'Reports'],
    features: ['Everything in Growth', 'Market intelligence & signals', 'Executive Copilot', 'AI recommendations'],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    tagline: 'Multi-location dealer groups.',
    modules: ['All modules'],
    features: ['Everything in Intelligence', 'Multi-location', 'API access', 'Custom integrations', 'Dedicated support'],
  },
]

const RANK: Record<SubscriptionPlan, number> = { starter: 0, growth: 1, intelligence: 2, enterprise: 3 }
export function planRank(p: SubscriptionPlan) {
  return RANK[p]
}
export function planByKey(key: SubscriptionPlan) {
  return PLANS.find((p) => p.key === key)!
}
