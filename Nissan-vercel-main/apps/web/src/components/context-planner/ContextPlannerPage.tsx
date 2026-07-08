import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Compass, Loader2, CheckCircle2, XCircle, Copy, Check, ArrowRight } from 'lucide-react'
import { createContext, listContexts, type ContextResult } from '#/lib/context-planner'
import { Button, Badge, Drawer } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import { CompanySummaryPanel } from './CompanySummaryPanel'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground/50 focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_20%,transparent)] transition'
const TEXTAREA = `${INPUT} min-h-[88px] resize-y`

const EMPTY_MANUAL = {
  company_name: '',
  website: '',
  region: '',
  industry: '',
  products: '',
  services: '',
  description: '',
}

function statusTone(status: ContextResult['status']): 'emerald' | 'rose' | 'amber' | 'neutral' {
  if (status === 'ready') return 'emerald'
  if (status === 'invalid' || status === 'failed') return 'rose'
  return 'amber'
}

export function ContextPlannerPage() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'url' | 'manual'>('url')
  const [url, setUrl] = useState('')
  const [manual, setManual] = useState(EMPTY_MANUAL)
  const [copied, setCopied] = useState(false)
  const [selectedContext, setSelectedContext] = useState<ContextResult | null>(null)

  const mutation = useMutation({
    mutationFn: createContext,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['context-planner', 'contexts'] })
    },
  })

  const recent = useQuery({
    queryKey: ['context-planner', 'contexts'],
    queryFn: () => listContexts({ data: { limit: 20 } }),
  })

  function setManualField(field: keyof typeof EMPTY_MANUAL, value: string) {
    setManual((m) => ({ ...m, [field]: value }))
  }

  function reset() {
    mutation.reset()
    setUrl('')
    setManual(EMPTY_MANUAL)
    setCopied(false)
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

  const result = mutation.data
  const succeeded = mutation.isSuccess && result?.status === 'ready'
  const rejected = mutation.isSuccess && result?.status !== 'ready'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="fade-up flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-[var(--brand)]">
          <Compass className="h-[18px] w-[18px]" />
        </div>
        <div>
          <div className="kicker text-muted-foreground/70">Intelligence</div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">Context Planner</h1>
        </div>
      </div>

      {succeeded && result ? (
        <div className="fade-up mx-auto max-w-lg pt-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="font-display text-[22px] font-semibold text-foreground">Context created</h2>
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            This context is ready for the next phase of analysis.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <code className="rounded-lg border border-border bg-muted px-3 py-1.5 text-[12.5px] text-foreground">
              {result.context_id}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(result.context_id)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Copy context ID"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <Badge tone="emerald">ready</Badge>
          </div>
          <div className="mt-6 flex justify-center">
            <Button variant="brand" onClick={reset}>
              Plan another
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="fade-up space-y-6" style={{ animationDelay: '60ms' }}>
          {/* Mode toggle */}
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
                {m === 'url' ? 'Website URL' : 'Manual Company Entry'}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            {mode === 'url' ? (
              <Field label="Website URL" required>
                <input
                  className={INPUT}
                  placeholder="e.g. nissanindia.in"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company Name" required>
                  <input
                    className={INPUT}
                    placeholder="ABC Nissan"
                    value={manual.company_name}
                    onChange={(e) => setManualField('company_name', e.target.value)}
                  />
                </Field>
                <Field label="Website">
                  <input
                    className={INPUT}
                    placeholder="abcnissan.in"
                    value={manual.website}
                    onChange={(e) => setManualField('website', e.target.value)}
                  />
                </Field>
                <Field label="Region">
                  <input
                    className={INPUT}
                    placeholder="Tamil Nadu, India"
                    value={manual.region}
                    onChange={(e) => setManualField('region', e.target.value)}
                  />
                </Field>
                <Field label="Industry" required>
                  <input
                    className={INPUT}
                    placeholder="Automotive Dealership"
                    value={manual.industry}
                    onChange={(e) => setManualField('industry', e.target.value)}
                  />
                </Field>
                <Field label="Products">
                  <input
                    className={INPUT}
                    placeholder="Magnite, Kicks, X-Trail"
                    value={manual.products}
                    onChange={(e) => setManualField('products', e.target.value)}
                  />
                </Field>
                <Field label="Services">
                  <input
                    className={INPUT}
                    placeholder="Sales, Service, Financing"
                    value={manual.services}
                    onChange={(e) => setManualField('services', e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Company Description" required>
                    <textarea
                      className={TEXTAREA}
                      placeholder="Authorized Nissan dealer serving Chennai since 2015…"
                      value={manual.description}
                      onChange={(e) => setManualField('description', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>

          {rejected && result && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <ul className="list-inside list-disc space-y-0.5">
                {result.errors.length > 0 ? (
                  result.errors.map((e, i) => <li key={i}>{e}</li>)
                ) : (
                  <li>Submission could not be processed.</li>
                )}
              </ul>
            </div>
          )}

          {mutation.isError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to create context.'}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pb-4">
            <Button type="submit" variant="brand" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Compass className="h-4 w-4" /> Create context
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {/* Recent contexts */}
      <div className="fade-up rounded-xl border border-border bg-card p-5 shadow-sm" style={{ animationDelay: '120ms' }}>
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Recent contexts
        </p>
        {recent.isLoading ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : !recent.data || recent.data.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No contexts created yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.data.map((c) => {
              const clickable = c.input_type === 'url' && c.status === 'ready'
              return (
                <li
                  key={c.context_id}
                  onClick={clickable ? () => setSelectedContext(c) : undefined}
                  className={cn(
                    'flex items-center justify-between gap-3 py-2.5',
                    clickable && 'cursor-pointer rounded-lg px-2 -mx-2 transition hover:bg-muted',
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-foreground">
                      {c.company_name || c.website || c.url || 'Untitled context'}
                    </p>
                    <p className="truncate text-[12px] text-muted-foreground">{c.industry || c.normalized_url || '—'}</p>
                  </div>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Drawer
        open={!!selectedContext}
        onClose={() => setSelectedContext(null)}
        title={
          <div>
            <div className="kicker text-muted-foreground/70">Company Summary</div>
            <h3 className="text-[15px] font-semibold text-foreground">
              {selectedContext?.company_name || selectedContext?.website || selectedContext?.url}
            </h3>
          </div>
        }
      >
        {selectedContext && (
          <div className="space-y-5">
            <CompanySummaryPanel context={selectedContext} />
            <Link
              to="/analysis/$contextId"
              params={{ contextId: selectedContext.context_id }}
              className="inline-flex items-center gap-1.5 rounded-lg brand-bg px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              Open Full Analysis <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </Drawer>
    </div>
  )
}
