import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts'
import { TrendingUp, BarChart3, PieChart as PieIcon, Info } from 'lucide-react'
import type { AnalyticsTrendPoint, AnalyticsChannelVolume } from '#/lib/marketing'

const BRAND = '#C3002F'

export const CHANNEL_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  linkedin: '#0A66C2',
  google_business: '#34A853',
  whatsapp: '#25D366',
  x: '#111111',
}
const channelLabel = (c: string) =>
  ({ instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', google_business: 'Google Business', whatsapp: 'WhatsApp', x: 'X' } as Record<string, string>)[c]
  ?? c.charAt(0).toUpperCase() + c.slice(1)

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

function Panel({ title, icon, children, note }: { title: string; icon: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-[14px] font-semibold text-[#1A1A1A]">{title}</h2>
        {note && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-[#9CA3AF]" title={note}>
            <Info className="h-3 w-3" /> {note}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center rounded-[12px] border-2 border-dashed border-[#E5E7EB] bg-[#FAFAFA] text-center">
      <p className="text-[13px] font-semibold text-[#9CA3AF]">{label}</p>
      <p className="mt-0.5 text-[11px] text-[#C4C4C4]">No data in the selected period.</p>
    </div>
  )
}

// 1. Performance Trend — Reach / Impressions / Engagement over time (real).
export function PerformanceTrend({ data }: { data: Array<AnalyticsTrendPoint> }) {
  return (
    <Panel title="Performance Trend" icon={<TrendingUp className="h-4 w-4 text-[#C3002F]" />}>
      {data.length === 0 ? (
        <ChartEmpty label="No insight snapshots yet" />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={(d: string) => d.substring(5)} />
            <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={compact} width={44} />
            <Tooltip formatter={(v: unknown) => (typeof v === 'number' ? v : 0).toLocaleString('en-IN')} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="reach" name="Reach" stroke={BRAND} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="impressions" name="Impressions" stroke="#F59E0B" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="engagement" name="Engagement" stroke="#8B5CF6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}

// 2. Channel Performance — REAL publish volume per channel (per-channel
//    reach/engagement is not tracked, so we chart what is real: post counts).
export function ChannelPerformance({ data }: { data: Array<AnalyticsChannelVolume> }) {
  const rows = data.map((d) => ({ ...d, label: channelLabel(d.channel) }))
  return (
    <Panel
      title="Channel Performance"
      icon={<BarChart3 className="h-4 w-4 text-[#C3002F]" />}
      note="Publish volume · per-channel reach/engagement not tracked"
    >
      {rows.length === 0 ? (
        <ChartEmpty label="No posts in this period" />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} width={32} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="total" name="Created" fill="#CBD5E1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="published" name="Published" radius={[4, 4, 0, 0]}>
              {rows.map((r) => <Cell key={r.channel} fill={CHANNEL_COLORS[r.channel] ?? BRAND} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}

// 6. Channel Distribution — donut of each channel's share of published posts (real).
export function ChannelDistribution({ data }: { data: Array<AnalyticsChannelVolume> }) {
  const rows = data
    .map((d) => ({ name: channelLabel(d.channel), key: d.channel, value: d.published }))
    .filter((r) => r.value > 0)
  const total = rows.reduce((t, r) => t + r.value, 0)
  return (
    <Panel
      title="Channel Distribution"
      icon={<PieIcon className="h-4 w-4 text-[#C3002F]" />}
      note="Share of published posts"
    >
      {rows.length === 0 ? (
        <ChartEmpty label="Nothing published in this period" />
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="60%" height={220}>
            <PieChart>
              <Pie data={rows} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {rows.map((r) => <Cell key={r.key} fill={CHANNEL_COLORS[r.key] ?? BRAND} />)}
              </Pie>
              <Tooltip formatter={(v: unknown) => `${typeof v === 'number' ? v : 0} posts`} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHANNEL_COLORS[r.key] ?? BRAND }} />
                <span className="text-[12px] font-medium text-[#1A1A1A]">{r.name}</span>
                <span className="ml-auto text-[12px] font-semibold text-[#4B5563]">
                  {total ? Math.round((r.value / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}
