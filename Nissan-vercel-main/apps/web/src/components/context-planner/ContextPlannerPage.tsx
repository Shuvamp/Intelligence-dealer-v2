import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Compass, Loader2, Sparkles, XCircle } from 'lucide-react'
import { createContext, listContexts } from '#/lib/context-planner'
import type { ContextResult } from '#/lib/context-planner'
import { Badge, Button, Panel } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import { AnalysisView } from './AnalysisView'

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground/50 focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_20%,transparent)] transition'
const TEXTAREA = `${INPUT} min-h-[80px] resize-y`

const EMPTY_MANUAL = {
  company_name: '', website: '', region: '', industry: '', products: '', services: '', description: '',
}

function statusTone(status: ContextResult['status']): 'emerald' | 'rose' | 'amber' | 'neutral' {
  if (status === 'ready') return 'emerald'
  if (status === 'invalid' || status === 'failed') return 'rose'
  return 'amber'
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  )
}

export function ContextPlannerPage() {
  const queryClient = useQueryClient()
  // Home shows the new-analysis form + recent list together. Picking a context
  // (or creating one) swaps to the full-width analysis; back returns home.
  const [analyzing, setAnalyzing] = useState<ContextResult | null>(null)
  const [autoRunId, setAutoRunId] = useState<string | null>(null)

  const [mode, setMode] = useState<'url' | 'manual'>('url')
  const [url, setUrl] = useState('')
  const [manual, setManual] = useState(EMPTY_MANUAL)

  const recent = useQuery({
    queryKey: ['context-planner', 'contexts'],
    queryFn: () => listContexts({ data: { limit: 20 } }),
  })

  const mutation = useMutation({
    mutationFn: createContext,
    onSuccess: (ctx) => {
      void queryClient.invalidateQueries({ queryKey: ['context-planner', 'contexts'] })
      if (ctx.status === 'ready') {
        setAnalyzing(ctx)
        setAutoRunId(ctx.context_id) // kick the pipeline for freshly created contexts
        setUrl('')
        setManual(EMPTY_MANUAL)
      }
    },
  })

  const contexts = useMemo(() => recent.data ?? [], [recent.data])

  function setManualField(field: keyof typeof EMPTY_MANUAL, value: string) {
    setManual((m) => ({ ...m, [field]: value }))
  }

  function openContext(c: ContextResult) {
    setAutoRunId(null) // existing context — show what's there, don't re-run
    setAnalyzing(c)
  }

  function backHome() {
    setAnalyzing(null)
    setAutoRunId(null)
    mutation.reset()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'url') {
      mutation.mutate({ data: { input_type: 'url', url: url.trim() } })
    } else {
      mutation.mutate({
        data: {
          input_type: 'manual',
          company_name: manual.company_name.trim() || undefined,
          website: manual.website.trim() || undefined,
          region: manual.region.trim() || undefined,
          industry: manual.industry.trim() || undefined,
          products: manual.products.trim() || undefined,
          services: manual.services.trim() || undefined,
          description: manual.description.trim() || undefined,
        },
      })
    }
  }

  const rejected = mutation.isSuccess && mutation.data.status !== 'ready'

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="fade-up flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-[var(--brand)]">
          <Compass className="h-[18px] w-[18px]" />
        </div>
        <div>
          <div className="kicker text-muted-foreground/70">Intelligence</div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">Context Planner</h1>
        </div>
      </header>

      {analyzing ? (
        // ---- Detail: a single context's analysis, full width ----
        <div className="fade-up mx-auto max-w-5xl space-y-4" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={backHome}
              aria-label="Back"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="kicker text-muted-foreground/70">Analysis</div>
              <h2 className="truncate font-display text-[20px] font-semibold tracking-tight text-foreground">
                {analyzing.company_name || analyzing.website || analyzing.url}
              </h2>
            </div>
            <Badge tone={statusTone(analyzing.status)}>{analyzing.status}</Badge>
          </div>
          <AnalysisView key={analyzing.context_id} context={analyzing} autoRun={autoRunId === analyzing.context_id} />
        </div>
      ) : (
        // ---- Home: new-analysis form + recent contexts (same page) ----
        <div className="mx-auto max-w-2xl space-y-4">
          <NewAnalysisForm
            mode={mode} setMode={setMode}
            url={url} setUrl={setUrl}
            manual={manual} setManualField={setManualField}
            onSubmit={handleSubmit}
            pending={mutation.isPending}
            rejected={rejected}
            rejectedErrors={rejected ? mutation.data.errors : []}
            error={mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : 'Failed to create context.') : null}
          />

          <Panel className="fade-up overflow-hidden" style={{ animationDelay: '120ms' }}>
            <div className="border-b border-border px-5 py-3">
              <span className="kicker text-muted-foreground/70">Recent</span>
            </div>
            {recent.isLoading ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>
            ) : contexts.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">No contexts yet — start a new analysis above.</p>
            ) : (
              <ul className="divide-y divide-border">
                {contexts.map((c) => (
                  <li key={c.context_id}>
                    <button
                      type="button"
                      onClick={() => openContext(c)}
                      className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-foreground">
                          {c.company_name || c.website || c.url || 'Untitled'}
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {c.industry || c.normalized_url || '—'}
                        </p>
                      </div>
                      <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

function NewAnalysisForm({
  mode, setMode, url, setUrl, manual, setManualField, onSubmit, pending, rejected, rejectedErrors, error,
}: {
  mode: 'url' | 'manual'
  setMode: (m: 'url' | 'manual') => void
  url: string
  setUrl: (v: string) => void
  manual: typeof EMPTY_MANUAL
  setManualField: (f: keyof typeof EMPTY_MANUAL, v: string) => void
  onSubmit: (e: React.FormEvent) => void
  pending: boolean
  rejected: boolean
  rejectedErrors: Array<string>
  error: string | null
}) {
  return (
    <Panel className="fade-up p-6" style={{ animationDelay: '60ms' }}>
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-[18px] w-[18px] text-[var(--brand)]" />
        <h2 className="font-display text-[18px] font-semibold text-foreground">New analysis</h2>
      </div>
      <p className="mb-5 text-[13px] text-muted-foreground">
        Enter a website and we&apos;ll crawl it, summarize the business, and score SEO &amp; AEO — in one run.
      </p>

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="inline-flex rounded-lg border border-border bg-muted p-1">
          {(['url', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-4 py-1.5 text-[13px] font-semibold transition',
                mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'url' ? 'Website URL' : 'Manual entry'}
            </button>
          ))}
        </div>

        {mode === 'url' ? (
          <Field label="Website URL" required>
            <div className="flex gap-2">
              <input className={INPUT} placeholder="e.g. nissanindia.in" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
              <Button type="submit" variant="brand" disabled={pending || !url.trim()} className="shrink-0">
                {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</> : <><Sparkles className="h-4 w-4" /> Analyze</>}
              </Button>
            </div>
          </Field>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company Name" required>
                <input className={INPUT} placeholder="ABC Nissan" value={manual.company_name} onChange={(e) => setManualField('company_name', e.target.value)} />
              </Field>
              <Field label="Website">
                <input className={INPUT} placeholder="abcnissan.in" value={manual.website} onChange={(e) => setManualField('website', e.target.value)} />
              </Field>
              <Field label="Region">
                <input className={INPUT} placeholder="Tamil Nadu, India" value={manual.region} onChange={(e) => setManualField('region', e.target.value)} />
              </Field>
              <Field label="Industry" required>
                <input className={INPUT} placeholder="Automotive Dealership" value={manual.industry} onChange={(e) => setManualField('industry', e.target.value)} />
              </Field>
              <Field label="Products">
                <input className={INPUT} placeholder="Magnite, Kicks, X-Trail" value={manual.products} onChange={(e) => setManualField('products', e.target.value)} />
              </Field>
              <Field label="Services">
                <input className={INPUT} placeholder="Sales, Service, Financing" value={manual.services} onChange={(e) => setManualField('services', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Company Description" required>
                  <textarea className={TEXTAREA} placeholder="Authorized Nissan dealer serving Chennai since 2015…" value={manual.description} onChange={(e) => setManualField('description', e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="brand" disabled={pending}>
                {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><Compass className="h-4 w-4" /> Create context</>}
              </Button>
            </div>
          </>
        )}

        {rejected ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <ul className="list-inside list-disc space-y-0.5">
              {rejectedErrors.length > 0 ? rejectedErrors.map((e, i) => <li key={i}>{e}</li>) : <li>Submission could not be processed.</li>}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">{error}</p>
        ) : null}
      </form>
    </Panel>
  )
}
