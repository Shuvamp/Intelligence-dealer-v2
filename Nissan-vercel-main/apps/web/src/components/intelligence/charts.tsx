import { useState, useEffect } from 'react'
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  RadialBarChart, RadialBar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PolarAngleAxis,
} from 'recharts'
import { LEAD_STAGE_LABEL } from '#/lib/types'
import type {
  VelocityWeek, SourceAnalytic, FunnelStage, DemandItem,
  ChannelAnalytic, CampaignHealth,
} from '#/lib/types'

// ─── SSR guard ────────────────────────────────────────────────────────────────
// TanStack Start renders on the server. Recharts' ResponsiveContainer measures
// the DOM, so it must only render after hydration to avoid a mismatch error
// that freezes the whole page (including tab switching).

function useMounted() {
  const [m, setM] = useState(false)
  useEffect(() => { setM(true) }, [])
  return m
}

function ChartSkeleton({ height }: { height: number }) {
  return <div style={{ height }} className="w-full rounded-lg bg-muted/30 animate-pulse" />
}

// ─── Nissan Brand Palette ─────────────────────────────────────────────────────

export const NP = {
  red:      '#C3002F',
  redLight: '#E63550',
  redDeep:  '#8B0021',
  black:    '#1C1C1C',
  charcoal: '#4A4A4A',
  silver:   '#9E9E9E',
  platinum: '#C8C8C8',
  gold:     '#C4960C',
} as const

export const NISSAN_PALETTE = [
  NP.red, NP.black, NP.silver, NP.redLight, NP.gold, NP.charcoal, NP.platinum,
] as const

// Funnel: pale pink → deep red (bars intensify as stages advance)
const FUNNEL_COLORS = ['#F2C4CC', '#E03050', '#C3002F', '#A80028', '#8B0021', '#6B001A', '#4A0012']

const TICK = { fontSize: 11, fill: '#8C8C8C', fontFamily: 'Hanken Grotesk, ui-sans-serif, sans-serif' }

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

type TipFmt = (v: number | string, name: string) => string

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTip(props: any) {
  const { active, payload, label, valueFormatter } = props as {
    active?: boolean
    payload?: Array<{ name?: string; value?: number | string; color?: string }>
    label?: string | number
    valueFormatter?: TipFmt
  }
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '8px 12px', fontSize: 12, minWidth: 120,
      boxShadow: '0 8px 24px -8px rgba(0,0,0,0.18)',
      fontFamily: 'Hanken Grotesk, ui-sans-serif, sans-serif',
    }}>
      {label !== undefined && (
        <div style={{ marginBottom: 6, fontWeight: 600, color: 'var(--foreground)' }}>{String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: i > 0 ? 3 : 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color ?? '#ccc', flexShrink: 0 }} />
          <span style={{ color: 'var(--muted-foreground)' }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
            {valueFormatter && p.value !== undefined
              ? valueFormatter(p.value, p.name ?? '')
              : String(p.value ?? '')}
          </span>
        </div>
      ))}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tip(fmt?: TipFmt) { return (p: any) => <ChartTip {...p} valueFormatter={fmt} /> }

function legendText(v: string) {
  return <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'Hanken Grotesk, ui-sans-serif, sans-serif' }}>{v}</span>
}

// ─── 1. Lead Velocity — Area Chart ───────────────────────────────────────────

export function VelocityChart({ weeks }: { weeks: VelocityWeek[] }) {
  const mounted = useMounted()
  if (!mounted) return <ChartSkeleton height={200} />
  const data = weeks.map(w => ({ week: w.weekLabel, Leads: w.count, Hot: w.hot }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="velGradLeads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={NP.red}      stopOpacity={0.22} />
            <stop offset="95%" stopColor={NP.red}      stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="velGradHot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={NP.redLight} stopOpacity={0.15} />
            <stop offset="95%" stopColor={NP.redLight} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis dataKey="week" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis                tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={tip()} />
        <Legend iconType="circle" iconSize={7} formatter={legendText} wrapperStyle={{ paddingTop: 8 }} />
        <Area type="monotone" dataKey="Leads" stroke={NP.red} strokeWidth={2}
          fill="url(#velGradLeads)" dot={false} activeDot={{ r: 4, fill: NP.red, strokeWidth: 0 }} />
        <Area type="monotone" dataKey="Hot" stroke={NP.redLight} strokeWidth={1.5} strokeDasharray="5 3"
          fill="url(#velGradHot)" dot={false} activeDot={{ r: 3, fill: NP.redLight, strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── 2. Lead Source — Donut Chart ─────────────────────────────────────────────

export function SourceDonutChart({ sources }: { sources: SourceAnalytic[] }) {
  const mounted = useMounted()
  if (!mounted) return <ChartSkeleton height={210} />
  const data = sources.map(s => ({ name: s.source, value: s.count }))
  return (
    <ResponsiveContainer width="100%" height={210}>
      <PieChart margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <Pie data={data} cx="38%" cy="50%" innerRadius={52} outerRadius={82}
          paddingAngle={3} dataKey="value" strokeWidth={0}>
          {data.map((_, i) => <Cell key={i} fill={NISSAN_PALETTE[i % NISSAN_PALETTE.length]} />)}
        </Pie>
        <Tooltip content={tip()} />
        <Legend layout="vertical" align="right" verticalAlign="middle"
          iconType="circle" iconSize={8} formatter={legendText} />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ─── 3. Pipeline Funnel — Horizontal Bar ─────────────────────────────────────
// Bars graduate pale-pink → deep-red as stages advance toward conversion.

export function FunnelBarChart({ funnel }: { funnel: FunnelStage[] }) {
  const mounted = useMounted()
  const data = funnel.map(s => ({ name: LEAD_STAGE_LABEL[s.stage], value: s.count }))
  const height = Math.max(180, data.length * 38 + 24)
  if (!mounted) return <ChartSkeleton height={height} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
        <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={TICK} axisLine={false} tickLine={false} width={82} />
        <Tooltip content={tip()} />
        <Bar dataKey="value" name="Leads" radius={[0, 4, 4, 0]} maxBarSize={22}
          label={{ position: 'right', fontSize: 11, fill: NP.charcoal }}>
          {data.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[Math.min(i, FUNNEL_COLORS.length - 1)]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── 4. Vehicle Demand — Grouped Vertical Bar ────────────────────────────────
// Total demand (red) + hot leads (silver) side-by-side per model.

export function DemandBarChart({ items }: { items: DemandItem[] }) {
  const mounted = useMounted()
  if (!mounted) return <ChartSkeleton height={210} />
  const data = items.slice(0, 7).map(d => ({ name: d.label, Demand: d.count, Hot: d.hot }))
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 44 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis dataKey="name"
          tick={{ ...TICK, angle: -38, textAnchor: 'end' } as typeof TICK}
          axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={tip()} />
        <Legend iconType="circle" iconSize={7} formatter={legendText} wrapperStyle={{ paddingTop: 6 }} />
        <Bar dataKey="Demand" fill={NP.red}    radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="Hot"    fill={NP.silver} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── 5. Regional Demand — Horizontal Bar ─────────────────────────────────────
// Charcoal bars sorted by count; visually distinct from the funnel chart.

export function RegionalBarChart({ items }: { items: DemandItem[] }) {
  const mounted = useMounted()
  const data = [...items].sort((a, b) => b.count - a.count).slice(0, 8)
    .map(d => ({ name: d.label, Leads: d.count }))
  const height = Math.max(160, data.length * 34 + 24)
  if (!mounted) return <ChartSkeleton height={height} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
        <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={TICK} axisLine={false} tickLine={false} width={82} />
        <Tooltip content={tip()} />
        <Bar dataKey="Leads" fill={NP.charcoal} radius={[0, 4, 4, 0]} maxBarSize={20}
          label={{ position: 'right', fontSize: 11, fill: NP.charcoal }} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── 6. Channel Effectiveness — Grouped Bar, dual Y-axis ─────────────────────
// Normalised Reach % (red) vs raw Leads (charcoal) per channel.

const CHANNEL_SHORT: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook',
  google_business: 'Google', whatsapp: 'WhatsApp',
}

export function ChannelGroupedBar({ channels }: { channels: ChannelAnalytic[] }) {
  const mounted = useMounted()
  if (!mounted) return <ChartSkeleton height={210} />
  const maxReach = Math.max(...channels.map(c => c.reach), 1)
  const data = channels.map(c => ({
    ch: CHANNEL_SHORT[c.channel] ?? c.channel,
    'Reach %': maxReach ? Math.round((c.reach / maxReach) * 100) : 0,
    Leads: c.leads,
  }))
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis dataKey="ch" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left"  tick={TICK} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" allowDecimals={false} />
        <YAxis yAxisId="right" tick={TICK} axisLine={false} tickLine={false} orientation="right" allowDecimals={false} />
        <Tooltip content={tip((v, name) => name === 'Reach %' ? `${v}%` : String(v))} />
        <Legend iconType="circle" iconSize={7} formatter={legendText} wrapperStyle={{ paddingTop: 6 }} />
        <Bar yAxisId="left"  dataKey="Reach %" fill={NP.red}      radius={[4, 4, 0, 0]} maxBarSize={20} />
        <Bar yAxisId="right" dataKey="Leads"   fill={NP.charcoal} radius={[4, 4, 0, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── 7. Campaign Health — Radial Gauge ───────────────────────────────────────
// Two arcs: Publish Rate (red) and Compliance Rate (charcoal).

export function HealthGaugeChart({ health }: { health: CampaignHealth }) {
  const mounted = useMounted()
  if (!mounted) return <ChartSkeleton height={190} />
  const publishRate = health.totalPosts > 0
    ? Math.round((health.published / health.totalPosts) * 100) : 0
  const gaugeData = [
    { name: 'Compliance', value: health.compliancePassRate, fill: NP.red },
    { name: 'Published',  value: publishRate,              fill: NP.charcoal },
  ]
  return (
    <ResponsiveContainer width="100%" height={190}>
      <RadialBarChart cx="50%" cy="55%" innerRadius={38} outerRadius={82}
        startAngle={90} endAngle={-270} data={gaugeData} barCategoryGap="30%">
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar dataKey="value" cornerRadius={5}
          background={{ fill: 'rgba(0,0,0,0.05)' } as object} label={false} />
        <Tooltip content={tip((v) => `${v}%`)} />
        <Legend layout="horizontal" verticalAlign="bottom" align="center"
          iconType="circle" iconSize={8}
          formatter={(value, entry) => {
            const pct = (entry as { payload?: { value?: number } }).payload?.value ?? 0
            return (
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'Hanken Grotesk, ui-sans-serif, sans-serif' }}>
                {value}: <strong style={{ color: 'var(--foreground)' }}>{pct}%</strong>
              </span>
            )
          }}
        />
      </RadialBarChart>
    </ResponsiveContainer>
  )
}
