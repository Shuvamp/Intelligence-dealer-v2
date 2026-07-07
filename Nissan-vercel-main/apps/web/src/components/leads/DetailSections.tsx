import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  Phone, FileText, ListChecks, Loader2, Plus, Check, MessageSquareText, Send,
  Mic, Upload, AudioLines, AlertTriangle, Sparkles, TrendingUp,
} from 'lucide-react'
import { Panel, PanelHeader, timeAgo, formatINTime } from '#/components/ui/kit'
import { addLeadMessage, addLeadTask, completeLeadTask } from '#/lib/leads'
import {
  getLeadCalls, analyzeCall, uploadCallRecording,
  type LeadCall, type CallStatus,
} from '#/lib/calls'
import { cn } from '#/lib/utils'
import type { LeadDetail, LeadMessageChannel, ScoreHistoryEntry } from '#/lib/types'

// Phase 2 — Lead Board UI: the 3 detail-view sections that didn't exist
// before this phase (Call History reuses lead_events — no new component
// needed beyond a filter, so it lives here too for cohesion). Documents
// ships as an explicit empty-state placeholder, not a real upload system —
// see PHASE_02 gap analysis for why that's a deliberate scope cut.

// ── Call History — filtered view of the existing lead_events timeline ──────
export function CallHistory({ detail }: { detail: LeadDetail }) {
  const calls = detail.events.filter((e) => e.type === 'call')
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Call history" kicker="Logged calls" />
      {calls.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
          <Phone className="h-5 w-5 text-muted-foreground/40" />
          <p className="text-[12.5px] text-muted-foreground">No calls logged yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {calls.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <p className="text-[12.5px] leading-snug text-foreground">{c.summary}</p>
              <span className="num shrink-0 text-[11px] text-muted-foreground/80" title={timeAgo(c.created_at)}>
                {formatINTime(c.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ── Call Intelligence (Phase 5) — upload a recording, see transcript + analysis ──
const _PROCESSING: Array<CallStatus> = ['uploaded', 'transcribing', 'analyzing']

function StatusBadge({ status }: { status: CallStatus }) {
  const map: Record<CallStatus, { label: string; cls: string }> = {
    uploaded: { label: 'Queued', cls: 'bg-amber-50 text-amber-700' },
    transcribing: { label: 'Transcribing…', cls: 'bg-amber-50 text-amber-700' },
    analyzing: { label: 'Analysing…', cls: 'bg-amber-50 text-amber-700' },
    completed: { label: 'Analysed', cls: 'bg-emerald-50 text-emerald-700' },
    failed: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
  }
  const m = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', m.cls)}>
      {_PROCESSING.includes(status) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {m.label}
    </span>
  )
}

function Pill({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-[12px] font-semibold text-foreground">{value}</div>
    </div>
  )
}

function AnalysisCard({ call }: { call: LeadCall }) {
  const a = call.analysis
  if (!a) return null
  const summary = Array.isArray(a.customer_summary) ? a.customer_summary : []
  const competitors = Array.isArray(a.competitors) ? a.competitors : []
  return (
    <div className="mt-2 space-y-2.5 rounded-lg border border-border bg-card p-3">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-fuchsia-700">
        <Sparkles className="h-3 w-3" /> AI call analysis
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Pill label="Sentiment" value={call.sentiment?.sentiment} />
        <Pill label="Interest" value={a.interest_level} />
        <Pill label="Intent" value={a.buying_intent_score != null ? `${a.buying_intent_score}/100` : null} />
        <Pill label="Timeline" value={a.purchase_timeline?.replace('_', ' ')} />
        <Pill label="Price sensitivity" value={a.price_sensitivity} />
        <Pill label="Competitor risk" value={a.competitor_risk} />
      </div>
      {competitors.length ? (
        <div className="text-[12px] text-foreground">
          <span className="text-muted-foreground">Competitors: </span>{competitors.join(', ')}
        </div>
      ) : null}
      {summary.length ? (
        <ul className="space-y-1">
          {summary.map((s, i) => (
            <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-muted-foreground">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11.5px]">
        {a.test_drive_interest ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">Wants test drive</span> : null}
        {a.followup_requested ? <span className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">Follow-up requested</span> : null}
        {a.recommended_action ? (
          <span className="rounded bg-fuchsia-50 px-1.5 py-0.5 font-semibold text-fuchsia-700">
            → {a.recommended_action.replace(/_/g, ' ')}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function CallIntelligence({ leadId }: { leadId: string }) {
  const [calls, setCalls] = useState<Array<LeadCall>>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openTranscript, setOpenTranscript] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    async function tick() {
      const data = await getLeadCalls({ data: { lead_id: leadId } }).catch(() => [] as Array<LeadCall>)
      if (cancelled) return
      setCalls(data)
      setLoading(false)
      attempts += 1
      const pending = data.some((c) => _PROCESSING.includes(c.recording.status))
      if (pending && attempts < 30) timer = setTimeout(tick, 3000)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [leadId, nonce])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await uploadCallRecording(leadId, file)
      setNonce((n) => n + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setError(
        msg === 'Failed to fetch'
          ? 'Could not reach the call service. Is the agent running on :8000?'
          : msg,
      )
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function retry(callId: string) {
    await analyzeCall({ data: { call_id: callId } }).catch(() => {})
    setNonce((n) => n + 1)
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Call intelligence"
        kicker="Recorded calls · AI analysis"
        action={
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload recording
          </button>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept=".mp3,.wav,.m4a,.ogg,.aac,.mp4,.mov,.webm,audio/*,video/mp4"
        onChange={onFile}
        className="hidden"
      />
      {error ? (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-1 text-[11px] font-semibold underline opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading calls…
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
          <Mic className="h-5 w-5 text-muted-foreground/40" />
          <p className="text-[12.5px] text-muted-foreground">No call recordings yet.</p>
          <p className="text-[11.5px] text-muted-foreground/70">Upload an mp3 / wav / m4a / mp4 to transcribe and analyse it.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {calls.map((call) => {
            const { recording, transcript, analysis } = call
            return (
            <li key={recording.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                  <AudioLines className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{recording.file_name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={recording.status} />
                  <span className="num text-[11px] text-muted-foreground/80">{timeAgo(recording.created_at)}</span>
                </span>
              </div>

              {recording.status === 'failed' ? (
                <button
                  type="button"
                  onClick={() => retry(recording.id)}
                  className="mt-1.5 text-[11.5px] font-semibold text-rose-600 hover:underline"
                >
                  Retry analysis
                </button>
              ) : null}

              {transcript?.transcript ? (
                <button
                  type="button"
                  onClick={() => setOpenTranscript((id) => (id === recording.id ? null : recording.id))}
                  className="mt-1.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  {openTranscript === recording.id ? 'Hide' : 'Show'} transcript
                  {transcript.language_detected ? ` · ${transcript.language_detected}` : ''}
                </button>
              ) : null}
              {openTranscript === recording.id && transcript?.transcript ? (
                <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  {transcript.transcript}
                </pre>
              ) : null}

              {analysis ? <AnalysisCard call={call} /> : null}
            </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// ── Messages — manual log + (separately) persisted Follow-up Agent drafts ──
const CHANNEL_LABEL: Record<LeadMessageChannel, string> = {
  whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', call_note: 'Call note',
}

export function MessagesPanel({ detail }: { detail: LeadDetail }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<LeadMessageChannel>('whatsapp')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!body.trim() || saving) return
    setSaving(true)
    try {
      await addLeadMessage({ data: { lead_id: detail.lead.id, channel, body: body.trim() } })
      setBody('')
      setOpen(false)
      await router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Messages"
        kicker="Outreach log"
        action={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Log
          </button>
        }
      />
      {open ? (
        <div className="space-y-2 border-b border-border bg-muted/30 px-5 py-3">
          <div className="flex gap-1.5">
            {(Object.keys(CHANNEL_LABEL) as Array<LeadMessageChannel>).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                  channel === c ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {CHANNEL_LABEL[c]}
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What was sent to the customer?"
            rows={2}
            className="input w-full resize-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!body.trim() || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      ) : null}
      {detail.messages.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
          <MessageSquareText className="h-5 w-5 text-muted-foreground/40" />
          <p className="text-[12.5px] text-muted-foreground">No messages logged yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {detail.messages.map((m) => (
            <li key={m.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  {CHANNEL_LABEL[m.channel]}
                  {m.direction === 'inbound' ? (
                    <span className="rounded bg-blue-50 px-1 py-0.5 text-[9.5px] font-semibold text-blue-700">
                      Inbound
                    </span>
                  ) : null}
                  {m.source === 'agent' ? (
                    <span className="rounded bg-fuchsia-50 px-1 py-0.5 text-[9.5px] font-semibold text-fuchsia-700">
                      Follow-up agent
                    </span>
                  ) : null}
                  {m.source === 'whatsapp_agent' ? (
                    <span className="rounded bg-green-50 px-1 py-0.5 text-[9.5px] font-semibold text-green-700">
                      Sent via API
                    </span>
                  ) : null}
                  {/* WhatsApp delivery status badge (Phase 4) */}
                  {m.channel === 'whatsapp' && m.status ? (
                    <span className={cn(
                      'rounded px-1 py-0.5 text-[9.5px] font-semibold',
                      m.status === 'sent'      ? 'bg-sky-50 text-sky-700'
                      : m.status === 'delivered' ? 'bg-emerald-50 text-emerald-700'
                      : m.status === 'read'      ? 'bg-emerald-100 text-emerald-800'
                      : m.status === 'failed'    ? 'bg-red-50 text-red-700'
                      : 'bg-muted text-muted-foreground',
                    )}>
                      {m.status === 'sent' ? 'Sent ✓'
                        : m.status === 'delivered' ? 'Delivered ✓✓'
                        : m.status === 'read' ? 'Read'
                        : m.status === 'failed' ? 'Failed ✗'
                        : m.status}
                    </span>
                  ) : null}
                </span>
                <span className="num text-[11px] text-muted-foreground/80">{timeAgo(m.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-line text-[12.5px] leading-snug text-foreground">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ── Tasks — flat list scoped to one lead, no reminders/recurrence ──────────
export function TasksPanel({ detail }: { detail: LeadDetail }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [completingId, setCompletingId] = useState<string | null>(null)

  async function add() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await addLeadTask({ data: { lead_id: detail.lead.id, title: title.trim() } })
      setTitle('')
      await router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  async function complete(id: string) {
    setCompletingId(id)
    try {
      await completeLeadTask({ data: { id } })
      await router.invalidate()
    } finally {
      setCompletingId(null)
    }
  }

  const open = detail.tasks.filter((t) => t.status === 'open')
  const done = detail.tasks.filter((t) => t.status === 'done')

  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Tasks" kicker="Follow-up checklist" />
      <div className="flex gap-2 border-b border-border px-5 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="Add a task…"
          className="input flex-1"
        />
        <button
          type="button"
          onClick={add}
          disabled={!title.trim() || saving}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>
      {detail.tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
          <ListChecks className="h-5 w-5 text-muted-foreground/40" />
          <p className="text-[12.5px] text-muted-foreground">No tasks yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {[...open, ...done].map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
              <button
                type="button"
                onClick={() => t.status === 'open' && complete(t.id)}
                disabled={t.status === 'done' || completingId === t.id}
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border transition',
                  t.status === 'done' ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-border text-transparent hover:border-foreground',
                )}
              >
                {completingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              </button>
              <span className={cn('flex-1 text-[12.5px]', t.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground')}>
                {t.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ── Documents — explicit placeholder, no upload/storage wiring this phase ──
// ── Phase 6: Score History Panel ─────────────────────────────────────────────

const SCORE_BADGE: Record<string, { label: string; cls: string }> = {
  hot:  { label: 'Hot',  cls: 'bg-red-50 text-red-700 border-red-200' },
  warm: { label: 'Warm', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cold: { label: 'Cold', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  dead: { label: 'Dead', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
}

const TRIGGER_LABEL: Record<string, string> = {
  intake:              'Initial intake',
  manual:              'Manual re-score',
  stage_change:        'Stage change',
  whatsapp_replied:    'WhatsApp reply',
  test_drive_booked:   'Test drive booked',
  call_completed:      'Call completed',
  lead_activity:       'Lead activity',
  email_opened:        'Email opened',
  manager_interaction: 'Manager interaction',
}

function ScoreBadgeSmall({ score }: { score: string }) {
  const meta = SCORE_BADGE[score] ?? { label: score, cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' }
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', meta.cls)}>
      {meta.label}
    </span>
  )
}

export function ScoreHistoryPanel({ scoreHistory }: { scoreHistory: Array<ScoreHistoryEntry> }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Score History" kicker="Dynamic Re-Scoring" action={
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
          <TrendingUp className="h-3 w-3" /> Phase 6
        </span>
      } />
      <div className="px-5 py-4">
        {scoreHistory.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No re-scoring history yet. Score updates automatically after WhatsApp replies, stage changes, and other lead activity.
          </p>
        ) : (
          <ol className="space-y-3">
            {scoreHistory.map((h) => (
              <li key={h.id} className="flex items-start gap-3">
                <div className="mt-0.5 flex shrink-0 items-center gap-1">
                  <ScoreBadgeSmall score={h.score} />
                  {h.previous_score && h.previous_score !== h.score ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">←</span>
                      <ScoreBadgeSmall score={h.previous_score} />
                    </>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-foreground">
                    {TRIGGER_LABEL[h.trigger] ?? h.trigger}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {h.score_value != null ? `Score ${h.score_value}` : ''}{h.scored_by ? ` · ${h.scored_by}` : ''}
                    {' · '}{timeAgo(h.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  )
}

export function DocumentsPanel() {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Documents" kicker="Quotes, forms, IDs" />
      <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
        <FileText className="h-5 w-5 text-muted-foreground/40" />
        <p className="text-[12.5px] text-muted-foreground">Document uploads coming soon.</p>
        <p className="text-[11.5px] text-muted-foreground/70">
          The data model is ready — wiring real file upload is a later phase.
        </p>
      </div>
    </Panel>
  )
}
