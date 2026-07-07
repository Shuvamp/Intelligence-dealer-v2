import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, UserMinus, ArrowRight, Loader2, Users2 } from 'lucide-react'
import { assignLead } from '#/lib/leads'
import { PriorityBadge } from '#/components/leads/lead-ui'
import type { Lead, SalesMember } from '#/lib/types'

// Availability shape sourced from the assignment agent (`/api/executives`).
// Names are first-names there, while a lead's assignee_name is the user's full
// name, so we match on the first-name token (or an exact match).
export interface ExecAvailability {
  id: string
  name: string
  status: string // 'active' | 'inactive'
  current_lead_count?: number
  max_lead_limit?: number
}

function firstName(name: string | null | undefined) {
  return (name ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

function matchesExec(assigneeName: string | null | undefined, execName: string) {
  if (!assigneeName) return false
  const a = assigneeName.trim().toLowerCase()
  const e = execName.trim().toLowerCase()
  return a === e || (firstName(assigneeName) !== '' && firstName(assigneeName) === firstName(execName))
}

type AvailableAgent = SalesMember & { load: number }

export function AgentAvailability({
  leads,
  team,
  executives,
}: {
  leads: Array<Lead>
  team: Array<SalesMember>
  executives: Array<ExecAvailability>
}) {
  const router = useRouter()
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<string | null>(null)
  const [sel, setSel] = useState<Record<string, string>>({})

  // Only open leads can become "stranded" by an absent agent.
  const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost')
  const loadOf = (id: string) => open.filter((l) => l.assigned_to === id).length

  const inactive = executives.filter((e) => e.status === 'inactive')

  // Available agents = team members not matching an absent executive, and not a
  // marketing executive, sorted by current live workload (fewest first).
  const available: Array<AvailableAgent> = team
    .filter((m) => m.role !== 'marketing_executive')
    .filter((m) => !inactive.some((e) => matchesExec(m.full_name, e.name)))
    .map((m) => ({ ...m, load: loadOf(m.id) }))
    .sort((a, b) => a.load - b.load)

  // Group affected open leads under each absent agent.
  const groups = inactive
    .map((exec) => ({ exec, affected: open.filter((l) => matchesExec(l.assignee_name, exec.name)) }))
    .filter((g) => g.affected.length > 0)

  if (groups.length === 0) return null

  const totalAffected = groups.reduce((t, g) => t + g.affected.length, 0)

  async function reassign(lead: Lead, memberId: string) {
    const member = available.find((m) => m.id === memberId) ?? team.find((m) => m.id === memberId)
    if (!member) return
    setPending((s) => new Set(s).add(lead.id))
    try {
      await assignLead({ data: { id: lead.id, assigned_to: memberId, assignee_name: member.full_name } })
      toast.success(`Reassigned to ${member.full_name}`, {
        description: `${lead.customer_name ?? 'Lead'} is now owned by ${member.full_name} — they've been notified.`,
      })
      await router.invalidate()
    } catch {
      toast.error('Reassignment failed', { description: 'Could not update the lead owner. Try again.' })
    } finally {
      setPending((s) => {
        const next = new Set(s)
        next.delete(lead.id)
        return next
      })
    }
  }

  async function reassignAll(group: (typeof groups)[number]) {
    if (available.length === 0) return
    setBulk(group.exec.id)
    // Balance across the available agents starting from their current loads.
    const loads = new Map(available.map((m) => [m.id, m.load]))
    let done = 0
    try {
      for (const lead of group.affected) {
        let best = available[0]
        for (const m of available) {
          if ((loads.get(m.id) ?? 0) < (loads.get(best.id) ?? 0)) best = m
        }
        loads.set(best.id, (loads.get(best.id) ?? 0) + 1)
        await assignLead({ data: { id: lead.id, assigned_to: best.id, assignee_name: best.full_name } })
        done += 1
      }
      toast.success(`Reassigned ${done} ${done === 1 ? 'lead' : 'leads'} from ${group.exec.name}`, {
        description: 'Balanced across the least-loaded available agents — all notified.',
      })
      await router.invalidate()
    } catch {
      toast.error('Bulk reassignment failed', { description: `Reassigned ${done} before stopping.` })
    } finally {
      setBulk(null)
    }
  }

  return (
    <div className="fade-up overflow-hidden rounded-xl border border-amber-200 bg-amber-50/70 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[13.5px] font-semibold text-amber-900">
              {groups.length} {groups.length === 1 ? 'agent is' : 'agents are'} unavailable
            </div>
            <p className="text-[12px] text-amber-800">
              {totalAffected} active {totalAffected === 1 ? 'lead' : 'leads'} need reassigning to an available agent.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11.5px] font-semibold text-amber-700">
          <Users2 className="h-3.5 w-3.5" /> {available.length} available
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        {groups.map((group) => (
          <div key={group.exec.id} className="rounded-lg border border-amber-200 bg-card p-3.5">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-rose-100 text-rose-600">
                  <UserMinus className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-[13px] font-semibold text-foreground">{group.exec.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    On leave / not logged in · {group.affected.length} affected{' '}
                    {group.affected.length === 1 ? 'lead' : 'leads'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => reassignAll(group)}
                disabled={available.length === 0 || bulk === group.exec.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[12px] font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulk === group.exec.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                Reassign all
              </button>
            </div>

            <ul className="divide-y divide-border">
              {group.affected.map((lead) => {
                const suggested = sel[lead.id] ?? available[0]?.id ?? ''
                const isPending = pending.has(lead.id)
                return (
                  <li key={lead.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-foreground">
                          {lead.customer_name ?? 'Unknown lead'}
                        </span>
                        <PriorityBadge score={lead.score} />
                      </div>
                      <div className="truncate text-[11.5px] text-muted-foreground">{lead.vehicle_interest ?? '—'}</div>
                    </div>

                    {available.length === 0 ? (
                      <span className="text-[11.5px] text-muted-foreground">No available agents</span>
                    ) : (
                      <>
                        <select
                          value={suggested}
                          onChange={(e) => setSel((s) => ({ ...s, [lead.id]: e.target.value }))}
                          disabled={isPending}
                          className="h-9 rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition focus:border-ring focus:outline-none disabled:opacity-60"
                          aria-label={`Reassign ${lead.customer_name ?? 'lead'} to`}
                        >
                          {available.map((m, i) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name} · {m.load} active{i === 0 ? ' (lightest)' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => reassign(lead, suggested)}
                          disabled={isPending || !suggested}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Assign
                        </button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>

            {available.length > 0 ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                <Users2 className="h-3 w-3" /> Suggestions ordered by current workload — fewest active leads first.
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
