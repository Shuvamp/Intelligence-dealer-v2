import { useState, useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Loader2, AlertTriangle, Zap, CheckCircle2, ChevronRight, ChevronLeft, Image as ImageIcon, Sparkles, Mic, MicOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { generateCampaignPlan, createCampaignFromPlan, getAssets, suggestCampaignDescription } from '#/lib/marketing'
import type { CampaignGoal, CampaignPlanInput, CampaignPlanResult, CampaignType, MediaAsset, SelectedAsset } from '#/lib/types'
import { cn } from '#/lib/utils'
import { getVoiceProvider, type VoiceSession } from './voiceInput'

// ─── Constants ────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPES: CampaignType[] = [
  'Event Campaign',
  'Festival Campaign',
  'Vehicle Promotion',
  'Service Promotion',
  'Seasonal Campaign',
  'Brand Awareness Campaign',
]

const VEHICLES = ['Magnite', 'Patrol', 'X-Trail', 'Sunny', 'Navara', 'Kicks'] as const

const GOALS: CampaignGoal[] = [
  'Lead Generation',
  'Test Drive Booking',
  'Sales Promotion',
  'Brand Awareness',
  'Service Promotion',
  'Customer Retention',
]

const STEPS = ['Details', 'Vehicles', 'Logo', 'Goal', 'Notes'] as const

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
    return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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

// ─── Asset Picker (Step 1 — Vehicles) ────────────────────────────────────────

interface AssetPickerProps {
  selectedAssets: SelectedAsset[]
  onToggleAsset: (asset: MediaAsset, vehicle: string) => void
  onAddWithoutImage: (vehicle: string) => void
  onRemoveVehicle: (vehicle: string) => void
}

function AssetPicker({ selectedAssets, onToggleAsset, onAddWithoutImage, onRemoveVehicle }: AssetPickerProps) {
  const [activeVehicle, setActiveVehicle] = useState<string>(VEHICLES[0])
  const [vehicleAssets, setVehicleAssets] = useState<MediaAsset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)

  useEffect(() => {
    if (!activeVehicle) return
    setLoadingAssets(true)
    getAssets({ data: { vehicle: activeVehicle } })
      .then(setVehicleAssets)
      .catch(() => setVehicleAssets([]))
      .finally(() => setLoadingAssets(false))
  }, [activeVehicle])

  const activeVehicleAssetIds = selectedAssets
    .filter((a) => a.vehicle === activeVehicle)
    .map((a) => a.asset_id)
  const selectedVehicles = [...new Set(selectedAssets.map((a) => a.vehicle))]

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[13px] font-semibold text-foreground">Select Vehicles & Assets</p>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Pick a vehicle, then select its campaign image. Or add without an image.
        </p>
      </div>

      <div className="flex gap-3 h-[240px]">
        <div className="flex flex-col gap-1.5 w-28 shrink-0">
          {VEHICLES.map((v) => {
            const isInCampaign = selectedVehicles.includes(v)
            return (
              <button
                key={v}
                type="button"
                onClick={() => setActiveVehicle(v)}
                className={cn(
                  'flex items-center justify-between rounded-[10px] border px-2.5 py-2 text-[11px] font-semibold text-left transition',
                  activeVehicle === v
                    ? 'border-[#C3002F] bg-[#FFF8F8] text-[#C3002F]'
                    : isInCampaign
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : 'border-border text-muted-foreground hover:border-[#C3002F]/40',
                )}
              >
                <span className="truncate">{v}</span>
                {isInCampaign && <span className="text-[9px] ml-1">✓</span>}
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingAssets ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 text-[#C3002F] animate-spin" />
            </div>
          ) : vehicleAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-[12px] text-muted-foreground">No assets for {activeVehicle} yet</p>
              <button
                type="button"
                onClick={() => onAddWithoutImage(activeVehicle)}
                disabled={selectedVehicles.includes(activeVehicle)}
                className="rounded-[8px] border border-[#C3002F]/40 bg-[#FFF8F8] px-3 py-1.5 text-[11px] font-semibold text-[#C3002F] hover:bg-[#FFF0F3] transition disabled:opacity-40"
              >
                {selectedVehicles.includes(activeVehicle) ? '✓ Added' : `Add ${activeVehicle} without image`}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 p-0.5">
              {vehicleAssets.map((asset) => {
                const isSel = activeVehicleAssetIds.includes(asset.id)
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onToggleAsset(asset, activeVehicle)}
                    className={cn(
                      'relative rounded-[10px] border overflow-hidden transition',
                      isSel ? 'border-2 border-[#C3002F] shadow-sm' : 'border-border hover:border-[#C3002F]/50',
                    )}
                  >
                    <div className="aspect-square bg-muted overflow-hidden">
                      <img src={asset.file_url} alt={asset.name} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    </div>
                    <div className="px-1.5 py-1 text-left">
                      <p className="text-[9px] font-semibold text-foreground truncate">{asset.name}</p>
                    </div>
                    {isSel && (
                      <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-[#C3002F] flex items-center justify-center">
                        <span className="text-white text-[8px] font-bold">✓</span>
                      </div>
                    )}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => onAddWithoutImage(activeVehicle)}
                disabled={selectedVehicles.includes(activeVehicle) && !activeVehicleAssetIds.some((id) => id === '')}
                className="aspect-square rounded-[10px] border border-dashed border-border flex flex-col items-center justify-center gap-1 text-center transition hover:border-[#C3002F]/40 disabled:opacity-40"
              >
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-[8px] text-muted-foreground">No image</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedVehicles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedVehicles.map((v) => {
            const assetForV = selectedAssets.find((a) => a.vehicle === v && a.file_url)
            return (
              <div key={v} className="flex items-center gap-1 rounded-full border border-[#C3002F]/30 bg-[#FFF8F8] pl-1.5 pr-2 py-0.5">
                {assetForV?.file_url ? (
                  <img src={assetForV.file_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                ) : (
                  <span className="h-4 w-4 rounded-full bg-[#C3002F]/10 flex items-center justify-center">
                    <ImageIcon className="h-2.5 w-2.5 text-[#C3002F]" />
                  </span>
                )}
                <span className="text-[10px] font-semibold text-[#C3002F]">{v}</span>
                <button type="button" onClick={() => onRemoveVehicle(v)} className="ml-0.5 text-[#C3002F]/50 hover:text-[#C3002F] text-[10px] font-bold">×</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Logo Picker (Step 2) ─────────────────────────────────────────────────────

interface LogoPickerProps {
  selectedLogo: SelectedAsset | null
  onSelect: (logo: SelectedAsset | null) => void
}

function LogoPicker({ selectedLogo, onSelect }: LogoPickerProps) {
  const [logos, setLogos] = useState<MediaAsset[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getAssets({ data: { asset_type: 'logo' } })
      .then(setLogos)
      .catch(() => setLogos([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground">Select Campaign Logo</p>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Choose a logo for this campaign. Upload logos in Media Library → Logo type.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 text-[#C3002F] animate-spin" />
        </div>
      ) : logos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-center rounded-[12px] border-2 border-dashed border-border bg-muted/20">
          <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-[13px] font-semibold text-foreground">No logos uploaded yet</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Go to Media Library, upload an image with type "Logo", then come back.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="rounded-[8px] border border-border px-4 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 transition"
          >
            Skip — no logo
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {logos.map((logo) => {
              const isSel = selectedLogo?.asset_id === logo.id
              return (
                <button
                  key={logo.id}
                  type="button"
                  onClick={() => onSelect(isSel ? null : { vehicle: '__logo__', asset_id: logo.id, asset_name: logo.name, file_url: logo.file_url })}
                  className={cn(
                    'relative rounded-[12px] border overflow-hidden transition group',
                    isSel ? 'border-2 border-[#C3002F] shadow-md bg-[#FFF8F8]' : 'border-border bg-white hover:border-[#C3002F]/50 hover:shadow-sm',
                  )}
                >
                  <div className="aspect-square flex items-center justify-center bg-muted/30 p-3 overflow-hidden">
                    <img
                      src={logo.file_url}
                      alt={logo.name}
                      className="max-h-full max-w-full object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  </div>
                  <div className="px-2 py-1.5 border-t border-border text-left">
                    <p className="text-[10px] font-semibold text-foreground truncate">{logo.name}</p>
                  </div>
                  {isSel && (
                    <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-[#C3002F] flex items-center justify-center shadow">
                      <span className="text-white text-[9px] font-bold">✓</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              'flex items-center gap-2 w-full rounded-[10px] border px-3 py-2.5 text-[12px] font-semibold transition',
              !selectedLogo ? 'border-[#C3002F] bg-[#FFF8F8] text-[#C3002F]' : 'border-border text-muted-foreground hover:border-[#C3002F]/40',
            )}
          >
            <span className={cn('h-3.5 w-3.5 rounded-full border shrink-0 flex items-center justify-center', !selectedLogo ? 'border-[#C3002F]' : 'border-border')}>
              {!selectedLogo && <span className="h-2 w-2 rounded-full bg-[#C3002F] block" />}
            </span>
            No logo for this campaign
          </button>
        </>
      )}
    </div>
  )
}

// ─── Posting Time Picker (12-hour with AM/PM) ─────────────────────────────────

// Converts internal 24h "HH:MM" to display "hh:mm AM/PM".
function to12hDisplay(val: string): string {
  const parts = (val || '10:00').split(':').map(Number)
  const h24 = parts[0] ?? 10
  const mm = String(parts[1] ?? 0).padStart(2, '0')
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = String(h24 % 12 || 12).padStart(2, '0')
  return `${h12}:${mm} ${ampm}`
}

// Parses "hh:mm AM/PM" (or bare "HH:MM") → 24h "HH:MM". Returns null if invalid.
function parse12hInput(raw: string): string | null {
  const s = raw.trim().toUpperCase()
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m12) {
    let h = parseInt(m12[1]!, 10)
    const mm = parseInt(m12[2]!, 10)
    if (h < 1 || h > 12 || mm < 0 || mm > 59) return null
    if (m12[3] === 'AM' && h === 12) h = 0
    if (m12[3] === 'PM' && h !== 12) h += 12
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1]!, 10)
    const mm = parseInt(m24[2]!, 10)
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  return null
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    } else {
      if (voiceRetryTimerRef.current) clearTimeout(voiceRetryTimerRef.current)
      voiceSessionRef.current?.stop()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

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

  function toggleAsset(asset: MediaAsset, vehicle: string) {
    setForm((prev) => {
      const existing = (prev.selected_assets ?? []).find((a) => a.asset_id === asset.id && a.vehicle === vehicle)
      let newAssets: SelectedAsset[]
      if (existing) {
        newAssets = (prev.selected_assets ?? []).filter((a) => !(a.asset_id === asset.id && a.vehicle === vehicle))
      } else {
        const newEntry: SelectedAsset = { vehicle, asset_id: asset.id, asset_name: asset.name, file_url: asset.file_url }
        newAssets = [...(prev.selected_assets ?? []), newEntry]
      }
      return { ...prev, selected_assets: newAssets, vehicles: [...new Set(newAssets.map((a) => a.vehicle))] }
    })
  }

  function addWithoutImage(vehicle: string) {
    setForm((prev) => {
      const alreadyAdded = (prev.selected_assets ?? []).some((a) => a.vehicle === vehicle)
      if (alreadyAdded) return prev
      const newAssets = [...(prev.selected_assets ?? []), { vehicle, asset_id: '', asset_name: vehicle, file_url: null }]
      return { ...prev, selected_assets: newAssets, vehicles: [...new Set(newAssets.map((a) => a.vehicle))] }
    })
  }

  function removeVehicle(vehicle: string) {
    setForm((prev) => {
      const newAssets = (prev.selected_assets ?? []).filter((a) => a.vehicle !== vehicle)
      return { ...prev, selected_assets: newAssets, vehicles: [...new Set(newAssets.map((a) => a.vehicle))] }
    })
  }

  // Step validation
  const step0Valid =
    !!form.campaign_name.trim() &&
    !!form.campaign_type &&
    !!form.start_date &&
    !!form.end_date &&
    !!form.posting_time.trim() &&
    form.start_date <= form.end_date
  const step1Valid = (form.selected_assets?.length ?? 0) > 0 || form.vehicles.length > 0
  // step2 (Logo) — always valid (optional)
  // step3 (Goal) — always valid
  // step4 (Notes) — always valid
  const stepValid = [step0Valid, step1Valid, true, true, true]

  const LAST_STEP = STEPS.length - 1 // 4

  const handleNext = () => { if (step < LAST_STEP) setStep(step + 1) }
  const handleBack = () => { if (step > 0) setStep(step - 1) }

  const handleSuggestDesc = async () => {
    setSuggestingDesc(true)
    try {
      const desc = await suggestCampaignDescription({ data: { campaign_name: form.campaign_name, campaign_type: form.campaign_type } })
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
              <label className={labelClass}>Campaign Name <span className="text-[#C3002F]">*</span></label>
              <input
                className={fieldClass}
                value={form.campaign_name}
                onChange={(e) => set('campaign_name', e.target.value)}
                placeholder="e.g. Father's Day SUV Campaign"
                autoFocus
              />
            </div>
            <div>
              <label className={labelClass}>Campaign Type <span className="text-[#C3002F]">*</span></label>
              <select className={fieldClass} value={form.campaign_type} onChange={(e) => set('campaign_type', e.target.value as CampaignType)}>
                {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Start Date <span className="text-[#C3002F]">*</span></label>
                <input type="date" className={fieldClass} value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>End Date <span className="text-[#C3002F]">*</span></label>
                <input type="date" className={fieldClass} value={form.end_date} min={form.start_date} onChange={(e) => set('end_date', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Posting Time</label>
                <PostingTimePicker
                  value={form.posting_time}
                  onChange={(v) => set('posting_time', v)}
                />
              </div>
            </div>
          </div>
        )

      // ── Step 1: Vehicles ─────────────────────────────────────────────────────
      case 1:
        return (
          <AssetPicker
            selectedAssets={form.selected_assets ?? []}
            onToggleAsset={toggleAsset}
            onAddWithoutImage={addWithoutImage}
            onRemoveVehicle={removeVehicle}
          />
        )

      // ── Step 2: Logo ─────────────────────────────────────────────────────────
      case 2:
        return (
          <LogoPicker
            selectedLogo={form.selected_logo ?? null}
            onSelect={(logo) => set('selected_logo', logo)}
          />
        )

      // ── Step 3: Goal ─────────────────────────────────────────────────────────
      case 3:
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
          </div>
        )

      // ── Step 4: Notes ─────────────────────────────────────────────────────────
      case 4: {
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
