import { Search, Flame, Thermometer, Snowflake } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import { SOURCE_META, type LeadPriority } from '#/components/leads/lead-ui'
import type { LeadScoreBand, LeadSource } from '#/lib/types'

export type ScoreFilter = 'all' | LeadScoreBand
export type SourceFilter = 'all' | LeadSource
export type PriorityFilter = 'all' | LeadPriority

const PRIORITY_CHIPS: Array<{ value: PriorityFilter; label: string; icon?: LucideIcon; active?: string; dot?: string }> = [
  { value: 'all',  label: 'All' },
  { value: 'hot',  label: 'Hot',  icon: Flame,       active: 'bg-rose-600 text-white border-transparent',  dot: 'bg-rose-500' },
  { value: 'warm', label: 'Warm', icon: Thermometer, active: 'bg-amber-500 text-white border-transparent', dot: 'bg-amber-500' },
  { value: 'cold', label: 'Cold', icon: Snowflake,   active: 'bg-sky-600 text-white border-transparent',   dot: 'bg-sky-500' },
]

const SCORE_OPTIONS: Array<{ value: ScoreFilter; label: string }> = [
  { value: 'all', label: 'All scores' },
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
  { value: 'dead', label: 'Dead' },
]

const SOURCE_KEYS = Object.keys(SOURCE_META) as Array<LeadSource>

const FIELD_CLS =
  'h-10 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-[color:color-mix(in_oklab,var(--ring)_18%,transparent)]'

export function BoardToolbar({
  query,
  onQuery,
  score,
  onScore,
  source,
  onSource,
  priority,
  onPriority,
}: {
  query: string
  onQuery: (v: string) => void
  score: ScoreFilter
  onScore: (v: ScoreFilter) => void
  source: SourceFilter
  onSource: (v: SourceFilter) => void
  priority: PriorityFilter
  onPriority: (v: PriorityFilter) => void
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Priority chips — Hot / Warm / Cold */}
      <div className="flex items-center gap-1.5">
        {PRIORITY_CHIPS.map((c) => {
          const Icon = c.icon
          const active = priority === c.value
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onPriority(c.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-semibold transition',
                active
                  ? c.active ?? 'border-transparent bg-foreground text-background'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              aria-pressed={active}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              {c.label}
            </button>
          )
        })}
      </div>

      <div className="relative flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search name or vehicle…"
          className={cn(FIELD_CLS, 'w-full pl-9')}
          aria-label="Search leads"
        />
      </div>

      <div className="flex items-center gap-2">
        <select
          value={score}
          onChange={(e) => onScore(e.target.value as ScoreFilter)}
          className={FIELD_CLS}
          aria-label="Filter by score"
        >
          {SCORE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={source}
          onChange={(e) => onSource(e.target.value as SourceFilter)}
          className={FIELD_CLS}
          aria-label="Filter by source"
        >
          <option value="all">All sources</option>
          {SOURCE_KEYS.map((key) => (
            <option key={key} value={key}>
              {SOURCE_META[key].label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
