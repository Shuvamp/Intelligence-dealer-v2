import {
  StickyNote, Phone, Mail, MessageCircle, ArrowRight, UserCheck, Car, FileText,
  Activity, Bot, Sparkles, type LucideIcon,
} from 'lucide-react'
import { timeAgo, formatINTime } from '#/components/ui/kit'
import { formatMoney } from '#/components/leads/lead-ui'
import type { LeadEvent, LeadEventType } from '#/lib/types'

const EVENT_META: Record<LeadEventType, { icon: LucideIcon; cls: string }> = {
  note:         { icon: StickyNote,    cls: 'text-zinc-600 bg-zinc-100' },
  call:         { icon: Phone,         cls: 'text-emerald-600 bg-emerald-50' },
  email:        { icon: Mail,          cls: 'text-sky-600 bg-sky-50' },
  whatsapp:     { icon: MessageCircle, cls: 'text-green-600 bg-green-50' },
  stage_change: { icon: ArrowRight,    cls: 'text-indigo-600 bg-indigo-50' },
  assignment:   { icon: UserCheck,     cls: 'text-violet-600 bg-violet-50' },
  test_drive:   { icon: Car,           cls: 'text-orange-600 bg-orange-50' },
  quotation:    { icon: FileText,      cls: 'text-amber-600 bg-amber-50' },
  agent:        { icon: Bot,           cls: 'text-fuchsia-600 bg-fuchsia-50' },
  nba:          { icon: Sparkles,      cls: 'text-fuchsia-600 bg-fuchsia-50' },
}

// Pull human-readable detail chips out of the loosely-typed metadata bag.
function metaChips(event: LeadEvent): Array<string> {
  const m = event.metadata ?? {}
  const chips: Array<string> = []
  if (typeof m.amount === 'number') chips.push(formatMoney(m.amount as number))
  if (typeof m.scheduled_at === 'string') {
    const d = new Date(m.scheduled_at as string)
    if (!Number.isNaN(d.getTime())) {
      chips.push(
        d.toLocaleString('en-IN', {
          day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        }),
      )
    }
  }
  if (typeof m.vehicle === 'string') chips.push(m.vehicle as string)
  return chips
}

export function LeadTimeline({ events }: { events: Array<LeadEvent> }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
        <Activity className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-[13px] text-muted-foreground">No activity logged yet.</p>
        <p className="text-[12px] text-muted-foreground/70">
          Log a note or call below to start the timeline.
        </p>
      </div>
    )
  }

  // The follow-up agent appends a fresh `nba` event on every run (auto-trigger on
  // intake, restarts, manual regenerate), so a lead can accrue several identical
  // NBA rows. Collapse them on display: keep only the most recent NBA, drop the
  // rest. Non-NBA events are untouched. (Display-only — the data is unchanged.)
  let latestNbaAt = -Infinity
  for (const e of events) {
    if (e.type === 'nba') latestNbaAt = Math.max(latestNbaAt, new Date(e.created_at).getTime())
  }
  const deduped = events.filter(
    (e) => e.type !== 'nba' || new Date(e.created_at).getTime() === latestNbaAt,
  )

  // Ascending order — oldest first (top) → newest last (bottom).
  const ordered = [...deduped].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  return (
    <ul className="px-5 py-2">
      {ordered.map((event, i) => {
        const meta = EVENT_META[event.type] ?? EVENT_META.note
        const Icon = meta.icon
        const chips = metaChips(event)
        const last = i === ordered.length - 1
        return (
          <li key={event.id} className="relative flex gap-3.5 pb-5 last:pb-1">
            <div className="relative flex flex-col items-center">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${meta.cls}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              {!last ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className="min-w-0 flex-1 pt-1">
              {typeof event.metadata?.agent === 'string' ? (
                <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-fuchsia-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-fuchsia-700">
                  <Bot className="h-2.5 w-2.5" /> {(event.metadata.agent as string).split('·')[0].trim()}
                </span>
              ) : null}
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13.5px] leading-snug text-foreground">{event.summary}</p>
                <span className="num shrink-0 text-[11px] font-medium text-muted-foreground/80" title={timeAgo(event.created_at)}>
                  {formatINTime(event.created_at)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] text-muted-foreground/70">
                  {timeAgo(event.created_at)}
                </span>
                {chips.map((c) => (
                  <span
                    key={c}
                    className="num inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
