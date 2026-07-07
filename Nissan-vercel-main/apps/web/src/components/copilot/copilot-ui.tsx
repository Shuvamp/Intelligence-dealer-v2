import { Sparkles, User, Target, Megaphone, TrendingUp, Hash } from 'lucide-react'
import { cn } from '#/lib/utils'
import { initials } from '#/components/ui/kit'
import type { CopilotCitation, CopilotMessage } from '#/lib/types'

const CITE_ICON: Record<string, typeof Hash> = {
  lead: Target, campaign: Megaphone, signal: TrendingUp, metric: Hash,
}

export function CitationChip({ citation }: { citation: CopilotCitation }) {
  const Icon = CITE_ICON[citation.kind] ?? Hash
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3 brand-text" /> {citation.label}
    </span>
  )
}

export function MessageBubble({ message, userName }: { message: CopilotMessage; userName?: string }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold',
          isUser ? 'bg-muted text-muted-foreground' : 'brand-bg',
        )}
      >
        {isUser ? (userName ? initials(userName) : <User className="h-4 w-4" />) : <Sparkles className="h-4 w-4" />}
      </div>
      <div className={cn('max-w-[78%] space-y-2', isUser ? 'items-end text-right' : 'items-start')}>
        <div
          className={cn(
            'inline-block rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed',
            isUser ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground shadow-card',
          )}
        >
          {message.content}
        </div>
        {message.citations?.length ? (
          <div className={cn('flex flex-wrap gap-1.5', isUser ? 'justify-end' : '')}>
            {message.citations.map((c, i) => (
              <CitationChip key={i} citation={c} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 text-muted-foreground">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  )
}
