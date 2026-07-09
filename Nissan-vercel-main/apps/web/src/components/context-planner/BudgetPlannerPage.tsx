import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CheckCircle2, Clock, IndianRupee, Info, Loader2, MinusCircle, PauseCircle, Target, Wallet,
} from 'lucide-react'
import { listContexts, type ContextResult } from '#/lib/context-planner'
import {
  planBudget,
  type BudgetPlanResult,
  type BudgetPriority,
  type ExecutionTask,
  type OptimizedStatus,
} from '#/lib/marketing-budget-planner'
import { Badge, Button, Panel } from '#/components/ui/kit'

const PRIORITY_TONE: Record<BudgetPriority, 'brand' | 'amber' | 'sky'> = {
  high: 'brand',
  medium: 'amber',
  low: 'sky',
}
const PRIORITY_RANK: Record<BudgetPriority, number> = { high: 0, medium: 1, low: 2 }

const STATUS_TONE: Record<OptimizedStatus, 'emerald' | 'amber' | 'rose'> = {
  included: 'emerald',
  deferred: 'amber',
  excluded: 'rose',
}
const STATUS_ICON: Record<OptimizedStatus, typeof CheckCircle2> = {
  included: CheckCircle2,
  deferred: PauseCircle,
  excluded: MinusCircle,
}

const inr = new Intl.NumberFormat('en-IN')

export function BudgetPlannerPage() {
  const [selectedId, setSelectedId] = useState<string>('')
  const [budget, setBudget] = useState<string>('100000')

  const recent = useQuery({
    queryKey: ['context-planner', 'contexts'],
    queryFn: () => listContexts({ data: { limit: 20 } }),
  })
  const contexts = useMemo<Array<ContextResult>>(
    () => (recent.data ?? []).filter((c) => c.status === 'ready'),
    [recent.data],
  )

  useEffect(() => {
    if (!selectedId && contexts.length > 0) setSelectedId(contexts[0].context_id)
  }, [contexts, selectedId])

  const mutation = useMutation({ mutationFn: planBudget })
  const selected = contexts.find((c) => c.context_id === selectedId)
  const result = mutation.data

  const userBudget = Math.max(0, Math.round(Number(budget) || 0))

  function generate() {
    if (selectedId && userBudget > 0) mutation.mutate({ data: { context_id: selectedId, user_budget: userBudget } })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <header className="fade-up flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-[var(--brand)]">
          <Wallet className="h-[18px] w-[18px]" />
        </div>
        <div>
          <div className="kicker text-muted-foreground/70">Context Planner</div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">Budget Planner</h1>
        </div>
      </header>

      {/* Picker + budget input */}
      <Panel className="fade-up p-5" style={{ animationDelay: '60ms' }}>
        <div className="mb-1 flex items-center gap-2">
          <Target className="h-[18px] w-[18px] text-[var(--brand)]" />
          <h2 className="font-display text-[17px] font-semibold text-foreground">AI Marketing Budget Planner</h2>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Pick an analyzed website and enter your monthly marketing budget (₹). The planner reads its recent
          analysis, recommends an ideal budget, allocates it across activities, and optimizes the plan to fit
          your budget — with an executable task list. It never re-runs SEO/AEO analysis.
        </p>

        {recent.isLoading ? (
          <p className="text-[13px] text-muted-foreground">Loading contexts…</p>
        ) : contexts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No analyzed websites yet.{' '}
            <Link to="/context-planner" className="brand-text hover:underline">Run an analysis</Link> first.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-foreground">Website</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="h-10 min-w-[260px] rounded-lg border border-border bg-background px-3 text-[13.5px] text-foreground focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_20%,transparent)]"
              >
                {contexts.map((c) => (
                  <option key={c.context_id} value={c.context_id}>
                    {c.company_name || c.website || c.url || 'Untitled'}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-foreground">Monthly budget (₹)</span>
              <div className="relative">
                <IndianRupee className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="number"
                  min={0}
                  step={5000}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="h-10 w-[180px] rounded-lg border border-border bg-background pl-9 pr-3 text-[13.5px] text-foreground focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_20%,transparent)]"
                />
              </div>
            </label>
            <Button variant="brand" onClick={generate} disabled={mutation.isPending || !selectedId || userBudget <= 0}>
              {mutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Planning…</>
              ) : result ? (
                <><Target className="h-4 w-4" /> Re-plan</>
              ) : (
                <><Target className="h-4 w-4" /> Generate plan</>
              )}
            </Button>
          </div>
        )}

        {mutation.isError ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to generate budget plan.'}
          </p>
        ) : null}
      </Panel>

      {/* Results */}
      {mutation.isPending ? (
        <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Studying {selected?.company_name || selected?.website || 'the analysis'} and building your budget plan…
        </div>
      ) : result?.status === 'no_analysis' ? (
        <Panel className="fade-up p-6 text-center">
          <p className="text-[13.5px] font-semibold text-foreground">No analysis found for this website yet.</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
            Run the Context Planner analysis first, then come back for a tailored marketing budget plan.
          </p>
          <Link
            to="/context-planner"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg brand-bg px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            Go to Context Planner
          </Link>
        </Panel>
      ) : result && result.budget_summary ? (
        <BudgetPlan result={result} />
      ) : null}
    </div>
  )
}

function BudgetPlan({ result }: { result: BudgetPlanResult }) {
  const s = result.budget_summary!
  const rec = result.recommended_budget_breakdown
  const opt = result.optimized_budget_breakdown
  const tasks = useMemo(
    () => [...result.execution_plan].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
    [result.execution_plan],
  )

  return (
    <div className="space-y-5">
      {/* Summary */}
      <Panel className="fade-up p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Info className="h-[18px] w-[18px] text-[var(--brand)]" />
            <h2 className="font-display text-[17px] font-semibold text-foreground">Budget summary</h2>
          </div>
          {result.engine === 'groq' ? <Badge tone="emerald">AI-generated</Badge> : <Badge tone="neutral">suggested</Badge>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Recommended" value={s.recommended_budget_display} tone="brand" />
          <Stat label="Your budget" value={s.user_budget_display} tone={s.fits_recommended ? 'emerald' : 'amber'} />
          <Stat label="Allocated (optimized)" value={s.optimized_total_display} tone="sky" />
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-foreground">{s.explanation}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{s.optimization_note}</p>
      </Panel>

      {/* Recommended allocation */}
      <Panel className="fade-up p-5">
        <SectionHead title="Recommended allocation" hint={`Totals ${s.recommended_budget_display} across ${rec.length} activities`} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Activity</th>
                <th className="py-2 pr-3 font-medium">Amount</th>
                <th className="py-2 pr-3 font-medium">Share</th>
                <th className="py-2 pr-3 font-medium">Priority</th>
                <th className="py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {rec.map((line) => (
                <tr key={line.activity} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-3 font-semibold text-foreground">{line.activity}</td>
                  <td className="py-2 pr-3 tabular-nums text-foreground">{line.amount_display}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">{line.share_pct}%</td>
                  <td className="py-2 pr-3"><Badge tone={PRIORITY_TONE[line.priority]} className="uppercase">{line.priority}</Badge></td>
                  <td className="py-2 text-[12.5px] leading-relaxed text-muted-foreground">{line.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Optimized allocation */}
      <Panel className="fade-up p-5">
        <SectionHead title="Optimized for your budget" hint={`${s.user_budget_display} budget · ${result.execution_plan.length} tasks funded`} />
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {opt.map((line) => {
            const Icon = STATUS_ICON[line.status]
            return (
              <div key={line.activity} className="rounded-lg border border-border bg-card/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className={`h-4 w-4 shrink-0 ${line.status === 'included' ? 'text-emerald-500' : line.status === 'deferred' ? 'text-amber-500' : 'text-rose-500'}`} />
                    <span className="truncate text-[13px] font-semibold text-foreground">{line.activity}</span>
                  </div>
                  <Badge tone={STATUS_TONE[line.status]} className="shrink-0 capitalize">{line.status}</Badge>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="tabular-nums text-[13px] text-foreground">{line.status === 'included' ? line.amount_display : '—'}</span>
                  <span className="text-[11.5px] text-muted-foreground">{line.note}</span>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* Comparison */}
      <Panel className="fade-up p-5">
        <SectionHead title="Recommended vs your budget" hint="What changes when you cap spend" />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Metric</th>
                <th className="py-2 pr-3 font-medium">Recommended</th>
                <th className="py-2 font-medium">Your budget</th>
              </tr>
            </thead>
            <tbody>
              {result.comparison_table.map((row) => (
                <tr key={row.metric} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-semibold text-foreground">{row.metric}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.recommended}</td>
                  <td className="py-2 tabular-nums text-foreground">{row.optimized}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Execution plan */}
      <Panel className="fade-up p-5">
        <SectionHead title="Execution plan" hint={`${tasks.length} tasks you can run in the platform`} />
        <div className="mt-3 grid gap-2.5">
          {tasks.map((t, i) => <TaskRow key={`${t.task_name}-${i}`} t={t} />)}
        </div>
      </Panel>

      {/* Recommendations */}
      {result.recommendations.length > 0 ? (
        <Panel className="fade-up p-5">
          <SectionHead title="Recommendations" hint="Where to focus for the best ROI" />
          <ul className="mt-3 space-y-3">
            {result.recommendations.map((r, i) => (
              <li key={`${r.title}-${i}`} className="border-l-2 border-[var(--brand)] pl-3">
                <div className="text-[13px] font-semibold text-foreground">{r.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{r.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'brand' | 'emerald' | 'amber' | 'sky' }) {
  const ring: Record<string, string> = {
    brand: 'text-[var(--brand)]',
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    sky: 'text-sky-500',
  }
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="kicker text-muted-foreground/70">{label}</div>
      <div className={`mt-0.5 font-display text-[20px] font-semibold tabular-nums ${ring[tone]}`}>{value}</div>
    </div>
  )
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="font-display text-[16px] font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>
    </div>
  )
}

function TaskRow({ t }: { t: ExecutionTask }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">{t.task_name}</span>
          <Badge tone={PRIORITY_TONE[t.priority]} className="uppercase">{t.priority}</Badge>
          <span className="kicker text-muted-foreground/70">{t.category}</span>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{t.expected_impact}</p>
      </div>
      <div className="shrink-0 text-right">
        <div className="flex items-center gap-1 text-[13px] font-semibold tabular-nums text-foreground">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />{t.estimated_cost_display}
        </div>
        <div className="text-[11px] text-muted-foreground">/ month</div>
      </div>
    </div>
  )
}
