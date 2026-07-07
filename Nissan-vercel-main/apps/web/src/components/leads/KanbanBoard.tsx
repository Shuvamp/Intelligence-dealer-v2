import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LeadCard, STAGE_META, formatMoney } from '#/components/leads/lead-ui'
import { BOARD_COLUMN_FOR_STAGE, BOARD_STAGES, type Lead, type LeadStage } from '#/lib/types'
import { cn } from '#/lib/utils'

// Jira-style Kanban board (Phase 2). Pure presentation — grouping happens
// client-side over whatever `leads` the caller passes in (already filtered
// upstream by the toolbar/stage chips), so the board always reflects the
// same filtered set the table view would show. Drag-and-drop via @dnd-kit
// (headless, React-19-safe, accessible by default) — react-beautiful-dnd
// was considered and rejected: unmaintained, not React 19 compatible.
export function KanbanBoard({
  leads,
  onMoveStage,
}: {
  leads: Array<Lead>
  onMoveStage: (leadId: string, stage: LeadStage) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeLead = activeId ? leads.find((l) => l.id === activeId) ?? null : null
  // The board lives inside a `.fade-up` wrapper whose lingering `transform`
  // would make the fixed-position DragOverlay drift from the cursor (it'd be
  // offset relative to that ancestor, not the viewport, growing with scroll).
  // Portaling the overlay to <body> escapes the transform so it tracks the
  // cursor exactly. `mounted` guards SSR (no document on the server).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // LeadCard is a router <Link> — without an activation distance, dnd-kit's
  // pointer-down handler swallows plain clicks and breaks navigation to the
  // detail page. Require an 8px move before a drag actually starts.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const columns = BOARD_STAGES.map((stage) => {
    const ls = leads.filter((l) => BOARD_COLUMN_FOR_STAGE[l.stage] === stage)
    return { stage, leads: ls, value: ls.reduce((t, l) => t + (l.budget ?? 0), 0) }
  })

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const overStage = e.over?.id as LeadStage | undefined
    if (!overStage) return
    const lead = leads.find((l) => l.id === String(e.active.id))
    // No-op if dropped back on the column it's already (visually) in.
    if (!lead || BOARD_COLUMN_FOR_STAGE[lead.stage] === overStage) return
    onMoveStage(String(e.active.id), overStage)
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <BoardColumn key={col.stage} stage={col.stage} leads={col.leads} value={col.value} />
        ))}
      </div>
      {mounted
        ? createPortal(
            <DragOverlay dropAnimation={null}>
              {activeLead ? (
                <div className="w-[244px] rotate-2 cursor-grabbing opacity-95 shadow-xl">
                  <LeadCard lead={activeLead} />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}
    </DndContext>
  )
}

function BoardColumn({ stage, leads, value }: { stage: LeadStage; leads: Array<Lead>; value: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[260px] shrink-0 flex-col rounded-xl border bg-muted/30 transition',
        isOver ? 'border-foreground/30 bg-muted/60' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', STAGE_META[stage].dot)} />
          {STAGE_META[stage].label}
          <span className="num grid h-4 min-w-4 place-items-center rounded-full bg-muted px-1 text-[10.5px] font-semibold text-muted-foreground">
            {leads.length}
          </span>
        </span>
        {value > 0 ? <span className="num text-[11px] font-semibold text-muted-foreground">{formatMoney(value)}</span> : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2">
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-4 text-center text-[11.5px] text-muted-foreground/60">
            No leads
          </div>
        ) : (
          leads.map((lead) => <DraggableCard key={lead.id} lead={lead} />)
        )}
      </div>
    </div>
  )
}

function DraggableCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn('cursor-grab touch-none active:cursor-grabbing', isDragging && 'opacity-30')}
    >
      <LeadCard lead={lead} />
    </div>
  )
}
