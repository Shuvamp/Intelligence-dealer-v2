import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import type { AccountUsage, SubscriptionPlan } from './types'

// RLS-scoped account usage for the Subscription/Settings page.
export const getAccountUsage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AccountUsage> => {
    const supabase = getSupabaseServerClient()
    const head = { count: 'exact' as const, head: true }
    const [tenant, users, locations, customers, leads, campaigns] = await Promise.all([
      supabase.from('tenants').select('subscription_plan').limit(1).single(),
      supabase.from('users').select('*', head),
      supabase.from('locations').select('*', head),
      supabase.from('customers').select('*', head),
      supabase.from('leads').select('*', head),
      supabase.from('campaigns').select('*', head),
    ])
    return {
      plan: (tenant.data?.subscription_plan ?? 'starter') as SubscriptionPlan,
      users: users.count ?? 0,
      locations: locations.count ?? 0,
      customers: customers.count ?? 0,
      leads: leads.count ?? 0,
      campaigns: campaigns.count ?? 0,
    }
  },
)
