import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, Download, FileText, Loader2, Printer, RefreshCw, Sparkles, XCircle,
} from 'lucide-react'
import {
  createExtraction, getExtraction, listExtractions 
} from '#/lib/website-extraction'
import type {ExtractionResult} from '#/lib/website-extraction';
import { createSummary, listSummaries  } from '#/lib/company-summary'
import type {SummaryResult} from '#/lib/company-summary';
import {
  createAnalysis as createSeo, getAnalysis as getSeo, listAnalyses as listSeo
   
} from '#/lib/seo-agent'
import type {AnalysisResult as SeoResult, SeoAnalysisData} from '#/lib/seo-agent';
import {
  createAnalysis as createAeo, getAnalysis as getAeo, listAnalyses as listAeo
   
} from '#/lib/aeo-agent'
import type {AnalysisResult as AeoResult, AeoAnalysisData} from '#/lib/aeo-agent';
import {
  createReport as createRec, getReport as getRec, listReports as listRec,
} from '#/lib/recommendation-engine'
import {
  createReport, getReport, listReports  
} from '#/lib/report-generator'
import type {ReportData, ReportResult} from '#/lib/report-generator';
import type { ContextResult } from '#/lib/context-planner'
import { Badge, Button, Panel, PanelHeader } from '#/components/ui/kit'
import {
  AnalyzeGlyph, BusinessInfoCard, CheckPanel, PipelineStepper, RecommendationCard, ScoreGauge,
  scoreTone    
} from './analysis-ui'
import type {BusinessInfoData, CheckItem, RecommendationView, StepperStage} from './analysis-ui';

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 45000

const STAGES: Array<StepperStage> = [
  { id: 'crawl', label: 'Crawling website' },
  { id: 'summary', label: 'Summarizing business' },
  { id: 'seo', label: 'Analyzing SEO (24 checks)' },
  { id: 'aeo', label: 'Analyzing AEO (11 agents)' },
  { id: 'recommend', label: 'Consolidating recommendations' },
  { id: 'report', label: 'Generating report' },
]

// Print: screen shows the concise view and hides `.print-report`; when printing,
// only `.print-report` is visible so the PDF carries the full detail.
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

export function AnalysisView({ context, autoRun = false }: { context: ContextResult; autoRun?: boolean }) {
  const [running, setRunning] = useState(false)
  const [activeStage, setActiveStage] = useState<string | null>(null)
  const [doneStages, setDoneStages] = useState<Record<string, boolean>>({})
  const [fresh, setFresh] = useState<Results | null>(null)
  const [freshSummary, setFreshSummary] = useState<SummaryResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const cancelled = useRef(false)
  const autoRan = useRef(false)

  useEffect(() => () => { cancelled.current = true }, [])

  // Load latest ready artifacts so revisits render instantly.
  const seoQ = useQuery({
    queryKey: ['analysis', 'seo', context.context_id],
    queryFn: () => listSeo({ data: { context_id: context.context_id, limit: 1 } }),
  })
  const aeoQ = useQuery({
    queryKey: ['analysis', 'aeo', context.context_id],
    queryFn: () => listAeo({ data: { context_id: context.context_id, limit: 1 } }),
  })
  const reportQ = useQuery({
    queryKey: ['analysis', 'report', context.context_id],
    queryFn: () => listReports({ data: { context_id: context.context_id, limit: 1 } }),
  })
  const summaryQ = useQuery({
    queryKey: ['company-summary', 'summaries', context.context_id],
    queryFn: () => listSummaries({ data: { context_id: context.context_id, limit: 1 } }),
  })

  const existingSeo = asSeoData(seoQ.data?.[0])
  const existingAeo = asAeoData(aeoQ.data?.[0])
  const existingReport = reportQ.data?.[0]?.status === 'ready' ? reportQ.data[0] : undefined
  const existingSummary = summaryQ.data?.[0]?.status === 'ready' ? summaryQ.data[0] : undefined

  const results: Results | null =
    fresh ??
    (existingSeo && existingAeo && existingReport
      ? { seo: existingSeo, aeo: existingAeo, report: existingReport }
      : null)
  const summary = freshSummary ?? existingSummary ?? null

  const loading = seoQ.isLoading || aeoQ.isLoading || reportQ.isLoading || summaryQ.isLoading

  async function run() {
    if (running) return
    setRunning(true)
    setErrorMsg(null)
    setFresh(null)
    setDoneStages({})
    cancelled.current = false
    const mark = (s: string) => setDoneStages((prev) => ({ ...prev, [s]: true }))

    try {
      // 1. Extraction (crawl)
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

      // 2. Business summary
      setActiveStage('summary')
      let summaryRow = (await listSummaries({ data: { context_id: context.context_id, limit: 1 } }))[0]
      if (!summaryRow || summaryRow.status !== 'ready') {
        summaryRow = await createSummary({ data: { extraction_id: extId } })
      }
      if (summaryRow?.status === 'ready') setFreshSummary(summaryRow)
      mark('summary')
      if (cancelled.current) return

      // 3. SEO
      setActiveStage('seo')
      let seoRow = (await listSeo({ data: { context_id: context.context_id, limit: 1 } }))[0]
      if (!seoRow || seoRow.status !== 'ready') {
        const created = await createSeo({ data: { extraction_id: extId } })
        seoRow = await pollUntilReady(() => getSeo({ data: { analysis_id: created.analysis_id } }), 'SEO analysis')
      }
      const seo = asSeoData(seoRow)
      mark('seo')
      if (cancelled.current) return

      // 4. AEO
      setActiveStage('aeo')
      let aeoRow = (await listAeo({ data: { context_id: context.context_id, limit: 1 } }))[0]
      if (!aeoRow || aeoRow.status !== 'ready') {
        const created = await createAeo({ data: { extraction_id: extId } })
        aeoRow = await pollUntilReady(() => getAeo({ data: { analysis_id: created.analysis_id } }), 'AEO analysis')
      }
      const aeo = asAeoData(aeoRow)
      mark('aeo')
      if (cancelled.current) return

      // 5. Recommendation report (report generator anchors on this)
      setActiveStage('recommend')
      let recRow = (await listRec({ data: { context_id: context.context_id, limit: 1 } }))[0]
      if (!recRow || recRow.status !== 'ready') {
        const created = await createRec({ data: { extraction_id: extId } })
        recRow = await pollUntilReady(() => getRec({ data: { report_id: created.report_id } }), 'Recommendations')
      }
      mark('recommend')
      if (cancelled.current) return

      // 6. Report (fresh so it reflects the latest analyses)
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
      void summaryQ.refetch()
    } catch (err) {
      if (cancelled.current) return
      setRunning(false)
      setActiveStage(null)
      setErrorMsg(err instanceof Error ? err.message : 'Analysis failed.')
    }
  }

  // Auto-run once for freshly created contexts (hub "type URL → Analyze" flow).
  useEffect(() => {
    if (autoRun && !autoRan.current && !loading && !results && !running) {
      autoRan.current = true
      void run()
    }
  }, [autoRun, loading, results, running])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-10 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading analysis…
      </div>
    )
  }

  if (running) {
    return (
      <div className="fade-up space-y-4">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)]" /> Analyzing {context.company_name || context.website || context.url}…
        </div>
        <PipelineStepper stages={STAGES} activeStage={activeStage} doneStages={doneStages} />
      </div>
    )
  }

  if (!results) {
    return (
      <div className="fade-up py-8 text-center">
        <AnalyzeGlyph />
        <h3 className="mt-4 font-display text-[18px] font-semibold text-foreground">Analyze this website</h3>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          One click crawls the site, summarizes the business, scores every SEO &amp; AEO check, and builds a
          downloadable report.
        </p>
        {errorMsg ? (
          <div className="mx-auto mt-4 flex max-w-md items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-left text-[13px] text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{errorMsg}</p>
          </div>
        ) : null}
        <div className="mt-5 flex justify-center">
          <Button variant="brand" onClick={() => void run()}>
            <Sparkles className="h-4 w-4" /> Run Analysis
          </Button>
        </div>
      </div>
    )
  }

  return <ResultsView
    results={results}
    summary={summary}
    context={context}
    running={running}
    onRerun={() => void run()}
    downloadOpen={downloadOpen}
    setDownloadOpen={setDownloadOpen}
  />
}

function toBusinessData(summary: SummaryResult | null, report: ReportResult, context: ContextResult): BusinessInfoData {
  const data = report.report_data && 'company_overview' in report.report_data ? (report.report_data as ReportData) : null
  return {
    company_name: summary?.company_name ?? data?.meta.company_name ?? context.company_name ?? null,
    website: summary?.website ?? data?.meta.website ?? context.website ?? context.url ?? null,
    region: summary?.region ?? context.region ?? null,
    industry: summary?.industry ?? context.industry ?? null,
    products: summary?.products ?? [],
    services: summary?.services ?? [],
    description: summary?.description ?? data?.company_overview ?? context.description ?? null,
    verdict: summary?.verdict ?? data?.executive_summary ?? null,
  }
}

function ResultsView({
  results, summary, context, running, onRerun, downloadOpen, setDownloadOpen,
}: {
  results: Results
  summary: SummaryResult | null
  context: ContextResult
  running: boolean
  onRerun: () => void
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

  const business = useMemo(() => toBusinessData(summary, report, context), [summary, report, context])

  const seoChecks = useMemo<Array<CheckItem>>(
    () => seo.dimensions.map((d) => ({ name: d.dimension, status: d.status, action: d.recommendations[0]?.recommendation })),
    [seo],
  )
  const aeoChecks = useMemo<Array<CheckItem>>(
    () => aeo.agents.map((a) => ({ name: a.agent, status: a.status, action: a.recommendations[0]?.how_to_improve })),
    [aeo],
  )

  const priorityRecs = useMemo<Array<RecommendationView>>(
    () => (data?.priority_fixes ?? []).map((r) => ({
      severity: r.severity, problem: r.problem, reason: r.reason, fix: r.fix,
      category: r.category, estimated_time: r.estimated_time, source: r.source,
    })),
    [data],
  )

  return (
    <div className="space-y-5">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <PrintReport data={data} seo={seo} aeo={aeo} generatedAt={report.completed_at ?? report.created_at} />

      {/* Score header */}
      <Panel className="fade-up p-5 no-print">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-6">
            <ScoreGauge score={combined} label="Overall" grade={grade} />
            <div className="flex gap-5">
              <ScoreGauge score={seoScore} label="SEO" size={92} stroke={8} />
              <ScoreGauge score={aeoScore} label="AEO" size={92} stroke={8} />
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <div className="relative">
              <Button variant="brand" onClick={() => setDownloadOpen(!downloadOpen)}>
                <Download className="h-4 w-4" /> Export <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {downloadOpen ? (
                <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-float">
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
              ) : null}
            </div>
            <Button variant="outline" disabled={running} onClick={onRerun}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Re-analyze
            </Button>
          </div>
        </div>

        {data?.executive_summary ? (
          <p className="mt-4 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">{data.executive_summary}</p>
        ) : null}
      </Panel>

      {/* Business information */}
      <Panel className="fade-up overflow-hidden no-print" style={{ animationDelay: '60ms' }}>
        <PanelHeader kicker="Extracted from the website" title="Business Information" />
        <BusinessInfoCard data={business} />
      </Panel>

      {/* Priority recommendations */}
      {priorityRecs.length > 0 ? (
        <Panel className="fade-up overflow-hidden no-print" style={{ animationDelay: '120ms' }}>
          <PanelHeader
            kicker="What to fix first"
            title="Priority Recommendations"
            action={<span className="num text-[12px] font-semibold text-muted-foreground">{priorityRecs.length}</span>}
          />
          <div className="space-y-2 px-5 py-4">
            {priorityRecs.map((r, i) => <RecommendationCard key={i} rec={r} />)}
          </div>
        </Panel>
      ) : null}

      {/* SEO + AEO — full-width, verdict-first */}
      <div className="no-print space-y-5">
        <CheckPanel
          kicker="Search Engine Optimization"
          title={`SEO — ${seo.summary.overall_score}/100`}
          headerBadge={<Badge tone={scoreTone(seo.summary.overall_score)}>{seo.summary.grade}</Badge>}
          items={seoChecks}
          delay={180}
        />
        <CheckPanel
          kicker="Answer Engine Optimization"
          title={`AEO — ${aeo.summary.aeo_score}/100`}
          headerBadge={<Badge tone={scoreTone(aeo.summary.aeo_score)}>{aeo.summary.pass_count}/{aeo.agents.length}</Badge>}
          items={aeoChecks}
          delay={240}
        />
      </div>
    </div>
  )
}

// Full report — hidden on screen, rendered into the PDF via window.print().
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
