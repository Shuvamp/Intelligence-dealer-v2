import { Users, Trophy, Percent, XCircle, Activity } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatMoney } from '#/components/leads/lead-ui'
import type { LeadConversionAnalytics } from '#/lib/queries'

type Tone = 'brand' | 'emerald' | 'sky' | 'rose' | 'neutral'
const TONES: Record<Tone, string> = {
  brand: 'var(--brand)',
  emerald: '#10B981',
  sky: '#0EA5E9',
  rose: '#F43F5E',
  neutral: '#6B7280',
}

function Card({
  icon: Icon, label, value, sub, tone, index,
}: { icon: LucideIcon; label: string; value: string; sub: string; tone: Tone; index: number }) {
  const color = TONES[tone]
  return (
    <div
      className="fade-up rounded-xl border border-border bg-card p-5 shadow-card"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: `color-mix(in oklab, ${color} 12%, transparent)`, color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="num mt-3 text-[28px] font-bold text-foreground">{value}</div>
      <div className="text-[12px] text-muted-foreground">{sub}</div>
    </div>
  )
}

export function ConversionKpis({ data }: { data: LeadConversionAnalytics }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <Card index={0} icon={Users} tone="brand" label="Total Leads" value={String(data.totalLeads)} sub={`${data.hot} hot in period`} />
      <Card index={1} icon={Trophy} tone="emerald" label="Converted" value={String(data.won)} sub={`${formatMoney(data.wonValue)} won`} />
      <Card index={2} icon={Percent} tone="sky" label="Conversion Rate" value={`${data.conversionRate}%`} sub="won of closed leads" />
      <Card index={3} icon={XCircle} tone="rose" label="Lost" value={String(data.lost)} sub="closed–lost" />
      <Card index={4} icon={Activity} tone="neutral" label="In Pipeline" value={String(data.open)} sub={`${formatMoney(data.pipelineValue)} open`} />
    </div>
  )
}
