import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Award, Calendar, Car, Gift, Heart, Lightbulb, Loader2, Mail, MapPin, Megaphone,
  Rocket, Share2, Sparkles, Star, Store, Target, Users, type LucideIcon,
} from 'lucide-react'
import { listContexts, type ContextResult } from '#/lib/context-planner'
import { suggestStrategies, type MarketingStrategy, type StrategyPriority } from '#/lib/marketing-strategy'
import { Badge, Button, Panel } from '#/components/ui/kit'

const CATEGORY_ICON: Record<string, LucideIcon> = {
  Events: Calendar,
  'Dealer Events': Store,
  'Influencer Collaborations': Users,
  'Regional Influencers': Users,
  'Celebrity Partnerships': Star,
  'Content Marketing': Lightbulb,
  'Social Media': Share2,
  'Paid Advertising': Megaphone,
  'Email Marketing': Mail,
  'Lead Generation': Target,
  'Customer Retention': Heart,
  'Brand Awareness': Sparkles,
  'Seasonal & Festival Campaigns': Gift,
  'Test Drive Campaigns': Car,
  Sponsorships: Award,
  Partnerships: Users,
  'Community Engagement': Users,
  'Local Promotions': MapPin,
}

const PRIORITY_TONE: Record<StrategyPriority, 'brand' | 'amber' | 'sky'> = {
  high: 'brand',
  medium: 'amber',
  low: 'sky',
}
const PRIORITY_RANK: Record<StrategyPriority, number> = { high: 0, medium: 1, low: 2 }

function StrategyCard({ s }: { s: MarketingStrategy }) {
  const Icon = CATEGORY_ICON[s.category] ?? Lightbulb
  return (
    <Panel className="fade-up p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] text-[var(--brand)]">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="kicker text-muted-foreground/70">{s.category}</div>
              <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-foreground">{s.title}</h3>
            </div>
            <Badge tone={PRIORITY_TONE[s.priority]} className="shrink-0 uppercase">{s.priority}</Badge>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-foreground">{s.description}</p>
          <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
            <div>
              <div className="kicker text-muted-foreground/70">Why it fits</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{s.reason}</p>
            </div>
            <div>
              <div className="kicker text-muted-foreground/70">Expected impact</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{s.expected_impact}</p>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}

export function MarketingStrategyPage() {
  const [selectedId, setSelectedId] = useState<string>('')

  const recent = useQuery({
    queryKey: ['context-planner', 'contexts'],
    queryFn: () => listContexts({ data: { limit: 20 } }),
  })
  const contexts = useMemo<Array<ContextResult>>(() => (recent.data ?? []).filter((c) => c.status === 'ready'), [recent.data])

  // Default to the most recent ready context.
  useEffect(() => {
    if (!selectedId && contexts.length > 0) setSelectedId(contexts[0].context_id)
  }, [contexts, selectedId])

  const mutation = useMutation({ mutationFn: suggestStrategies })

  const selected = contexts.find((c) => c.context_id === selectedId)
  const result = mutation.data
  const strategies = useMemo(
    () => [...(result?.strategies ?? [])].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
    [result],
  )

  function generate() {
    if (selectedId) mutation.mutate({ data: { context_id: selectedId } })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <header className="fade-up flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-[var(--brand)]">
          <Rocket className="h-[18px] w-[18px]" />
        </div>
        <div>
          <div className="kicker text-muted-foreground/70">Context Planner</div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">Marketing Strategy</h1>
        </div>
      </header>

      {/* Picker */}
      <Panel className="fade-up p-5" style={{ animationDelay: '60ms' }}>
        <div className="mb-1 flex items-center gap-2">
          <Sparkles className="h-[18px] w-[18px] text-[var(--brand)]" />
          <h2 className="font-display text-[17px] font-semibold text-foreground">AI Growth Advisor</h2>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Pick an analyzed website and the AI will study its recent analysis, then suggest concrete marketing
          strategies — events, influencer &amp; celebrity collaborations, campaigns, partnerships and more — to grow the business.
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
                className="h-10 min-w-[280px] rounded-lg border border-border bg-background px-3 text-[13.5px] text-foreground focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_20%,transparent)]"
              >
                {contexts.map((c) => (
                  <option key={c.context_id} value={c.context_id}>
                    {c.company_name || c.website || c.url || 'Untitled'}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="brand" onClick={generate} disabled={mutation.isPending || !selectedId}>
              {mutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Thinking…</>
              ) : result ? (
                <><Sparkles className="h-4 w-4" /> Regenerate</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Suggest strategies</>
              )}
            </Button>
          </div>
        )}

        {mutation.isError ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to generate strategies.'}
          </p>
        ) : null}
      </Panel>

      {/* Results */}
      {mutation.isPending ? (
        <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Studying {selected?.company_name || selected?.website || 'the analysis'} and drafting strategies…
        </div>
      ) : result?.status === 'no_analysis' ? (
        <Panel className="fade-up p-6 text-center">
          <p className="text-[13.5px] font-semibold text-foreground">No analysis found for this website yet.</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
            Run the Context Planner analysis first, then come back for tailored marketing strategies.
          </p>
          <Link
            to="/context-planner"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg brand-bg px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            Go to Context Planner
          </Link>
        </Panel>
      ) : result && strategies.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <PanelHeaderInline count={strategies.length} />
            {result.engine === 'groq' ? <Badge tone="emerald">AI-generated</Badge> : <Badge tone="neutral">suggested</Badge>}
          </div>
          <div className="grid gap-4">
            {strategies.map((s, i) => <StrategyCard key={`${s.category}-${i}`} s={s} />)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PanelHeaderInline({ count }: { count: number }) {
  return (
    <div>
      <div className="kicker text-muted-foreground/70">Recommended strategies</div>
      <h2 className="font-display text-[18px] font-semibold text-foreground">{count} ways to grow</h2>
    </div>
  )
}
