import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '#/lib/utils'

export function Panel({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card shadow-card',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function PanelHeader({
  title,
  kicker,
  action,
}: {
  title: string
  kicker?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        {kicker ? (
          <div className="kicker text-muted-foreground/70">{kicker}</div>
        ) : null}
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </h3>
      </div>
      {action}
    </div>
  )
}

// Slide-over drawer (Phase 2 — Lead Board UI). No dialog/sheet primitive
// existed before this; kept minimal (fixed panel + backdrop, Esc + backdrop
// to close) rather than pulling in a new dependency for one use site.
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <div
        className="fade-up relative h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-background shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'emerald' | 'amber' | 'sky' | 'rose'
  className?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-muted text-muted-foreground',
    brand: 'text-[var(--brand)] bg-[color-mix(in_oklab,var(--brand)_12%,transparent)]',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700',
    rose: 'bg-rose-50 text-rose-700',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: {
  variant?: 'primary' | 'brand' | 'ghost' | 'outline'
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<string, string> = {
    primary:
      'bg-primary text-primary-foreground hover:bg-primary/90',
    brand: 'brand-bg hover:opacity-90',
    ghost: 'text-foreground hover:bg-muted',
    outline: 'border border-border bg-card text-foreground hover:bg-muted',
  }
  return (
    <button
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

// India-format absolute timestamp — "09 Jun 2026, 4:20 PM" (Asia/Kolkata, 12-hour).
// The follow-up agent keys off exact contact times, so we show the real timestamp.
export function formatIN(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// Just the time portion — "4:20 PM" (Asia/Kolkata, 12-hour).
export function formatINTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
