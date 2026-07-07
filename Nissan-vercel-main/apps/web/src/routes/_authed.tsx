import { createFileRoute, redirect, Outlet, useRouter } from '@tanstack/react-router'
import { getSessionUser, signOut } from '#/lib/auth'
import { getDashboardData, type DashboardData } from '#/lib/queries'
import { AppShell } from '#/components/shell/AppShell'

const EMPTY_DASHBOARD: DashboardData = {
  customerCount: 0,
  unreadNotifications: 0,
  notifications: [],
  activity: [],
  metrics: { hotLeads: 0, testDrives: 0, campaignsScheduled: 0, pipelineValue: 0 },
}

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context }) => {
    // Use React Query cache — only hits the server on first load or after 60s.
    // beforeLoad itself has no stale-time, so without this it re-fetches every nav.
    const user = await context.queryClient.ensureQueryData({
      queryKey: ['session-user'],
      queryFn: () => getSessionUser(),
      staleTime: 60_000,
    })
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: async () => {
    try {
      return { dashboard: await getDashboardData() }
    } catch {
      return { dashboard: EMPTY_DASHBOARD }
    }
  },
  errorComponent: AuthErrorBoundary,
  component: AuthedLayout,
})

function AuthErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter()
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-center">
      <div className="text-[15px] font-semibold text-foreground">Something went wrong</div>
      <div className="max-w-sm text-[13px] text-muted-foreground">
        {error?.message ?? 'Unknown error'}
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => { reset(); void router.invalidate() }}
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Retry
        </button>
        <a
          href="/login"
          className="rounded-lg border border-border px-4 py-2 text-[13px] font-semibold text-foreground transition hover:bg-muted"
        >
          Back to login
        </a>
      </div>
    </div>
  )
}

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  const { dashboard } = Route.useLoaderData()

  async function handleSignOut() {
    await signOut()
    window.location.href = '/login'
  }

  return (
    <AppShell user={user} unread={dashboard.unreadNotifications} onSignOut={handleSignOut}>
      <Outlet />
    </AppShell>
  )
}
