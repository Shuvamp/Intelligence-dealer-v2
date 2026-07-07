import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { getLeadBoard, getSalesTeam, updateLeadStage } from '#/lib/leads'
import { fetchExecutives } from '#/lib/assignments'
import { Button } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import { STAGE_META, priorityOf } from '#/components/leads/lead-ui'
import { LeadTable } from '#/components/leads/LeadTable'
import { KanbanBoard } from '#/components/leads/KanbanBoard'
import { PipelineStats } from '#/components/leads/PipelineStats'
import { AgentAvailability, type ExecAvailability } from '#/components/leads/AgentAvailability'
import {
  BoardToolbar,
  type ScoreFilter,
  type SourceFilter,
  type PriorityFilter,
} from '#/components/leads/BoardToolbar'
import { BOARD_COLUMN_FOR_STAGE, BOARD_STAGES, type Lead, type LeadBoard, type LeadStage, type SalesMember } from '#/lib/types'
import { toast } from 'sonner'

const EMPTY_BOARD: LeadBoard = {
  columns: BOARD_STAGES.map((stage) => ({ stage, leads: [], count: 0, value: 0 })),
  stats: { total: 0, hot: 0, warm: 0, cold: 0, unassigned: 0, pipelineValue: 0, wonValue: 0, winRate: 0 },
}

export const Route = createFileRoute('/_authed/leads/')({
  loader: async () => {
    try {
      const [board, team, executives] = await Promise.all([
        getLeadBoard(),
        getSalesTeam().catch(() => [] as Array<SalesMember>),
        // Agent availability comes from the assignment agent; degrade gracefully.
        fetchExecutives().catch(() => [] as Array<ExecAvailability>),
      ])
      return { board, team, executives: (executives ?? []) as Array<ExecAvailability> }
    } catch {
      return { board: EMPTY_BOARD, team: [] as Array<SalesMember>, executives: [] as Array<ExecAvailability> }
    }
  },
  errorComponent: ({ reset }) => (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="text-[15px] font-semibold text-foreground">Could not load leads</div>
      <p className="text-[13px] text-muted-foreground">Check that the local API server is running, then retry.</p>
      <button
        onClick={reset}
        className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Retry
      </button>
    </div>
  ),
  component: LeadsBoard,
})

type StageFilter = 'all' | LeadStage

function LeadsBoard() {
  const { board, team, executives } = Route.useLoaderData()
  const [query, setQuery] = useState('')
  const [score, setScore] = useState<ScoreFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [stage, setStage] = useState<StageFilter>('all')
  const [priority, setPriority] = useState<PriorityFilter>('all')
  const [view, setView] = useState<'board' | 'table'>('board')
  const router = useRouter()
  const navigate = useNavigate()
  const esRef = useRef<EventSource | null>(null)

  // Drag-and-drop reuses the same mutation the detail page's StageStepper
  // already calls — no new mutation logic needed (PHASE_02 plan, step 4).
  async function handleMoveStage(leadId: string, nextStage: LeadStage) {
    const lead = allLeads.find((l) => l.id === leadId)
    try {
      await updateLeadStage({
        data: {
          id: leadId,
          stage: nextStage,
          from_stage: lead?.stage,
          customer_name: lead?.customer_name,
          vehicle_interest: lead?.vehicle_interest,
        },
      })
      toast.success(`Moved to ${STAGE_META[nextStage].label}`)
      await router.invalidate()
    } catch {
      toast.error('Could not update the lead’s stage — try again.')
    }
  }

  // Flatten the stage-grouped board into a single list for the table.
  const allLeads = useMemo<Array<Lead>>(
    () => board.columns.flatMap((c) => c.leads),
    [board.columns],
  )

  useEffect(() => {
    const apiUrl =
      (import.meta.env as Record<string, string>).VITE_AGENT_API_URL ?? 'http://localhost:8000'
    const es = new EventSource(`${apiUrl}/intake/stream`)
    esRef.current = es
    es.onmessage = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data as string) as {
          type: string
          source?: string
          lead?: {
            customer_name?: string
            vehicle_interest?: string
            scored_by?: string | null
            score_notice?: string | null
          }
          to_stage?: LeadStage
          customer_name?: string
        }
        if (payload.type === 'stage_change') {
          // Another user (or another tab) moved a card — refresh the board
          // so everyone's view stays in sync (PHASE_02 acceptance criteria:
          // "Real-time updates via SSE").
          void router.invalidate()
          if (payload.to_stage) {
            toast.message(`${payload.customer_name ?? 'A lead'} moved to ${STAGE_META[payload.to_stage].label}`)
          }
        }
        if (payload.type === 'new_lead') {
          void router.invalidate()
          toast.success(
            `New ${payload.source ?? ''} lead: ${payload.lead?.customer_name ?? 'Unknown'}`,
            {
              description: payload.lead?.vehicle_interest
                ? `Interested in ${payload.lead.vehicle_interest}`
                : 'View in the table',
            },
          )
          // Scoring took a non-ideal path (rate-limit → backup key, or fallback).
          // Surface a clear, persistent warning so the issue is actionable.
          if (payload.lead?.score_notice) {
            toast.warning('Scoring service notice', {
              description: payload.lead.score_notice,
              duration: 12_000,
            })
          }
        }
      } catch {}
    }
    es.onerror = () => {
      console.warn('[LeadsBoard] SSE connection error — will auto-reconnect')
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [router])

  const filtered = useMemo<Array<Lead>>(() => {
    const q = query.trim().toLowerCase()
    return allLeads.filter((l) => {
      if (priority !== 'all' && priorityOf(l.score) !== priority) return false
      if (score !== 'all' && l.score !== score) return false
      if (source !== 'all' && l.source !== source) return false
      // Filter by board column, not raw stage, so a legacy-stage lead
      // (qualified/quotation/won) still matches the chip for the column it
      // visually appears under on the Kanban board.
      if (stage !== 'all' && BOARD_COLUMN_FOR_STAGE[l.stage] !== stage) return false
      if (q) {
        const hay = `${l.customer_name ?? ''} ${l.vehicle_interest ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [allLeads, query, score, source, stage, priority])

  const isFiltered = query.trim() !== '' || score !== 'all' || source !== 'all' || stage !== 'all' || priority !== 'all'

  // Per-board-column counts for the stage chips.
  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of allLeads) {
      const col = BOARD_COLUMN_FOR_STAGE[l.stage]
      m[col] = (m[col] ?? 0) + 1
    }
    return m
  }, [allLeads])

  return (
    <div className="space-y-6">
      <div className="fade-up flex items-end justify-between gap-4">
        <div>
          <div className="kicker text-muted-foreground/70">Pipeline</div>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-foreground">
            Lead Pipeline
          </h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {board.stats.total} active {board.stats.total === 1 ? 'lead' : 'leads'} across your funnel
          </p>
        </div>
        <Button variant="brand" onClick={() => void navigate({ to: '/leads/new' })}>
          <Plus className="h-4 w-4" /> Add lead
        </Button>
      </div>

      {/* Agent availability — only renders when an agent is on leave with affected leads */}
      <AgentAvailability leads={allLeads} team={team} executives={executives} />

      <div className="fade-up" style={{ animationDelay: '60ms' }}>
        <PipelineStats stats={board.stats} />
      </div>

      <div className="fade-up" style={{ animationDelay: '120ms' }}>
        <BoardToolbar
          query={query}
          onQuery={setQuery}
          score={score}
          onScore={setScore}
          source={source}
          onSource={setSource}
          priority={priority}
          onPriority={setPriority}
        />
      </div>

      {/* Stage filter chips + board/table view toggle */}
      <div className="fade-up flex flex-wrap items-center justify-between gap-2" style={{ animationDelay: '150ms' }}>
        <div className="flex flex-wrap items-center gap-1.5">
          <StageChip label="All" count={allLeads.length} active={stage === 'all'} onClick={() => setStage('all')} />
          {BOARD_STAGES.map((s) => (
            <StageChip
              key={s}
              label={STAGE_META[s].label}
              count={stageCounts[s] ?? 0}
              dot={STAGE_META[s].dot}
              active={stage === s}
              onClick={() => setStage(s)}
            />
          ))}
        </div>
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
          <ViewToggleButton active={view === 'board'} onClick={() => setView('board')} icon={LayoutGrid} label="Board" />
          <ViewToggleButton active={view === 'table'} onClick={() => setView('table')} icon={List} label="Table" />
        </div>
      </div>

      <div className="fade-up" style={{ animationDelay: '180ms' }}>
        {view === 'board' ? (
          <KanbanBoard leads={filtered} onMoveStage={handleMoveStage} />
        ) : (
          <LeadTable leads={filtered} />
        )}
      </div>

      {isFiltered && filtered.length === 0 ? (
        <p className="text-center text-[13px] text-muted-foreground">No leads match your filters.</p>
      ) : null}
    </div>
  )
}

function ViewToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof LayoutGrid
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition',
        active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

function StageChip({
  label,
  count,
  dot,
  active,
  onClick,
}: {
  label: string
  count: number
  dot?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition',
        active
          ? 'border-transparent bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-background' : dot)} /> : null}
      {label}
      <span
        className={cn(
          'num grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10.5px] font-semibold',
          active ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  )
}
