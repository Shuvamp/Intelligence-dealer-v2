import { Flame, IndianRupee, Target, Users, Thermometer, Snowflake, UserX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import { formatMoney } from '#/components/leads/lead-ui'
import type { LeadStats } from '#/lib/types'

type Tone = 'brand' | 'amber' | 'emerald' | 'sky'

const TONE_ACCENT: Record<Tone, string> = {
  brand: 'before:bg-[var(--brand)]',
  amber: 'before:bg-amber-400',
  emerald: 'before:bg-emerald-400',
  sky: 'before:bg-sky-400',
}

const TONE_ICON: Record<Tone, string> = {
  brand: 'bg-[color-mix(in_oklab,var(--brand)_10%,transparent)] brand-text',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  sky: 'bg-sky-50 text-sky-600',
}

function StatTile({
  label,
  value,
  sublabel,
  tone,
  icon: Icon,
  index,
}: {
  label: string
  value: string
  sublabel: string
  tone: Tone
  icon: LucideIcon
  index: number
}) {
  return (
    <div
      className={cn(
        'fade-up relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition hover:shadow-float',
        'before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:content-[""]',
        TONE_ACCENT[tone],
      )}
      style={{ animationDelay: `${80 + index * 60}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-muted-foreground">{label}</div>
        <span className={cn('grid h-8 w-8 place-items-center rounded-lg', TONE_ICON[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="num mt-2 text-[30px] font-bold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[12px] text-muted-foreground/80">{sublabel}</div>
    </div>
  )
}

// Hot / Warm / Cold breakdown segment.
function PrioritySegment({
  label,
  value,
  total,
  icon: Icon,
  tint,
  bar,
}: {
  label: string
  value: number
  total: number
  icon: LucideIcon
  tint: string
  bar: string
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-semibold', tint)}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="num text-[15px] font-bold text-foreground">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground/80">{pct}% of pipeline</div>
    </div>
  )
}

export function PipelineStats({ stats }: { stats: LeadStats }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          index={0}
          tone="brand"
          icon={Users}
          label="Total Leads"
          value={String(stats.total)}
          sublabel="across all stages"
        />
        <StatTile
          index={1}
          tone="amber"
          icon={Flame}
          label="Hot Leads"
          value={String(stats.hot)}
          sublabel="high-intent buyers"
        />
        <StatTile
          index={2}
          tone="sky"
          icon={IndianRupee}
          label="Pipeline Value"
          value={formatMoney(stats.pipelineValue)}
          sublabel="open opportunities"
        />
        <StatTile
          index={3}
          tone="emerald"
          icon={Target}
          label="Win Rate"
          value={`${stats.winRate}%`}
          sublabel="of closed deals won"
        />
      </div>

      {/* Priority breakdown + unassigned alert */}
      <div
        className="fade-up grid grid-cols-1 gap-4 lg:grid-cols-3"
        style={{ animationDelay: '260ms' }}
      >
        <div className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-2">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="text-[12px] font-semibold text-muted-foreground">Priority breakdown</div>
            <span className="num text-[11.5px] font-medium text-muted-foreground/70">
              {stats.total} {stats.total === 1 ? 'lead' : 'leads'}
            </span>
          </div>
          <div className="flex items-start gap-5">
            <PrioritySegment label="Hot" value={stats.hot} total={stats.total} icon={Flame} tint="text-rose-600" bar="bg-rose-500" />
            <PrioritySegment label="Warm" value={stats.warm} total={stats.total} icon={Thermometer} tint="text-amber-600" bar="bg-amber-500" />
            <PrioritySegment label="Cold" value={stats.cold} total={stats.total} icon={Snowflake} tint="text-sky-600" bar="bg-sky-500" />
          </div>
        </div>

        <div
          className={cn(
            'relative overflow-hidden rounded-xl border p-5 shadow-card before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:content-[""]',
            stats.unassigned > 0
              ? 'border-rose-200 bg-rose-50/60 before:bg-rose-500'
              : 'border-border bg-card before:bg-emerald-400',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className={cn('text-[12px] font-semibold', stats.unassigned > 0 ? 'text-rose-700' : 'text-muted-foreground')}>
              Unassigned leads
            </div>
            <span
              className={cn(
                'grid h-8 w-8 place-items-center rounded-lg',
                stats.unassigned > 0 ? 'bg-rose-100 text-rose-600' : 'bg-emerald-50 text-emerald-600',
              )}
            >
              <UserX className="h-4 w-4" />
            </span>
          </div>
          <div className={cn('num mt-2 text-[30px] font-bold leading-none', stats.unassigned > 0 ? 'text-rose-700' : 'text-foreground')}>
            {stats.unassigned}
          </div>
          <div className={cn('mt-1 text-[12px]', stats.unassigned > 0 ? 'text-rose-600/80' : 'text-muted-foreground/80')}>
            {stats.unassigned > 0 ? 'need an owner — assign now' : 'every open lead has an owner'}
          </div>
        </div>
      </div>
    </div>
  )
}
