import { Link } from '@tanstack/react-router'
import {
  Building2, Globe, Facebook, Instagram, Footprints, Phone, CalendarDays, Users,
  Flame, Snowflake, Thermometer, Skull, type LucideIcon,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { initials, timeAgo } from '#/components/ui/kit'
import { compactNextAction } from '#/components/leads/NextBestAction'
import type { Lead, LeadScoreBand, LeadSource, LeadStage } from '#/lib/types'

// ---- stage visual config (dot + text + soft bg) ----
export const STAGE_META: Record<LeadStage, { label: string; dot: string; text: string; soft: string }> = {
  new:         { label: 'New',         dot: 'bg-zinc-400',    text: 'text-zinc-600',    soft: 'bg-zinc-100' },
  contacted:   { label: 'Contacted',   dot: 'bg-sky-400',     text: 'text-sky-600',     soft: 'bg-sky-50' },
  qualified:   { label: 'Qualified',   dot: 'bg-indigo-400',  text: 'text-indigo-600',  soft: 'bg-indigo-50' },
  test_drive:  { label: 'Test Drive',  dot: 'bg-violet-400',  text: 'text-violet-600',  soft: 'bg-violet-50' },
  quotation:   { label: 'Quotation',   dot: 'bg-amber-400',   text: 'text-amber-600',   soft: 'bg-amber-50' },
  negotiation: { label: 'Negotiation', dot: 'bg-orange-400',  text: 'text-orange-600',  soft: 'bg-orange-50' },
  booked:      { label: 'Booked',      dot: 'bg-teal-400',    text: 'text-teal-600',    soft: 'bg-teal-50' },
  delivered:   { label: 'Delivered',   dot: 'bg-emerald-500', text: 'text-emerald-600', soft: 'bg-emerald-50' },
  won:         { label: 'Won',         dot: 'bg-emerald-500', text: 'text-emerald-600', soft: 'bg-emerald-50' },
  lost:        { label: 'Lost',        dot: 'bg-rose-400',    text: 'text-rose-600',    soft: 'bg-rose-50' },
}

export const SOURCE_META: Record<LeadSource, { label: string; icon: LucideIcon }> = {
  oem:       { label: 'OEM',       icon: Building2 },
  website:   { label: 'Website',   icon: Globe },
  facebook:  { label: 'Facebook',  icon: Facebook },
  instagram: { label: 'Instagram', icon: Instagram },
  walkin:    { label: 'Walk-in',   icon: Footprints },
  phone:     { label: 'Phone',     icon: Phone },
  event:     { label: 'Event',     icon: CalendarDays },
  referral:  { label: 'Referral',  icon: Users },
}

const SCORE_META: Record<LeadScoreBand, { label: string; icon: LucideIcon; cls: string }> = {
  hot:  { label: 'Hot',  icon: Flame,       cls: 'text-rose-600 bg-rose-50' },
  warm: { label: 'Warm', icon: Thermometer, cls: 'text-amber-600 bg-amber-50' },
  cold: { label: 'Cold', icon: Snowflake,   cls: 'text-sky-600 bg-sky-50' },
  dead: { label: 'Dead', icon: Skull,       cls: 'text-zinc-500 bg-zinc-100' },
}

// Fallback so an unexpected/legacy score value never crashes the badge.
const SCORE_FALLBACK = { label: 'Unscored', icon: Snowflake, cls: 'text-zinc-500 bg-zinc-100' }

// ₹ formatting: Cr / L / plain
export function formatMoney(n: number | null | undefined) {
  if (!n) return '—'
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  return `₹${n.toLocaleString('en-IN')}`
}

// ---- Lead priority (Hot / Warm / Cold) ----
// Priority is a customer-facing view of the score band: hot→Hot, warm→Warm,
// cold + dead→Cold. Hot = red, Warm = amber, Cold = blue/gray.
export type LeadPriority = 'hot' | 'warm' | 'cold'

export function priorityOf(score: LeadScoreBand): LeadPriority {
  if (score === 'hot') return 'hot'
  if (score === 'warm') return 'warm'
  return 'cold' // cold + dead both render as Cold priority
}

// Lower rank sorts first — Hot leads float to the top.
export const PRIORITY_RANK: Record<LeadPriority, number> = { hot: 0, warm: 1, cold: 2 }

const PRIORITY_META: Record<LeadPriority, { label: string; cls: string; dot: string }> = {
  hot:  { label: 'Hot',  cls: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200', dot: 'bg-rose-500' },
  warm: { label: 'Warm', cls: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200', dot: 'bg-amber-500' },
  cold: { label: 'Cold', cls: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200', dot: 'bg-sky-500' },
}

export function PriorityBadge({ score, className }: { score: LeadScoreBand; className?: string }) {
  const m = PRIORITY_META[priorityOf(score)]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', m.cls, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} /> {m.label}
    </span>
  )
}

export function ScoreBadge({ score, className }: { score: LeadScoreBand; className?: string }) {
  const m = SCORE_META[score] ?? SCORE_FALLBACK
  const Icon = m.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', m.cls, className)}>
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  )
}

export function StageBadge({ stage }: { stage: LeadStage }) {
  const m = STAGE_META[stage]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', m.soft, m.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} /> {m.label}
    </span>
  )
}

export function SourceTag({ source }: { source: LeadSource }) {
  const m = SOURCE_META[source]
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  )
}

// Compact lead card for the pipeline board. Links to the detail page.
export function LeadCard({ lead }: { lead: Lead }) {
  return (
    <Link
      to="/leads/$leadId"
      params={{ leadId: lead.id }}
      className="group block rounded-lg border border-border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">
            {lead.customer_name ?? 'Unknown lead'}
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {lead.vehicle_interest ?? '—'}
          </div>
        </div>
        {/* Classification (hot/warm/cold/dead) */}
        <ScoreBadge score={lead.score} />
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <SourceTag source={lead.source} />
        <span className="flex items-center gap-2">
          {/* Score (numeric, distinct from the Classification badge above) */}
          <span className="num text-[11px] font-semibold text-muted-foreground">{lead.score_value}/100</span>
          <span className="num text-[12px] font-semibold text-foreground">{formatMoney(lead.budget)}</span>
        </span>
      </div>

      <div className="mt-2 truncate text-[11px] font-medium text-muted-foreground/80">
        → {compactNextAction(lead)}
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
        <span className="text-[10.5px] text-muted-foreground/70">{timeAgo(lead.last_activity_at)}</span>
        {lead.assignee_name ? (
          <span
            className="grid h-5 w-5 place-items-center rounded-full bg-[color-mix(in_oklab,var(--brand)_14%,transparent)] text-[9px] font-bold brand-text"
            title={lead.assignee_name}
          >
            {initials(lead.assignee_name)}
          </span>
        ) : (
          <span className="text-[10.5px] text-muted-foreground/60">Unassigned</span>
        )}
      </div>
    </Link>
  )
}
