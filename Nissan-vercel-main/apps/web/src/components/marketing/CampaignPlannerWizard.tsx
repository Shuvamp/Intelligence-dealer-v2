import { useState, useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Loader2, AlertTriangle, Zap, CheckCircle2, ChevronRight, ChevronLeft, Image as ImageIcon, Sparkles, Mic, MicOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { generateCampaignPlan, createCampaignFromPlan, getMediaAssets, suggestCampaignDescription } from '#/lib/marketing'
import type { CampaignGoal, CampaignPlanInput, CampaignPlanResult, CampaignType, MediaAsset, SelectedAsset } from '#/lib/types'
import { cn } from '#/lib/utils'
import { getVoiceProvider } from './voiceInput'
import type { VoiceSession } from './voiceInput'
import { to12hDisplay, parse12hInput } from './time12h'

// ─── Constants ────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPES: CampaignType[] = [
  'Event Campaign',
  'Festival Campaign',
  'Vehicle Promotion',
  'Service Promotion',
  'Seasonal Campaign',
  'Brand Awareness Campaign',
]

const GOALS: CampaignGoal[] = [
  'Lead Generation',
  'Test Drive Booking',
  'Sales Promotion',
  'Brand Awareness',
  'Service Promotion',
  'Customer Retention',
]

const STEPS = ['Details', 'Goal', 'Notes'] as const

const emptyInput = (): CampaignPlanInput => ({
  campaign_name: '',
  campaign_type: 'Event Campaign',
  start_date: '',
  end_date: '',
  posting_time: '10:00',
  vehicles: [],
  goal: 'Lead Generation',
  notes: '',
  campaign_color: '#C3002F',
  selected_assets: [],
  selected_logo: null,
  selected_logo_2: null,
})

const fieldClass =
  'w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]'
const labelClass = 'block text-[12px] font-semibold text-foreground mb-1'

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition ${
              i < current
                ? 'bg-[#C3002F] text-white'
                : i === current
                  ? 'border-2 border-[#C3002F] text-[#C3002F]'
                  : 'border-2 border-border text-muted-foreground'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          <span className={`text-[10px] font-semibold ${i === current ? 'text-foreground' : 'text-muted-foreground'}`}>
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-3 ${i < current ? 'bg-[#C3002F]' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Generating ───────────────────────────────────────────────────────────────

function Generating() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-5 text-center">
      <div className="h-16 w-16 rounded-full bg-[#FFF8F8] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#C3002F] animate-spin" />
      </div>
      <div>
        <p className="text-[15px] font-bold text-foreground">Campaign Planner Agent</p>
        <p className="text-[13px] text-muted-foreground mt-1">Building calendar + generating content for every day…</p>
      </div>
      <div className="flex flex-col gap-2 text-[12px] text-muted-foreground w-full max-w-xs">
        {[
          'Analysing campaign goal & vehicles',
          'Researching festivals & regional occasions',
          'Planning daily content themes',
          'Assigning vehicles across days',
          'Generating post content for every day',
          'Saving campaign & content calendar',
        ].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 text-[#C3002F]/40 animate-spin shrink-0" />
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function CampaignSummaryView({ plan }: { plan: CampaignPlanResult }) {
  const durationDays = plan.days.length
  const dateLabel = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-green-50 flex items-center justify-center shrink-0">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <p className="text-[15px] font-bold text-foreground">{plan.campaign_name}</p>
          <p className="text-[12px] text-muted-foreground">Campaign created successfully</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-foreground">{durationDays} days</span>
        <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-foreground">{plan.campaign_type}</span>
        <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-foreground">{plan.goal}</span>
        <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-foreground">{plan.posting_time}</span>
      </div>

      {/* Vehicles */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Vehicles</p>
        <div className="flex flex-wrap gap-2">
          {(plan.selected_assets?.length ? plan.selected_assets : plan.vehicles.map((v) => ({ vehicle: v, asset_id: '', file_url: null }))).map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-full border border-[#C3002F]/30 bg-[#FFF8F8] px-2.5 py-1">
              {a.file_url ? (
                <img src={a.file_url} alt="" className="h-5 w-5 rounded-full object-cover" />
              ) : (
                <span className="h-5 w-5 rounded-full bg-[#C3002F]/10 flex items-center justify-center">
                  <ImageIcon className="h-2.5 w-2.5 text-[#C3002F]" />
                </span>
              )}
              <span className="text-[11px] font-semibold text-[#C3002F]">{a.vehicle}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Logo */}
      {plan.selected_logo && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Logo</p>
          <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-muted/30 px-3 py-2 w-fit">
            {plan.selected_logo.file_url ? (
              <img src={plan.selected_logo.file_url} alt="" className="h-8 w-8 rounded-[6px] object-contain bg-white border border-border p-0.5" />
            ) : (
              <div className="h-8 w-8 rounded-[6px] bg-muted border border-border flex items-center justify-center">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <span className="text-[12px] font-semibold text-foreground">{plan.selected_logo.asset_name ?? 'Logo'}</span>
          </div>
        </div>
      )}

      {/* Calendar */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Content Calendar</p>
        <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
          {plan.days.map((d) => (
            <div key={d.date} className="flex items-center gap-3 rounded-[8px] bg-muted/40 px-3 py-2">
              <span className="w-14 shrink-0 text-[11px] font-semibold text-muted-foreground">{dateLabel(d.date)}</span>
              <span className="flex-1 min-w-0 truncate text-[12px] font-semibold text-foreground">{d.theme}</span>
              {d.vehicle && <span className="shrink-0 text-[10px] font-bold text-[#C3002F]">{d.vehicle}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[10px] border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-[12px] font-semibold text-green-700">Post Content Generated For Every Day</p>
        <p className="text-[11px] text-green-600 mt-0.5">Go to Content Studio to review, edit and approve each day's post</p>
      </div>
    </div>
  )
}

// ─── Posting Time Picker (12-hour with AM/PM) ─────────────────────────────────
// to12hDisplay / parse12hInput moved to ./time12h (shared with the content
// studio, which had a byte-for-byte copy). See M4.

// Single text field — accepts "hh:mm AM/PM" or "HH:MM". Stores as 24h "HH:MM".
function PostingTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [display, setDisplay] = useState(() => to12hDisplay(value))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => { setDisplay(to12hDisplay(value)); setInvalid(false) }, [value])

  const handleBlur = () => {
    const parsed = parse12hInput(display)
    if (parsed) {
      setInvalid(false)
      onChange(parsed)
      setDisplay(to12hDisplay(parsed))
    } else {
      // Revert to last valid value on bad input
      setDisplay(to12hDisplay(value))
      setInvalid(false)
    }
  }

  return (
    <input
      type="text"
      value={display}
      onChange={(e) => { setDisplay(e.target.value); setInvalid(false) }}
      onBlur={handleBlur}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder="10:00 AM"
      className={cn(
        'w-32 rounded-[10px] border px-3 py-2 text-[13px] text-center outline-none',
        'focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]',
        invalid ? 'border-red-400 bg-red-50' : 'border-border bg-background',
      )}
    />
  )
}

// ─── Media Selection Banner ───────────────────────────────────────────────────
// Shows what the Media Library selection contributes (vehicles + logos). Campaigns
// no longer pick media in the wizard — they inherit the library selection.

function MediaSelectionBanner({ loading, vehicleCount, logoCount, onOpenLibrary }: {
  loading: boolean; vehicleCount: number; logoCount: number; onOpenLibrary: () => void
}) {
  const has = vehicleCount + logoCount > 0
  return (
    <div className={cn(
      'rounded-[10px] border px-3 py-2.5 text-[12px]',
      loading ? 'border-border bg-muted/30 text-muted-foreground'
        : has ? 'border-green-200 bg-green-50 text-green-700'
        : 'border-amber-200 bg-amber-50 text-amber-700',
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">
            {loading ? 'Loading your Media Library selection…'
              : has ? `Using ${vehicleCount} vehicle image${vehicleCount === 1 ? '' : 's'} + ${logoCount} logo${logoCount === 1 ? '' : 's'} from Media Library.`
              : 'No media selected. Pick vehicles & logos in Media Library — they’ll be used on the posters.'}
          </span>
        </div>
        <button type="button" onClick={onOpenLibrary} className="shrink-0 font-semibold underline underline-offset-2 hover:opacity-80">
          Media Library
        </button>
      </div>
    </div>
  )
}

// ─── Wizard Shell ─────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultValues?: Partial<CampaignPlanInput>
}

// ─── Voice support detection ──────────────────────────────────────────────────

type VoiceStatus = 'idle' | 'listening' | 'transcribing' | 'success' | 'error' | 'unsupported'

// Auto-retry budget for transient 'network' errors before surfacing to user.
const MAX_VOICE_RETRIES = 2
const VOICE_RETRY_DELAY_MS = 500

interface VoiceSupport {
  level: 'full' | 'partial' | 'none'
  label: string
}

// Web Speech API availability + per-browser confidence.
// Chrome/Edge route audio to Google's STT service (full). Safari has webkit
// SpeechRecognition but flaky (partial). Firefox has none.
function detectVoiceSupport(): VoiceSupport {
  if (typeof window === 'undefined') return { level: 'none', label: '' }
   
  const w = window as any
  const hasSR = !!(w.SpeechRecognition || w.webkitSpeechRecognition)
  if (!hasSR) return { level: 'none', label: 'Not supported' }
  const ua = navigator.userAgent
  const isEdge = /Edg\//.test(ua)
  const isChrome = /Chrome\//.test(ua) && !/Edg\/|OPR\//.test(ua)
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua)
  if (isChrome || isEdge) return { level: 'full', label: 'Supported' }
  if (isSafari) return { level: 'partial', label: 'Partial support' }
  return { level: 'full', label: 'Supported' }
}

export function CampaignPlannerWizard({ open, onOpenChange, defaultValues }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<CampaignPlanInput>({ ...emptyInput(), ...defaultValues })
  const [generating, setGenerating] = useState(false)
  const [summary, setSummary] = useState<CampaignPlanResult | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [suggestingDesc, setSuggestingDesc] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [voiceSupport, setVoiceSupport] = useState<VoiceSupport>({ level: 'full', label: '' })
  const voiceSessionRef = useRef<VoiceSession | null>(null)
  // Transcript assembly: base = notes when listening began, final = confirmed
  // chunks accumulated this session. Live display = base + final + interim tail.
  const voiceBaseRef = useRef('')
  const voiceFinalRef = useRef('')
  // Perf timing (performance.now() epochs, ms).
  const voiceSpeechStartRef = useRef(0)
  const voiceFirstResultRef = useRef(0)
  const voiceSpeechEndRef = useRef(0)
  // Auto-retry on transient network failures.
  const voiceRetryRef = useRef(0)
  const voiceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detect browser support once, client-side (window unavailable during SSR).
  useEffect(() => {
    const support = detectVoiceSupport()
    console.debug('[voice] browser support:', support)
    setVoiceSupport(support)
  }, [])

  useEffect(() => {
    if (open) {
      setStep(0)
      setForm({ ...emptyInput(), ...defaultValues })
      setGenerating(false)
      setSummary(null)
      setError(null)
      setIsListening(false)
      setVoiceError(null)
      setVoiceStatus('idle')
      void loadCampaignMedia()
    } else {
      if (voiceRetryTimerRef.current) clearTimeout(voiceRetryTimerRef.current)
      voiceSessionRef.current?.stop()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pull the assets flagged in the Media Library (Supabase campaign_selected) →
  // vehicles + up to two logos (1st top-left, 2nd top-right, by pick order).
  const loadCampaignMedia = async () => {
    setMediaLoading(true)
    try {
      // Filtered in Postgres, not here — this used to pull the tenant's whole
      // media library over the wire on every wizard open just to keep the
      // handful of flagged rows.
      const picked = await getMediaAssets({ data: { campaign_selected: true } })
      const vehicles = picked.filter((a) => a.asset_type === 'vehicle')
      const logos = picked
        .filter((a) => a.asset_type === 'logo')
        .sort((a, b) => (a.campaign_selected_at ?? '').localeCompare(b.campaign_selected_at ?? ''))
      const toLogo = (a: MediaAsset): SelectedAsset => ({ vehicle: '__logo__', asset_id: a.id, asset_name: a.name, file_url: a.file_url })
      setForm((prev) => ({
        ...prev,
        selected_assets: vehicles.map((a) => ({ vehicle: a.vehicle || a.name, asset_id: a.id, asset_name: a.name, file_url: a.file_url })),
        vehicles: [...new Set(vehicles.map((a) => a.vehicle || a.name))],
        selected_logo: logos[0] ? toLogo(logos[0]) : null,
        selected_logo_2: logos[1] ? toLogo(logos[1]) : null,
      }))
    } catch { /* leave media empty; user can still generate */ }
    finally { setMediaLoading(false) }
  }

  // Clean up on unmount
  useEffect(() => () => {
    if (voiceRetryTimerRef.current) clearTimeout(voiceRetryTimerRef.current)
    voiceSessionRef.current?.stop()
  }, [])

  // Compose the textbox value from the committed base + finalized chunks + the
  // live interim tail. Keeps a single space between segments.
  const applyVoiceComposite = (interim: string) => {
    const base = voiceBaseRef.current
    const final = voiceFinalRef.current
    let composed = base + final
    if (interim) composed += (composed && !composed.endsWith(' ') ? ' ' : '') + interim
    setForm((prev) => ({ ...prev, notes: composed }))
  }

  // Starts (or restarts, on auto-retry) a recognition session. Does NOT reset
  // the transcript refs — fresh-start resets live in toggleVoice so a retry
  // resumes from the already-committed text.
  const startVoiceSession = () => {
    const provider = getVoiceProvider() // browser (Web Speech API) by default
    setVoiceStatus('listening')
    voiceSpeechStartRef.current = 0
    voiceFirstResultRef.current = 0
    voiceSpeechEndRef.current = 0

    voiceSessionRef.current = provider.start(
      { lang: 'en-US' },
      {
        onStart: () => console.debug('[voice] recognition started'),
        onAudioStart: () => {
          console.debug('[voice] audio capture started')
          setVoiceStatus('listening')
        },
        onSpeechStart: () => {
          voiceSpeechStartRef.current = performance.now()
          console.debug('[voice] speech start')
          setVoiceStatus('transcribing')
        },
        onSpeechEnd: () => {
          voiceSpeechEndRef.current = performance.now()
          console.debug('[voice] speech end')
        },
        onInterim: (text) => {
          // First visible text → measure speech-start-to-display latency.
          if (!voiceFirstResultRef.current && voiceSpeechStartRef.current) {
            voiceFirstResultRef.current = performance.now()
            const latency = Math.round(voiceFirstResultRef.current - voiceSpeechStartRef.current)
            console.debug(`[voice] ⏱ speech start → first transcript: ${latency}ms`)
          }
          console.debug('[voice] interim:', text)
          setVoiceStatus('transcribing')
          applyVoiceComposite(text)
        },
        onFinal: (text) => {
          voiceRetryRef.current = 0 // healthy result → refresh retry budget
          voiceFinalRef.current += (voiceFinalRef.current ? ' ' : '') + text
          applyVoiceComposite('') // drop interim tail, commit final
          if (voiceSpeechEndRef.current) {
            const finalLatency = Math.round(performance.now() - voiceSpeechEndRef.current)
            console.debug(`[voice] ⏱ speech end → final transcript: ${finalLatency}ms`)
          }
          console.debug('[voice] final:', text)
          setVoiceStatus('success')
        },
        onError: (code) => {
          console.debug('[voice] error:', code)
          // Transient network failures: auto-retry before surfacing.
          if (code === 'network' && voiceRetryRef.current < MAX_VOICE_RETRIES) {
            voiceRetryRef.current += 1
            console.debug(`[voice] network error — auto-retry ${voiceRetryRef.current}/${MAX_VOICE_RETRIES} in ${VOICE_RETRY_DELAY_MS}ms`)
            setVoiceStatus('listening')
            voiceRetryTimerRef.current = setTimeout(() => {
              voiceRetryTimerRef.current = null
              startVoiceSession()
            }, VOICE_RETRY_DELAY_MS)
            return
          }
          const messages: Record<string, string> = {
            'network':           'Speech recognition service is unreachable — the browser may lack access to the speech backend (common in embedded previews and Chromium variants). Try standalone Chrome or Edge.',
            'not-allowed':       'Microphone access denied. Allow microphone in browser settings and try again.',
            'audio-capture':     'No microphone found. Connect a microphone and try again.',
            'service-not-allowed': 'Speech recognition is not permitted on this page. Try using HTTPS.',
            'language-not-supported': 'The selected language is not supported by speech recognition.',
          }
          const silent = new Set(['aborted', 'no-speech'])
          if (!silent.has(code)) {
            setVoiceError(messages[code] ?? `Speech recognition error: ${code}. Please try again.`)
            setVoiceStatus('error')
          }
          setIsListening(false)
        },
        onEnd: () => {
          console.debug('[voice] recognition ended')
          // Don't tear down UI if an auto-retry is pending.
          if (voiceRetryTimerRef.current) return
          setIsListening(false)
          setVoiceStatus((prev) => (prev === 'listening' || prev === 'transcribing' ? 'idle' : prev))
        },
      },
    )
    setIsListening(true)
  }

  const toggleVoice = () => {
    const provider = getVoiceProvider()
    if (!provider.isSupported()) {
      console.debug('[voice] SpeechRecognition unavailable in this browser')
      setVoiceStatus('unsupported')
      setVoiceError('Voice input is unavailable. You can continue typing manually.')
      return
    }
    if (isListening) {
      if (voiceRetryTimerRef.current) { clearTimeout(voiceRetryTimerRef.current); voiceRetryTimerRef.current = null }
      voiceSessionRef.current?.stop()
      setIsListening(false)
      return
    }

    // Fresh start. Base = current notes (with trailing space) so dictated text
    // appends rather than overwrites. Reset retry budget + transcript refs.
    setVoiceError(null)
    voiceRetryRef.current = 0
    if (voiceRetryTimerRef.current) { clearTimeout(voiceRetryTimerRef.current); voiceRetryTimerRef.current = null }
    voiceBaseRef.current = form.notes ? `${form.notes.trimEnd()} ` : ''
    voiceFinalRef.current = ''
    startVoiceSession()
  }

  const set = (k: keyof CampaignPlanInput, v: unknown) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  // Step validation. Vehicles + logos now come from the Media Library selection,
  // so only Details is gated; Goal + Notes are always valid.
  const step0Valid =
    !!form.campaign_name.trim() &&
    !!form.campaign_type &&
    !!form.start_date &&
    !!form.end_date &&
    !!form.posting_time.trim() &&
    form.start_date <= form.end_date
  const stepValid = [step0Valid, true, true]

  const LAST_STEP = STEPS.length - 1 // 2

  const handleNext = () => { if (step < LAST_STEP) setStep(step + 1) }
  const handleBack = () => { if (step > 0) setStep(step - 1) }

  const handleSuggestDesc = async () => {
    setSuggestingDesc(true)
    try {
      const vehicles = form.selected_assets?.length
        ? [...new Set(form.selected_assets.map((a) => a.vehicle))]
        : form.vehicles
      const desc = await suggestCampaignDescription({ data: { campaign_name: form.campaign_name, campaign_type: form.campaign_type, vehicles, goal: form.goal } })
      if (desc) set('notes', desc)
    } catch { /* silently ignore */ }
    finally { setSuggestingDesc(false) }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const plan = await generateCampaignPlan({ data: form })
      const { campaign_id } = await createCampaignFromPlan({ data: plan })
      setCreatedId(campaign_id)
      await router.invalidate()
      setSummary(plan)
    } catch (e) {
      console.error('[wizard] campaign creation failed:', e)
      setError('Failed to create campaign. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const handleClose = () => onOpenChange(false)

  // ── Step content ──────────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // ── Step 0: Details ─────────────────────────────────────────────────────
      case 0:
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="campaign-name" className={labelClass}>Campaign Name <span className="text-[#C3002F]">*</span></label>
              <input
                id="campaign-name"
                className={fieldClass}
                value={form.campaign_name}
                onChange={(e) => set('campaign_name', e.target.value)}
                placeholder="e.g. Father's Day SUV Campaign"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="campaign-type" className={labelClass}>Campaign Type <span className="text-[#C3002F]">*</span></label>
              <select id="campaign-type" className={fieldClass} value={form.campaign_type} onChange={(e) => set('campaign_type', e.target.value)}>
                {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="campaign-start-date" className={labelClass}>Start Date <span className="text-[#C3002F]">*</span></label>
                <input id="campaign-start-date" type="date" className={fieldClass} value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </div>
              <div>
                <label htmlFor="campaign-end-date" className={labelClass}>End Date <span className="text-[#C3002F]">*</span></label>
                <input id="campaign-end-date" type="date" className={fieldClass} value={form.end_date} min={form.start_date} onChange={(e) => set('end_date', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Posting Time</label>
                <PostingTimePicker
                  value={form.posting_time}
                  onChange={(v) => set('posting_time', v)}
                />
              </div>
            </div>
            <MediaSelectionBanner
              loading={mediaLoading}
              vehicleCount={form.selected_assets?.length ?? 0}
              logoCount={[form.selected_logo, form.selected_logo_2].filter(Boolean).length}
              onOpenLibrary={() => { handleClose(); void router.navigate({ to: '/marketing/media-library' }) }}
            />
          </div>
        )

      // ── Step 1: Goal ─────────────────────────────────────────────────────────
      case 1:
        return (
          <div className="space-y-3">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Campaign Goal</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">The agent will align daily themes to your primary goal.</p>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => set('goal', g)}
                  className={cn(
                    'flex items-center gap-2 rounded-[10px] border px-3 py-2.5 text-[12px] font-semibold text-left transition',
                    form.goal === g ? 'border-[#C3002F] bg-[#FFF8F8] text-[#C3002F]' : 'border-border text-muted-foreground hover:border-[#C3002F]/50',
                  )}
                >
                  <span className={cn('h-3.5 w-3.5 rounded-full border shrink-0 flex items-center justify-center', form.goal === g ? 'border-[#C3002F]' : 'border-border')}>
                    {form.goal === g && <span className="h-2 w-2 rounded-full bg-[#C3002F] block" />}
                  </span>
                  {g}
                </button>
              ))}
            </div>
            <div className="pt-1">
              <label htmlFor="campaign-goal-custom" className={labelClass}>Or describe your own goal</label>
              <textarea
                id="campaign-goal-custom"
                className={`${fieldClass} resize-none`}
                rows={2}
                value={(GOALS as readonly string[]).includes(form.goal) ? '' : form.goal}
                onChange={(e) => set('goal', e.target.value)}
                placeholder="e.g. Drive weekend showroom footfall with an exchange offer"
              />
            </div>
          </div>
        )

      // ── Step 2: Notes ─────────────────────────────────────────────────────────
      case 2: {
        const selectedVehicles = form.selected_assets?.length
          ? [...new Set(form.selected_assets.map((a) => a.vehicle))]
          : form.vehicles
        return (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-[13px] font-semibold text-foreground">Additional Notes</p>
                <button
                  type="button"
                  onClick={handleSuggestDesc}
                  disabled={suggestingDesc || !form.campaign_name.trim()}
                  className="flex items-center gap-1 rounded-[7px] border border-[#C3002F]/30 bg-[#FFF8F8] px-2.5 py-1 text-[11px] font-semibold text-[#C3002F] hover:bg-[#FFF0F3] transition disabled:opacity-40"
                >
                  {suggestingDesc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  AI Suggest
                </button>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Optional context to guide the agent — offers, audience, tone, occasions.
              </p>
            </div>
            <div className="relative">
              <textarea
                className={`${fieldClass} resize-none pr-11`}
                rows={4}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder={isListening ? '🎤 Listening… speak now' : 'e.g. Focus on families. Promote ₹20,000 exchange bonus. Emotional messaging for Father\'s Day.'}
                autoFocus
              />
              {/* Mic toggle */}
              <button
                type="button"
                onClick={toggleVoice}
                disabled={voiceSupport.level === 'none'}
                title={
                  voiceSupport.level === 'none'
                    ? 'Voice input unavailable in this browser'
                    : isListening ? 'Stop recording' : 'Start voice input'
                }
                className={cn(
                  'absolute right-2.5 bottom-2.5 h-7 w-7 rounded-[7px] flex items-center justify-center transition disabled:opacity-40 disabled:cursor-not-allowed',
                  isListening
                    ? 'bg-red-500 text-white shadow-md'
                    : 'bg-muted text-muted-foreground hover:bg-[#C3002F]/10 hover:text-[#C3002F] border border-border',
                )}
              >
                {isListening
                  ? <MicOff className="h-3.5 w-3.5" />
                  : <Mic className="h-3.5 w-3.5" />}
              </button>
            </div>
            {/* Voice status indicators */}
            {voiceStatus === 'listening' && (
              <div className="flex items-center gap-2 text-[11px] font-semibold text-red-600">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                🎤 Listening… click the mic to stop
              </div>
            )}
            {voiceStatus === 'transcribing' && (
              <div className="flex items-center gap-2 text-[11px] font-semibold text-[#C3002F]">
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                📝 Transcribing…
              </div>
            )}
            {voiceStatus === 'success' && (
              <div className="flex items-center gap-2 text-[11px] font-semibold text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ✅ Transcript Updated
              </div>
            )}
            {voiceSupport.level === 'partial' && voiceStatus === 'idle' && (
              <p className="text-[11px] text-muted-foreground">
                ⚠️ Voice input has limited support in Safari. Chrome or Edge work best.
              </p>
            )}
            {(voiceStatus === 'error' || voiceStatus === 'unsupported') && voiceError && (
              <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-amber-700">
                    {voiceStatus === 'unsupported' ? '❌ Speech recognition unavailable' : '❌ Voice input failed'}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">{voiceError}</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">You can continue typing manually.</p>
                  {voiceStatus === 'error' && (
                    <button
                      type="button"
                      onClick={toggleVoice}
                      className="mt-1.5 inline-flex items-center gap-1 rounded-[6px] border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 transition"
                    >
                      🔄 Retry
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* Review */}
            <div className="rounded-[10px] border border-border bg-muted/30 px-4 py-3 space-y-2 text-[12px]">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">{form.campaign_name}</p>
              </div>
              <p className="text-muted-foreground">{form.campaign_type} · {form.goal}</p>
              <p className="text-muted-foreground">{form.start_date} → {form.end_date} · {form.posting_time}</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedVehicles.map((v) => {
                  const assetForV = form.selected_assets?.find((a) => a.vehicle === v && a.file_url)
                  return (
                    <div key={v} className="flex items-center gap-1 rounded-full border border-[#C3002F]/30 bg-[#FFF8F8] pl-1 pr-2 py-0.5">
                      {assetForV?.file_url ? (
                        <img src={assetForV.file_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                      ) : (
                        <span className="h-4 w-4 rounded-full bg-[#C3002F]/10 flex items-center justify-center">
                          <ImageIcon className="h-2.5 w-2.5 text-[#C3002F]" />
                        </span>
                      )}
                      <span className="text-[10px] font-semibold text-[#C3002F]">{v}</span>
                    </div>
                  )
                })}
              </div>
              {form.selected_logo && (
                <div className="flex items-center gap-2 pt-0.5">
                  {form.selected_logo.file_url ? (
                    <img src={form.selected_logo.file_url} alt="" className="h-5 w-5 rounded-[4px] object-contain bg-white border border-border p-0.5" />
                  ) : (
                    <div className="h-5 w-5 rounded-[4px] bg-muted border border-border flex items-center justify-center">
                      <ImageIcon className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  <span className="text-[11px] text-muted-foreground">Logo: {form.selected_logo.asset_name ?? 'selected'}</span>
                </div>
              )}
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                <p className="text-[12px] text-red-700">{error}</p>
              </div>
            )}
          </div>
        )
      }

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-4 shrink-0 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <Zap className="h-4 w-4 text-[#C3002F]" />
            {summary ? 'Campaign Created' : 'New Campaign'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {summary
              ? 'Your campaign was created — review the generated plan.'
              : 'Guided steps to set up a campaign and generate its content plan.'}
          </DialogDescription>
          {!generating && !summary && <StepIndicator current={step} />}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {generating ? <Generating /> : summary ? <CampaignSummaryView plan={summary} /> : renderStep()}
        </div>

        {!generating && (
          <div className="flex items-center justify-between border-t border-border px-6 py-4 shrink-0">
            {summary ? (
              <div className="flex w-full justify-end">
                <button
                  type="button"
                  onClick={() => {
                    handleClose()
                    // Content is already generated — review it in Content Studio,
                    // preselected on the campaign we just created.
                    void router.navigate({
                      to: '/marketing/content-studio',
                      search: createdId ? { campaign: createdId } : {},
                    })
                  }}
                  className="rounded-[10px] bg-[#C3002F] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#a50027] transition"
                >
                  Done — Review Content
                </button>
              </div>
            ) : (
              <>
                {step === 0 ? (
                  <button type="button" onClick={handleClose} className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted transition">
                    Cancel
                  </button>
                ) : (
                  <button type="button" onClick={handleBack} className="flex items-center gap-1 rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted transition">
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
                {step < LAST_STEP ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!stepValid[step]}
                    className="flex items-center gap-1 rounded-[10px] bg-[#C3002F] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#a50027] transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button type="button" onClick={handleGenerate} className="flex items-center gap-2 rounded-[10px] bg-[#C3002F] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#a50027] transition">
                    <Zap className="h-4 w-4" />
                    Generate Plan
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
