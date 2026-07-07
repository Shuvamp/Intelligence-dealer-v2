import {
  TrendingUp, Target, Lightbulb, AlertTriangle, LineChart, type LucideIcon,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import type { SignalKind, SignalSeverity } from '#/lib/types'

export const SIGNAL_META: Record<SignalKind, { label: string; icon: LucideIcon; cls: string }> = {
  demand:      { label: 'Demand',      icon: TrendingUp,    cls: 'text-emerald-600 bg-emerald-50' },
  intent:      { label: 'Intent',      icon: Target,        cls: 'text-sky-600 bg-sky-50' },
  opportunity: { label: 'Opportunity', icon: Lightbulb,     cls: 'text-amber-600 bg-amber-50' },
  trend:       { label: 'Trend',       icon: LineChart,     cls: 'text-indigo-600 bg-indigo-50' },
  risk:        { label: 'Risk',        icon: AlertTriangle, cls: 'text-rose-600 bg-rose-50' },
}

export const SEVERITY_META: Record<SignalSeverity, { label: string; cls: string }> = {
  high:   { label: 'High',   cls: 'bg-rose-50 text-rose-700' },
  medium: { label: 'Medium', cls: 'bg-amber-50 text-amber-700' },
  low:    { label: 'Low',    cls: 'bg-zinc-100 text-zinc-600' },
}

export function SeverityBadge({ severity }: { severity: SignalSeverity }) {
  const m = SEVERITY_META[severity]
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', m.cls)}>{m.label}</span>
}

export function StatTile({
  label, value, sub, accent = 'brand',
}: {
  label: string; value: string; sub?: string; accent?: 'brand' | 'emerald' | 'sky' | 'amber'
}) {
  const bar: Record<string, string> = {
    brand: 'before:bg-[var(--brand)]', emerald: 'before:bg-emerald-400',
    sky: 'before:bg-sky-400', amber: 'before:bg-amber-400',
  }
  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:content-[""]', bar[accent])}>
      <div className="text-[12px] font-semibold text-muted-foreground">{label}</div>
      <div className="num mt-2 text-[26px] font-bold leading-none text-foreground">{value}</div>
      {sub ? <div className="mt-1 text-[12px] text-muted-foreground/80">{sub}</div> : null}
    </div>
  )
}

// Horizontal proportion bar for source/vehicle/region analytics.
export function MiniBar({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between text-[12.5px]">
        <span className="font-medium capitalize text-foreground">{label}</span>
        <span className="num text-muted-foreground">{hint ?? value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full brand-bg" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </div>
  )
}
