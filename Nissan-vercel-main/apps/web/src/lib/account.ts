import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import type { DealershipSettings } from './types'

// RLS-scoped team + locations for the Settings page.
export const getDealershipSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DealershipSettings> => {
    const supabase = getSupabaseServerClient()
    const [locs, team] = await Promise.all([
      supabase.from('locations').select('id, name, status').order('name'),
      supabase.from('users').select('id, full_name, email, role, status').order('full_name'),
    ])
    return {
      locations: (locs.data ?? []) as DealershipSettings['locations'],
      team: (team.data ?? []) as DealershipSettings['team'],
    }
  },
)
