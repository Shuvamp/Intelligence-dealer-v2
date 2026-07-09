import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ContextResult } from '#/lib/context-planner'
import { Badge } from '#/components/ui/kit'
import { AnalysisView } from '#/components/context-planner/AnalysisView'

function statusTone(status: ContextResult['status']): 'emerald' | 'rose' | 'amber' | 'neutral' {
  if (status === 'ready') return 'emerald'
  if (status === 'invalid' || status === 'failed') return 'rose'
  return 'amber'
}

// Standalone deep-link page for a single context's analysis (/analysis/:id).
// The Context Planner hub renders the same AnalysisView inline; this wrapper
// keeps direct links / reloads working with a back-link header.
export function AnalysisPage({ context, tenantId }: { context: ContextResult | null; tenantId: string }) {
  void tenantId

  if (!context) {
    return (
      <div className="mx-auto max-w-2xl pt-16 text-center">
        <p className="text-[14px] text-muted-foreground">Context not found.</p>
        <Link to="/context-planner" className="mt-4 inline-block text-[13px] text-[var(--brand)] hover:underline">
          Back to Context Planner
        </Link>
      </div>
    )
  }

  const title = context.company_name || context.website || context.url || 'Analysis'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="fade-up flex items-center gap-3">
        <Link
          to="/context-planner"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="kicker text-muted-foreground/70">Analysis</div>
          <h1 className="truncate font-display text-[22px] font-semibold tracking-tight text-foreground">{title}</h1>
        </div>
        <Badge tone={statusTone(context.status)}>{context.status}</Badge>
      </header>

      <AnalysisView context={context} />
    </div>
  )
}
