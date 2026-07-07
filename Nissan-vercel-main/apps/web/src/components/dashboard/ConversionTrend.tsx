import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Panel, PanelHeader } from '#/components/ui/kit'
import type { LeadConversionAnalytics } from '#/lib/queries'

const BRAND = '#C3002F'
const EMERALD = '#10B981'

// Leads created vs converted, per day, over the selected period.
export function ConversionTrend({ data }: { data: LeadConversionAnalytics }) {
  const rows = data.trend
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '160ms' }}>
      <PanelHeader title="Leads vs Converted" kicker="Trend" />
      <div className="p-5">
        {rows.length === 0 ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-center">
            <TrendingUp className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-[13px] text-muted-foreground">No leads in this period.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={BRAND} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gWon" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={EMERALD} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={EMERALD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={(d: string) => d.substring(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} width={32} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="leads" name="Leads" stroke={BRAND} strokeWidth={2} fill="url(#gLeads)" />
              <Area type="monotone" dataKey="won" name="Converted" stroke={EMERALD} strokeWidth={2} fill="url(#gWon)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  )
}
