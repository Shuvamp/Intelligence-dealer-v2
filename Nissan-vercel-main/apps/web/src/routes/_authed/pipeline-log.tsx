import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Panel, Badge } from '#/components/ui/kit'

type LogEntry = {
  type: 'success' | 'failure'
  timestamp: string
  source: string
  // success
  lead_id?: string
  customer_name?: string
  phone?: string
  vehicle?: string
  score?: string
  is_duplicate?: boolean
  // failure
  name?: string
  errors?: string[]
}

const getIntakeLogs = createServerFn({ method: 'GET' }).handler(async () => {
  const apiUrl =
    (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
  try {
    const res = await fetch(`${apiUrl}/intake/logs`)
    if (!res.ok) return [] as LogEntry[]
    return res.json() as Promise<LogEntry[]>
  } catch {
    return [] as LogEntry[]
  }
})

export const Route = createFileRoute('/_authed/pipeline-log')({
  loader: () => getIntakeLogs(),
  component: PipelineLogPage,
})

function PipelineLogPage() {
  const initial = Route.useLoaderData()
  const [logs, setLogs] = useState<LogEntry[]>(initial)

  useEffect(() => {
    const id = setInterval(async () => {
      const fresh = await getIntakeLogs()
      setLogs(fresh)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const successes = logs.filter((l) => l.type === 'success')
  const failures = logs.filter((l) => l.type === 'failure')

  return (
    <div className="fade-up space-y-6">
      <div>
        <div className="kicker text-muted-foreground/70">Lead Intake</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-tight text-foreground">
          Pipeline Log
        </h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Live log of form → intake → validator → DB. Auto-refreshes every 5 s.
        </p>
      </div>

      {/* ── Successes ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <h2 className="text-[14px] font-semibold text-foreground">
            Successful Inserts ({successes.length})
          </h2>
        </div>
        <Panel className="overflow-hidden">
          {successes.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
              No successful inserts yet — submit the form at{' '}
              <a href="/enquire" className="underline">
                /enquire
              </a>{' '}
              or use the{' '}
              <a href="/leads/new" className="underline">
                Add Lead
              </a>{' '}
              form.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1.4fr_1fr_1fr_0.6fr_0.6fr_1fr] gap-3 border-b border-border bg-muted/40 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <div>Customer</div>
                <div>Phone</div>
                <div>Vehicle</div>
                <div>Score</div>
                <div>Source</div>
                <div>Time</div>
              </div>
              <ul className="divide-y divide-border">
                {successes.map((e, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[1.4fr_1fr_1fr_0.6fr_0.6fr_1fr] items-center gap-3 px-5 py-3 text-[13px]"
                  >
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      {e.customer_name ?? '—'}
                      {e.is_duplicate && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                          duplicate
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground">{e.phone ?? '—'}</div>
                    <div className="text-foreground">{e.vehicle ?? '—'}</div>
                    <div>
                      <Badge tone={SCORE_TONE[e.score ?? ''] ?? 'neutral'}>{e.score ?? '—'}</Badge>
                    </div>
                    <div>
                      <Badge tone={SOURCE_TONE[e.source] ?? 'neutral'}>{e.source}</Badge>
                    </div>
                    <div className="text-[12px] text-muted-foreground">{fmtTime(e.timestamp)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </section>

      {/* ── Failures ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4 text-rose-500" />
          <h2 className="text-[14px] font-semibold text-foreground">
            Validation Failures ({failures.length})
          </h2>
        </div>
        <Panel className="overflow-hidden">
          {failures.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
              No failures recorded.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_1fr_2.5fr_1fr] gap-3 border-b border-border bg-muted/40 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <div>Name</div>
                <div>Phone</div>
                <div>Reason</div>
                <div>Time</div>
              </div>
              <ul className="divide-y divide-border">
                {failures.map((e, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[1fr_1fr_2.5fr_1fr] items-center gap-3 px-5 py-3 text-[13px]"
                  >
                    <div className="text-foreground">{e.name ?? '—'}</div>
                    <div className="text-muted-foreground">{e.phone ?? '—'}</div>
                    <div className="text-[12px] text-rose-500">
                      {(e.errors ?? []).join(' · ')}
                    </div>
                    <div className="text-[12px] text-muted-foreground">{fmtTime(e.timestamp)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </section>
    </div>
  )
}

const SCORE_TONE: Record<string, 'emerald' | 'amber' | 'sky' | 'rose' | 'neutral'> = {
  hot: 'rose',
  warm: 'amber',
  cold: 'sky',
}

const SOURCE_TONE: Record<string, 'sky' | 'rose' | 'emerald' | 'neutral'> = {
  website: 'emerald',
  facebook: 'sky',
  instagram: 'rose',
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
