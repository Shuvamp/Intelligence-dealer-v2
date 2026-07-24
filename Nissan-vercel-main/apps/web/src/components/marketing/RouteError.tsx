import { useRouter } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'

// Scoped loader-error boundary for the marketing routes. Without one, any loader
// throw (FastAPI down, DuckDB locked, expired session) escapes to the _authed
// boundary and takes the whole shell down instead of just this page.
//
// The thrown error is deliberately NOT rendered — loader errors here carry raw
// Supabase/Postgres text (table, constraint and policy names). It stays in the
// console for debugging.
export function MarketingRouteError({ title, reset }: { title: string; reset: () => void }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <AlertCircle className="h-6 w-6 text-muted-foreground" />
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      <p className="text-[13px] text-muted-foreground">
        The data could not be fetched. Check that the API server is running, then retry.
      </p>
      <button
        onClick={() => { reset(); void router.invalidate() }}
        className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Retry
      </button>
    </div>
  )
}
