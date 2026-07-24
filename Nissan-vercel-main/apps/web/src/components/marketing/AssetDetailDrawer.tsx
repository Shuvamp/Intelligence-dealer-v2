import { useEffect, useRef, useState } from 'react'
import type { MediaAsset } from '#/lib/types'
import {
  X, Download, Copy, Check, Trash2, Star, Calendar, HardDrive,
  Ruler, Tag, Car, FolderOpen, Sparkles, Link2, History,
} from 'lucide-react'
import { cn } from '#/lib/utils'

const TYPE_LABEL: Record<MediaAsset['asset_type'], string> = {
  vehicle: 'Vehicle',
  logo: 'Logo',
  background: 'Background',
  brand_asset: 'Brand Asset',
}

const TYPE_TONE: Record<MediaAsset['asset_type'], string> = {
  vehicle: 'bg-[color-mix(in_oklab,var(--brand)_14%,transparent)] text-[var(--brand)]',
  logo: 'bg-sky-50 text-sky-700',
  background: 'bg-violet-50 text-violet-700',
  brand_asset: 'bg-amber-50 text-amber-700',
}

function fmtBytes(n?: number | null) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function isImage(url: string) {
  // SVG deliberately excluded — an inline-served SVG is an executable document
  // (stored-XSS vector); legacy SVGs render as the non-image placeholder instead
  // of via <img src>. New SVG uploads are already blocked server-side. See S3.
  return /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(url)
}

interface Props {
  asset: MediaAsset | null
  onClose: () => void
  onDelete: (asset: MediaAsset) => void
  isFavorite: boolean
  onToggleFavorite: (id: string) => void
}

export function AssetDetailDrawer({ asset, onClose, onDelete, isFavorite, onToggleFavorite }: Props) {
  const [copied, setCopied] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setCopied(false)
    setDims(null)
    setImgLoaded(false)
  }, [asset?.id])

  // Focus management + keyboard: Escape closes, Tab is trapped inside the drawer,
  // and focus returns to whatever opened it when it closes. Keyed on open-state,
  // not asset id, so switching assets doesn't re-capture the opener or re-run the
  // trap setup.
  const isOpen = asset !== null
  useEffect(() => {
    if (!isOpen) return
    openerRef.current = document.activeElement as HTMLElement | null

    const focusables = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )

    // Move focus into the drawer so the trap has an anchor and screen readers land here.
    focusables()[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !drawerRef.current?.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      openerRef.current?.focus()
    }
  }, [isOpen, onClose])

  if (!asset) return null

  const image = isImage(asset.file_url)
  // Supabase Storage already hands back an absolute URL; only legacy relative
  // paths need the origin prepended.
  const absoluteUrl =
    /^https?:\/\//i.test(asset.file_url) || typeof window === 'undefined'
      ? asset.file_url
      : `${window.location.origin}${asset.file_url}`

  function copyUrl() {
    navigator.clipboard.writeText(absoluteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  // The <a download> attribute is ignored for cross-origin URLs, and Supabase
  // Storage serves from a different origin — so the footer link just opened the
  // file instead of saving it. Supabase honors a `download` query param to send
  // Content-Disposition: attachment; on same-origin/legacy URLs it's an inert
  // extra param and the download attribute still applies.
  const downloadUrl = (() => {
    try {
      const u = new URL(absoluteUrl)
      u.searchParams.set('download', asset.name)
      return u.toString()
    } catch {
      return absoluteUrl
    }
  })()

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Scrim */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
      />

      {/* Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={asset.name}
        className="relative w-full max-w-[440px] h-full bg-white shadow-float border-l border-border flex flex-col"
        style={{ animation: 'fade-up 320ms cubic-bezier(0.16,1,0.3,1) both' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', TYPE_TONE[asset.asset_type])}>
              <Sparkles className="h-3 w-3" />
              {TYPE_LABEL[asset.asset_type]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onToggleFavorite(asset.id)}
              className={cn('h-8 w-8 flex items-center justify-center rounded-full transition hover:bg-muted/60', isFavorite ? 'text-amber-500' : 'text-muted-foreground')}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={cn('h-4 w-4', isFavorite && 'fill-amber-400')} />
            </button>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted/60 transition text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Large preview */}
          <div className="p-5">
            <div className="relative rounded-[18px] overflow-hidden border border-border bg-[radial-gradient(circle_at_30%_20%,#f8fafc,#eef1f5)] aspect-[4/3] flex items-center justify-center">
              {image ? (
                <>
                  {!imgLoaded && <div className="absolute inset-0 animate-pulse bg-muted" />}
                  <img
                    src={asset.file_url}
                    alt={asset.name}
                    // A cached image can be complete before onLoad can attach.
                    ref={(el) => {
                      if (el?.complete && el.naturalWidth) {
                        // An inline ref re-runs on every render, so bail out when
                        // the dims are unchanged — a fresh object each time would
                        // re-render → re-attach → loop ("Maximum update depth").
                        setDims((d) =>
                          d && d.w === el.naturalWidth && d.h === el.naturalHeight
                            ? d
                            : { w: el.naturalWidth, h: el.naturalHeight },
                        )
                        setImgLoaded(true)
                      }
                    }}
                    onLoad={(e) => {
                      const t = e.currentTarget
                      setDims({ w: t.naturalWidth, h: t.naturalHeight })
                      setImgLoaded(true)
                    }}
                    onError={() => setImgLoaded(true)}
                    className={cn('max-h-full max-w-full object-contain transition-opacity duration-300', imgLoaded ? 'opacity-100' : 'opacity-0')}
                  />
                </>
              ) : (
                <FolderOpen className="h-16 w-16 text-muted-foreground/40" />
              )}
            </div>
          </div>

          {/* Title */}
          <div className="px-5 pb-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground leading-snug">{asset.name}</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5 break-all">{asset.file_url}</p>
          </div>

          {/* Metadata grid */}
          <div className="px-5 pb-4">
            <div className="grid grid-cols-2 gap-2">
              <Meta icon={<Tag className="h-3.5 w-3.5" />} label="Type" value={TYPE_LABEL[asset.asset_type]} />
              <Meta icon={<Car className="h-3.5 w-3.5" />} label="Vehicle" value={asset.vehicle || '—'} />
              <Meta icon={<FolderOpen className="h-3.5 w-3.5" />} label="Category" value={asset.sub_category || '—'} />
              <Meta icon={<HardDrive className="h-3.5 w-3.5" />} label="File size" value={fmtBytes(asset.file_size)} />
              <Meta icon={<Ruler className="h-3.5 w-3.5" />} label="Dimensions" value={dims ? `${dims.w} × ${dims.h}` : image ? 'Loading…' : '—'} />
              <Meta icon={<Calendar className="h-3.5 w-3.5" />} label="Uploaded" value={asset.created_at ? new Date(asset.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
            </div>
          </div>

          {/* Public URL */}
          <div className="px-5 pb-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <Link2 className="h-3 w-3" /> Asset URL
            </p>
            <div className="flex items-center gap-2 rounded-[12px] border border-border bg-muted/30 px-3 py-2">
              <code className="flex-1 text-[11px] text-foreground truncate">{absoluteUrl}</code>
              <button
                onClick={copyUrl}
                className={cn('shrink-0 inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-semibold transition', copied ? 'bg-emerald-50 text-emerald-700' : 'bg-white border border-border text-foreground hover:bg-muted/40')}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Usage history (no data wired yet — honest placeholder) */}
          <div className="px-5 pb-5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <History className="h-3 w-3" /> Usage & campaigns
            </p>
            <div className="rounded-[14px] border border-dashed border-border bg-muted/20 px-4 py-5 text-center">
              <p className="text-[12px] font-semibold text-foreground">No usage recorded yet</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Once this asset is placed in a campaign, its publish history and linked campaigns appear here.
              </p>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-border px-5 py-3 flex items-center gap-2 shrink-0">
          <a
            href={downloadUrl}
            download={asset.name}
            className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-[12px] brand-bg text-[13px] font-semibold hover:opacity-90 transition"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
          <button
            onClick={() => onDelete(asset)}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[12px] border border-red-200 bg-red-50 text-[13px] font-semibold text-[var(--brand)] hover:bg-red-100 transition"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </aside>
    </div>
  )
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        {icon}
        {label}
      </p>
      <p className="text-[13px] font-semibold text-foreground mt-1 truncate capitalize">{value}</p>
    </div>
  )
}
