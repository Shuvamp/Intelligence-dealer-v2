import { Sparkles, type LucideIcon, Phone, CalendarClock, FileText, Trophy, RotateCcw } from 'lucide-react'
import type { Lead, LeadDetail } from '#/lib/types'

const DAY_MS = 86_400_000

type Suggestion = { title: string; body: string; icon: LucideIcon }

// Rule-based "next best action", derived from stage / score / recency.
export function nextBestAction(detail: LeadDetail): Suggestion {
  const { lead, events } = detail
  const idleMs = Date.now() - new Date(lead.last_activity_at).getTime()
  const idleDays = idleMs / DAY_MS
  const hasTestDrive = events.some((e) => e.type === 'test_drive')

  if (lead.score === 'hot' && idleDays > 2) {
    return {
      title: 'This hot lead is going cold',
      body: `No activity in ${Math.round(idleDays)} days. Call now before the intent fades.`,
      icon: Phone,
    }
  }
  if (lead.stage === 'new') {
    return {
      title: 'Make first contact within 24h',
      body: 'Speed-to-lead is the single biggest win-rate lever. Reach out today.',
      icon: Phone,
    }
  }
  if (lead.stage === 'qualified' && !hasTestDrive) {
    return {
      title: 'Schedule a test drive',
      body: 'They are qualified but have not driven yet — book a slot to move them forward.',
      icon: CalendarClock,
    }
  }
  if (lead.stage === 'quotation' || lead.stage === 'negotiation') {
    return {
      title: 'Follow up on the quotation',
      body: 'A timely nudge keeps the deal warm. Confirm numbers and next steps.',
      icon: FileText,
    }
  }
  if (lead.stage === 'booked') {
    return {
      title: 'Booked — prep for delivery',
      body: 'Loop in the delivery team, confirm paperwork, and set a delivery date.',
      icon: Trophy,
    }
  }
  if (lead.stage === 'won' || lead.stage === 'delivered') {
    return {
      title: lead.stage === 'delivered' ? 'Delivered — capture a referral' : 'Deal won — kick off delivery',
      body: 'Loop in the delivery team and capture a referral while the joy is fresh.',
      icon: Trophy,
    }
  }
  if (lead.stage === 'lost') {
    return {
      title: 'Lead lost — capture the reason',
      body: 'Log why it slipped, then schedule a re-engagement check-in in ~90 days.',
      icon: RotateCcw,
    }
  }
  if (lead.stage === 'contacted') {
    return {
      title: 'Qualify the requirement',
      body: 'Confirm budget, timeline and vehicle so you can route the right offer.',
      icon: CalendarClock,
    }
  }
  return {
    title: 'Keep the momentum',
    body: 'Log your next touchpoint to keep this lead moving through the pipeline.',
    icon: Sparkles,
  }
}

// Stage/score-only next-action label for the compact Kanban card, where no
// `events`/`customer` are loaded (getLeadBoard() only returns bare Lead
// rows). Deliberately a subset of nextBestAction()'s rules — drops the
// idle-days and test-drive-history checks, which need events.
export function compactNextAction(lead: Lead): string {
  if (lead.score === 'hot') return 'Call now'
  if (lead.stage === 'new') return 'Make first contact'
  if (lead.stage === 'contacted' || lead.stage === 'qualified') return 'Qualify requirement'
  if (lead.stage === 'test_drive') return 'Schedule test drive'
  if (lead.stage === 'quotation' || lead.stage === 'negotiation') return 'Follow up on quotation'
  if (lead.stage === 'booked') return 'Prep for delivery'
  if (lead.stage === 'won' || lead.stage === 'delivered') return 'Capture a referral'
  if (lead.stage === 'lost') return 'Log loss reason'
  return 'Keep the momentum'
}

export function NextBestAction({ detail }: { detail: LeadDetail }) {
  const s = nextBestAction(detail)
  const Icon = s.icon
  return (
    <div
      className="fade-up relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card"
      style={{ animationDelay: '120ms' }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            'radial-gradient(420px 200px at 100% -20%, color-mix(in oklab, var(--brand) 12%, transparent), transparent 65%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--brand)_12%,transparent)]">
            <Sparkles className="h-4 w-4 brand-text" />
          </span>
          <span className="kicker brand-text">Next best action</span>
        </div>
        <div className="mt-3 flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg brand-bg">
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h4 className="text-[14.5px] font-semibold leading-snug text-foreground">{s.title}</h4>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
