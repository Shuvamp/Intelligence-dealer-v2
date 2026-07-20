import { useState, useMemo, useEffect, useRef } from 'react'
import { createFileRoute, useRouter, Link } from '@tanstack/react-router'
import {
  getCampaigns, getDuckCampaignDays, getMonthEvents, getAssets,
  saveDayContent, saveEventContent, generateDayContent, generateEventContent, suggestField,
  approveCampaign, approveEvent, generatePosterImage, getChannelStatus,
  getCurrentTenantId, uploadContentVideo, saveContentVideoUrl,
  uploadContentPoster, saveContentPosterUrl,
} from '#/lib/marketing'
import {
  Zap, RefreshCw, Hash, Image as ImageIcon, ChevronDown, ChevronLeft, ChevronRight, Car, Download, Calendar,
  AlertCircle, Loader2, Sparkles, Save, CheckCircle2, X as XIcon, Plus, Link2, Check, Upload,
} from 'lucide-react'
import type {
  PostChannel, CampaignSummary, CampaignDay, MediaAsset, MonthOpportunity, ContentStatus,
  ChannelConnection,
} from '#/lib/types'
import { cn } from '#/lib/utils'

function ContentStudioSkeleton() {
  return (
    <div className="flex -mx-6 -my-7 overflow-hidden animate-pulse" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="w-64 shrink-0 border-r border-border bg-white flex flex-col gap-3 p-3">
        <div className="h-8 rounded-[10px] bg-muted" />
        <div className="space-y-1.5 flex-1">
          {[...Array(8)].map((_, i) => <div key={i} className="h-10 rounded-[8px] bg-muted/60" />)}
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-5 p-5">
        <div className="h-6 w-48 rounded-[8px] bg-muted" />
        <div className="h-10 rounded-[10px] bg-muted" />
        <div className="h-32 rounded-[12px] bg-muted" />
        <div className="h-20 rounded-[10px] bg-muted" />
        <div className="h-[360px] max-w-[420px] rounded-[16px] bg-muted" />
      </div>
      <div className="w-[280px] shrink-0 border-l border-border bg-white" />
    </div>
  )
}

export const Route = createFileRoute('/_authed/marketing/content-studio')({
  loader: async () => {
    const now = new Date()
    const [campaigns, campaignDays, monthEvents, channels, tenantId] = await Promise.all([
      getCampaigns(),
      getDuckCampaignDays(),
      getMonthEvents({ data: { month: now.getMonth() + 1, year: now.getFullYear() } }),
      getChannelStatus(),
      getCurrentTenantId(),
    ])
    return { campaigns, campaignDays, monthEvents, channels, tenantId }
  },
  pendingComponent: ContentStudioSkeleton,
  component: ContentStudio,
})

// Preview channel keys. `value` matches the ChannelConnection.channel strings
// so the picker can be filtered down to connected channels. `x` has no backend
// connection flow yet, so it stays hidden until a real connection exists.
type PreviewChannel = PostChannel | 'x' | 'linkedin' | 'youtube'

const CHANNELS: Array<{ value: PreviewChannel; label: string; color: string }> = [
  { value: 'instagram',       label: 'Instagram',       color: '#E1306C' },
  { value: 'facebook',        label: 'Facebook',        color: '#1877F2' },
  { value: 'linkedin',        label: 'LinkedIn',        color: '#0A66C2' },
  { value: 'x',               label: 'X / Twitter',     color: '#000000' },
  { value: 'youtube',         label: 'YouTube',         color: '#FF0000' },
  { value: 'google_business', label: 'Google Business', color: '#34A853' },
  { value: 'whatsapp',        label: 'WhatsApp',        color: '#25D366' },
]

const CHANNEL_RATIOS: Record<string, string> = {
  instagram:        '1/1',
  facebook:         '191/100',
  linkedin:         '191/100',
  x:                '16/9',
  youtube:          '16/9',
  google_business:  '4/3',
  whatsapp:         '9/16',
}

const POSTER_DISPLAY_BASE = (
  (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
).replace(/\/$/, '')

function posterDisplayUrl(url: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
    const idx = parsed.pathname.indexOf('/posters/')
    if (idx >= 0) return `${POSTER_DISPLAY_BASE}${parsed.pathname.slice(idx)}${parsed.search}`
  } catch {
    if (url.startsWith('/posters/')) return `${POSTER_DISPLAY_BASE}${url}`
  }
  return url
}

// Channels shown in the Publish Channels selector + Channel Preview strip —
// same set, kept in one place instead of duplicated per usage site.
const MAIN_CHANNELS = ['facebook', 'instagram', 'linkedin', 'x', 'youtube']

const EVENTS_ID = '__monthly_events__'

const STATUS_BADGE: Record<ContentStatus, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-muted text-muted-foreground' },
  generated: { label: 'AI Ready',  cls: 'bg-blue-100 text-blue-700' },
  edited:    { label: 'Edited',    cls: 'bg-amber-100 text-amber-700' },
  approved:  { label: 'Approved',  cls: 'bg-green-100 text-green-700' },
}

function StatusBadge({ status }: { status?: ContentStatus }) {
  const s = STATUS_BADGE[status ?? 'pending']
  return (
    <span className={cn('shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide', s.cls)}>
      {s.label}
    </span>
  )
}

// One reviewable item — campaign day or monthly event, same editable shape.
interface StudioItem {
  kind: 'day' | 'event'
  key: string
  label: string        // "Day 1" / event name
  sublabel: string     // date · vehicle / date · kind
  date: string
  theme: string
  vehicle?: string
  day_num?: number
  // persistence keys
  campaign_id?: string
  event_id?: string
  // content
  headline: string
  subheadline: string
  caption: string
  hashtags: string[]
  cta: string
  content_status: ContentStatus
  poster_url?: string | null
  video_url?: string | null
  selected_channels?: string[] | null
}

function dayToItem(d: CampaignDay): StudioItem {
  return {
    kind: 'day',
    key: `${d.campaign_id}_${d.date}`,
    label: `Day ${d.day_num}`,
    sublabel: `${d.date}${d.vehicle ? ` · ${d.vehicle}` : ''}`,
    date: d.date,
    theme: d.theme,
    vehicle: d.vehicle,
    day_num: d.day_num,
    campaign_id: d.campaign_id,
    headline: d.headline ?? '',
    subheadline: d.subheadline ?? '',
    caption: d.caption ?? '',
    hashtags: d.hashtags ?? [],
    cta: d.cta ?? '',
    content_status: d.content_status ?? 'pending',
    poster_url: d.poster_url ?? null,
    video_url: d.video_url ?? null,
    selected_channels: (d as unknown as { selected_channels?: string[] }).selected_channels ?? null,
  }
}

function eventToItem(o: MonthOpportunity): StudioItem {
  return {
    kind: 'event',
    key: o.id ?? `${o.date}_${o.name}`,
    label: o.name,
    sublabel: `${o.date} · ${o.kind}`,
    date: o.date,
    theme: o.name,
    event_id: o.id,
    headline: o.headline ?? '',
    subheadline: o.subheadline ?? '',
    caption: o.caption ?? '',
    hashtags: o.hashtags ?? [],
    cta: o.cta ?? '',
    content_status: o.content_status ?? 'pending',
    poster_url: o.poster_url ?? null,
    video_url: o.video_url ?? null,
    selected_channels: (o as unknown as { selected_channels?: string[] }).selected_channels ?? null,
  }
}

// Pure CSS poster preview — composes the copy into a Nissan-branded card.
function PosterPreview({ vehicle, theme, headline, subheadline, caption, cta, vehicleAsset }: {
  vehicle: string; theme: string; headline: string; subheadline: string
  caption: string; cta: string; vehicleAsset: string | null
}) {
  return (
    <div
      className="w-full rounded-[16px] overflow-hidden relative"
      style={{ background: 'linear-gradient(135deg, #1A1A1A 0%, #3D0A00 100%)' }}
    >
      <div className="flex items-center justify-between px-6 pt-5">
        <div className="bg-[#C3002F] px-3 py-1.5 rounded-[5px]">
          <span className="text-white font-black text-[10px] tracking-[4px]">NISSAN</span>
        </div>
        <div className="bg-white/10 border border-white/20 rounded-[6px] px-2.5 py-1">
          <span className="text-white text-[9px] font-semibold tracking-widest uppercase">{vehicle}</span>
        </div>
      </div>

      <div className="px-6 py-5">
        {theme && <p className="text-white/40 text-[9px] font-semibold tracking-widest uppercase mb-3">{theme}</p>}
        <h2 className="text-white text-[22px] font-black leading-tight mb-2">{headline || 'Headline will appear here'}</h2>
        <p className="text-white/75 text-[12px] leading-relaxed mb-3">{subheadline || 'Subheadline will appear here'}</p>
        <p className="text-white/50 text-[10px] leading-relaxed line-clamp-2">
          {caption ? caption.substring(0, 140) + (caption.length > 140 ? '…' : '') : 'Caption preview…'}
        </p>
      </div>

      <div className="flex items-center justify-between px-6 pb-5 mt-2">
        <div className="bg-[#C3002F] text-white text-[10px] font-bold px-4 py-2 rounded-[6px]">
          {cta || 'CTA'}
        </div>
        {vehicleAsset && (
          <img src={vehicleAsset} alt="" className="h-10 w-10 rounded-[6px] object-cover opacity-60" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        )}
      </div>

      {headline && (
        <div className="absolute top-3 right-3 bg-green-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-full">
          Generated
        </div>
      )}
    </div>
  )
}

function to12hDisplay(val: string): string {
  const parts = (val || '10:00').split(':').map(Number)
  const h24 = parts[0] ?? 10
  const mm = String(parts[1] ?? 0).padStart(2, '0')
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = String(h24 % 12 || 12).padStart(2, '0')
  return `${h12}:${mm} ${ampm}`
}

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

// Per-field AI suggest button (small sparkles icon next to a label).
function SuggestButton({ busy, onClick, title }: { busy: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title ?? 'AI suggest'}
      className="flex items-center gap-1 rounded-[6px] border border-[#C3002F]/30 bg-[#FFF8F8] px-2 py-0.5 text-[10px] font-semibold text-[#C3002F] hover:bg-[#FFF0F3] transition disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
      AI
    </button>
  )
}

// Module-level cache: vehicle name → asset. Avoids repeated getAssets() calls
// as the user navigates items within a session.
const vehicleAssetCache = new Map<string, MediaAsset | null>()

function ContentStudio() {
  const { campaigns, campaignDays, monthEvents, channels, tenantId } = Route.useLoaderData()
  const router = useRouter()

  // Only channels the user has actually connected drive the preview picker.
  const availableChannels = useMemo(() => {
    const connected = new Set(
      channels.filter((c) => c.status === 'connected').map((c) => c.channel),
    )
    return CHANNELS.filter((c) => connected.has(c.value))
  }, [channels])

  // channel key → its connection details (account name / id / status), so the
  // preview can show the same connected-account info as the Connected Channels page.
  const channelDetails = useMemo(() => {
    const m: Record<string, ChannelConnection> = {}
    for (const c of channels) m[c.channel] = c
    return m
  }, [channels])

  // ── Collapsible right (Channel Preview) panel ────────────────────────────
  const PREVIEW_WIDTH = 280            // px — open width
  const [previewOpen, setPreviewOpen] = useState(false)   // hidden by default on load

  // ── selection ────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string>(campaigns[0]?.id ?? EVENTS_ID)
  const selectedCampaign: CampaignSummary | null =
    selectedId === EVENTS_ID ? null : (campaigns.find((c) => c.id === selectedId) ?? null)
  const isEvents = selectedId === EVENTS_ID
  // Declared before items useMemo — used in its dependency array.
  const [savedStatuses, setSavedStatuses] = useState<Record<string, ContentStatus>>({})

  const items: StudioItem[] = useMemo(() => {
    const raw = isEvents
      ? monthEvents.opportunities.map(eventToItem)
      : campaignDays.filter((d) => d.campaign_id === selectedId).map(dayToItem)
    if (Object.keys(savedStatuses).length === 0) return raw
    return raw.map((it) => savedStatuses[it.key] ? { ...it, content_status: savedStatuses[it.key]! } : it)
  }, [isEvents, monthEvents, campaignDays, selectedId, savedStatuses])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selectedItem = items.find((i) => i.key === selectedKey) ?? null

  // ── editable content state ───────────────────────────────────────────────
  const [channel, setChannel] = useState<PreviewChannel>(availableChannels[0]?.value ?? 'instagram')
  // Channels selected for publishing (subset of connected). Separate from the preview chip.
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])

  // Keep the selected preview channel valid as connections change.
  useEffect(() => {
    if (availableChannels.length > 0 && !availableChannels.some((c) => c.value === channel)) {
      setChannel(availableChannels[0]!.value)
    }
  }, [availableChannels, channel])

  const togglePublishChannel = (ch: string) =>
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    )

  // ── Publish-channels multi-select dropdown ──────────────────────────────
  const [channelMenuOpen, setChannelMenuOpen] = useState(false)
  const channelMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!channelMenuOpen) return
    const onPointer = (e: MouseEvent) => {
      if (channelMenuRef.current && !channelMenuRef.current.contains(e.target as Node)) {
        setChannelMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChannelMenuOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [channelMenuOpen])

  const [headline, setHeadline] = useState('')
  const [subheadline, setSubheadline] = useState('')
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [cta, setCta] = useState('')
  const [, setStatus] = useState<ContentStatus>('pending')
  const [dirty, setDirty] = useState(false)

  const [genLoading, setGenLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [fieldBusy, setFieldBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [eventTime, setEventTime] = useState('10:00 AM') // post time for monthly events (12h display; parseTimeToHHMM normalises before API call)
  const [approving, setApproving] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [refining, setRefining] = useState(false)

  // Event-mode asset pickers — vehicle photo + logo chosen independently of any campaign
  const [eventVehicleAssets, setEventVehicleAssets] = useState<MediaAsset[]>([])
  const [eventLogoAssets, setEventLogoAssets] = useState<MediaAsset[]>([])
  const [eventVehicleAsset, setEventVehicleAsset] = useState<MediaAsset | null>(null)
  const [eventLogoAsset, setEventLogoAsset] = useState<MediaAsset | null>(null)

  // Poster cache: item.key → URL. Initialized from loader data so existing posters show instantly.
  const [posterCache, setPosterCache] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    campaignDays.forEach(d => { if (d.poster_url) init[`${d.campaign_id}_${d.date}`] = posterDisplayUrl(d.poster_url) })
    monthEvents.opportunities.forEach(o => { if (o.poster_url) init[o.id ?? `${o.date}_${o.name}`] = posterDisplayUrl(o.poster_url) })
    return init
  })
  const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(new Set())
  // Refs so effects never see stale closure values.
  const posterCacheRef = useRef<Record<string, string>>({})
  const generatingKeysRef = useRef<Set<string>>(new Set())
  posterCacheRef.current = posterCache
  generatingKeysRef.current = generatingKeys

  // Video attachment cache: item.key → URL. Same shape as posterCache, but
  // written by a manual upload (handleVideoUpload) rather than AI generation
  // — YouTube's videos.insert needs a real file, which nothing here can generate.
  const [videoCache, setVideoCache] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    campaignDays.forEach(d => { if (d.video_url) init[`${d.campaign_id}_${d.date}`] = d.video_url })
    monthEvents.opportunities.forEach(o => { if (o.video_url) init[o.id ?? `${o.date}_${o.name}`] = o.video_url })
    return init
  })
  const [videoUploading, setVideoUploading] = useState<Set<string>>(new Set())
  const [videoError, setVideoError] = useState<string | null>(null)
  const [posterUploading, setPosterUploading] = useState<Set<string>>(new Set())

  // Derived for the currently selected item.
  const currentPosterUrl = posterCache[selectedKey ?? ''] ?? null
  const currentPosterDisplayUrl = currentPosterUrl ? posterDisplayUrl(currentPosterUrl) : null
  const currentPosterLoading = selectedKey ? generatingKeys.has(selectedKey) : false
  const currentPosterUploading = selectedKey ? posterUploading.has(selectedKey) : false
  const currentVideoUrl = videoCache[selectedKey ?? ''] ?? null
  const currentVideoUploading = selectedKey ? videoUploading.has(selectedKey) : false

  const loadItem = (it: StudioItem) => {
    setSelectedKey(it.key)
    setRefineText('')
    setHeadline(it.headline)
    setSubheadline(it.subheadline)
    setCaption(it.caption)
    setHashtags(it.hashtags)
    setCta(it.cta)
    setStatus(it.content_status)
    setDirty(false)
    setError(null)
    setSavedMsg(null)
    // Init channel selection: use saved selection → campaign channels ∩ connected → all connected
    const connectedKeys = availableChannels.map((c) => c.value)
    if (it.selected_channels?.length) {
      setSelectedChannels(it.selected_channels.filter((ch) => connectedKeys.includes(ch as PreviewChannel)))
    } else {
      const campaignChs = selectedCampaign?.channels ?? []
      const fromCampaign = campaignChs.filter((ch) => connectedKeys.includes(ch as PreviewChannel))
      setSelectedChannels(fromCampaign.length ? fromCampaign : connectedKeys)
    }
  }

  // Auto-select first item when the campaign/source changes
  useEffect(() => {
    if (items.length > 0 && !items.some((i) => i.key === selectedKey)) {
      loadItem(items[0]!)
    } else if (items.length === 0) {
      setSelectedKey(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, items.length])

  const markDirty = () => { setDirty(true); setSavedMsg(null) }
  const hasContent = !!(headline || caption)

  // ── vehicle asset for preview ────────────────────────────────────────────
  const vehicle = selectedItem?.vehicle ?? selectedCampaign?.vehicles?.[0] ?? 'Nissan'
  const [vehicleAsset, setVehicleAsset] = useState<MediaAsset | null>(null)
  useEffect(() => {
    const campaignAsset = selectedCampaign?.selected_assets?.find(
      (a) => a.vehicle === vehicle && a.file_url,
    )
    if (campaignAsset?.file_url) {
      setVehicleAsset({ id: campaignAsset.asset_id, file_url: campaignAsset.file_url, name: campaignAsset.asset_name ?? vehicle } as MediaAsset)
      return
    }
    if (vehicleAssetCache.has(vehicle)) {
      setVehicleAsset(vehicleAssetCache.get(vehicle) ?? null)
      return
    }
    getAssets({ data: { vehicle, asset_type: 'vehicle' } })
      .then((assets) => {
        const asset = assets[0] ?? null
        vehicleAssetCache.set(vehicle, asset)
        setVehicleAsset(asset)
      })
      .catch(() => {
        vehicleAssetCache.set(vehicle, null)
        setVehicleAsset(null)
      })
  }, [vehicle, selectedCampaign])

  // Load vehicle + logo assets when Monthly Events mode is active.
  useEffect(() => {
    if (!isEvents) return
    Promise.all([
      getAssets({ data: { asset_type: 'vehicle' } }),
      getAssets({ data: { asset_type: 'logo' } }),
    ]).then(([vehicles, logos]) => {
      setEventVehicleAssets(vehicles)
      setEventLogoAssets(logos)
      setEventVehicleAsset(v => v ?? vehicles[0] ?? null)
      setEventLogoAsset(l => l ?? logos[0] ?? null)
    }).catch(() => {})
  }, [isEvents])

  // Seed poster cache from DB poster_urls whenever items list changes.
  // Always update when DB has a URL different from what's cached — this
  // ensures a freshly-saved regenerated poster replaces the old cached URL.
  useEffect(() => {
    items.forEach(it => {
      if (!it.poster_url) return
      const cached = posterCacheRef.current[it.key]
      // Strip query params for base-path comparison so a new ?v= timestamp
      // (written by generatePosterImage) is recognised as a new poster.
      const displayUrl = posterDisplayUrl(it.poster_url)
      const dbBase = displayUrl.split('?')[0]
      const cachedBase = cached?.startsWith('data:') ? cached : cached?.split('?')[0]
      if (!cached || dbBase !== cachedBase) {
        posterCacheRef.current[it.key] = displayUrl
        setPosterCache(prev => ({ ...prev, [it.key]: displayUrl }))
      }
    })
  }, [items])

  // Auto-generate poster for the SELECTED item only (not the whole list).
  // Fires when selectedKey changes — one Gemini call at a time instead of N.
  useEffect(() => {
    if (!selectedItem) return
    const key = selectedItem.key
    if (posterCacheRef.current[key] || generatingKeysRef.current.has(key)) return
    generatingKeysRef.current.add(key)
    setGeneratingKeys(prev => new Set([...prev, key]))
    const camp = campaigns.find(c => c.id === selectedItem.campaign_id)
    const assetUrl = selectedItem.kind === 'day'
      ? (camp?.selected_assets?.find(a => a.vehicle === selectedItem.vehicle && a.file_url)?.file_url
         ?? camp?.selected_assets?.find(a => a.file_url)?.file_url ?? null)
      : null
    const logoUrl = camp?.selected_logo?.file_url ?? null
    generatePosterImage({
      data: {
        kind: selectedItem.kind,
        campaign_id: selectedItem.campaign_id,
        day_date: selectedItem.kind === 'day' ? selectedItem.date : undefined,
        day_num: selectedItem.kind === 'day' ? selectedItem.day_num : undefined,
        event_id: selectedItem.event_id,
        title: selectedItem.kind === 'day' ? (camp?.name ?? '') : selectedItem.label,
        theme: selectedItem.theme,
        headline: selectedItem.headline || selectedItem.theme,
        vehicle: selectedItem.vehicle ?? camp?.vehicles?.[0] ?? 'Nissan',
        asset_url: assetUrl,
        logo_url: logoUrl,
      },
    })
      .then(res => {
        posterCacheRef.current[key] = res.url
        setPosterCache(prev => ({ ...prev, [key]: res.url }))
      })
      .catch(() => {})
      .finally(() => {
        generatingKeysRef.current.delete(key)
        setGeneratingKeys(prev => { const n = new Set(prev); n.delete(key); return n })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  // ── actions ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedItem) return
    setGenLoading(true)
    setError(null)
    try {
      const res = selectedItem.kind === 'day'
        ? await generateDayContent({
            data: {
              campaign_id: selectedItem.campaign_id!,
              day_date: selectedItem.date,
              theme: selectedItem.theme,
              vehicle: selectedItem.vehicle,
              campaign_name: selectedCampaign?.name,
              goal: selectedCampaign?.goal ?? undefined,
            },
          })
        : await generateEventContent({
            data: { id: selectedItem.event_id!, name: selectedItem.theme, date: selectedItem.date },
          })
      if (!res) throw new Error('Generation returned nothing — check FastAPI logs (Gemini quota?)')
      setHeadline(res.headline)
      setSubheadline(res.subheadline)
      setCaption(res.caption)
      setHashtags(res.hashtags)
      setCta(res.cta)
      setStatus('generated')
      setDirty(false)
      if (!res.ai) setError('AI quota reached — template content used. Edit it or retry later.')
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenLoading(false)
    }
  }

  const persist = async (newStatus: ContentStatus) => {
    if (!selectedItem) return
    setSaveLoading(true)
    setError(null)
    try {
      const payload = {
        headline, subheadline, caption, hashtags, cta,
        content_status: newStatus,
        selected_channels: selectedChannels,
      }
      if (selectedItem.kind === 'day') {
        await saveDayContent({ data: { campaign_id: selectedItem.campaign_id!, day_date: selectedItem.date, ...payload } })
      } else {
        await saveEventContent({ data: { id: selectedItem.event_id!, ...payload } })
      }
      setStatus(newStatus)
      setDirty(false)
      setSavedMsg(newStatus === 'approved' ? 'Approved & saved ✓' : 'Saved ✓')
      // Update sidebar badge instantly without reloading all 4 loaders.
      setSavedStatuses(prev => ({ ...prev, [selectedItem.key]: newStatus }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaveLoading(false)
    }
  }

  // One Approve for the whole campaign — queues every day at the campaign's
  // posting time, then jumps to the Publishing page.
  const handleApproveCampaign = async () => {
    if (!selectedCampaign) return
    // Save the currently edited day first so no edits are lost on approve.
    if (dirty && selectedItem?.kind === 'day') await persist('edited')
    setApproving(true)
    setError(null)
    try {
      await approveCampaign({ data: { campaign_id: selectedCampaign.id } })
      await router.navigate({ to: '/marketing/publishing' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
      setApproving(false)
    }
  }

  // Generate the AI poster (Gemini 3) — real campaign car photo for days,
  // most recent uploaded car for events; theme from content / event name.
  const handleGeneratePoster = async () => {
    if (!selectedItem) return
    const key = selectedItem.key

    // Clear stale cached URL immediately so the loading spinner shows
    // and the old poster cannot flash back if the request fails.
    delete posterCacheRef.current[key]
    setPosterCache(prev => { const n = { ...prev }; delete n[key]; return n })

    generatingKeysRef.current.add(key)
    setGeneratingKeys(prev => new Set([...prev, key]))
    setError(null)
    try {
      const campaignAssetUrl = selectedItem.kind === 'day'
        ? (selectedCampaign?.selected_assets?.find((a) => a.vehicle === selectedItem.vehicle && a.file_url)?.file_url
           ?? selectedCampaign?.selected_assets?.find((a) => a.file_url)?.file_url
           ?? null)
        : (eventVehicleAsset?.file_url ?? null)
      const campaignLogoUrl = isEvents
        ? (eventLogoAsset?.file_url ?? null)
        : (selectedCampaign?.selected_logo?.file_url ?? null)
      const res = await generatePosterImage({
        data: {
          kind: selectedItem.kind,
          campaign_id: selectedItem.campaign_id,
          day_date: selectedItem.kind === 'day' ? selectedItem.date : undefined,
          day_num: selectedItem.kind === 'day' ? selectedItem.day_num : undefined,
          event_id: selectedItem.event_id,
          title: selectedItem.kind === 'day' ? (selectedCampaign?.name ?? '') : selectedItem.label,
          theme: selectedItem.theme,
          headline: headline || selectedItem.theme,
          vehicle: selectedItem.vehicle ?? vehicle,
          asset_url: campaignAssetUrl,
          logo_url: campaignLogoUrl,
          force_regenerate: true,
        },
      })
      // data: URLs are self-contained; HTTP URLs get a timestamp to bust browser cache
      // in case the FastAPI overwrites the same file on disk.
      const displayUrl = res.url.startsWith('data:')
        ? res.url
        : `${res.url}${res.url.includes('?') ? '&' : '?'}_cb=${Date.now()}`
      posterCacheRef.current[key] = displayUrl
      setPosterCache(prev => ({ ...prev, [key]: displayUrl }))
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Poster generation failed')
    } finally {
      generatingKeysRef.current.delete(key)
      setGeneratingKeys(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  // Upload a poster from the user's device — fallback when Gemini is over quota.
  // Goes to the backend /posters folder, then persists as poster_url (public URL)
  // so it displays here and publishes to Instagram like a generated poster.
  const handleUploadPoster = async (file: File) => {
    if (!selectedItem) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (jpg or png).')
      return
    }
    const key = selectedItem.key
    setError(null)
    setPosterUploading(prev => new Set([...prev, key]))
    try {
      const { path } = await uploadContentPoster(file, {
        kind: selectedItem.kind,
        campaign_id: selectedItem.campaign_id,
        day_date: selectedItem.kind === 'day' ? selectedItem.date : undefined,
        day_num: selectedItem.kind === 'day' ? selectedItem.day_num : undefined,
        event_id: selectedItem.event_id,
        theme: selectedItem.theme,
        title: selectedItem.kind === 'day' ? (selectedCampaign?.name ?? '') : selectedItem.label,
      })
      const { url } = await saveContentPosterUrl({
        data: {
          kind: selectedItem.kind,
          campaign_id: selectedItem.campaign_id,
          day_date: selectedItem.kind === 'day' ? selectedItem.date : undefined,
          event_id: selectedItem.event_id,
          path,
        },
      })
      const displayUrl = posterDisplayUrl(url)
      posterCacheRef.current[key] = displayUrl
      setPosterCache(prev => ({ ...prev, [key]: displayUrl }))
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Poster upload failed')
    } finally {
      setPosterUploading(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  // Attach a video file for YouTube — unlike LinkedIn/IG/FB (image or text
  // shares), YouTube's videos.insert() needs a real video, which nothing here
  // can generate. Uploads straight to FastAPI, then persists the returned URL.
  const handleVideoUpload = async (file: File) => {
    if (!selectedItem || !tenantId) return
    if (!file.type.startsWith('video/')) {
      setVideoError('Please choose a video file (mp4, mov, webm, avi, mkv).')
      return
    }
    const key = selectedItem.key
    setVideoError(null)
    setVideoUploading(prev => new Set([...prev, key]))
    try {
      const { video_url } = await uploadContentVideo(tenantId, file)
      await saveContentVideoUrl({
        data: {
          kind: selectedItem.kind,
          campaign_id: selectedItem.campaign_id,
          day_date: selectedItem.kind === 'day' ? selectedItem.date : undefined,
          event_id: selectedItem.event_id,
          video_url,
        },
      })
      setVideoCache(prev => ({ ...prev, [key]: video_url }))
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : 'Video upload failed')
    } finally {
      setVideoUploading(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  const handleVideoRemove = async () => {
    if (!selectedItem) return
    const key = selectedItem.key
    try {
      await saveContentVideoUrl({
        data: {
          kind: selectedItem.kind,
          campaign_id: selectedItem.campaign_id,
          day_date: selectedItem.kind === 'day' ? selectedItem.date : undefined,
          event_id: selectedItem.event_id,
          video_url: null,
        },
      })
      setVideoCache(prev => { const n = { ...prev }; delete n[key]; return n })
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : 'Could not remove video')
    }
  }

  // Refine the existing poster with the user's comment (Gemini image edit).
  const handleRefinePoster = async () => {
    if (!selectedItem || !currentPosterUrl || !refineText.trim()) return
    setRefining(true)
    setError(null)
    try {
      const res = await generatePosterImage({
        data: {
          kind: selectedItem.kind,
          campaign_id: selectedItem.campaign_id,
          day_date: selectedItem.kind === 'day' ? selectedItem.date : undefined,
          day_num: selectedItem.kind === 'day' ? selectedItem.day_num : undefined,
          event_id: selectedItem.event_id,
          title: selectedItem.kind === 'day' ? (selectedCampaign?.name ?? '') : selectedItem.label,
          theme: selectedItem.theme,
          headline: headline || selectedItem.theme,
          vehicle: selectedItem.vehicle ?? vehicle,
          mode: 'refine',
          instructions: refineText.trim(),
          base_poster_url: posterDisplayUrl(currentPosterUrl),
        },
      })
      const key = selectedItem.key
      const displayUrl = res.url.startsWith('data:')
        ? res.url
        : `${res.url}${res.url.includes('?') ? '&' : '?'}_cb=${Date.now()}`
      posterCacheRef.current[key] = displayUrl
      setPosterCache(prev => ({ ...prev, [key]: displayUrl }))
      setRefineText('')
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Poster refine failed')
    } finally {
      setRefining(false)
    }
  }

  // Approve one monthly event at the chosen post time → Publishing.
  const handleApproveEvent = async () => {
    if (!selectedItem || selectedItem.kind !== 'event') return
    if (dirty) await persist('edited')
    setApproving(true)
    setError(null)
    try {
      await approveEvent({ data: { id: selectedItem.event_id!, post_time: eventTime } })
      await router.navigate({ to: '/marketing/publishing' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
      setApproving(false)
    }
  }

  const handleSuggest = async (field: 'headline' | 'subheadline' | 'caption' | 'cta' | 'hashtags') => {
    if (!selectedItem) return
    setFieldBusy(field)
    try {
      const current = field === 'hashtags' ? hashtags.join(' ') :
        field === 'headline' ? headline :
        field === 'subheadline' ? subheadline :
        field === 'caption' ? caption : cta
      const { value } = await suggestField({
        data: {
          field, vehicle, theme: selectedItem.theme,
          channel: String(channel), campaign_name: selectedCampaign?.name ?? 'Monthly Events',
          current,
        },
      })
      if (field === 'hashtags' && Array.isArray(value) && value.length) { setHashtags(value); markDirty() }
      else if (typeof value === 'string' && value) {
        if (field === 'headline') setHeadline(value)
        else if (field === 'subheadline') setSubheadline(value)
        else if (field === 'caption') setCaption(value)
        else setCta(value)
        markDirty()
      }
    } catch { /* leave field unchanged */ }
    finally { setFieldBusy(null) }
  }

  const addTag = () => {
    const t = newTag.trim().replace(/\s+/g, '')
    if (!t) return
    const tag = t.startsWith('#') ? t : `#${t}`
    if (!hashtags.includes(tag)) { setHashtags([...hashtags, tag]); markDirty() }
    setNewTag('')
  }
  const removeTag = (tag: string) => { setHashtags(hashtags.filter((h) => h !== tag)); markDirty() }

  // Download: real AI poster when one exists; otherwise compose a branded
  // PNG from the copy on a canvas (no external API).
  const handleDownloadPoster = async () => {
    if (currentPosterDisplayUrl) {
      const fileName = `nissan-${(selectedItem?.theme ?? vehicle).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-poster.png`
      // data: URL downloads directly; cross-origin http (backend) needs blob.
      if (currentPosterDisplayUrl.startsWith('data:')) {
        const a = document.createElement('a'); a.download = fileName; a.href = currentPosterDisplayUrl; a.click()
      } else {
        try {
          const blob = await fetch(currentPosterDisplayUrl).then((r) => r.blob())
          const obj = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.download = fileName; a.href = obj; a.click()
          URL.revokeObjectURL(obj)
        } catch {
          window.open(currentPosterDisplayUrl, '_blank')
        }
      }
      return
    }
    const W = 1080, H = 1080
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawTextOverlay = () => {
      const scrim = ctx.createLinearGradient(0, H * 0.4, 0, H)
      scrim.addColorStop(0, 'rgba(0,0,0,0)')
      scrim.addColorStop(1, 'rgba(0,0,0,0.85)')
      ctx.fillStyle = scrim
      ctx.fillRect(0, 0, W, H)

      ctx.fillStyle = '#C3002F'
      ctx.beginPath(); ctx.roundRect(52, 52, 180, 52, 8); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = '900 18px Arial'
      ctx.letterSpacing = '6px'
      ctx.fillText('NISSAN', 80, 86)
      ctx.letterSpacing = '0px'

      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.beginPath(); ctx.roundRect(W - 220, 52, 168, 52, 8); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = '700 14px Arial'
      ctx.fillText(vehicle.toUpperCase(), W - 196, 84)

      const activeTheme = (selectedItem?.theme ?? '').toUpperCase()
      if (activeTheme) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.font = '700 13px Arial'
        ctx.letterSpacing = '4px'
        ctx.fillText(activeTheme.substring(0, 60), 52, H - 260)
        ctx.letterSpacing = '0px'
      }

      ctx.fillStyle = '#fff'
      ctx.font = '900 64px Arial'
      const words = headline.split(' ')
      let line = ''; let y = H - 210
      for (const w of words) {
        const test = line ? `${line} ${w}` : w
        if (ctx.measureText(test).width > 960 && line) {
          ctx.fillText(line, 52, y); line = w; y += 74
        } else { line = test }
      }
      ctx.fillText(line, 52, y)

      ctx.fillStyle = 'rgba(255,255,255,0.78)'
      ctx.font = '400 24px Arial'
      ctx.fillText(subheadline.substring(0, 80), 52, y + 48)

      ctx.fillStyle = '#C3002F'
      ctx.beginPath(); ctx.roundRect(52, y + 86, Math.min(ctx.measureText(cta).width + 56, 380), 56, 8); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = '700 18px Arial'
      ctx.fillText(cta, 80, y + 122)
    }

    const bgImageSrc = vehicleAsset?.file_url ?? null
    if (bgImageSrc) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve) => {
        img.onload = () => { ctx.drawImage(img, 0, 0, W, H); resolve() }
        img.onerror = () => {
          const grad = ctx.createLinearGradient(0, 0, W, H)
          grad.addColorStop(0, '#1A1A1A'); grad.addColorStop(1, '#3D0A00')
          ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H); resolve()
        }
        img.src = bgImageSrc
      })
    } else {
      const grad = ctx.createLinearGradient(0, 0, W, H)
      grad.addColorStop(0, '#1A1A1A'); grad.addColorStop(1, '#3D0A00')
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H)
    }

    drawTextOverlay()

    const link = document.createElement('a')
    link.download = `nissan-${(selectedItem?.theme ?? vehicle).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-poster.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const fieldLabelRow = (label: string, field: 'headline' | 'subheadline' | 'caption' | 'cta' | 'hashtags', extra?: React.ReactNode) => (
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-[12px] font-semibold text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        {extra}
        <SuggestButton busy={fieldBusy === field} onClick={() => handleSuggest(field)} />
      </div>
    </div>
  )

  return (
    // Break out of AppShell's px-6 py-7 wrapper and own the viewport height below
    // the 64px TopBar, so only the center column scrolls — sides stay fixed.
    <div className="relative flex -mx-6 -my-7 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
      {/* ── Left Panel ──────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-border bg-white flex flex-col">
        {/* Source selector: campaigns + monthly events */}
        <div className="p-3 border-b border-border">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Source</p>
          <div className="relative">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full appearance-none rounded-[10px] border border-border px-3 py-2 text-[12px] text-foreground bg-white pr-8 focus:outline-none"
            >
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={EVENTS_ID}>📅 Monthly Events ({monthEvents.label})</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Campaign: one approve for ALL days at the campaign's posting time */}
          {!isEvents && selectedCampaign && items.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              <button
                onClick={handleApproveCampaign}
                disabled={approving}
                className="w-full flex items-center justify-center gap-1.5 rounded-[10px] bg-green-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-60 transition"
              >
                {approving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve Campaign ({items.length} days)
              </button>
              <p className="text-[9px] text-muted-foreground text-center">
                Posts daily at {selectedCampaign.posting_time ?? '10:00'} · goes to Publishing
              </p>
            </div>
          )}

          {/* Events: shared post time used when approving an event */}
          {isEvents && (
            <div className="mt-2.5 flex items-center gap-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Post at</label>
              <input
                type="text"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                onBlur={() => {
                  const parsed = parse12hInput(eventTime)
                  setEventTime(parsed ? to12hDisplay(parsed) : '10:00 AM')
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                placeholder="10:00 AM"
                className="flex-1 rounded-[8px] border border-border px-2 py-1.5 text-[12px] text-foreground text-center focus:outline-none focus:border-[#C3002F]"
              />
            </div>
          )}
        </div>

        {/* Items: campaign days or events */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pt-3 pb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {isEvents ? 'Events' : 'Campaign Days'}
            </p>
            <Calendar className="h-3 w-3 text-muted-foreground" />
          </div>
          <div className="px-1.5 pb-2">
            {items.length === 0 && (
              <p className="text-[11px] text-muted-foreground px-2 py-4 text-center">
                {isEvents ? 'No events this month.' : 'No days — create a campaign first.'}
              </p>
            )}
            {items.map((it) => {
              const isActive = selectedKey === it.key
              return (
                <button
                  key={it.key}
                  onClick={() => loadItem(it)}
                  className={cn(
                    'w-full flex items-start gap-2 px-2 py-1.5 rounded-[8px] text-left transition-colors mb-0.5',
                    isActive ? 'bg-[#FFF0F3] border border-[#FECDD3]' : 'hover:bg-muted/40',
                  )}
                >
                  <span className={cn('shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-[4px] mt-0.5', isActive ? 'bg-[#C3002F] text-white' : 'bg-muted text-muted-foreground')}>
                    {it.kind === 'day' ? it.label.replace('Day ', 'D') : '★'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold text-foreground truncate">
                      {it.kind === 'day' ? it.theme : it.label}
                    </p>
                    <p className="text-[9px] text-muted-foreground">{it.sublabel}</p>
                  </div>
                  {generatingKeys.has(it.key)
                    ? <Loader2 className="h-3 w-3 text-[#C3002F] animate-spin shrink-0" />
                    : <StatusBadge status={it.content_status} />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Asset panel */}
        <div className="p-3 border-t border-border">
          <div className="rounded-[10px] bg-[#FFF8F8] border border-[#FECDD3] p-2.5">
            <p className="text-[9px] font-bold text-[#C3002F] uppercase tracking-widest mb-2">Asset Panel</p>
            <div className="flex items-center gap-2">
              {vehicleAsset?.file_url ? (
                <img
                  src={vehicleAsset.file_url}
                  alt={vehicleAsset.name}
                  loading="lazy"
                  className="h-8 w-8 rounded-[6px] object-cover border border-[#FECDD3] shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div className="h-8 w-8 rounded-[6px] bg-[#C3002F]/10 flex items-center justify-center border border-[#FECDD3] shrink-0">
                  <Car className="h-3.5 w-3.5 text-[#C3002F]" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[9px] font-semibold text-[#C3002F]">Vehicle</p>
                <p className="text-[10px] text-foreground truncate">
                  {vehicleAsset ? vehicleAsset.name : `${vehicle} (no image)`}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Center Panel ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-white shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {selectedItem && (
              <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                {selectedItem.label} · {selectedItem.theme}
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {hasContent && (
              <button
                onClick={handleDownloadPoster}
                title="Download poster"
                className="flex items-center justify-center rounded-[8px] border border-border h-[30px] w-[34px] text-foreground hover:bg-muted/40 transition"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            {selectedItem && hasContent && (
              <button
                onClick={() => persist('edited')}
                disabled={saveLoading || !dirty}
                className="flex items-center gap-1.5 rounded-[8px] border border-[#C3002F] px-3 py-1.5 text-[11px] font-semibold text-[#C3002F] hover:bg-[#FFF8F8] disabled:opacity-50 transition"
              >
                {saveLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </button>
            )}
            {selectedItem?.kind === 'event' && hasContent && (
              <button
                onClick={handleApproveEvent}
                disabled={approving || saveLoading}
                className="flex items-center gap-1.5 rounded-[8px] bg-green-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-60 transition"
              >
                {approving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve · {eventTime}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {savedMsg && (
            <div className="rounded-[10px] border border-green-200 bg-green-50 p-3 text-[12px] font-semibold text-green-700">
              {savedMsg}
            </div>
          )}

          {error && (
            <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-4 flex gap-3">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-relaxed">{error}</p>
            </div>
          )}

          {/* ── Publish Channels — compact multi-select dropdown ───────────── */}
          {(() => {
            const mainChannels = CHANNELS.filter((c) => MAIN_CHANNELS.includes(c.value))
            const connectedMain = mainChannels.filter((c) => channelDetails[c.value]?.status === 'connected')
            const selectedMeta = selectedChannels
              .map((v) => mainChannels.find((c) => c.value === v))
              .filter((c): c is (typeof mainChannels)[number] => Boolean(c))
            const allConnectedSelected =
              connectedMain.length > 0 && connectedMain.every((c) => selectedChannels.includes(c.value))
            return (
              <div ref={channelMenuRef} className="relative">
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
                  Publish Channels
                </label>

                {/* Trigger */}
                <button
                  type="button"
                  onClick={() => setChannelMenuOpen((o) => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={channelMenuOpen}
                  className={cn(
                    'w-full flex items-center gap-2 min-h-[42px] rounded-[12px] border bg-white px-3 py-2 text-left transition shadow-sm',
                    channelMenuOpen
                      ? 'border-[#C3002F] ring-2 ring-[#C3002F]/15'
                      : 'border-border hover:border-[#C3002F]/40',
                  )}
                >
                  <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
                    {selectedMeta.length === 0 ? (
                      <span className="text-[12px] text-muted-foreground">Select channels to publish…</span>
                    ) : (
                      selectedMeta.map((ch) => (
                        <span
                          key={ch.value}
                          className="inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2 py-0.5 text-[11px] font-semibold text-white"
                          style={{ background: ch.color }}
                        >
                          <span className="grid h-4 w-4 place-items-center rounded-full bg-white/25 text-[9px] font-black">
                            {ch.label.charAt(0)}
                          </span>
                          {ch.label}
                          <span
                            role="button"
                            tabIndex={0}
                            title={`Remove ${ch.label}`}
                            onClick={(e) => { e.stopPropagation(); togglePublishChannel(ch.value) }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePublishChannel(ch.value) } }}
                            className="grid h-3.5 w-3.5 place-items-center rounded-full hover:bg-white/30 transition"
                          >
                            <XIcon className="h-2.5 w-2.5" />
                          </span>
                        </span>
                      ))
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-muted-foreground num">
                    {selectedChannels.length}/{connectedMain.length}
                  </span>
                  <ChevronDown
                    className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', channelMenuOpen && 'rotate-180')}
                  />
                </button>

                {/* Menu */}
                {channelMenuOpen && (
                  <div className="absolute z-30 mt-1.5 w-full rounded-[14px] border border-border bg-white shadow-float overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                        {connectedMain.length} of {mainChannels.length} connected
                      </p>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={connectedMain.length === 0 || allConnectedSelected}
                          onClick={() => setSelectedChannels(connectedMain.map((c) => c.value))}
                          className="rounded-[7px] border border-border px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          disabled={selectedChannels.length === 0}
                          onClick={() => setSelectedChannels([])}
                          className="rounded-[7px] border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    <ul role="listbox" aria-multiselectable className="py-1 max-h-72 overflow-y-auto">
                      {mainChannels.map((ch) => {
                        const conn = channelDetails[ch.value]
                        const isConnected = conn?.status === 'connected'
                        const checked = selectedChannels.includes(ch.value)
                        return (
                          <li key={ch.value} role="option" aria-selected={checked}>
                            <div
                              role={isConnected ? 'button' : undefined}
                              tabIndex={isConnected ? 0 : undefined}
                              onClick={isConnected ? () => { togglePublishChannel(ch.value); setChannel(ch.value) } : undefined}
                              onKeyDown={isConnected ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePublishChannel(ch.value); setChannel(ch.value) } } : undefined}
                              className={cn(
                                'flex items-center gap-3 px-3 py-2.5 mx-1 rounded-[10px] select-none transition',
                                isConnected ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default',
                                isConnected && checked && 'bg-[#FFF8F8]',
                              )}
                            >
                              {/* Checkbox */}
                              <span
                                className={cn(
                                  'h-4 w-4 shrink-0 rounded-[5px] border-2 flex items-center justify-center transition',
                                  !isConnected ? 'border-border bg-muted' :
                                  checked ? 'border-[#C3002F] bg-[#C3002F]' : 'border-border bg-white',
                                )}
                              >
                                {checked && isConnected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                              </span>

                              {/* Avatar */}
                              <span
                                className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-white text-[10px] font-black"
                                style={{ background: ch.color, opacity: isConnected ? 1 : 0.45 }}
                              >
                                {ch.label.charAt(0)}
                              </span>

                              {/* Label + status */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn('text-[12px] font-semibold truncate', isConnected ? 'text-foreground' : 'text-muted-foreground')}>
                                    {ch.label}
                                  </span>
                                </div>
                                {isConnected ? (
                                  <p className="text-[10px] text-green-600 truncate mt-0.5 flex items-center gap-1">
                                    <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
                                    {conn?.account_name ?? conn?.handle ?? 'Connected'}
                                  </p>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">Not Connected</p>
                                )}
                              </div>

                              {/* Right side */}
                              {isConnected ? (
                                checked && (
                                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold text-white" style={{ background: ch.color }}>
                                    Selected
                                  </span>
                                )
                              ) : (
                                <Link
                                  to="/channels"
                                  search={{} as any}
                                  onClick={(e) => e.stopPropagation()}
                                  className="shrink-0 inline-flex items-center gap-1 rounded-[8px] border border-[#C3002F]/30 bg-[#FFF0F3] px-2 py-1 text-[10px] font-semibold text-[#C3002F] hover:bg-[#FFE0E6] transition"
                                >
                                  <Link2 className="h-2.5 w-2.5" />
                                  Connect Account
                                </Link>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {/* No-selection hint */}
                {selectedChannels.length === 0 && (
                  <p className="mt-1.5 text-[10px] font-semibold text-amber-600">
                    No channels selected — content will not be published anywhere.
                  </p>
                )}
              </div>
            )
          })()}

          {/* ── YouTube video attachment — required, unlike the image/text channels ── */}
          {selectedItem && selectedChannels.includes('youtube') && (
            <div className="rounded-[10px] border border-[#FF0000]/25 bg-[#FFF5F5] px-3 py-2.5 space-y-1.5">
              <label className="block text-[11px] font-semibold text-[#C3002F] uppercase tracking-widest">
                YouTube Video (required)
              </label>
              {currentVideoUrl ? (
                <div className="flex items-center gap-2">
                  <a
                    href={currentVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-[11px] font-medium text-[#0A66C2] hover:underline"
                  >
                    {currentVideoUrl.split('/').pop()}
                  </a>
                  <label className="cursor-pointer text-[10px] font-semibold text-muted-foreground hover:text-foreground">
                    Replace
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f) }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleVideoRemove}
                    className="text-[10px] font-semibold text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                </div>
              ) : currentVideoUploading ? (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
                </p>
              ) : (
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold text-[#C3002F] hover:text-[#A00027]">
                  <Plus className="h-3 w-3" /> Attach a video
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f) }}
                  />
                </label>
              )}
              {!currentVideoUrl && !currentVideoUploading && (
                <p className="text-[10px] text-muted-foreground">
                  YouTube needs a real video file — publishing will be skipped for this channel until one is attached.
                </p>
              )}
              {videoError && <p className="text-[10px] font-semibold text-red-600">{videoError}</p>}
            </div>
          )}

          {!selectedItem ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center py-16">
              <Zap className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-[14px] font-semibold text-muted-foreground">
                {items.length === 0
                  ? (isEvents ? 'No events found this month' : 'Create a campaign to get day-wise content')
                  : 'Select a day or event to review its content'}
              </p>
            </div>
          ) : !hasContent ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center py-16">
              <Sparkles className="h-10 w-10 text-[#C3002F]/40" />
              <div>
                <p className="text-[14px] font-semibold text-foreground">No content yet for {selectedItem.label}</p>
                <p className="text-[12px] text-muted-foreground mt-1">Theme: {selectedItem.theme}</p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={genLoading}
                className="flex items-center gap-2 rounded-[10px] bg-[#C3002F] px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-[#a50027] disabled:opacity-60 transition"
              >
                {genLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {genLoading ? 'Generating…' : 'Generate Content'}
              </button>
            </div>
          ) : (
            <>
              {/* Headline + Subheadline */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  {fieldLabelRow('Headline', 'headline')}
                  <input
                    value={headline}
                    onChange={(e) => { setHeadline(e.target.value); markDirty() }}
                    className="w-full rounded-[10px] border border-border px-3 py-2 text-[13px] font-bold text-foreground focus:outline-none focus:border-[#C3002F]"
                  />
                </div>
                <div>
                  {fieldLabelRow('Subheadline', 'subheadline')}
                  <input
                    value={subheadline}
                    onChange={(e) => { setSubheadline(e.target.value); markDirty() }}
                    className="w-full rounded-[10px] border border-border px-3 py-2 text-[12px] text-foreground focus:outline-none focus:border-[#C3002F]"
                  />
                </div>
              </div>

              {/* Caption */}
              <div>
                {fieldLabelRow('Caption', 'caption',
                  <span className="text-[10px] text-muted-foreground">{caption.length}/2200</span>)}
                <textarea
                  value={caption}
                  onChange={(e) => { setCaption(e.target.value); markDirty() }}
                  rows={4}
                  className="w-full rounded-[12px] border border-border bg-muted/30 p-3 text-[12px] text-foreground leading-relaxed resize-none focus:outline-none focus:border-[#C3002F]"
                />
              </div>

              {/* Hashtags — editable chips */}
              <div>
                {fieldLabelRow('Hashtags', 'hashtags',
                  <span className="text-[10px] text-muted-foreground">{hashtags.length}/30</span>)}
                <div className="flex flex-wrap gap-1.5 items-center">
                  {hashtags.map((tag, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-[6px] bg-[#FFF0F3] border border-[#FECDD3] text-[11px] text-[#C3002F] font-medium">
                      <Hash className="h-2.5 w-2.5" />{tag.replace('#', '')}
                      <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 hover:text-[#7f001f]">
                        <XIcon className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                      placeholder="#add"
                      className="w-20 rounded-[6px] border border-dashed border-border px-2 py-1 text-[11px] focus:outline-none focus:border-[#C3002F]"
                    />
                    <button type="button" onClick={addTag} className="rounded-[6px] border border-border p-1 hover:bg-muted/40">
                      <Plus className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <div>
                {fieldLabelRow('CTA', 'cta')}
                <input
                  value={cta}
                  onChange={(e) => { setCta(e.target.value); markDirty() }}
                  className="w-48 rounded-[10px] border border-border px-3 py-2 text-[12px] font-bold text-foreground focus:outline-none focus:border-[#C3002F]"
                />
              </div>

              {/* Regenerate */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={genLoading}
                  className="flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-[11px] font-semibold hover:bg-muted/40 disabled:opacity-60 transition"
                >
                  <RefreshCw className={cn('h-3 w-3', genLoading && 'animate-spin')} />
                  Regenerate All
                </button>
                {dirty && <span className="text-[10px] text-amber-600 font-semibold">Unsaved changes</span>}
              </div>

              {/* Event-mode asset pickers — vehicle photo + logo */}
              {isEvents && (
                <div className="space-y-2 mb-4 p-3 rounded-[12px] border border-border bg-muted/20">
                  <p className="text-[11px] font-semibold text-foreground">Poster Assets</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      {eventVehicleAsset?.file_url && (
                        <img src={eventVehicleAsset.file_url} alt="" className="h-8 w-8 rounded-[6px] object-cover shrink-0 border border-border" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      )}
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Car Photo</label>
                        <select
                          value={eventVehicleAsset?.id ?? ''}
                          onChange={(e) => setEventVehicleAsset(eventVehicleAssets.find(a => a.id === e.target.value) ?? null)}
                          className="w-full rounded-[8px] border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:border-[#C3002F]"
                        >
                          <option value="">None (auto-select from library)</option>
                          {eventVehicleAssets.map(a => (
                            <option key={a.id} value={a.id}>{a.name}{a.vehicle ? ` · ${a.vehicle}` : ''}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {eventLogoAsset?.file_url && (
                        <img src={eventLogoAsset.file_url} alt="" className="h-8 w-8 rounded-[6px] object-contain shrink-0 border border-border bg-white p-0.5" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      )}
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Logo</label>
                        <select
                          value={eventLogoAsset?.id ?? ''}
                          onChange={(e) => setEventLogoAsset(eventLogoAssets.find(a => a.id === e.target.value) ?? null)}
                          className="w-full rounded-[8px] border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:border-[#C3002F]"
                        >
                          <option value="">No logo</option>
                          {eventLogoAssets.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Marketing Poster — Gemini 3 image with the real car photo */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[12px] font-semibold text-foreground">Marketing Poster</p>
                    <p className="text-[10px] text-muted-foreground">
                      {currentPosterUrl
                        ? 'AI poster generated with your car image · Download exports it'
                        : currentPosterLoading
                          ? 'Generating poster with Gemini…'
                          : 'Generating AI poster — or click Regenerate to refresh'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Upload own poster — fallback for when Gemini is over quota */}
                    <label
                      className={cn(
                        'flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-[11px] font-semibold text-foreground hover:border-[#C3002F]/40 hover:text-[#C3002F] transition cursor-pointer',
                        (currentPosterLoading || currentPosterUploading) && 'opacity-60 pointer-events-none',
                      )}
                    >
                      {currentPosterUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      {currentPosterUploading ? 'Uploading…' : 'Upload Poster'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadPoster(f); e.target.value = '' }}
                      />
                    </label>
                    <button
                      onClick={handleGeneratePoster}
                      disabled={currentPosterLoading || currentPosterUploading}
                      className="flex items-center gap-1.5 rounded-[8px] bg-[#C3002F] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#a50027] disabled:opacity-60 transition"
                    >
                      {currentPosterLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {currentPosterLoading ? 'Designing…' : 'Regenerate AI Poster'}
                    </button>
                  </div>
                </div>

                {currentPosterLoading || currentPosterUploading ? (
                  <div className="w-full max-w-[420px] rounded-[16px] bg-[#1A1A1A] flex flex-col items-center justify-center gap-3" style={{ aspectRatio: '3/4' }}>
                    <Loader2 className="h-8 w-8 text-white/40 animate-spin" />
                    <p className="text-[12px] text-white/60">{currentPosterUploading ? 'Uploading your poster…' : 'Designing poster with Gemini…'}</p>
                    {!currentPosterUploading && <p className="text-[10px] text-white/35">Compositing your car onto a themed scene (~20s)</p>}
                  </div>
                ) : currentPosterDisplayUrl ? (
                  <div className="w-full max-w-[420px] space-y-2.5">
                    <div className="rounded-[16px] overflow-hidden border border-border shadow-md relative">
                      <img
                    src={currentPosterDisplayUrl}
                    key={currentPosterDisplayUrl}
                    alt="AI marketing poster"
                    className="w-full h-auto block"
                  />
                      {refining && (
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                          <Loader2 className="h-7 w-7 text-white/80 animate-spin" />
                          <p className="text-[12px] text-white/80">Applying your changes…</p>
                        </div>
                      )}
                    </div>
                    {/* Refine: extra comment → Gemini edits the existing poster */}
                    <div className="flex items-start gap-2">
                      <textarea
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        rows={2}
                        placeholder="Describe a change… e.g. make the background blue, add festive fireworks, move headline higher"
                        className="flex-1 rounded-[10px] border border-border bg-muted/30 px-3 py-2 text-[12px] leading-relaxed resize-none focus:outline-none focus:border-[#C3002F]"
                      />
                      <button
                        onClick={handleRefinePoster}
                        disabled={refining || !refineText.trim() || !currentPosterDisplayUrl}
                        className="shrink-0 flex items-center gap-1.5 rounded-[10px] bg-[#C3002F] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#a50027] disabled:opacity-50 transition"
                      >
                        {refining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Apply
                      </button>
                    </div>
                  </div>
                ) : (
                  <PosterPreview
                    vehicle={vehicle}
                    theme={selectedItem.theme}
                    headline={headline}
                    subheadline={subheadline}
                    caption={caption}
                    cta={cta}
                    vehicleAsset={vehicleAsset?.file_url ?? null}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Floating toggle arrow — rides the panel's left edge ────────── */}
      <button
        type="button"
        onClick={() => setPreviewOpen((o) => !o)}
        aria-expanded={previewOpen}
        aria-label={previewOpen ? 'Hide Channel Preview' : 'Show Channel Preview'}
        title={previewOpen ? 'Hide Channel Preview' : 'Show Channel Preview'}
        style={{ right: previewOpen ? PREVIEW_WIDTH : 0 }}
        className="absolute top-1/2 -translate-y-1/2 z-40 flex items-center justify-center h-16 w-6 rounded-l-[10px] border border-r-0 border-border bg-white text-muted-foreground shadow-float hover:text-[#C3002F] hover:border-[#C3002F]/40 transition-[right,color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        {previewOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      {/* ── Right Panel — Channel Preview (collapsible) ────────────────── */}
      <div
        className="shrink-0 bg-white flex flex-col overflow-hidden border-l border-border transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: previewOpen ? PREVIEW_WIDTH : 0 }}
      >
        <div className="flex flex-col h-full shrink-0" style={{ width: PREVIEW_WIDTH }}>
            <div className="px-4 py-3 border-b border-border shrink-0">
              <p className="text-[13px] font-semibold text-foreground mb-2">Channel Preview</p>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.filter((c) => MAIN_CHANNELS.includes(c.value)).map((ch) => {
                  const isConn = channelDetails[ch.value]?.status === 'connected'
                  return (
                    <button
                      key={ch.value}
                      onClick={isConn ? () => setChannel(ch.value as PreviewChannel) : undefined}
                      disabled={!isConn}
                      title={isConn ? ch.label : `${ch.label} — not connected`}
                      className="rounded-[8px] px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: channel === ch.value && isConn ? ch.color : '#F3F4F6',
                        color: channel === ch.value && isConn ? '#fff' : '#6B7280',
                      }}
                    >
                      {ch.label}
                    </button>
                  )
                })}
              </div>

              {/* All main channels — connected = selectable; not connected = greyed */}
              {(() => {
                const mainChs = CHANNELS.filter((c) => MAIN_CHANNELS.includes(c.value))
                const connectedCount = mainChs.filter((c) => channelDetails[c.value]?.status === 'connected').length
                return (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                        Channels ({connectedCount} connected)
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedChannels(
                            selectedChannels.length === connectedCount
                              ? []
                              : mainChs.filter((c) => channelDetails[c.value]?.status === 'connected').map((c) => c.value),
                          )
                        }
                        className="text-[9px] font-semibold text-[#C3002F] hover:underline"
                      >
                        {selectedChannels.length === connectedCount ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    {mainChs.map((ch) => {
                      const conn = channelDetails[ch.value]
                      const isConnected = conn?.status === 'connected'
                      const isPreviewing = channel === ch.value
                      const isPublishing = selectedChannels.includes(ch.value)
                      return (
                        <div
                          key={ch.value}
                          className={cn(
                            'rounded-[8px] border transition overflow-hidden',
                            !isConnected ? 'border-border opacity-50' :
                            isPreviewing ? 'border-[#C3002F]/40' : 'border-border',
                            isConnected && isPublishing ? 'bg-[#FFF8F8]' : 'bg-muted/10',
                          )}
                        >
                          <div className="flex items-center gap-0">
                            {/* Checkbox — toggles publish selection (connected only) */}
                            <button
                              type="button"
                              onClick={isConnected ? () => togglePublishChannel(ch.value) : undefined}
                              disabled={!isConnected}
                              className="flex items-center justify-center h-full px-2.5 py-2.5 hover:bg-muted/30 transition shrink-0 disabled:cursor-not-allowed"
                            >
                              <div
                                className={cn(
                                  'h-3.5 w-3.5 rounded border-2 flex items-center justify-center transition',
                                  !isConnected ? 'border-border bg-muted' :
                                  isPublishing ? 'border-[#C3002F] bg-[#C3002F]' : 'border-border bg-white',
                                )}
                              >
                                {isPublishing && isConnected && (
                                  <Check className="h-2 w-2 text-white" strokeWidth={3} />
                                )}
                              </div>
                            </button>
                            {/* Row body — switches preview (connected only) */}
                            <button
                              type="button"
                              onClick={isConnected ? () => setChannel(ch.value as PreviewChannel) : undefined}
                              disabled={!isConnected}
                              className="flex items-center gap-2 flex-1 min-w-0 py-2 pr-2.5 text-left disabled:cursor-not-allowed"
                            >
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ background: ch.color }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[11px] font-semibold text-foreground">
                                    {ch.label}
                                  </span>
                                  {isConnected && isPreviewing && (
                                    <span className="shrink-0 text-[8px] font-bold text-[#C3002F] bg-[#FFF0F3] px-1 py-0.5 rounded">
                                      Preview
                                    </span>
                                  )}
                                </div>
                                <p className="truncate text-[10px] text-muted-foreground">
                                  {isConnected
                                    ? (conn?.account_name ?? conn?.handle ?? '—')
                                    : 'Not connected'}
                                </p>
                              </div>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-muted/20">
              {/* Phone-style mock — capped width so it stays clean at any panel size */}
              <div className="w-full max-w-[360px] mx-auto rounded-[16px] border border-border bg-white overflow-hidden shadow-md">
                <div
                  className="h-9 flex items-center px-4 shrink-0"
                  style={{ background: CHANNELS.find((c) => c.value === channel)?.color ?? '#C3002F' }}
                >
                  <span className="text-[12px] font-bold text-white">
                    {CHANNELS.find((c) => c.value === channel)?.label}
                  </span>
                </div>

                <div
                  className="relative bg-[#1A1A1A] overflow-hidden"
                  style={{ aspectRatio: CHANNEL_RATIOS[channel] ?? '1/1' }}
                >
                  {currentPosterDisplayUrl ? (
                    // Real generated poster, cropped to this channel's frame.
                    <img
                      src={currentPosterDisplayUrl}
                      key={currentPosterDisplayUrl}
                      alt="poster"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : hasContent ? (
                    <div
                      className="absolute inset-0 flex flex-col justify-between p-4"
                      style={{ background: 'linear-gradient(135deg, #1A1A1A 0%, #3D0A00 100%)' }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="bg-[#C3002F] px-2.5 py-1 rounded-[5px]">
                          <span className="text-white font-black text-[10px] tracking-[3px]">NISSAN</span>
                        </div>
                        <span className="text-white/70 text-[10px] font-semibold uppercase tracking-wide">{vehicle}</span>
                      </div>
                      <div>
                        <h3 className="text-white text-[20px] font-black leading-tight line-clamp-3 drop-shadow">{headline}</h3>
                        {cta && (
                          <div className="mt-2 inline-block bg-[#C3002F] text-white text-[11px] font-bold px-3 py-1.5 rounded-[5px]">
                            {cta}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <ImageIcon className="h-8 w-8 text-white/30" />
                      <p className="text-[11px] text-white/40 text-center px-4 leading-tight">
                        Select a day or event
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-4 space-y-1.5">
                  {subheadline && (
                    <p className="text-[12px] font-semibold text-foreground line-clamp-1">{subheadline}</p>
                  )}
                  <p className="text-[12px] text-muted-foreground line-clamp-4 leading-relaxed">
                    {caption || <span className="opacity-50 italic">Caption will appear here…</span>}
                  </p>
                  {hashtags.length > 0 && (
                    <p className="text-[12px] text-[#1877F2] line-clamp-2 leading-relaxed">
                      {hashtags.slice(0, 6).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}
                    </p>
                  )}
                  {cta && (
                    <div className="mt-2 bg-[#C3002F] text-white text-[11px] font-bold text-center py-2 rounded-[6px]">
                      {cta}
                    </div>
                  )}
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  )
}
