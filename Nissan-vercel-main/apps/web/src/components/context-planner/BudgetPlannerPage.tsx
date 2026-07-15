import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle, BarChart3, Calendar, Car, CheckCircle2, Globe, IndianRupee, Layers, Lightbulb,
  Loader2, Mail, Map, Megaphone, MessageSquare, Search, Search as SeoIcon,
  Share2, ShoppingBag, Sliders, Sparkles, ThumbsUp, TrendingUp, Trophy, Users, Video, Wallet, Wrench,
} from 'lucide-react'
import { listContexts, type ContextResult } from '#/lib/context-planner'
import {
  planBudget,
  type BudgetLine,
  type BudgetPlanResult,
  type BudgetPriority,
  type BusinessImpact,
  type InsightCategory,
  type MarketingObjective,
} from '#/lib/marketing-budget-planner'
import { Badge, Button, Panel } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts'

const OBJECTIVES: Array<{ value: MarketingObjective; label: string }> = [
  { value: 'lead_generation', label: 'Lead Generation' },
  { value: 'vehicle_sales', label: 'Vehicle Sales' },
  { value: 'brand_awareness', label: 'Brand Awareness' },
  { value: 'website_traffic', label: 'Website Traffic' },
  { value: 'customer_engagement', label: 'Customer Engagement' },
]

const PREFERRED_CHANNEL_OPTIONS = [
  'Google Search Ads', 'Meta Ads', 'SEO', 'YouTube Ads', 'Email Marketing', 'Social Media',
]

// Validated categorical palette (dataviz skill reference palette, light mode) — fixed order,
// never cycled. 8 slots for 9 activities: the lowest-weight activity folds into the chart's
// "Other" bucket (see toChartRows) rather than generating a 9th hue.
const ACTIVITY_META: Record<string, { icon: typeof Search; color: string }> = {
  'Google Ads':                 { icon: Megaphone, color: '#2a78d6' },
  'Meta Ads':                   { icon: ThumbsUp, color: '#1baf7a' },
  'SEO Content':                { icon: SeoIcon, color: '#eda100' },
  'Landing Page Optimization':  { icon: Layers, color: '#008300' },
  'AI Search Optimization':     { icon: Sparkles, color: '#4a3aa7' },
  'Social Media':                { icon: Share2, color: '#e34948' },
  'Email Marketing':            { icon: Mail, color: '#e87ba4' },
  'Video Content':               { icon: Video, color: '#eb6834' },
  'Marketing Tools':            { icon: Wrench, color: '#9CA3AF' },
}
const OTHER_META = { icon: Wrench, color: '#9CA3AF' }

const PRIORITY_TONE: Record<BudgetPriority, 'brand' | 'amber' | 'sky'> = {
  high: 'brand',
  medium: 'amber',
  low: 'sky',
}

const IMPACT_TILES: Array<{ key: keyof BusinessImpact & string; displayKey: keyof BusinessImpact & string; label: string; icon: typeof Users; tone: 'brand' | 'emerald' | 'amber' | 'sky' }> = [
  { key: 'expected_leads', displayKey: 'expected_leads_display', label: 'Expected Leads', icon: Users, tone: 'brand' },
  { key: 'website_traffic', displayKey: 'website_traffic_display', label: 'Website Traffic', icon: Globe, tone: 'sky' },
  { key: 'customer_enquiries', displayKey: 'customer_enquiries_display', label: 'Customer Enquiries', icon: MessageSquare, tone: 'amber' },
  { key: 'test_drive_bookings', displayKey: 'test_drive_bookings_display', label: 'Test Drive Bookings', icon: Car, tone: 'emerald' },
  { key: 'vehicle_sales', displayKey: 'vehicle_sales_display', label: 'Est. Vehicle Sales', icon: ShoppingBag, tone: 'brand' },
  { key: 'estimated_roi_pct', displayKey: 'estimated_roi_display', label: 'Predicted ROI', icon: TrendingUp, tone: 'emerald' },
]

const INSIGHT_META: Record<InsightCategory, { label: string; icon: typeof Trophy; tone: 'brand' | 'emerald' | 'amber' | 'sky' | 'rose'; iconClass: string }> = {
  best_channel: { label: 'Best-performing channel', icon: Trophy, tone: 'emerald', iconClass: 'text-emerald-500' },
  optimization: { label: 'Budget optimization', icon: Sliders, tone: 'sky', iconClass: 'text-sky-500' },
  growth: { label: 'Long-term growth', icon: TrendingUp, tone: 'brand', iconClass: 'text-[var(--brand)]' },
  risk: { label: 'Potential risk', icon: AlertTriangle, tone: 'rose', iconClass: 'text-rose-500' },
  tip: { label: 'Marketing tip', icon: Lightbulb, tone: 'amber', iconClass: 'text-amber-500' },
}

function compactINR(n: number) {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`
  return `₹${n}`
}

// Sorted desc, top 7 kept individually, the rest folded into "Other" — matches
// the 8-slot categorical palette exactly instead of generating a 9th hue.
function toChartRows(lines: Array<BudgetLine>) {
  const sorted = [...lines].sort((a, b) => b.amount - a.amount)
  const head = sorted.slice(0, 7)
  const rest = sorted.slice(7)
  const rows = head.map((l) => ({
    activity: l.activity,
    amount: l.amount,
    amount_display: l.amount_display,
    share_pct: l.share_pct,
    color: ACTIVITY_META[l.activity]?.color ?? OTHER_META.color,
  }))
  if (rest.length > 0) {
    const amount = rest.reduce((t, l) => t + l.amount, 0)
    const share_pct = rest.reduce((t, l) => t + l.share_pct, 0)
    rows.push({ activity: `Other (${rest.length})`, amount, amount_display: compactINR(amount), share_pct: Math.round(share_pct * 10) / 10, color: OTHER_META.color })
  }
  return rows
}

export function BudgetPlannerPage() {
  const [selectedId, setSelectedId] = useState<string>('')
  const [budget, setBudget] = useState<string>('100000')
  const [objective, setObjective] = useState<MarketingObjective>('lead_generation')
  const [durationDays, setDurationDays] = useState<string>('30')
  const [targetAudience, setTargetAudience] = useState<string>('')
  const [vehicleCategory, setVehicleCategory] = useState<string>('')
  const [region, setRegion] = useState<string>('')
  const [preferredChannels, setPreferredChannels] = useState<Array<string>>([])

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

  const selected = contexts.find((c) => c.context_id === selectedId)
  useEffect(() => {
    if (selected?.region) setRegion(selected.region)
  }, [selected?.context_id])

  const mutation = useMutation({ mutationFn: planBudget })
  const result = mutation.data

  const userBudget = Math.max(0, Math.round(Number(budget) || 0))
  const campaignFields = {
    objective,
    campaign_duration_days: Math.max(1, Math.round(Number(durationDays) || 30)),
    target_audience: targetAudience || undefined,
    vehicle_category: vehicleCategory || undefined,
    preferred_channels: preferredChannels.length > 0 ? preferredChannels : undefined,
    region: region || undefined,
  }

  function generate() {
    if (selectedId && userBudget > 0) {
      mutation.mutate({ data: { context_id: selectedId, user_budget: userBudget, ...campaignFields } })
    }
  }

  function toggleChannel(channel: string) {
    setPreferredChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <header className="fade-up flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card text-[var(--brand)]">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <div className="kicker flex items-center gap-1.5 text-muted-foreground/70">
            <Sparkles className="h-3 w-3" /> AI Marketing Consultant
          </div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">Budget Planner</h1>
        </div>
      </header>

      {/* Budget Input Card */}
      <Panel className="fade-up p-5" style={{ animationDelay: '60ms' }}>
        <h2 className="font-display text-[17px] font-semibold text-foreground">Plan your campaign</h2>
        <p className="mb-4 mt-1 text-[13px] text-muted-foreground">
          Tell us the budget and goal — the AI reads your website's recent SEO/AEO analysis and recommends
          how to split spend across channels, with predicted business impact.
        </p>

        {recent.isLoading ? (
          <p className="text-[13px] text-muted-foreground">Loading analyzed websites…</p>
        ) : contexts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No analyzed websites yet.{' '}
            <Link to="/context-planner" className="brand-text hover:underline">Run an analysis</Link> first.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Website">
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className={inputClass}
                >
                  {contexts.map((c) => (
                    <option key={c.context_id} value={c.context_id}>
                      {c.company_name || c.website || c.url || 'Untitled'}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Total marketing budget (₹)" icon={IndianRupee}>
                <input
                  type="number" min={0} step={5000} value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Business goal">
                <select value={objective} onChange={(e) => setObjective(e.target.value as MarketingObjective)} className={inputClass}>
                  {OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>

              <Field label="Campaign duration (days)" icon={Calendar}>
                <input
                  type="number" min={1} step={15} value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Target audience" icon={Users} optional>
                <input
                  type="text" placeholder="e.g. First-time SUV buyers" value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Region" icon={Map}>
                <input
                  type="text" placeholder="e.g. Chennai" value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Vehicle category" optional>
                <input
                  type="text" placeholder="e.g. Magnite, X-Trail" value={vehicleCategory}
                  onChange={(e) => setVehicleCategory(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="mt-4">
              <span className="text-[13px] font-semibold text-foreground">
                Preferred channels <span className="font-normal text-muted-foreground">(optional — focuses spend, doesn't exclude others)</span>
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {PREFERRED_CHANNEL_OPTIONS.map((channel) => {
                  const active = preferredChannels.includes(channel)
                  return (
                    <button
                      key={channel} type="button" onClick={() => toggleChannel(channel)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[12.5px] font-medium transition',
                        active
                          ? 'border-[var(--brand)] bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] text-[var(--brand)]'
                          : 'border-border bg-card/40 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {channel}
                    </button>
                  )
                })}
              </div>
            </div>

            <Button
              variant="brand" onClick={generate}
              disabled={mutation.isPending || !selectedId || userBudget <= 0}
              className="mt-5"
            >
              {mutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Generate AI Recommendation</>
              )}
            </Button>
          </>
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
          <Loader2 className="h-4 w-4 animate-spin" /> Studying {selected?.company_name || selected?.website || 'the analysis'} and building your recommendation…
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
        <Dashboard result={result} contextId={selectedId} campaignFields={campaignFields} />
      ) : null}
    </div>
  )
}

const inputClass = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-[13.5px] text-foreground focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_20%,transparent)]'

function Field({ label, icon: Icon, optional, children }: { label: string; icon?: typeof Users; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {label} {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </span>
      {children}
    </label>
  )
}

// ── Dashboard (result-dependent sections) ───────────────────────────────────

function Dashboard({
  result, contextId, campaignFields,
}: {
  result: BudgetPlanResult
  contextId: string
  campaignFields: {
    objective: MarketingObjective
    campaign_duration_days: number
    target_audience?: string
    vehicle_category?: string
    preferred_channels?: Array<string>
    region?: string
  }
}) {
  const s = result.budget_summary!
  const rec = result.recommended_budget_breakdown
  const chartRows = useMemo(() => toChartRows(rec), [rec])

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <Panel className="fade-up p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[17px] font-semibold text-foreground">Budget summary</h2>
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

      {/* AI Recommended Budget Allocation */}
      <Panel className="fade-up p-5">
        <SectionHead title="AI Recommended Budget Allocation" hint={`Totals ${s.recommended_budget_display} across ${rec.length} channels`} icon={BarChart3} />
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={Math.max(220, chartRows.length * 42)}>
            <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" horizontal={false} />
              <XAxis type="number" tickFormatter={compactINR} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
              <YAxis type="category" dataKey="activity" width={150} tick={{ fontSize: 12, fill: '#4B5563' }} />
              <Tooltip
                formatter={(_v: unknown, _n: unknown, item: { payload?: { amount_display?: string; share_pct?: number } }) =>
                  [`${item?.payload?.amount_display ?? ''} · ${item?.payload?.share_pct ?? 0}%`, 'Budget']}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }}
              />
              <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                {chartRows.map((r) => <Cell key={r.activity} fill={r.color} />)}
                <LabelList dataKey="amount_display" position="right" style={{ fontSize: 11, fill: '#4B5563', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rec.map((line) => {
            const meta = ACTIVITY_META[line.activity] ?? OTHER_META
            const Icon = meta.icon
            return (
              <div key={line.activity} className="rounded-lg border border-border bg-card/40 p-3.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                    style={{ background: `${meta.color}1A`, color: meta.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-foreground">{line.activity}</div>
                    <div className="text-[11.5px] text-muted-foreground">{line.share_pct}% of budget</div>
                  </div>
                  <Badge tone={PRIORITY_TONE[line.priority]} className="ml-auto shrink-0 uppercase">{line.priority}</Badge>
                </div>
                <div className="mt-2.5 flex items-baseline justify-between">
                  <span className="font-display text-[17px] font-semibold tabular-nums text-foreground">{line.amount_display}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{line.rationale}</p>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* Expected Business Impact */}
      {result.business_impact ? <BusinessImpactPanel impact={result.business_impact} /> : null}

      {/* AI Business Insights */}
      {result.recommendations.length > 0 ? (
        <Panel className="fade-up p-5">
          <SectionHead title="AI Business Insights" hint="What the model wants you to know before you spend" icon={Sparkles} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.recommendations.map((r) => {
              const meta = INSIGHT_META[r.category] ?? INSIGHT_META.tip
              const Icon = meta.icon
              return (
                <div key={r.category} className="rounded-lg border border-border bg-card/40 p-3.5">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('h-4 w-4', meta.iconClass)} />
                    <span className="kicker text-muted-foreground/70">{meta.label}</span>
                  </div>
                  <div className="mt-1.5 text-[13px] font-semibold text-foreground">{r.title}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{r.detail}</p>
                </div>
              )
            })}
          </div>
        </Panel>
      ) : null}

      {/* What-If Analysis */}
      <WhatIfPanel contextId={contextId} campaignFields={campaignFields} recommendedBudget={result.recommended_budget} />

      {/* Execution plan */}
      {result.execution_plan.length > 0 ? (
        <Panel className="fade-up p-5">
          <SectionHead title="Recommended action plan" hint={`${result.execution_plan.length} tasks you can run in the platform`} icon={CheckCircle2} />
          <div className="mt-3 grid gap-2.5">
            {[...result.execution_plan]
              .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
              .map((t, i) => {
                const meta = ACTIVITY_META[t.category] ?? OTHER_META
                const Icon = meta.icon
                return (
                  <div key={`${t.task_name}-${i}`} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card/40 p-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: `${meta.color}1A`, color: meta.color }}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-foreground">{t.task_name}</span>
                          <Badge tone={PRIORITY_TONE[t.priority]} className="uppercase">{t.priority}</Badge>
                        </div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{t.expected_impact}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[13px] font-semibold tabular-nums text-foreground">{t.estimated_cost_display}</div>
                      <div className="text-[11px] text-muted-foreground">/ month</div>
                    </div>
                  </div>
                )
              })}
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

function SectionHead({ title, hint, icon: Icon }: { title: string; hint: string; icon: typeof Search }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-[18px] w-[18px] text-[var(--brand)]" />
      <div>
        <h2 className="font-display text-[16px] font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>
      </div>
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
      <div className={cn('mt-0.5 font-display text-[20px] font-semibold tabular-nums', ring[tone])}>{value}</div>
    </div>
  )
}

function BusinessImpactPanel({ impact }: { impact: { recommended: BusinessImpact; optimized: BusinessImpact } }) {
  const [variant, setVariant] = useState<'recommended' | 'optimized'>('optimized')
  const data = impact[variant]

  return (
    <Panel className="fade-up p-5">
      <div className="flex items-center justify-between gap-3">
        <SectionHead title="Expected Business Impact" hint="Projections, not guarantees" icon={TrendingUp} />
        <div className="flex gap-1 rounded-lg border border-border bg-card/40 p-0.5">
          {(['optimized', 'recommended'] as const).map((v) => (
            <button
              key={v} type="button" onClick={() => setVariant(v)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-semibold capitalize transition',
                variant === v ? 'brand-bg text-white' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {IMPACT_TILES.map((tile) => {
          const Icon = tile.icon
          const ring: Record<string, string> = { brand: 'text-[var(--brand)]', emerald: 'text-emerald-500', amber: 'text-amber-500', sky: 'text-sky-500' }
          return (
            <div key={tile.key} className="rounded-lg border border-border bg-card/40 p-3.5">
              <div className="flex items-center gap-2">
                <Icon className={cn('h-4 w-4', ring[tile.tone])} />
                <span className="kicker text-muted-foreground/70">{tile.label}</span>
              </div>
              <div className={cn('mt-1.5 font-display text-[20px] font-semibold tabular-nums', ring[tile.tone])}>
                {data[tile.displayKey] as string}
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function WhatIfPanel({
  contextId, campaignFields, recommendedBudget,
}: {
  contextId: string
  campaignFields: {
    objective: MarketingObjective
    campaign_duration_days: number
    target_audience?: string
    vehicle_category?: string
    preferred_channels?: Array<string>
    region?: string
  }
  recommendedBudget: number
}) {
  const min = Math.max(5_000, Math.round((recommendedBudget * 0.5) / 5_000) * 5_000)
  const max = Math.max(min + 5_000, Math.round((recommendedBudget * 2) / 5_000) * 5_000)

  const [sliderBudget, setSliderBudget] = useState<number>(recommendedBudget)
  useEffect(() => setSliderBudget(recommendedBudget), [recommendedBudget])

  const whatIf = useMutation({ mutationFn: planBudget })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      whatIf.mutate({ data: { context_id: contextId, user_budget: sliderBudget, ...campaignFields, skip_llm: true } })
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderBudget, contextId])

  const impact = whatIf.data?.business_impact?.optimized
  const allocated = whatIf.data?.budget_summary?.optimized_total_display

  return (
    <Panel className="fade-up p-5">
      <SectionHead title="What-If Analysis" hint="Drag the slider to see recommendations and impact update instantly" icon={Sliders} />
      <div className="mt-4">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">₹{min.toLocaleString('en-IN')}</span>
          <span className="font-display text-[18px] font-semibold text-[var(--brand)]">₹{sliderBudget.toLocaleString('en-IN')}</span>
          <span className="text-muted-foreground">₹{max.toLocaleString('en-IN')}</span>
        </div>
        <input
          type="range" min={min} max={max} step={5000} value={sliderBudget}
          onChange={(e) => setSliderBudget(Number(e.target.value))}
          className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--brand)]"
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Allocated" value={whatIf.isPending ? '…' : allocated ?? '—'} tone="sky" />
        <Stat label="Expected Leads" value={whatIf.isPending ? '…' : impact?.expected_leads_display ?? '—'} tone="brand" />
        <Stat label="Est. Vehicle Sales" value={whatIf.isPending ? '…' : impact?.vehicle_sales_display ?? '—'} tone="emerald" />
        <Stat label="Predicted ROI" value={whatIf.isPending ? '…' : impact?.estimated_roi_display ?? '—'} tone="amber" />
      </div>
      {whatIf.isPending ? (
        <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Recalculating…
        </div>
      ) : null}
    </Panel>
  )
}
