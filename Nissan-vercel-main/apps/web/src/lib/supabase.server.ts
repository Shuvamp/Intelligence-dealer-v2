import { createServerClient } from '@supabase/ssr'
import { getCookies, setCookie } from '@tanstack/react-start/server'

// Null-safe query builder — returns empty data instead of throwing.
function nullBuilder(): any {
  const b: any = new Proxy(
    {
      then(resolve: (v: any) => void) {
        resolve({ data: [], count: 0, error: null })
      },
      async single() { return { data: null, error: null } },
      async maybeSingle() { return { data: null, error: null } },
    },
    {
      get(target, prop) {
        if (prop in target) return (target as any)[prop]
        return () => b
      },
    },
  )
  return b
}

// Mock Supabase client used when no real DB is available.
function getMockClient(): any {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: 'demo-owner-id', email: 'owner@abcnissan.test' } }, error: null }
      },
      async signInWithPassword() { return { error: null } },
      async signOut() { return { error: null } },
    },
    from: () => nullBuilder(),
  }
}

export function getSupabaseServerClient() {
  const url = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

  if (!url || !anonKey) return getMockClient()

  try {
    return createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return Object.entries(getCookies()).map(([name, value]) => ({
            name,
            value: value ?? '',
          }))
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            setCookie(name, value, options)
          }
        },
      },
    })
  } catch {
    return getMockClient()
  }
}
