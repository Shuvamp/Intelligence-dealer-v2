import {
  Check, Clock, FileInput, Search, UserCheck, Car, FileText, Flag, type LucideIcon,
} from 'lucide-react'
import { Panel, PanelHeader, formatIN } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import { LeadTimeline } from '#/components/leads/LeadTimeline'
import { priorityOf } from '#/components/leads/lead-ui'
import type { LeadDetail, LeadStage } from '#/lib/types'

// Customer-facing journey: a simpler, friendlier view of the internal pipeline.
type CustomerStep = { key: string; label: string; icon: LucideIcon; reached: (d: LeadDetail) => boolean }

const STEPS: Array<CustomerStep> = [
  { key: 'submitted', label: 'Submitted', icon: FileInput, reached: () => true },
  { key: 'reviewed', label: 'Reviewed', icon: Search, reached: (d) => d.lead.stage !== 'new' },
  { key: 'assigned', label: 'Assigned', icon: UserCheck, reached: (d) => !!d.lead.assigned_to },
  { key: 'demo', label: 'Demo', icon: Car, reached: (d) => inStages(d.lead.stage, ['test_drive', 'quotation', 'negotiation', 'won']) },
  { key: 'proposal', label: 'Proposal', icon: FileText, reached: (d) => inStages(d.lead.stage, ['quotation', 'negotiation', 'won']) },
  { key: 'closed', label: 'Closed', icon: Flag, reached: (d) => inStages(d.lead.stage, ['won', 'lost']) },
]

function inStages(stage: LeadStage, set: Array<LeadStage>) {
  return set.includes(stage)
}

// Friendly estimate of when the customer can expect to hear from the dealership.
function estimatedContact(detail: LeadDetail): string {
  const { lead } = detail
  if (lead.stage === 'won') return 'Deal closed — delivery team will be in touch'
  if (lead.stage === 'lost') return 'No further contact scheduled'
  const p = priorityOf(lead.score)
  if (p === 'hot') return 'Within the next hour'
  if (p === 'warm') return 'Within 24 hours'
  return 'Within 2–3 business days'
}

export function CustomerLeadStatus({ detail }: { detail: LeadDetail }) {
  const { lead } = detail
  const reached = STEPS.map((s) => s.reached(detail))
  // Active step = first not-yet-reached step (or the last, if all are reached).
  const activeIdx = reached.findIndex((r) => !r)
  const currentIdx = activeIdx === -1 ? STEPS.length - 1 : activeIdx
  const isLost = lead.stage === 'lost'

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Customer status"
        kicker="What the customer sees"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> {estimatedContact(detail)}
          </span>
        }
      />

      {/* Progress tracker */}
      <div className="px-5 pt-5">
        <ol className="flex items-start justify-between">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            const done = reached[i] && i !== currentIdx
            const current = i === currentIdx && !reached[STEPS.length - 1]
            const lineDone = reached[i + 1]
            const tone = isLost && step.key === 'closed'
              ? 'rose'
              : done
                ? 'done'
                : current
                  ? 'current'
                  : 'pending'
            return (
              <li key={step.key} className="relative flex flex-1 flex-col items-center text-center last:flex-none">
                <div className="flex w-full items-center">
                  {/* left connector spacer (invisible on first) */}
                  {i !== 0 ? (
                    <span className={cn('h-0.5 flex-1', reached[i] ? 'bg-emerald-400' : 'bg-border')} />
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 transition',
                      tone === 'rose'
                        ? 'border-rose-300 bg-rose-50 text-rose-600'
                        : tone === 'done'
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-600'
                          : tone === 'current'
                            ? 'border-[var(--brand)] bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] brand-text'
                            : 'border-border bg-card text-muted-foreground/50',
                    )}
                  >
                    {tone === 'done' ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  {/* right connector */}
                  {i !== STEPS.length - 1 ? (
                    <span className={cn('h-0.5 flex-1', lineDone ? 'bg-emerald-400' : 'bg-border')} />
                  ) : (
                    <span className="flex-1" />
                  )}
                </div>
                <span
                  className={cn(
                    'mt-1.5 text-[11.5px] font-semibold',
                    tone === 'pending' ? 'text-muted-foreground/60' : 'text-foreground',
                  )}
                >
                  {step.label}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Estimated contact banner */}
      <div className="mx-5 mt-5 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--brand)_12%,transparent)]">
          <Clock className="h-4 w-4 brand-text" />
        </span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-foreground">Estimated contact time</div>
          <p className="text-[12px] text-muted-foreground">
            {estimatedContact(detail)}
            {lead.assignee_name ? ` · handled by ${lead.assignee_name}` : ' · being assigned to an executive'}
          </p>
        </div>
      </div>

      <div className="pb-5" />
    </Panel>
  )
}

// Standalone activity timeline — the customer's journey so far.
export function CustomerActivity({ detail }: { detail: LeadDetail }) {
  const { lead, events } = detail
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Your activity"
        kicker="Lead activity"
        action={
          <span className="num text-[11.5px] font-medium text-muted-foreground/70" title={formatIN(lead.last_activity_at)}>
            Updated {formatIN(lead.last_activity_at)}
          </span>
        }
      />
      <LeadTimeline events={events} />
    </Panel>
  )
}
