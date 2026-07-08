import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Sparkles, XCircle } from 'lucide-react'
import { createExtraction, getExtraction, listExtractions, type ExtractionResult } from '#/lib/website-extraction'
import { createSummary, listSummaries } from '#/lib/company-summary'
import type { ContextResult } from '#/lib/context-planner'
import { Badge, Button } from '#/components/ui/kit'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
      {children}
    </div>
  )
}

function BulletList({ items }: { items: Array<string> }) {
  if (items.length === 0 || (items.length === 1 && items[0] === 'Unknown')) {
    return <p className="text-[13.5px] text-muted-foreground">Unknown</p>
  }
  return (
    <ul className="list-inside list-disc space-y-0.5 text-[13.5px] text-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

async function waitForExtractionReady(extraction: ExtractionResult): Promise<ExtractionResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let current = extraction
  while (current.status !== 'ready' && current.status !== 'failed') {
    if (Date.now() > deadline) throw new Error('Website extraction timed out.')
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const polled = await getExtraction({ data: { extraction_id: extraction.extraction_id } })
    if (!polled) throw new Error('Website extraction disappeared while polling.')
    current = polled
  }
  if (current.status === 'failed') {
    throw new Error(current.errors[0] ?? 'Website extraction failed.')
  }
  return current
}

export function CompanySummaryPanel({ context }: { context: ContextResult }) {
  const queryClient = useQueryClient()
  const [subLabel, setSubLabel] = useState<string | null>(null)

  const extractionsQuery = useQuery({
    queryKey: ['website-extraction', 'extractions', context.context_id],
    queryFn: () => listExtractions({ data: { context_id: context.context_id, limit: 1 } }),
  })
  const summariesQuery = useQuery({
    queryKey: ['company-summary', 'summaries', context.context_id],
    queryFn: () => listSummaries({ data: { context_id: context.context_id, limit: 1 } }),
  })

  const latestSummary = summariesQuery.data?.[0]
  const hasReadySummary = latestSummary?.status === 'ready'

  const generateMutation = useMutation({
    mutationFn: async () => {
      const latestExtraction = extractionsQuery.data?.[0]
      let extraction = latestExtraction && latestExtraction.status === 'ready' ? latestExtraction : null

      if (!extraction) {
        setSubLabel('Crawling website…')
        const created = await createExtraction({ data: { context_id: context.context_id } })
        extraction = await waitForExtractionReady(created)
      }

      setSubLabel('Generating summary…')
      return await createSummary({ data: { extraction_id: extraction.extraction_id } })
    },
    onSuccess: () => {
      setSubLabel(null)
      void queryClient.invalidateQueries({ queryKey: ['company-summary', 'summaries', context.context_id] })
      void queryClient.invalidateQueries({ queryKey: ['website-extraction', 'extractions', context.context_id] })
    },
    onError: () => {
      setSubLabel(null)
    },
  })

  if (extractionsQuery.isLoading || summariesQuery.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading…</p>
  }

  if (hasReadySummary && latestSummary) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Badge tone="emerald">ready</Badge>
          <span className="text-[12px] text-muted-foreground">Generated summary</span>
        </div>
        <Field label="Company Name">
          <p className="text-[15px] font-semibold text-foreground">{latestSummary.company_name || 'Unknown'}</p>
        </Field>
        <Field label="Website">
          {latestSummary.website && latestSummary.website !== 'Unknown' ? (
            <a
              href={latestSummary.website}
              target="_blank"
              rel="noreferrer"
              className="text-[13.5px] text-[var(--brand)] hover:underline"
            >
              {latestSummary.website}
            </a>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">Unknown</p>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Region">
            <p className="text-[13.5px] text-foreground">{latestSummary.region || 'Unknown'}</p>
          </Field>
          <Field label="Industry">
            <p className="text-[13.5px] text-foreground">{latestSummary.industry || 'Unknown'}</p>
          </Field>
        </div>
        <Field label="Products">
          <BulletList items={latestSummary.products} />
        </Field>
        <Field label="Services">
          <BulletList items={latestSummary.services} />
        </Field>
        <Field label="Company Description">
          <p className="text-[13.5px] leading-relaxed text-foreground">{latestSummary.description || 'Unknown'}</p>
        </Field>
        <Field label="Short Verdict">
          <p className="rounded-lg border border-border bg-muted px-3 py-2.5 text-[13.5px] italic text-foreground">
            {latestSummary.verdict || 'Unknown'}
          </p>
        </Field>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-[13.5px] text-muted-foreground">
        No summary yet for this context. Generating one will crawl the website (if not already
        done) and then produce a concise company summary.
      </p>

      {generateMutation.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {generateMutation.error instanceof Error
              ? generateMutation.error.message
              : 'Failed to generate summary.'}
          </p>
        </div>
      )}

      <Button variant="brand" disabled={generateMutation.isPending} onClick={() => generateMutation.mutate()}>
        {generateMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {subLabel ?? 'Working…'}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" /> Generate Summary
          </>
        )}
      </Button>
    </div>
  )
}
