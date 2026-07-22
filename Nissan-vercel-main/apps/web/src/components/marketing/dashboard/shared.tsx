import { motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'

// Shared chrome for the redesigned Marketing Dashboard. Kept local (not
// ui/kit.tsx) to match the hex-literal palette the rest of this page's
// existing filter bar (DateRangeFilter/ChannelFilter) already uses —
// swapping only these to CSS-var tokens would make the page look stitched
// together from two design systems instead of one.
export const BRAND = '#C3002F'
export const INK = '#1A1A1A'
export const MUTED = '#9CA3AF'
export const BORDER = '#E5E7EB'

export function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, delay, ease: 'easeOut' as const },
  }
}

// Premium card shell — rounded-20, soft shadow, hover lift. Every dashboard
// section renders inside one of these for a consistent "SaaS panel" look.
// NOTE: Tailwind's scanner needs literal arbitrary-value strings in source —
// classes can't be built by interpolating a JS color constant, so the hex
// values below are written out even though BRAND/INK/etc. exist above.
export function DashCard({
  className = '',
  glass = false,
  delay = 0,
  children,
}: {
  className?: string
  glass?: boolean
  delay?: number
  children: ReactNode
}) {
  return (
    <motion.div
      {...fadeUp(delay)}
      className={`rounded-[16px] border border-[#ECECEF] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-8px_rgba(16,24,40,0.08)] transition-shadow duration-200 hover:shadow-[0_2px_4px_rgba(16,24,40,0.06),0_16px_32px_-8px_rgba(16,24,40,0.12)] ${
        glass ? 'bg-white/70 backdrop-blur-md' : 'bg-white'
      } ${className}`}
    >
      {children}
    </motion.div>
  )
}

// Compact number formatting — one implementation, used by every tile, axis,
// table cell and funnel step on this page.
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-IN')
}

// Every widget's "nothing to show" state. Never rendered alongside fabricated
// zeros — a widget shows either real numbers or this.
export function EmptyState({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={`flex h-full min-h-[180px] flex-col items-center justify-center rounded-[14px] border-2 border-dashed border-[#ECECEF] bg-[#FAFAFA] p-4 text-center ${className}`}>
      <p className="text-[12px] font-semibold text-[#9CA3AF]">{label}</p>
    </div>
  )
}

// Small segmented control (Daily / Weekly) used in the chart card headers.
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <div className="flex rounded-[10px] border border-[#ECECEF] bg-[#F9FAFB] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-[8px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            value === o.value ? 'bg-white text-[#1A1A1A] shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-[#9CA3AF] hover:text-[#4B5563]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SectionHeader({ kicker, title, action }: { kicker?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {kicker && <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{kicker}</p>}
        <h2 className="text-[15px] font-semibold text-[#1A1A1A]">{title}</h2>
      </div>
      {action}
    </div>
  )
}

// Honest "no real data source yet" placeholder — same convention as
// AnalyticsSections.tsx's NotTracked, reused here so tiles/sections never
// fabricate a number for a metric we don't actually collect.
export function NotTrackedNote({ lines }: { lines: Array<string> }) {
  return (
    <div className="flex items-start gap-2 rounded-[14px] border border-dashed border-[#E5E7EB] bg-[#FAFAFA] p-4">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" />
      <p className="text-[11px] leading-relaxed text-[#9CA3AF]">
        Not tracked yet — {lines.join(', ')}.
      </p>
    </div>
  )
}
