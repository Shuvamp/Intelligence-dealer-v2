import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Download, FileText,
  Loader2, Printer, RefreshCw, Sparkles, XCircle,
} from 'lucide-react'
import {
  createExtraction, getExtraction, listExtractions, type ExtractionResult,
} from '#/lib/website-extraction'
import {
  createAnalysis as createSeo, getAnalysis as getSeo, listAnalyses as listSeo,
  type AnalysisResult as SeoResult, type SeoAnalysisData, type SeoStatus,
} from '#/lib/seo-agent'
import {
  createAnalysis as createAeo, getAnalysis as getAeo, listAnalyses as listAeo,
  type AnalysisResult as AeoResult, type AeoAnalysisData,
} from '#/lib/aeo-agent'
import {
  createReport as createRec, getReport as getRec, listReports as listRec,
} from '#/lib/recommendation-engine'
import {
  createReport, getReport, listReports, type ReportData, type ReportResult,
} from '#/lib/report-generator'
import type { ContextResult } from '#/lib/context-planner'
import { Badge, Button, Panel, PanelHeader } from '#/components/ui/kit'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 45000

type Stage = 'crawl' | 'seo' | 'aeo' | 'recommend' | 'report'
const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'crawl', label: 'Crawling website' },
  { id: 'seo', label: 'Analyzing SEO (24 checks)' },
  { id: 'aeo', label: 'Analyzing AEO (11 agents)' },
  { id: 'recommend', label: 'Consolidating recommendations' },
  { id: 'report', label: 'Generating report' },
]

function scoreTone(score: number): 'emerald' | 'sky' | 'amber' | 'rose' {
  if (score >= 90) return 'emerald'
  if (score >= 75) return 'sky'
  if (score >= 60) return 'amber'
  return 'rose'
}

async function pollUntilReady<T extends { status: string; errors: Array<string> }>(
  fetchOne: () => Promise<T | null>,
  label: string,
): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${label} timed out.`)
    const polled = await fetchOne()
    if (!polled) throw new Error(`${label} disappeared while polling.`)
    if (polled.status === 'ready') return polled
    if (polled.status === 'failed') throw new Error(polled.errors[0] ?? `${label} failed.`)
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

// On screen: the concise view is shown and `.print-report` (the full report)
// is hidden. When printing (Download → PDF), everything is hidden EXCEPT
// `.print-report`, so the PDF carries the complete detail while the screen
// stays concise.
const PRINT_CSS = `
.print-report { display: none; }
@media print {
  body * { visibility: hidden !important; }
  .print-report, .print-report * { visibility: visible !important; }
  .print-report { display: block !important; position: absolute; left: 0; top: 0; width: 100%; padding: 24px !important; margin: 0 !important; }
  .no-print { display: none !important; }
}
`

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface Results {
  seo: SeoAnalysisData
  aeo: AeoAnalysisData
  report: ReportResult
}

function asSeoData(r: SeoResult | undefined): SeoAnalysisData | null {
  if (r?.status === 'ready' && r.analysis_data && 'dimensions' in r.analysis_data) return r.analysis_data as SeoAnalysisData
  return null
}

function asAeoData(r: AeoResult | undefined): AeoAnalysisData | null {
  if (r?.status === 'ready' && r.analysis_data && 'agents' in r.analysis_data) return r.analysis_data as AeoAnalysisData
  return null
}

export function AnalysisPage({ context, tenantId }: { context: ContextResult | null; tenantId: string }) {
  void tenantId
  const [running, setRunning] = useState(false)
  const [activeStage, setActiveStage] = useState<Stage | null>(null)
  const [doneStages, setDoneStages] = useState<Record<Stage, boolean>>({} as Record<Stage, boolean>)
  const [fresh, setFresh] = useState<Results | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => () => { cancelled.current = true }, [])

  // Load latest ready SEO + AEO + report so revisits render instantly.
  const seoQ = useQuery({
    queryKey: ['analysis', 'seo', context?.context_id],
    queryFn: () => listSeo({ data: { context_id: context!.context_id, limit: 1 } }),
    enabled: !!context,
  })
  const aeoQ = useQuery({
    queryKey: ['analysis', 'aeo', context?.context_id],
    queryFn: () => listAeo({ data: { context_id: context!.context_id, limit: 1 } }),
    enabled: !!context,
  })
  const reportQ = useQuery({
    queryKey: ['analysis', 'report', context?.context_id],
    queryFn: () => listReports({ data: { context_id: context!.context_id, limit: 1 } }),
    enabled: !!context,
  })

  const existingSeo = asSeoData(seoQ.data?.[0])
  const existingAeo = asAeoData(aeoQ.data?.[0])
  const existingReport = reportQ.data?.[0]?.status === 'ready' ? reportQ.data[0] : undefined

  const results: Results | null =
    fresh ??
    (existingSeo && existingAeo && existingReport
      ? { seo: existingSeo, aeo: existingAeo, report: existingReport }
      : null)

  async function run() {
    if (!context || running) return
    setRunning(true)
    setErrorMsg(null)
    setFresh(null)
    setDoneStages({} as Record<Stage, boolean>)
    cancelled.current = false

    const mark = (s: Stage) => setDoneStages((prev) => ({ ...prev, [s]: true }))

    try {
      // 1. Extraction
      setActiveStage('crawl')
      const latestExt = (await listExtractions({ data: { context_id: context.context_id, limit: 1 } }))[0]
      let extraction: ExtractionResult
      if (latestExt && latestExt.status === 'ready') {
        extraction = latestExt
      } else {
        const created = latestExt && latestExt.status !== 'failed' ? latestExt : await createExtraction({ data: { context_id: context.context_id } })
        extraction = await pollUntilReady(() => getExtraction({ data: { extraction_id: created.extraction_id } }), 'Website extraction')
      }
      const extId = extraction.extraction_id
      mark('crawl')
      if (cancelled.current) return

      // 2. SEO
      setActiveStage('seo')
      let seoRow = (await listSeo({ data: { context_id: context.context_id, limit: 1 } }))[0]
      if (!seoRow || seoRow.status !== 'ready') {
        const created = await createSeo({ data: { extraction_id: extId } })
        seoRow = await pollUntilReady(() => getSeo({ data: { analysis_id: created.analysis_id } }), 'SEO analysis')
      }
      const seo = asSeoData(seoRow)
      mark('seo')
      if (cancelled.current) return

      // 3. AEO
      setActiveStage('aeo')
      let aeoRow = (await listAeo({ data: { context_id: context.context_id, limit: 1 } }))[0]
      if (!aeoRow || aeoRow.status !== 'ready') {
        const created = await createAeo({ data: { extraction_id: extId } })
        aeoRow = await pollUntilReady(() => getAeo({ data: { analysis_id: created.analysis_id } }), 'AEO analysis')
      }
      const aeo = asAeoData(aeoRow)
      mark('aeo')
      if (cancelled.current) return

      // 4. Recommendation report (report generator anchors on this)
      setActiveStage('recommend')
      let recRow = (await listRec({ data: { context_id: context.context_id, limit: 1 } }))[0]
      if (!recRow || recRow.status !== 'ready') {
        const created = await createRec({ data: { extraction_id: extId } })
        recRow = await pollUntilReady(() => getRec({ data: { report_id: created.report_id } }), 'Recommendations')
      }
      mark('recommend')
      if (cancelled.current) return

      // 5. Report (always generate a fresh one so it reflects the latest analyses)
      setActiveStage('report')
      const createdReport = await createReport({ data: { extraction_id: extId } })
      const report = await pollUntilReady(() => getReport({ data: { report_id: createdReport.report_id } }), 'Report')
      mark('report')
      if (cancelled.current) return

      if (!seo || !aeo) throw new Error('Analysis produced no results.')
      setFresh({ seo, aeo, report })
      setActiveStage(null)
      setRunning(false)
      void seoQ.refetch()
      void aeoQ.refetch()
      void reportQ.refetch()
    } catch (err) {
      if (cancelled.current) return
      setRunning(false)
      setActiveStage(null)
      setErrorMsg(err instanceof Error ? err.message : 'Analysis failed.')
    }
  }

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
    <div className="mx-auto max-w-3xl space-y-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="fade-up flex items-center gap-3 no-print">
        <Link
          to="/context-planner"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="kicker text-muted-foreground/70">Analysis</div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-foreground">{title}</h1>
        </div>
      </div>

      {results ? (
        <ResultsView results={results} onRerun={run} running={running} downloadOpen={downloadOpen} setDownloadOpen={setDownloadOpen} />
      ) : (
        <Panel className="p-5 no-print">
          <p className="mb-4 text-[13.5px] text-muted-foreground">
            Run a full SEO + AEO analysis of this website. One click crawls the site, scores every check, and
            builds a downloadable report — no back-and-forth.
          </p>

          {errorMsg && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{errorMsg}</p>
            </div>
          )}

          <Button variant="brand" disabled={running} onClick={() => void run()}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {running ? 'Analyzing…' : 'Run Analysis'}
          </Button>

          {running && (
            <ul className="mt-5 space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              {STAGES.map((stage) => {
                const done = doneStages[stage.id]
                const active = activeStage === stage.id
                return (
                  <li key={stage.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className={done || active ? 'font-medium text-foreground' : 'font-medium text-muted-foreground/50'}>{stage.label}</span>
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--brand)]" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  )
}

function CheckRow({ status, name, points, action }: { status: SeoStatus; name: string; points: number; action?: string }) {
  const icon =
    status === 'PASS' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
    : status === 'WARNING' ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
    : <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
  const tone = status === 'PASS' ? 'emerald' : status === 'WARNING' ? 'amber' : 'rose'
  return (
    <div className="flex items-start gap-2.5 px-5 py-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-foreground">{name}</span>
          <Badge tone={tone}>+{points}</Badge>
        </div>
        {status !== 'PASS' && action && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">→ {action}</p>
        )}
      </div>
    </div>
  )
}

function pointsFor(status: SeoStatus): number {
  return status === 'PASS' ? 2 : status === 'WARNING' ? 1 : 0
}

function ResultsView({
  results, onRerun, running, downloadOpen, setDownloadOpen,
}: {
  results: Results
  onRerun: () => void
  running: boolean
  downloadOpen: boolean
  setDownloadOpen: (v: boolean) => void
}) {
  const { seo, aeo, report } = results
  const data: ReportData | null =
    report.report_data && 'executive_summary' in report.report_data ? (report.report_data as ReportData) : null

  const combined = data?.overall_score.combined_score ?? report.overall_score ?? 0
  const grade = data?.overall_score.combined_grade ?? '—'
  const seoScore = data?.overall_score.seo_score ?? seo.summary.overall_score
  const aeoScore = data?.overall_score.aeo_score ?? aeo.summary.aeo_score
  const topActions = (data?.priority_fixes ?? []).slice(0, 3)

  return (
    <div className="space-y-5">
      <PrintReport data={data} seo={seo} aeo={aeo} generatedAt={report.completed_at ?? report.created_at} />

      {/* Score + verdict header */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="kicker text-muted-foreground/70">Overall Score</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-[40px] font-bold leading-none text-foreground">{combined}</span>
              <span className="text-[15px] text-muted-foreground">/ 100</span>
              <Badge tone={scoreTone(combined)} className="ml-2 text-[13px]">{grade}</Badge>
            </div>
            <div className="mt-2 flex gap-2 text-[12px] text-muted-foreground">
              <span>SEO {seoScore}</span><span>·</span><span>AEO {aeoScore}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <div className="relative">
              <Button variant="brand" onClick={() => setDownloadOpen(!downloadOpen)}>
                <Download className="h-4 w-4" /> Download <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {downloadOpen && (
                <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                  <button type="button" onClick={() => { download('report.json', JSON.stringify(report.report_data, null, 2), 'application/json'); setDownloadOpen(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted">
                    <FileText className="h-3.5 w-3.5" /> JSON
                  </button>
                  <button type="button" onClick={() => { download('report.md', report.markdown_content ?? '', 'text/markdown;charset=utf-8;'); setDownloadOpen(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted">
                    <FileText className="h-3.5 w-3.5" /> Markdown
                  </button>
                  <button type="button" onClick={() => { setDownloadOpen(false); window.print() }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted">
                    <Printer className="h-3.5 w-3.5" /> PDF
                  </button>
                </div>
              )}
            </div>
            <Button variant="outline" disabled={running} onClick={onRerun}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Re-analyze
            </Button>
          </div>
        </div>

        {data?.executive_summary && (
          <p className="mt-4 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">{data.executive_summary}</p>
        )}

        {topActions.length > 0 && (
          <div className="mt-4">
            <div className="kicker text-muted-foreground/70">Top recommended actions</div>
            <ul className="mt-1.5 space-y-1">
              {topActions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] text-foreground">
                  <Badge tone={a.severity === 'Critical' ? 'rose' : 'amber'} className="mt-0.5">{a.severity}</Badge>
                  <span>{a.fix}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {/* SEO checks */}
      <Panel className="overflow-hidden">
        <PanelHeader title={`SEO — ${seo.summary.overall_score}/100 (${seo.summary.grade})`} kicker="Search Engine Optimization" />
        <div className="divide-y divide-border">
          {seo.dimensions.map((d) => (
            <CheckRow key={d.dimension} status={d.status} name={d.dimension} points={pointsFor(d.status)}
              action={d.recommendations[0]?.recommendation} />
          ))}
        </div>
      </Panel>

      {/* AEO checks */}
      <Panel className="overflow-hidden">
        <PanelHeader title={`AEO — ${aeo.summary.aeo_score}/100`} kicker="Answer Engine Optimization" />
        <div className="divide-y divide-border">
          {aeo.agents.map((a) => (
            <CheckRow key={a.agent} status={a.status} name={a.agent} points={pointsFor(a.status)}
              action={a.recommendations[0]?.how_to_improve} />
          ))}
        </div>
      </Panel>
    </div>
  )
}

// Full report — hidden on screen, rendered into the PDF via window.print().
// Carries the complete detail (all narrative sections + every check + all
// recommendations), so a downloaded PDF matches the JSON/Markdown exports.
function PrintReport({
  data, seo, aeo, generatedAt,
}: {
  data: ReportData | null
  seo: SeoAnalysisData
  aeo: AeoAnalysisData
  generatedAt: string | null
}) {
  if (!data) return null
  const os = data.overall_score
  const narratives: Array<[string, string]> = [
    ['Executive Summary', data.executive_summary],
    ['Company Overview', data.company_overview],
    ['Website Summary', data.website_summary],
    ['SEO Summary', data.seo_summary],
    ['AEO Summary', data.aeo_summary],
  ]
  const h2 = { fontSize: '15px', fontWeight: 700, margin: '18px 0 6px' } as const
  const p = { fontSize: '12px', lineHeight: 1.5, margin: '0 0 6px' } as const

  return (
    <div className="print-report" style={{ color: '#111', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 2px' }}>
        SEO &amp; AEO Report — {data.meta.company_name || 'Company'}
      </h1>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
        {generatedAt ? new Date(generatedAt).toLocaleString() : ''} · engine: {data.meta.engine}
      </div>
      <div style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 12px' }}>
        Overall {os.combined_score}/100 (Grade {os.combined_grade}) — SEO {os.seo_score} · AEO {os.aeo_score}
      </div>

      {narratives.map(([title, text]) => (
        <div key={title}>
          <div style={h2}>{title}</div>
          <p style={p}>{text}</p>
        </div>
      ))}

      <div style={h2}>Strengths</div>
      {data.strengths.length === 0 ? <p style={p}>None.</p> : (
        <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
          {data.strengths.map((s, i) => <li key={i} style={p}><b>[{s.source.toUpperCase()}] {s.title}</b> — {s.detail}</li>)}
        </ul>
      )}

      <div style={h2}>Weaknesses</div>
      {data.weaknesses.length === 0 ? <p style={p}>None.</p> : (
        <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
          {data.weaknesses.map((w, i) => <li key={i} style={p}><b>[{w.source.toUpperCase()}] {w.title}</b> — {w.detail}</li>)}
        </ul>
      )}

      <div style={h2}>Priority Fixes</div>
      {data.priority_fixes.length === 0 ? <p style={p}>None.</p> : (
        <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
          {data.priority_fixes.map((r, i) => <li key={i} style={p}><b>[{r.severity}] {r.problem}</b> — {r.fix} <i>({r.estimated_time})</i></li>)}
        </ul>
      )}

      <div style={h2}>Technical Details</div>
      <p style={p}>
        Pages crawled {data.technical_details.pages_crawled_count} · SSL {data.technical_details.has_ssl ? 'yes' : 'no'} ·
        Sitemap {data.technical_details.has_sitemap ? 'yes' : 'no'} · robots.txt {data.technical_details.has_robots_txt ? 'yes' : 'no'} ·
        CMS {data.technical_details.cms || 'Unknown'} · Schema {data.technical_details.schema_markup_types.join(', ') || 'none'}
      </p>

      <div style={h2}>SEO Checks ({seo.summary.overall_score}/100, grade {seo.summary.grade})</div>
      <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
        {seo.dimensions.map((d) => (
          <li key={d.dimension} style={p}>
            {d.status === 'PASS' ? '✓' : d.status === 'WARNING' ? '⚠' : '✗'} <b>{d.dimension}</b> ({d.status})
            {d.status !== 'PASS' && d.recommendations[0]?.recommendation ? ` — ${d.recommendations[0].recommendation}` : ''}
          </li>
        ))}
      </ul>

      <div style={h2}>AEO Checks ({aeo.summary.aeo_score}/100)</div>
      <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
        {aeo.agents.map((a) => (
          <li key={a.agent} style={p}>
            {a.status === 'PASS' ? '✓' : a.status === 'WARNING' ? '⚠' : '✗'} <b>{a.agent}</b> ({a.status})
            {a.status !== 'PASS' && a.recommendations[0]?.how_to_improve ? ` — ${a.recommendations[0].how_to_improve}` : ''}
          </li>
        ))}
      </ul>

      <div style={h2}>All Recommendations ({data.recommendations.length})</div>
      <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
        {data.recommendations.map((r, i) => (
          <li key={i} style={p}><b>[{r.severity}] {r.category}: {r.problem}</b> — {r.fix} <i>({r.estimated_time}, difficulty {r.difficulty})</i></li>
        ))}
      </ul>
    </div>
  )
}
