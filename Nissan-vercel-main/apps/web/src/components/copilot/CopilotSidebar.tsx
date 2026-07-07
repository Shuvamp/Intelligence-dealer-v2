import { Plus, Sparkles, MessageSquare } from 'lucide-react'
import { cn } from '#/lib/utils'
import { timeAgo } from '#/components/ui/kit'
import type { CopilotConversation, DailyBriefing } from '#/lib/types'

export function CopilotSidebar({
  conversations,
  briefing,
  activeId,
  onSelect,
  onNewChat,
}: {
  conversations: Array<CopilotConversation>
  briefing: DailyBriefing
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
}) {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col gap-4 overflow-hidden">
      <button
        type="button"
        onClick={onNewChat}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg brand-bg px-4 text-[13.5px] font-semibold transition hover:opacity-90"
      >
        <Plus className="h-4 w-4" /> New chat
      </button>

      <BriefingCard briefing={briefing} />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="kicker mb-2 px-1 text-muted-foreground/70">Conversations</div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {conversations.length === 0 ? (
            <p className="px-1 pt-1 text-[12.5px] leading-relaxed text-muted-foreground/70">
              No conversations yet. Ask your first question to get started.
            </p>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    'group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                    isActive
                      ? 'bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--brand)_28%,transparent)]'
                      : 'hover:bg-muted',
                  )}
                >
                  <MessageSquare
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      isActive ? 'brand-text' : 'text-muted-foreground/50',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-[13px] font-medium',
                        isActive ? 'text-foreground' : 'text-foreground/85',
                      )}
                    >
                      {c.title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground/70">
                      {timeAgo(c.updated_at)}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </aside>
  )
}

function BriefingCard({ briefing }: { briefing: DailyBriefing }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-md brand-bg">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="kicker text-muted-foreground/70">Today</div>
          <div className="truncate text-[12.5px] font-semibold text-foreground">
            {briefing.headline}
          </div>
        </div>
      </div>
      <dl className="divide-y divide-border">
        {briefing.lines.map((line) => (
          <div key={line.label} className="flex items-center justify-between gap-2 px-3.5 py-2">
            <dt className="text-[12px] text-muted-foreground">{line.label}</dt>
            <dd className="num text-right text-[12.5px] font-semibold text-foreground">
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
