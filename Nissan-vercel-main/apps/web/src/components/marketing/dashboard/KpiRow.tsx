import type { ComponentType } from 'react'
import { ArrowDownRight, ArrowUpRight, Eye, Heart, Layers, Megaphone, MessageCircle, Minus, MousePointerClick, Share2, UserPlus } from 'lucide-react'
import type { AnalyticsKpis, InstagramInsights } from '#/lib/marketing'
import { DashCard, compact } from './shared'

// null = "no previous-period baseline" (prev was 0 or absent) → render as N/A,
// not a fabricated +/-100%.
function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] font-medium text-[#9CA3AF]">N/A</span>
  const Icon = pct === 0 ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight
  const color = pct === 0 ? '#9CA3AF' : pct > 0 ? '#16A34A' : '#DC2626'
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold" style={{ color }}>
      <Icon className="h-3.5 w-3.5" />{Math.abs(pct).toFixed(1)}%
    </span>
  )
}

interface Kpi {
  icon: ComponentType<{ className?: string }>
  label: string
  value: number | null
  pct: number | null
  tracked: boolean
  // Per-KPI icon tile — [background, foreground]. Tailwind's scanner needs
  // literal class strings, so these are written out rather than interpolated.
  tile: string
}

function KpiCard({ icon: Icon, label, value, pct, tracked, tile, delay }: Kpi & { delay: number }) {
  return (
    <DashCard delay={delay} className="!p-4">
      <div className="flex items-center gap-2.5">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${tile}`}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <p className="min-w-0 truncate text-[12px] font-medium text-[#6B7280]">{label}</p>
      </div>
      <p className="mt-3 text-[24px] font-bold leading-none tracking-tight text-[#1A1A1A]">
        {tracked && value !== null ? compact(value) : '—'}
      </p>
      <div className="mt-2">
        {tracked ? <Trend pct={pct} /> : <span className="text-[11px] font-semibold text-[#9CA3AF]">Not tracked</span>}
        <p className="mt-0.5 text-[10px] font-medium text-[#9CA3AF]">vs prev. period</p>
      </div>
    </DashCard>
  )
}

export function KpiRow({
  kpis, prevKpis, instagram, prevInstagram,
}: {
  kpis: AnalyticsKpis
  prevKpis: AnalyticsKpis
  instagram: InstagramInsights | null
  prevInstagram: InstagramInsights | null
}) {
  // Sum of the real day-over-day follower deltas in range — tracked only once
  // the poller has ≥2 snapshots to diff (see AudienceGrowthChart).
  const gained = instagram?.audience.reduce<number | null>((t, p) => (p.net === null ? t : (t ?? 0) + p.net), null) ?? null
  const items: Array<Kpi> = [
    { icon: Eye, label: 'Total Reach', value: kpis.reach, pct: pctDelta(kpis.reach, prevKpis.reach), tracked: true, tile: 'bg-[#EEF2FF] text-[#4F46E5]' },
    { icon: Layers, label: 'Impressions', value: kpis.impressions, pct: pctDelta(kpis.impressions, prevKpis.impressions), tracked: true, tile: 'bg-[#EFF6FF] text-[#2563EB]' },
    { icon: Heart, label: 'Likes', value: instagram?.likes ?? null, pct: instagram && prevInstagram ? pctDelta(instagram.likes, prevInstagram.likes) : null, tracked: !!instagram, tile: 'bg-[#FDF2F8] text-[#DB2777]' },
    { icon: MessageCircle, label: 'Comments', value: instagram?.comments ?? null, pct: instagram && prevInstagram ? pctDelta(instagram.comments, prevInstagram.comments) : null, tracked: !!instagram, tile: 'bg-[#FFF7ED] text-[#EA580C]' },
    { icon: Share2, label: 'Shares', value: null, pct: null, tracked: false, tile: 'bg-[#ECFDF5] text-[#059669]' },
    { icon: Megaphone, label: 'Saves', value: null, pct: null, tracked: false, tile: 'bg-[#FEFCE8] text-[#CA8A04]' },
    { icon: UserPlus, label: 'Followers Gained', value: gained, pct: null, tracked: gained !== null, tile: 'bg-[#F5F3FF] text-[#7C3AED]' },
    { icon: MousePointerClick, label: 'Leads', value: kpis.leads, pct: pctDelta(kpis.leads, prevKpis.leads), tracked: true, tile: 'bg-[#ECFEFF] text-[#0891B2]' },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
      {items.map((item, i) => <KpiCard key={item.label} {...item} delay={i * 0.03} />)}
    </div>
  )
}
