import { useState  } from 'react'
import type {ReactNode} from 'react';
import {
  Boxes, Building2, CheckCircle2, ChevronDown, Globe, Loader2,
  MapPin, Quote, Sparkles, Tag, Wrench 
} from 'lucide-react'
import type {LucideIcon} from 'lucide-react';
import { Badge, Panel, PanelHeader } from '#/components/ui/kit'
import { cn } from '#/lib/utils'

// Shared status vocabulary for SEO dimensions + AEO agents (identical union).
type CheckStatus = 'PASS' | 'WARNING' | 'FAIL'

type ScoreTone = 'emerald' | 'sky' | 'amber' | 'rose'

export function scoreTone(score: number): ScoreTone {
  if (score >= 90) return 'emerald'
  if (score >= 75) return 'sky'
  if (score >= 60) return 'amber'
  return 'rose'
}

const TONE_STROKE: Record<ScoreTone, string> = {
  emerald: 'var(--success)',
  sky: 'var(--info)',
  amber: 'var(--warning)',
  rose: 'var(--destructive)',
}

const TONE_TEXT: Record<ScoreTone, string> = {
  emerald: 'text-emerald-600',
  sky: 'text-sky-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
}

// ---------------------------------------------------------------------------
// Circular score gauge — brand-neutral donut, colour keyed to the score band.
// ---------------------------------------------------------------------------
export function ScoreGauge({
  score, label, sublabel, grade, size = 120, stroke = 9,
}: {
  score: number
  label: string
  sublabel?: string
  grade?: string
  size?: number
  stroke?: number
}) {
  const tone = scoreTone(score)
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score))
  const offset = circ * (1 - pct / 100)

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="var(--muted)" strokeWidth={stroke}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={TONE_STROKE[tone]} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('num text-[26px] font-bold leading-none', TONE_TEXT[tone])}>{score}</span>
          {grade ? <span className="mt-0.5 text-[11px] font-semibold text-muted-foreground">Grade {grade}</span> : null}
        </div>
      </div>
      <div className="text-center">
        <div className="text-[12.5px] font-semibold text-foreground">{label}</div>
        {sublabel ? <div className="text-[11px] text-muted-foreground">{sublabel}</div> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Advice panel — one friendly AI summary per section instead of a list of
// per-check explanations. Uses the report's AI narrative when present, else a
// composed friendly line; celebrates when everything already passes. The full
// per-check detail is preserved in the export (PDF/JSON/Markdown), not here.
// ---------------------------------------------------------------------------
export interface CheckItem {
  name: string
  status: CheckStatus
  action?: string
}

export function AdvicePanel({
  kicker, title, headerBadge, summary, items, delay = 0,
}: {
  kicker: string
  title: string
  headerBadge?: ReactNode
  summary?: string | null
  items: Array<CheckItem>
  delay?: number
}) {
  const needs = items.filter((i) => i.status !== 'PASS')
  const allGood = needs.length === 0
  const text =
    summary && summary.trim()
      ? summary.trim()
      : allGood
        ? 'Great news — everything here looks good. No changes needed right now.'
        : `A few areas could lift your score: ${needs.map((n) => n.name).join(', ')}. Tackle these and you'll see a noticeable improvement.`

  return (
    <Panel className="fade-up overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      <PanelHeader kicker={kicker} title={title} action={headerBadge} />
      <div className="px-5 py-4">
        <div
          className={cn(
            'flex gap-3 rounded-lg border px-4 py-3.5',
            allGood ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-muted/40',
          )}
        >
          <span
            className={cn(
              'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
              allGood
                ? 'bg-emerald-100 text-emerald-600'
                : 'bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] text-[var(--brand)]',
            )}
          >
            {allGood ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </span>
          <div>
            <div className="kicker text-muted-foreground/70">{allGood ? 'Looking good' : 'AI advice'}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground">{text}</p>
          </div>
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Recommendation card — problem / why / fix, scannable, expandable detail.
// ---------------------------------------------------------------------------
const SEVERITY_TONE: Record<string, 'rose' | 'amber' | 'sky' | 'neutral'> = {
  Critical: 'rose',
  High: 'amber',
  Medium: 'sky',
  Low: 'neutral',
}

export interface RecommendationView {
  severity: string
  problem: string
  reason: string
  fix: string
  category?: string
  estimated_time?: string
  source?: string
}

export function RecommendationCard({ rec }: { rec: RecommendationView }) {
  const [open, setOpen] = useState(false)
  const tone = SEVERITY_TONE[rec.severity] ?? 'neutral'
  return (
    <div className="rounded-lg border border-border bg-card transition hover:shadow-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <Badge tone={tone} className="mt-0.5 shrink-0">{rec.severity}</Badge>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-foreground">{rec.problem}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {rec.category ? <span className="rounded-md bg-muted px-1.5 py-0.5 font-semibold capitalize">{rec.category}</span> : null}
            {rec.source ? <span className="uppercase tracking-wide">{rec.source}</span> : null}
            {rec.estimated_time ? <span>· {rec.estimated_time}</span> : null}
          </div>
        </div>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="space-y-2.5 border-t border-border px-4 py-3">
          {rec.reason ? (
            <div>
              <div className="kicker text-muted-foreground/70">Why it matters</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground">{rec.reason}</p>
            </div>
          ) : null}
          <div>
            <div className="kicker text-muted-foreground/70">Recommended fix</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground">{rec.fix}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Business information — scannable enterprise fields + badge groups.
// ---------------------------------------------------------------------------
export interface BusinessInfoData {
  company_name: string | null
  website: string | null
  region: string | null
  industry: string | null
  products: Array<string>
  services: Array<string>
  description: string | null
  verdict: string | null
}

function InfoRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="kicker text-muted-foreground/70">{label}</div>
        <div className="mt-0.5 text-[13.5px] text-foreground">{children}</div>
      </div>
    </div>
  )
}

function BadgeRow({ items, tone }: { items: Array<string>; tone: 'brand' | 'sky' | 'emerald' }) {
  const clean = items.filter((i) => i && i !== 'Unknown')
  if (clean.length === 0) return <span className="text-[13px] text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {clean.map((i) => <Badge key={i} tone={tone}>{i}</Badge>)}
    </div>
  )
}

export function BusinessInfoCard({ data }: { data: BusinessInfoData }) {
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <InfoRow icon={Building2} label="Business">
          <span className="font-semibold">{data.company_name || 'Unknown'}</span>
        </InfoRow>
        <InfoRow icon={Tag} label="Industry">{data.industry || 'Unknown'}</InfoRow>
        <InfoRow icon={MapPin} label="Region">{data.region || 'Unknown'}</InfoRow>
        <InfoRow icon={Globe} label="Website">
          {data.website && data.website !== 'Unknown' ? (
            <a href={data.website} target="_blank" rel="noreferrer" className="brand-text hover:underline">{data.website}</a>
          ) : 'Unknown'}
        </InfoRow>
      </div>

      {data.description && data.description !== 'Unknown' ? (
        <div className="border-t border-border pt-3">
          <div className="kicker text-muted-foreground/70">Summary</div>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground">{data.description}</p>
        </div>
      ) : null}

      <div className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2">
        <InfoRow icon={Boxes} label="Products"><BadgeRow items={data.products} tone="brand" /></InfoRow>
        <InfoRow icon={Wrench} label="Services"><BadgeRow items={data.services} tone="sky" /></InfoRow>
      </div>

      {data.verdict && data.verdict !== 'Unknown' ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] italic leading-relaxed text-foreground">{data.verdict}</p>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline progress — one row per stage, animated active / done markers.
// ---------------------------------------------------------------------------
export interface StepperStage { id: string; label: string }

export function PipelineStepper({
  stages, activeStage, doneStages,
}: {
  stages: Array<StepperStage>
  activeStage: string | null
  doneStages: Record<string, boolean>
}) {
  return (
    <ul className="space-y-1 rounded-xl border border-border bg-muted/30 p-3">
      {stages.map((stage) => {
        const done = doneStages[stage.id]
        const active = activeStage === stage.id
        return (
          <li key={stage.id} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[12.5px]">
            <span className={cn('font-medium', done || active ? 'text-foreground' : 'text-muted-foreground/50')}>
              {stage.label}
            </span>
            {done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : active ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)]" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
            )}
          </li>
        )
      })}
    </ul>
  )
}

// Small brand sparkle badge used on empty states.
export function AnalyzeGlyph() {
  return (
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border bg-card text-[var(--brand)] shadow-card">
      <Sparkles className="h-6 w-6" />
    </div>
  )
}
