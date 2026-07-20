import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  ArrowLeft, ArrowRight, Loader2, XCircle, Check,
  Gauge, Bot, Sparkles, CircleCheck,
  AlertTriangle, Quote, Send, MessageSquareText,
  Phone, MessageCircle, Mail, Image as ImageIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { addLeadMessage, getLead, getSalesTeam, updateLeadStage, assignLead } from '#/lib/leads'
import { runFollowup, type FollowupResult } from '#/lib/followup'
import { sendWhatsAppMessage, type WhatsAppSendResult } from '#/lib/whatsapp'
import { runRescore } from '#/lib/rescore'
import { Panel, PanelHeader, initials, timeAgo, formatIN } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import {
  ScoreBadge, StageBadge, SourceTag, SOURCE_META, STAGE_META, formatMoney,
} from '#/components/leads/lead-ui'
import { ActivityDrawer } from '#/components/leads/ActivityDrawer'
import { MessagesPanel, ScoreHistoryPanel } from '#/components/leads/DetailSections'
import type { LeadDetail, LeadStage, SalesMember, Lead } from '#/lib/types'

export const Route = createFileRoute('/_authed/leads/$leadId')({
  loader: async ({ params }) => {
    const [detail, team] = await Promise.all([
      getLead({ data: { id: params.leadId } }),
      getSalesTeam(),
    ])
    return { detail, team }
  },
  component: LeadDetailPage,
})

// Phase 2: the funnel now ends in booked → delivered (two real steps) rather
// than a single "won" close action. qualified/quotation are dropped from the
// clickable funnel (legacy values still exist on old rows — folded onto
// contacted/negotiation respectively for display, see BOARD_COLUMN_FOR_STAGE)
// — only 'lost' remains as a separate close-style exit.
const FUNNEL: Array<LeadStage> = ['new', 'contacted', 'test_drive', 'negotiation', 'booked', 'delivered']

// The detail view renders as a full, deep-linkable page with a "Back to leads"
// control at the top (replacing the earlier slide-over drawer). The route,
// loader, and every section component below are otherwise untouched.
function BackBar() {
  return (
    <Link
      to="/leads"
      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-all hover:gap-2.5 hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Back to leads
    </Link>
  )
}

function LeadDetailPage() {
  const data = Route.useLoaderData() as { detail: LeadDetail | null; team: Array<SalesMember> }
  const { detail, team } = data
  // router is used by the WhatsApp inbound-reply effect below to refresh the page.
  // (navigate/close from the old drawer version are gone — this is now a full page
  // with a BackBar link, not a slide-over.)
  const router = useRouter()

  // Single SSE connection for all real-time events on this lead detail page.
  // Handles: whatsapp_inbound (customer reply) and rescore_complete (Phase 6).
  useEffect(() => {
    if (!detail) return
    const agentUrl =
      (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    const es = new EventSource(`${agentUrl}/intake/stream`)
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as {
          type?: string; lead_id?: string
          customer_name?: string; body_preview?: string   // whatsapp_inbound
          new_score?: string; previous_score?: string; trigger?: string; score_changed?: boolean  // rescore_complete
        }
        if (d.lead_id !== detail.lead.id) return

        if (d.type === 'whatsapp_inbound') {
          toast.success(`Reply from ${d.customer_name ?? 'customer'}`, {
            description: d.body_preview || 'New WhatsApp message',
            duration: 8000,
          })
          void router.invalidate()
        }

        if (d.type === 'rescore_complete') {
          if (d.score_changed && d.new_score && d.previous_score && d.new_score !== d.previous_score) {
            toast.info(`Score updated: ${d.previous_score} → ${d.new_score}`, {
              description: `Triggered by: ${d.trigger?.replace(/_/g, ' ')}`,
              duration: 6000,
            })
          }
          void router.invalidate()
        }
      } catch {}
    }
    return () => es.close()
  }, [detail?.lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail) {
    return (
      <div className="space-y-5">
        <BackBar />
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <p className="text-[15px] font-semibold text-foreground">Lead not found</p>
          <p className="text-[14px] text-muted-foreground">
            This lead may have been removed or you don’t have access to it.
          </p>
          <Link
            to="/leads"
            className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold brand-text transition-all hover:gap-2.5"
          >
            <ArrowLeft className="h-4 w-4" /> Back to pipeline
          </Link>
        </div>
      </div>
    )
  }

  const { lead } = detail

  return (
    <div className="space-y-5">
      <BackBar />
      <div className="fade-up space-y-5">
        <HeaderCard detail={detail} />

        {/* Scoring-service notice — prominent, full width, only when something went off-path */}
        {lead.score_notice ? <ScoringNotice notice={lead.score_notice} /> : null}

        <div className="grid grid-cols-12 gap-5">
          {/* Left — wide interactive panels (follow-up, messaging, calls, tasks) */}
          <div className="col-span-12 space-y-5 lg:col-span-8">
            <FollowupCard
              leadId={lead.id}
              phone={detail.customer?.phone ?? null}
              email={detail.customer?.email ?? null}
              customerName={lead.customer_name}
            />
            <WhatsAppSendCard
              leadId={lead.id}
              messages={detail.messages}
            />
            <MessagesPanel detail={detail} />
          </div>

          {/* Right — at-a-glance sidebar: profile, scoring, next action, ownership, activity */}
          <div className="col-span-12 space-y-5 lg:col-span-4">
            <AssignControl lead={detail.lead} team={team} />
            <KeyFacts detail={detail} />
            <ScoringBreakdown lead={lead} />
            <AIReasoning lead={lead} />
            <RescoreButton leadId={lead.id} />
            <ScoreHistoryPanel scoreHistory={detail.score_history ?? []} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Phase 6: Manual Re-Score button ─────────────────────────────────────────
function RescoreButton({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleRescore() {
    setBusy(true)
    try {
      const result = await runRescore({ data: { lead_id: leadId, trigger: 'manual' } })
      if (result.score_changed) {
        toast.success(`Score updated: ${result.previous_score} → ${result.new_score}`)
      } else {
        toast.info('Score unchanged — lead profile is still current.')
      }
      void router.invalidate()
    } catch (err) {
      toast.error('Re-score failed', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleRescore}
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-[12.5px] font-semibold text-foreground transition hover:bg-muted disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {busy ? 'Re-scoring…' : 'Re-score this lead'}
    </button>
  )
}

// ── Scoring notice banner ────────────────────────────────────────────────────
// Shown when the scoring agent fell back (primary key rate-limited → backup, or
// deterministic fallback). Makes the issue obvious and explains what happened.
function ScoringNotice({ notice }: { notice: string }) {
  return (
    <div className="fade-up flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-amber-900">Scoring service notice</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-amber-800">{notice}</p>
      </div>
    </div>
  )
}

// ── Scoring Breakdown & AI Reasoning — two panels per PHASE_02's spec,
// split from what used to be one combined "Why this score" panel. Same
// underlying data (lead.score_value / lead.score_reasons) — no per-dimension
// numeric breakdown exists in the persisted Lead record today (the scoring
// agent's full 8-dimension detail is transient, computed at intake time and
// never written to the leads table), so this is a faithful, not invented,
// split rather than fabricating numbers that aren't actually stored. ───────
function ScoringBreakdown({ lead }: { lead: Lead }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Scoring breakdown"
        kicker="Lead quality"
        action={
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
            <Gauge className="h-3 w-3" /> {lead.score_value}/100
          </span>
        }
      />
      <div className="flex items-center gap-2 px-5 py-4">
        <ScoreBadge score={lead.score} />
        <span className="text-[12.5px] text-muted-foreground">
          {lead.scored_by ? (SCORED_BY_LABEL[lead.scored_by] ?? lead.scored_by) : 'Not yet scored'}
        </span>
      </div>
    </Panel>
  )
}

function AIReasoning({ lead }: { lead: Lead }) {
  const reasons = (lead.score_reasons ?? []).filter(Boolean)
  if (reasons.length === 0) return null
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="AI reasoning" kicker="Why this score" />
      <ul className="space-y-2 px-5 py-4">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-muted-foreground">
            <Quote className="mt-0.5 h-3 w-3 shrink-0 text-rose-300" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ── Follow-up Agent (LangGraph, apps/api) ────────────────────────────────────
// Decides the next best action, drafts an outreach message, logs an NBA event on
// the timeline, and notifies the assignee. The drafted message is shown inline.
// The 4 LangGraph nodes, in execution order — used to animate a live trace while
// the agent runs (the endpoint returns the real per-node detail when it finishes).
const FOLLOWUP_NODES: Array<{ label: string; engine: 'data' | 'groq' }> = [
  { label: 'Fetch detail', engine: 'data' },
  { label: 'Decide action', engine: 'groq' },
  { label: 'Draft message', engine: 'groq' },
  { label: 'Write NBA', engine: 'data' },
]

// Turns the agent's recommendation into one-click outreach: Call / WhatsApp /
// Email wired to the customer's real phone & email, with the recommended channel
// highlighted and the drafted message pre-filled where the channel supports it.
type ContactChannel = 'call' | 'whatsapp' | 'email'

function recommendedChannel(result: FollowupResult): ContactChannel | null {
  const s = `${result.action_type ?? ''} ${result.channel ?? ''}`.toLowerCase()
  if (s.includes('whatsapp')) return 'whatsapp'
  if (s.includes('email')) return 'email'
  if (s.includes('call') || s.includes('phone')) return 'call'
  return null
}

function ContactActions({
  result,
  phone,
  email,
  customerName,
}: {
  result: FollowupResult
  phone: string | null
  email: string | null
  customerName: string | null
}) {
  const reco = recommendedChannel(result)
  const msg = result.message ?? ''
  const digits = (phone ?? '').replace(/\D/g, '')
  const subject = `Following up on your Nissan enquiry`

  const actions: Array<{
    key: ContactChannel
    label: string
    icon: typeof Phone
    href: string | null
    onClick?: () => void
    disabledHint: string
  }> = [
    {
      key: 'call',
      label: 'Call',
      icon: Phone,
      href: phone ? `tel:${phone}` : null,
      disabledHint: 'No phone number on file',
    },
    {
      // WhatsApp always goes through the in-app WhatsApp Agent card — never wa.me
      key: 'whatsapp',
      label: 'WhatsApp',
      icon: MessageCircle,
      href: null,
      onClick: digits
        ? () => {
            document.getElementById('wa-send-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        : undefined,
      disabledHint: 'No phone number on file',
    },
    {
      key: 'email',
      label: 'Email',
      icon: Mail,
      href: email
        ? `mailto:${email}?subject=${encodeURIComponent(subject)}${msg ? `&body=${encodeURIComponent(msg)}` : ''}`
        : null,
      disabledHint: 'No email on file',
    },
  ]

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
        Contact {customerName ?? 'customer'}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {actions.map((a) => {
          const Icon = a.icon
          const isReco = reco === a.key
          const disabled = !a.href && !a.onClick
          const cls = cn(
            'inline-flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-[11.5px] font-semibold transition',
            disabled
              ? 'cursor-not-allowed border-dashed border-border text-muted-foreground/50'
              : isReco
                ? 'brand-bg border-transparent hover:opacity-90'
                : 'border-border bg-card text-foreground hover:bg-muted',
          )
          if (disabled) {
            return (
              <span key={a.key} className={cls} title={a.disabledHint}>
                <Icon className="h-4 w-4" />
                {a.label}
              </span>
            )
          }
          if (a.onClick) {
            return (
              <button
                key={a.key}
                type="button"
                onClick={a.onClick}
                className={cls}
                title={isReco ? 'Recommended by the follow-up agent' : a.label}
              >
                <Icon className="h-4 w-4" />
                {a.label}
                {isReco ? <span className="text-[9px] font-bold uppercase opacity-90">Recommended</span> : null}
              </button>
            )
          }
          return (
            <a
              key={a.key}
              href={a.href!}
              className={cls}
              title={isReco ? 'Recommended by the follow-up agent' : a.label}
            >
              <Icon className="h-4 w-4" />
              {a.label}
              {isReco ? <span className="text-[9px] font-bold uppercase opacity-90">Recommended</span> : null}
            </a>
          )
        })}
      </div>
    </div>
  )
}

function FollowupCard({
  leadId,
  phone,
  email,
  customerName,
}: {
  leadId: string
  phone: string | null
  email: string | null
  customerName: string | null
}) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<FollowupResult | null>(null)
  // How many nodes have "lit up" so far during a live run (0..4).
  const [activeStep, setActiveStep] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  // Close any open stream on unmount.
  useEffect(() => () => esRef.current?.close(), [])

  function finish(res: FollowupResult) {
    setActiveStep(FOLLOWUP_NODES.length)
    setResult(res)
    setRunning(false)
    toast.success(`Follow-up ready: ${(res.action_type ?? 'none').toUpperCase()}`, {
      description: res.assignee_notified ? 'Assignee notified · logged to timeline' : 'Logged to timeline',
    })
    // Phase 2: persist the drafted message so it survives a reload — it used
    // to only live in this component's React state (PHASE_02 gap analysis).
    if (res.message) {
      const reco = recommendedChannel(res)
      void addLeadMessage({
        data: {
          lead_id: leadId,
          channel: reco === 'call' ? 'call_note' : reco === 'email' ? 'email' : 'whatsapp',
          body: res.message,
          source: 'agent',
        },
      })
    }
    void router.invalidate() // surface the new NBA event in the timeline + the saved message
  }

  // Fallback for when the SSE stream can't connect (e.g. agent API unreachable
  // from the browser) — runs the same agent via the server function.
  async function runViaServerFn() {
    try {
      const res = await runFollowup({ data: { lead_id: leadId } })
      finish(res)
    } catch {
      setRunning(false)
      toast.error('Follow-up agent failed', { description: 'Is the API (apps/api :8000) running?' })
    }
  }

  function run() {
    if (running) return
    setRunning(true)
    setResult(null)
    setActiveStep(0)
    esRef.current?.close()

    const apiUrl =
      (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    let settled = false
    let es: EventSource
    try {
      es = new EventSource(`${apiUrl}/followup/${leadId}/stream`)
    } catch {
      void runViaServerFn()
      return
    }
    esRef.current = es

    // Each node finishing on the backend advances the live trace for real.
    es.addEventListener('node', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data as string) as { n: number }
        if (typeof data.n === 'number' && data.n > 0) setActiveStep(data.n)
      } catch {}
    })
    es.addEventListener('result', (e) => {
      settled = true
      es.close()
      try {
        finish(JSON.parse((e as MessageEvent).data as string) as FollowupResult)
      } catch {
        setRunning(false)
      }
    })
    es.addEventListener('error', (e) => {
      // A `data`-carrying error event = the agent reported a real failure.
      const data = (e as MessageEvent).data
      if (data) {
        settled = true
        es.close()
        setRunning(false)
        toast.error('Follow-up agent failed', { description: 'See the lead — it may not exist.' })
        return
      }
      // Otherwise it's a connection drop. If we never got a result, fall back.
      es.close()
      if (!settled) {
        settled = true
        void runViaServerFn()
      }
    })
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Follow-up agent"
        kicker="Next best action"
        action={
          <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-700">
            <Sparkles className="h-3 w-3" /> LangGraph
          </span>
        }
      />
      <div className="space-y-3 px-5 py-4">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-semibold text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {running ? 'Thinking…' : result ? 'Regenerate follow-up' : 'Generate follow-up'}
        </button>

        {/* Live trace while running — nodes light up one-by-one. */}
        {running && !result ? (
          <ol className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            {FOLLOWUP_NODES.map((node, i) => {
              const state = i < activeStep ? 'done' : i === activeStep ? 'active' : 'pending'
              return (
                <li key={node.label} className="flex items-center gap-2 text-[12px] leading-snug">
                  <span
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                      state === 'done'
                        ? 'bg-emerald-100 text-emerald-700'
                        : state === 'active'
                          ? 'bg-fuchsia-100 text-fuchsia-700'
                          : 'bg-muted text-muted-foreground/60',
                    )}
                  >
                    {state === 'done' ? <Check className="h-2.5 w-2.5" /> : state === 'active' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : i + 1}
                  </span>
                  <span className={cn('font-semibold', state === 'pending' ? 'text-muted-foreground/60' : 'text-foreground')}>
                    {node.label}
                  </span>
                  {node.engine === 'groq' ? (
                    <span className="rounded bg-fuchsia-50 px-1 py-0.5 text-[9.5px] font-semibold text-fuchsia-700">LLM</span>
                  ) : null}
                </li>
              )
            })}
          </ol>
        ) : null}

        {result ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700">
                {(result.action_type ?? 'none').toUpperCase()}
              </span>
              {result.channel ? (
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
                  via {result.channel}
                </span>
              ) : null}
            </div>

            <ContactActions result={result} phone={phone} email={email} customerName={customerName} />

            {result.rationale ? (
              <p className="text-[12.5px] leading-snug text-muted-foreground">{result.rationale}</p>
            ) : null}

            {/* Live trace — what each LangGraph node did */}
            {result.steps?.length ? (
              <ol className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                {result.steps.map((s) => (
                  <li key={s.n} className="flex items-start gap-2 text-[12px] leading-snug">
                    <span
                      className={cn(
                        'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                        s.status === 'skipped'
                          ? 'bg-muted text-muted-foreground'
                          : s.status === 'fallback'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700',
                      )}
                    >
                      {s.n}
                    </span>
                    <span className="min-w-0">
                      <span className="font-semibold text-foreground">{s.label}</span>
                      {s.engine !== 'data' ? (
                        <span
                          className={cn(
                            'ml-1.5 rounded px-1 py-0.5 text-[9.5px] font-semibold',
                            s.engine === 'groq'
                              ? 'bg-fuchsia-50 text-fuchsia-700'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {s.engine === 'groq' ? 'LLM' : 'rule'}
                        </span>
                      ) : null}
                      <span className="block text-muted-foreground">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}

            {result.message ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <MessageSquareText className="h-3 w-3" /> Drafted message
                </div>
                <p className="whitespace-pre-line text-[12.5px] leading-snug text-foreground">{result.message}</p>
              </div>
            ) : null}

            {result.talking_points?.length ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> Nissan talking points
                </div>
                <ul className="space-y-1">
                  {result.talking_points.map((p, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-foreground">
                      <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground/70">
            Runs the Python LangGraph agent — picks the next action, drafts the message, logs it to
            the timeline, and notifies the assignee.
          </p>
        )}
      </div>
    </Panel>
  )
}

// ── WhatsApp Agent (Phase 4) ─────────────────────────────────────────────────
const WA_STATUS_META: Record<string, { label: string; cls: string }> = {
  sent:           { label: 'Sent ✓',        cls: 'bg-sky-50 text-sky-700' },
  delivered:      { label: 'Delivered ✓✓',  cls: 'bg-emerald-50 text-emerald-700' },
  read:           { label: 'Read',           cls: 'bg-emerald-100 text-emerald-800' },
  failed:         { label: 'Failed ✗',      cls: 'bg-red-50 text-red-700' },
  mock:           { label: 'Queued (mock)', cls: 'bg-amber-50 text-amber-700' },
  mock_fallback:  { label: 'Sent (fallback)', cls: 'bg-amber-50 text-amber-700' },
}

type WaMediaType = 'image' | 'video' | 'document'
const MEDIA_LABELS: Record<WaMediaType, string> = { image: 'Image', video: 'Video', document: 'Document' }

function WhatsAppSendCard({
  leadId,
  messages,
}: {
  leadId: string
  messages: Array<import('#/lib/types').LeadMessage>
}) {
  const priorDraft = messages.find(
    (m) => m.channel === 'whatsapp' && m.source === 'agent' && m.direction === 'outbound',
  )?.body ?? ''

  const [text, setText] = useState(priorDraft)
  const [userEdited, setUserEdited] = useState(false)
  const [sending, setSending] = useState(false)

  // When the Follow-up Agent generates a new draft (router invalidates → messages prop updates),
  // auto-fill the textarea only if the rep hasn't started typing their own message.
  useEffect(() => {
    if (!userEdited && priorDraft) setText(priorDraft)
  }, [priorDraft]) // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState<WhatsAppSendResult | null>(null)
  const [liveStatus, setLiveStatus] = useState<string | null>(null)

  // Media attachment state
  const [showMedia, setShowMedia] = useState(false)
  const [mediaType, setMediaType] = useState<WaMediaType>('image')
  const [mediaUrl, setMediaUrl] = useState('')
  const [uploadedName, setUploadedName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Infer media type from MIME
    if (file.type.startsWith('image/')) setMediaType('image')
    else if (file.type.startsWith('video/')) setMediaType('video')
    else setMediaType('document')

    setUploading(true)
    setUploadedName(null)
    setMediaUrl('')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // Strip the data URL prefix (data:image/jpeg;base64,...)
          resolve(result.split(',')[1] ?? '')
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const agentUrl =
        (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
      const res = await fetch(`${agentUrl}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data: base64, mimetype: file.type }),
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const json = (await res.json()) as { url: string; filename: string }
      setMediaUrl(json.url)
      setUploadedName(file.name)
    } catch (err) {
      toast.error('Upload failed', { description: String(err) })
    } finally {
      setUploading(false)
      // Reset file input so the same file can be re-selected after a failure.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [])

  // Live delivery status via SSE
  useEffect(() => {
    if (!result?.wamid) return
    const agentUrl =
      (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    const es = new EventSource(`${agentUrl}/intake/stream`)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as { type?: string; wamid?: string; status?: string }
        if (data.type === 'whatsapp_status' && data.wamid === result.wamid && data.status) {
          setLiveStatus(data.status)
        }
      } catch {}
    }
    return () => es.close()
  }, [result?.wamid])

  const hasContent = text.trim() !== '' || (showMedia && mediaUrl.trim() !== '')

  async function handleSend() {
    if (!hasContent || sending) return
    setSending(true)
    setResult(null)
    setLiveStatus(null)
    try {
      const res = await sendWhatsAppMessage({
        data: {
          lead_id: leadId,
          message: text,
          media_url: showMedia && mediaUrl.trim() ? mediaUrl.trim() : null,
          media_type: showMedia && mediaUrl.trim() ? mediaType : null,
        },
      })
      setResult(res)
      setUserEdited(false) // allow next Follow-up Agent draft to auto-fill
      setUploadedName(null)
      if (res.success || res.wamid) {
        toast.success('WhatsApp message sent')
      } else {
        toast.error('Send failed', { description: res.errors.join(', ') })
      }
    } catch (err) {
      toast.error('Send failed', { description: String(err) })
    } finally {
      setSending(false)
    }
  }

  const displayStatus = liveStatus ?? result?.status ?? (result?.wamid ? 'sent' : null)
  const provider = result?.provider ?? ''
  const isFallback = provider === 'mock_fallback'
  const isMock = provider === 'mock' || isFallback
  const statusKey = isFallback ? 'mock_fallback' : (displayStatus === 'sent' && isMock ? 'mock' : displayStatus)
  const statusMeta = statusKey ? WA_STATUS_META[statusKey] : null

  return (
    <Panel id="wa-send-card" className="overflow-hidden">
      <PanelHeader
        title="Send via WhatsApp"
        kicker="WhatsApp Agent"
        action={
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
            <MessageCircle className="h-3 w-3" /> Cloud API
          </span>
        }
      />
      <div className="space-y-3 px-5 py-4">
        {/* Message text */}
        <textarea
          value={text}
          onChange={(e) => { setUserEdited(true); setText(e.target.value) }}
          rows={4}
          placeholder="Write a WhatsApp message or generate a draft using the Follow-up Agent above…"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand)] disabled:opacity-60"
          disabled={sending}
        />

        {/* Attach media toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setShowMedia((v) => !v); setMediaUrl('') }}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition',
              showMedia
                ? 'border-green-300 bg-green-50 text-green-700'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {showMedia ? 'Remove attachment' : '+ Attach image / video / file'}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Links in text auto-preview on WhatsApp
          </span>
        </div>

        {/* Media panel */}
        {showMedia ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            {/* Type selector (auto-set when file is picked; can override manually) */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {(Object.keys(MEDIA_LABELS) as WaMediaType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMediaType(t)}
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition',
                      mediaType === t
                        ? 'bg-foreground text-background'
                        : 'border border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {MEDIA_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* File picker — uploads to shim and auto-fills URL below */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.pdf,.doc,.docx"
                className="hidden"
                onChange={handleFileSelect}
                disabled={sending || uploading}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || uploading}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-semibold text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                {uploading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                  : <><ImageIcon className="h-3.5 w-3.5" /> Choose file</>
                }
              </button>
              {uploadedName ? (
                <span className="truncate text-[11.5px] text-green-700 font-medium max-w-[160px]">
                  {uploadedName}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">or paste a public URL below</span>
              )}
            </div>

            {/* URL input — populated automatically after file upload */}
            <input
              type="url"
              value={mediaUrl}
              onChange={(e) => { setMediaUrl(e.target.value); setUploadedName(null) }}
              placeholder={
                mediaType === 'image' ? 'https://example.com/photo.jpg'
                : mediaType === 'video' ? 'https://example.com/video.mp4'
                : 'https://example.com/brochure.pdf'
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand)]"
              disabled={sending || uploading}
            />
            <p className="text-[11px] text-muted-foreground">
              Caption for the media comes from the message text above.
            </p>
          </div>
        ) : null}

        {/* Footer: status + send button */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {statusMeta ? (
              <span className={cn('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', statusMeta.cls)}>
                {statusMeta.label}
              </span>
            ) : null}
            {result?.wamid && !isMock ? (
              <span className="text-[11px] text-muted-foreground">wamid: {result.wamid.slice(-8)}</span>
            ) : null}
            {isFallback ? (
              <span className="text-[11px] text-amber-700">Meta rejected — saved as draft</span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !hasContent}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Sending…' : 'Send via WhatsApp'}
          </button>
        </div>

        {/* Hard error (no wamid at all) */}
        {result && !result.wamid ? (
          <p className="text-[12px] text-red-600">
            {result.errors.join(' · ') || 'Send failed — check the agent logs.'}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

function HeaderCard({ detail }: { detail: LeadDetail }) {
  const { lead } = detail
  return (
    <Panel className="overflow-hidden p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StageBadge stage={lead.stage} />
            <ScoreBadge score={lead.score} />
            <SourceTag source={lead.source} />
          </div>
          <h1 className="mt-2 truncate font-display text-[30px] leading-tight text-foreground">
            {lead.customer_name ?? 'Unknown lead'}
          </h1>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">
            {lead.vehicle_interest ?? 'No vehicle interest recorded'}
            {lead.budget ? (
              <>
                {' · '}
                <span className="num font-semibold text-foreground">{formatMoney(lead.budget)}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            {lead.assignee_name ? (
              <>
                <span
                  className="grid h-8 w-8 place-items-center rounded-full bg-[color-mix(in_oklab,var(--brand)_14%,transparent)] text-[11px] font-bold brand-text"
                  title={lead.assignee_name}
                >
                  {initials(lead.assignee_name)}
                </span>
                <div className="text-right">
                  <div className="text-[12.5px] font-semibold text-foreground">{lead.assignee_name}</div>
                  <div className="text-[11px] text-muted-foreground">Owner</div>
                </div>
              </>
            ) : (
              <span className="rounded-full border border-dashed border-border px-3 py-1 text-[12px] text-muted-foreground">
                Unassigned
              </span>
            )}
          </div>
          <Link
            to="/customers"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold brand-text transition-all hover:gap-2.5"
          >
            Open Customer 360 <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <StageStepper lead={lead} />
        </div>
        <div className="shrink-0 sm:self-end">
          <ActivityDrawer detail={detail} />
        </div>
      </div>
    </Panel>
  )
}

// Human-readable label for the scoring engine that produced this lead's score.
const SCORED_BY_LABEL: Record<string, string> = {
  claude_holistic: 'Claude · holistic rubric',
  groq_holistic: 'Groq LLM · holistic rubric',
  groq_holistic_backup: 'Groq LLM · backup key',
  nvidia_llm: 'NVIDIA NIM · Llama',
  deterministic: 'Agent heuristic (8 dimensions)',
  static_js: 'Static fallback (offline)',
}

function StageStepper({
  lead,
}: {
  lead: { id: string; stage: LeadStage; customer_name: string | null; vehicle_interest: string | null }
}) {
  const router = useRouter()
  const [pendingStage, setPendingStage] = useState<LeadStage | null>(null)
  // 'won' kept for legacy rows that haven't moved to booked/delivered yet.
  const terminal = lead.stage === 'delivered' || lead.stage === 'won' || lead.stage === 'lost'

  async function move(stage: LeadStage) {
    if (stage === lead.stage || pendingStage) return
    setPendingStage(stage)
    try {
      await updateLeadStage({
        data: {
          id: lead.id,
          stage,
          from_stage: lead.stage,
          customer_name: lead.customer_name,
          vehicle_interest: lead.vehicle_interest,
        },
      })
      await router.invalidate()
    } finally {
      setPendingStage(null)
    }
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="kicker text-muted-foreground/70">Pipeline stage</span>
        {pendingStage ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FUNNEL.map((stage) => {
          const meta = STAGE_META[stage]
          const isCurrent = stage === lead.stage
          const isPending = stage === pendingStage
          return (
            <button
              key={stage}
              type="button"
              onClick={() => move(stage)}
              disabled={!!pendingStage}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition disabled:cursor-not-allowed',
                isCurrent
                  ? cn(meta.soft, meta.text, 'ring-1 ring-inset ring-current')
                  : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                pendingStage && !isPending ? 'opacity-50' : '',
              )}
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className={cn('h-1.5 w-1.5 rounded-full', isCurrent ? meta.dot : 'bg-muted-foreground/40')} />
              )}
              {meta.label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {/* "Won" dropped as a separate close action — booked/delivered above
            are now real funnel steps that cover what it used to mean. */}
        <span className="text-[11.5px] text-muted-foreground/70">Exit as:</span>
        <button
          type="button"
          onClick={() => move('lost')}
          disabled={!!pendingStage}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
            lead.stage === 'lost'
              ? 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
              : 'border border-border bg-card text-rose-600 hover:bg-rose-50',
          )}
        >
          {pendingStage === 'lost' ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          Lost
        </button>
        {terminal ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground">
            <Check className="h-3 w-3" /> Closed
          </span>
        ) : null}
      </div>
    </div>
  )
}

function KeyFacts({ detail }: { detail: LeadDetail }) {
  const { lead } = detail
  const SourceIcon = SOURCE_META[lead.source].icon

  const timelineLabel =
    lead.purchase_timeline_days == null ? null
      : lead.purchase_timeline_days <= 7 ? 'Within a week'
        : lead.purchase_timeline_days <= 30 ? 'This month'
          : lead.purchase_timeline_days <= 90 ? '1–3 months'
            : lead.purchase_timeline_days <= 180 ? '3–6 months' : 'Just exploring'

  // Human-readable labels for the enquiry-form scoring-signal fields.
  const FINANCING_LABEL: Record<string, string> = {
    cash: 'Cash / own funds', pre_approved: 'Loan pre-approved',
    loan_needed: 'Needs a car loan', unsure: 'Undecided',
  }
  const RELATIONSHIP_LABEL: Record<string, string> = {
    current_owner: 'Current Nissan owner', past_owner: 'Past Nissan owner',
    referred: 'Referred by a customer', new: 'New to Nissan',
  }
  const REASON_LABEL: Record<string, string> = {
    replacement: 'Replacing current car', occasion: 'Wedding / festival',
    business: 'Business use', first_car: 'First car', researching: 'Just researching',
  }
  const brandLabel =
    lead.brand_consideration === 'only_nissan' ? 'Set on Nissan'
      : lead.brand_consideration === 'comparing'
        ? `Comparing${lead.comparing_brands ? `: ${lead.comparing_brands}` : ' other brands'}`
        : null

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: 'Source',
      value: (
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <SourceIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {SOURCE_META[lead.source].label}
        </span>
      ),
    },
    { label: 'Vehicle interest', value: lead.vehicle_interest ?? '—' },
    { label: 'Budget', value: <span className="num font-semibold">{formatMoney(lead.budget)}</span> },
    {
      label: 'Score',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <ScoreBadge score={lead.score} />
          <span className="num font-semibold">
            {lead.score_value}
            <span className="text-muted-foreground">/100</span>
          </span>
        </span>
      ),
    },
    {
      label: 'Scored by',
      value: (
        <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-fuchsia-700">
          <Bot className="h-3 w-3" />
          {lead.scored_by ? (SCORED_BY_LABEL[lead.scored_by] ?? lead.scored_by) : '—'}
        </span>
      ),
    },
    { label: 'Test drive', value: lead.test_drive_required ? 'Requested' : '—' },
    { label: 'Buy timeline', value: timelineLabel ?? '—' },
    { label: 'Preferred contact', value: lead.contact_medium ?? '—' },
    ...(lead.financing ? [{ label: 'Financing', value: FINANCING_LABEL[lead.financing] ?? lead.financing }] : []),
    ...(lead.purchase_reason ? [{ label: 'Purchase reason', value: REASON_LABEL[lead.purchase_reason] ?? lead.purchase_reason }] : []),
    ...(lead.nissan_relationship ? [{ label: 'Nissan history', value: RELATIONSHIP_LABEL[lead.nissan_relationship] ?? lead.nissan_relationship }] : []),
    ...(brandLabel ? [{ label: 'Brand consideration', value: brandLabel }] : []),
    {
      label: 'Created',
      value: (
        <span className="num" title={timeAgo(lead.created_at)}>{formatIN(lead.created_at)}</span>
      ),
    },
    {
      label: 'Last activity',
      value: (
        <span className="num" title={timeAgo(lead.last_activity_at)}>{formatIN(lead.last_activity_at)}</span>
      ),
    },
  ]

  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Key facts" kicker="Lead profile" />
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <dt className="text-[12.5px] text-muted-foreground">{r.label}</dt>
            <dd className="text-right text-[13px] text-foreground">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function AssignControl({ lead, team }: { lead: LeadDetail['lead']; team: Array<SalesMember> }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    const assigned_to = value === '' ? null : value
    const member = team.find((m) => m.id === assigned_to)
    if (assigned_to === (lead.assigned_to ?? null)) return
    setPending(true)
    try {
      await assignLead({
        data: { id: lead.id, assigned_to, assignee_name: member?.full_name },
      })
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Assignment"
        kicker="Ownership"
        action={
          pending ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          ) : null
        }
      />
      <div className="px-5 py-4">
        <label className="mb-1.5 block text-[12px] font-semibold text-foreground">
          Reassign lead
        </label>
        <div className="relative">
          <select
            value={lead.assigned_to ?? ''}
            onChange={onChange}
            disabled={pending}
            className="input appearance-none pr-9 disabled:opacity-60"
          >
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name} · {roleLabel(m.role)}
              </option>
            ))}
          </select>
          <ArrowRight className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-muted-foreground" />
        </div>
      </div>
    </Panel>
  )
}

function roleLabel(role: SalesMember['role']) {
  return role
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ')
}
