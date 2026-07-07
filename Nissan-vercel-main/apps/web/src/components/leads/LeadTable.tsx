import { useState, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronUp, ChevronDown, ChevronsUpDown, Inbox } from 'lucide-react'
import { cn } from '#/lib/utils'
import { initials, timeAgo, formatIN } from '#/components/ui/kit'
import { ScoreBadge, StageBadge, SourceTag, PriorityBadge, priorityOf, PRIORITY_RANK, formatMoney } from '#/components/leads/lead-ui'
import type { Lead } from '#/lib/types'

type SortKey = 'customer_name' | 'score_value' | 'budget' | 'stage' | 'last_activity_at'
type SortDir = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey | null; label: string; align?: 'right'; sortable?: boolean; className?: string }> = [
  { key: 'customer_name', label: 'Lead', sortable: true },
  { key: null, label: 'Priority' },
  { key: null, label: 'Source' },
  { key: 'score_value', label: 'Score', sortable: true },
  { key: 'budget', label: 'Budget', sortable: true, align: 'right' },
  { key: 'stage', label: 'Stage', sortable: true },
  { key: null, label: 'Owner' },
  { key: 'last_activity_at', label: 'Last Activity', sortable: true, align: 'right' },
]

export function LeadTable({ leads }: { leads: Array<Lead> }) {
  const navigate = useNavigate()
  // Default: most recently active leads first — what the follow-up agent watches.
  const [sortKey, setSortKey] = useState<SortKey>('last_activity_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  // Hot leads float to the top by default; manually sorting a column turns this off.
  const [hotFirst, setHotFirst] = useState(true)

  function toggleSort(key: SortKey) {
    setHotFirst(false)
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'customer_name' || key === 'stage' ? 'asc' : 'desc')
    }
  }

  const sorted = useMemo(() => {
    const copy = [...leads]
    copy.sort((a, b) => {
      if (hotFirst) {
        const pr = PRIORITY_RANK[priorityOf(a.score)] - PRIORITY_RANK[priorityOf(b.score)]
        if (pr !== 0) return pr
      }
      let av: string | number = ''
      let bv: string | number = ''
      switch (sortKey) {
        case 'customer_name': av = a.customer_name ?? ''; bv = b.customer_name ?? ''; break
        case 'score_value': av = a.score_value ?? 0; bv = b.score_value ?? 0; break
        case 'budget': av = a.budget ?? 0; bv = b.budget ?? 0; break
        case 'stage': av = a.stage; bv = b.stage; break
        case 'last_activity_at': av = a.last_activity_at ?? ''; bv = b.last_activity_at ?? ''; break
      }
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [leads, sortKey, sortDir, hotFirst])

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
        <Inbox className="h-7 w-7 text-muted-foreground/40" />
        <p className="text-[14px] font-medium text-foreground">No leads to show</p>
        <p className="text-[12.5px] text-muted-foreground">Adjust your filters or wait for new leads to arrive.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
                    col.align === 'right' && 'text-right',
                  )}
                >
                  {col.sortable && col.key ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key as SortKey)}
                      className={cn(
                        'inline-flex items-center gap-1 transition hover:text-foreground',
                        col.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {col.label}
                      <SortIcon active={sortKey === col.key} dir={sortDir} />
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => navigate({ to: '/leads/$leadId', params: { leadId: lead.id } })}
                className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-[color-mix(in_oklab,var(--brand)_5%,transparent)]"
              >
                {/* Lead */}
                <td className="px-4 py-3">
                  <div className="text-[13.5px] font-semibold text-foreground transition-colors group-hover:brand-text">
                    {lead.customer_name ?? 'Unknown lead'}
                  </div>
                  <div className="text-[12px] text-muted-foreground transition-colors group-hover:text-foreground/60">{lead.vehicle_interest ?? '—'}</div>
                </td>
                {/* Priority */}
                <td className="px-4 py-3"><PriorityBadge score={lead.score} /></td>
                {/* Source */}
                <td className="px-4 py-3"><SourceTag source={lead.source} /></td>
                {/* Score */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={lead.score} />
                    <span className="num text-[12px] font-semibold text-muted-foreground transition-colors group-hover:text-foreground">{lead.score_value}</span>
                  </div>
                </td>
                {/* Budget */}
                <td className="px-4 py-3 text-right">
                  <span className="num text-[13px] font-semibold text-foreground">{formatMoney(lead.budget)}</span>
                </td>
                {/* Stage */}
                <td className="px-4 py-3"><StageBadge stage={lead.stage} /></td>
                {/* Owner */}
                <td className="px-4 py-3">
                  {lead.assignee_name ? (
                    <div className="flex items-center gap-2">
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--brand)_14%,transparent)] text-[9.5px] font-bold brand-text"
                        title={lead.assignee_name}
                      >
                        {initials(lead.assignee_name)}
                      </span>
                      <span className="hidden truncate text-[12.5px] text-foreground lg:inline">{lead.assignee_name}</span>
                    </div>
                  ) : (
                    <span className="text-[12px] text-muted-foreground/60">Unassigned</span>
                  )}
                </td>
                {/* Last Activity — exact IN timestamp (12h) + relative */}
                <td className="px-4 py-3 text-right" title={formatIN(lead.last_activity_at)}>
                  <div className="num text-[12.5px] font-medium text-foreground">{formatIN(lead.last_activity_at)}</div>
                  <div className="text-[11px] text-muted-foreground transition-colors group-hover:text-foreground/60">{timeAgo(lead.last_activity_at)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-40" />
  return dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
}
