import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Gauge, Loader2 } from 'lucide-react'
import { signIn, getSessionUser } from '#/lib/auth'
import { Button } from '#/components/ui/kit'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const user = await getSessionUser()
    if (user) throw redirect({ to: '/dashboard', search: { preset: 'last30' } })
  },
  component: LoginPage,
})

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await signIn({ data: { email, password } })
      if (!res.ok) {
        setError(res.message)
        return
      }
      // Hard navigation: load /dashboard fresh via SSR with the new session cookie.
      // (A client-side navigate races the in-flight session fetch and aborts it.)
      window.location.href = '/dashboard'
      return
    } catch {
      setError('Sign in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(700px 380px at 12% 8%, color-mix(in oklab, var(--brand) 32%, transparent), transparent 60%), radial-gradient(600px 360px at 92% 100%, rgba(70,90,140,0.35), transparent 60%)',
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg brand-bg">
            <Gauge className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <span className="text-[15px] font-bold tracking-tight">Dealer Intelligence OS</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-[40px] leading-[1.05] text-white">
            The operating system for modern dealerships.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            Marketing, leads, intelligence and an executive copilot — unified around one
            customer, powered by AI.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {['Customer 360', 'AI Lead Scoring', 'Campaign Automation', 'Market Signals'].map(
              (t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-medium text-white/80"
                >
                  {t}
                </span>
              ),
            )}
          </div>
        </div>

        <div className="relative text-[12px] text-white/40">
          © 2026 Dealer Intelligence OS · Built for Nissan dealers
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-lg brand-bg">
              <Gauge className="h-5 w-5 text-white" strokeWidth={2.2} />
            </div>
          </div>
          <h2 className="mt-6 text-[24px] font-bold tracking-tight text-foreground lg:mt-0">
            Welcome back
          </h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Sign in to your dealership workspace.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                autoComplete="current-password"
                required
              />
            </Field>

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
                {error}
              </div>
            ) : null}

            <Button variant="brand" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-foreground">{label}</span>
      {children}
    </label>
  )
}
