import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import type { SessionUser } from './types'

export const signIn = createServerFn({ method: 'POST' })
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })
    if (error) return { ok: false as const, message: error.message }
    return { ok: true as const }
  })

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  await supabase.auth.signOut()
  return { ok: true as const }
})

// Returns the authenticated user's profile + tenant (with branding), or null.
export const getSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const supabase = getSupabaseServerClient()
    // getUser() (not getSession()) — it re-validates the JWT against the Auth
    // server, so identity here can't be forged from a tampered cookie.
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('users')
      .select('id, full_name, email, role, tenant_id')
      .eq('id', user.id)
      .single()
    if (!profile) return null

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name, brand, subscription_plan, branding')
      .eq('id', profile.tenant_id)
      .single()
    if (!tenant) return null

    return { profile, tenant } as SessionUser
  },
)
