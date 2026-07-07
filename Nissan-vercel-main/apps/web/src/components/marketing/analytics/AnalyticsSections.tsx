import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import {
  Eye, Megaphone, Activity, ThumbsUp, MessageCircle, Share2, MousePointerClick,
  Users, Phone, Percent, Trophy, IndianRupee, Target, ArrowUpDown, Send,
  CheckCircle2, Clock, Sparkles, FileEdit, X, Lock,
} from 'lucide-react'
import type {
  AnalyticsKpis, AnalyticsCampaignRow, AnalyticsActivityItem, MarketingAnalytics,
} from '#/lib/marketing'

const fmt = (n: number) => n.toLocaleString('en-IN')
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)
const SORT_LABEL: Record<'reach' | 'impressions' | 'engagement' | 'leads', string> = {
  reach: 'Reach', impressions: 'Impressions', engagement: 'Engagement', leads: 'Leads',
}
const channelLabel = (c: string) =>
  ({ instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', google_business: 'Google Business', whatsapp: 'WhatsApp', x: 'X' } as Record<string, string>)[c]
  ?? c.charAt(0).toUpperCase() + c.slice(1)

// ── KPI cards ────────────────────────────────────────────────────────────────
function Kpi({
  title, value, icon, iconColor, iconBg, suffix, tracked = true,
}: {
  title: string; value: string; icon: React.ReactNode; iconColor: string; iconBg: string
  suffix?: string; tracked?: boolean
}) {
  return (
    <div className={`rounded-[16px] border bg-white p-4 ${tracked ? 'border-[#E5E7EB]' : 'border-dashed border-[#E5E7EB]'}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{title}</p>
          {tracked ? (
            <p className="mt-1 text-[24px] font-bold leading-none text-[#1A1A1A]">
              {value}{suffix && <span className="text-[14px] font-semibold text-[#9CA3AF]"> {suffix}</span>}
            </p>
          ) : (
            <>
              <p className="mt-1 text-[24px] font-bold leading-none text-[#D1D5DB]">—</p>
              <p className="mt-0.5 text-[10px] text-[#C4C4C4]">Not tracked yet</p>
            </>
          )}
        </div>
        <div className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: tracked ? iconBg : '#F3F4F6' }}>
          <span style={{ color: tracked ? iconColor : '#D1D5DB' }}>{icon}</span>
        </div>
      </div>
    </div>
  )
}

export function KpiCards({ kpis }: { kpis: AnalyticsKpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Kpi title="Total Reach" value={fmt(kpis.reach)} icon={<Eye className="h-5 w-5" />} iconColor="#C3002F" iconBg="#FFF0F3" />
      <Kpi title="Total Impressions" value={fmt(kpis.impressions)} icon={<Megaphone className="h-5 w-5" />} iconColor="#F59E0B" iconBg="#FFFBEB" />
      <Kpi title="Total Engagement" value={fmt(kpis.engagement)} icon={<Activity className="h-5 w-5" />} iconColor="#8B5CF6" iconBg="#F5F3FF" />
      <Kpi title="Leads Generated" value={fmt(kpis.leads)} icon={<Phone className="h-5 w-5" />} iconColor="#34A853" iconBg="#F0FDF4" />
      <Kpi title="Engagement Rate" value={String(kpis.engagementRate)} suffix="%" icon={<Percent className="h-5 w-5" />} iconColor="#0EA5E9" iconBg="#F0F9FF" />
      <Kpi title="Total Likes" value="" tracked={false} icon={<ThumbsUp className="h-5 w-5" />} iconColor="" iconBg="" />
      <Kpi title="Total Comments" value="" tracked={false} icon={<MessageCircle className="h-5 w-5" />} iconColor="" iconBg="" />
      <Kpi title="Total Shares" value="" tracked={false} icon={<Share2 className="h-5 w-5" />} iconColor="" iconBg="" />
      <Kpi title="Page / Profile Views" value="" tracked={false} icon={<Users className="h-5 w-5" />} iconColor="" iconBg="" />
      <Kpi title="CTR" value="" tracked={false} icon={<MousePointerClick className="h-5 w-5" />} iconColor="" iconBg="" />
    </div>
  )
}

// ── Campaign leaderboard (sortable + campaign→post drill) ─────────────────────
type SortKey = 'reach' | 'impressions' | 'engagement' | 'leads'

export function CampaignLeaderboard({
  rows, selectedId, onSelect,
}: {
  rows: Array<AnalyticsCampaignRow>
  selectedId: string | null
  onSelect: (row: AnalyticsCampaignRow | null) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('reach')
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sortKey] - a[sortKey]), [rows, sortKey])

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="px-2 py-2 text-right">
      <button
        onClick={() => setSortKey(k)}
        className={`inline-flex items-center gap-1 ${sortKey === k ? 'text-[#C3002F]' : 'text-[#9CA3AF] hover:text-[#4B5563]'}`}
      >
        {label} <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  )

  return (
    <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-[#C3002F]" />
        <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Campaign Leaderboard</h2>
        <span className="ml-auto text-[10px] text-[#9CA3AF]">sort by any metric · click a row to drill in</span>
      </div>
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[#9CA3AF]">No campaign insights in this period.</p>
      ) : (
        <>
          {/* Visual: top campaigns by the active sort metric */}
          <div className="mb-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              Top {Math.min(sorted.length, 8)} by {SORT_LABEL[sortKey]}
            </p>
            <ResponsiveContainer width="100%" height={Math.max(140, Math.min(sorted.length, 8) * 34)}>
              <BarChart data={sorted.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" horizontal={false} />
                <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#4B5563' }} />
                <Tooltip formatter={(v: unknown) => fmt(typeof v === 'number' ? v : 0)} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }} />
                <Bar dataKey={sortKey} radius={[0, 4, 4, 0]}>
                  {sorted.slice(0, 8).map((r, i) => (
                    <Cell key={r.campaign_id} fill={i === 0 ? '#C3002F' : '#F4A8B8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[#F0F0F0] text-[11px] font-semibold uppercase tracking-wide">
                <th className="px-2 py-2 text-left text-[#9CA3AF]">Campaign</th>
                <Th k="reach" label="Reach" />
                <Th k="impressions" label="Impr." />
                <Th k="engagement" label="Engmt." />
                <Th k="leads" label="Leads" />
                <th className="px-2 py-2 text-right text-[#9CA3AF]">CPL</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const active = r.campaign_id === selectedId
                return (
                  <tr
                    key={r.campaign_id}
                    onClick={() => onSelect(active ? null : r)}
                    className={`cursor-pointer border-b border-[#F7F7F7] transition ${active ? 'bg-[#FFF0F3]' : 'hover:bg-[#FAFAFA]'}`}
                  >
                    <td className="px-2 py-2.5 text-left">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F3F4F6] text-[10px] font-bold text-[#6B7280]">{i + 1}</span>
                        <span className="font-semibold text-[#1A1A1A]">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right text-[#4B5563]">{fmt(r.reach)}</td>
                    <td className="px-2 py-2.5 text-right text-[#4B5563]">{fmt(r.impressions)}</td>
                    <td className="px-2 py-2.5 text-right text-[#4B5563]">{fmt(r.engagement)}</td>
                    <td className="px-2 py-2.5 text-right font-semibold text-[#34A853]">{fmt(r.leads)}</td>
                    <td className="px-2 py-2.5 text-right text-[#4B5563]">{r.costPerLead ? `₹${fmt(r.costPerLead)}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── ROI section ───────────────────────────────────────────────────────────────
export function RoiSection({ roi }: { roi: MarketingAnalytics['roi'] }) {
  const Stat = ({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) => (
    <div className="rounded-[12px] border border-[#E5E7EB] bg-[#FAFAFA] p-3">
      <div className="flex items-center gap-1.5 text-[#9CA3AF]"><span style={{ color }}>{icon}</span><span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="mt-1 text-[20px] font-bold text-[#1A1A1A]">{value}</p>
    </div>
  )
  return (
    <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-[#C3002F]" />
        <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Campaign ROI</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Cost / Lead" value={roi.costPerLead ? `₹${fmt(roi.costPerLead)}` : '—'} icon={<IndianRupee className="h-4 w-4" />} color="#C3002F" />
        <Stat label="Leads Generated" value={fmt(roi.leads)} icon={<Phone className="h-4 w-4" />} color="#34A853" />
        <Stat label="Conversion Rate" value={`${roi.conversionRate}%`} icon={<Percent className="h-4 w-4" />} color="#0EA5E9" />
        <Stat label="Total Spend" value={roi.spend ? `₹${fmt(roi.spend)}` : '—'} icon={<IndianRupee className="h-4 w-4" />} color="#F59E0B" />
      </div>
      <div className="mt-3 rounded-[12px] border border-[#FECDD3] bg-[#FFF0F3] p-3">
        <div className="flex items-center gap-1.5 text-[#C3002F]"><Trophy className="h-3.5 w-3.5" /><span className="text-[10px] font-semibold uppercase tracking-wide">Best Performing Campaign</span></div>
        {roi.bestCampaign ? (
          <p className="mt-1 text-[14px] font-bold text-[#1A1A1A]">
            {roi.bestCampaign.name}
            <span className="ml-2 text-[11px] font-medium text-[#6B7280]">{fmt(roi.bestCampaign.leads)} leads · {fmt(roi.bestCampaign.reach)} reach</span>
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-[#9CA3AF]">No data in this period.</p>
        )}
      </div>
    </div>
  )
}

// ── Recent activity feed (real, with campaign→post drill filter) ──────────────
const KIND_META: Record<AnalyticsActivityItem['kind'], { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  published: { icon: <Send className="h-3.5 w-3.5" />, color: '#22C55E', bg: '#F0FDF4', label: 'Published' },
  scheduled: { icon: <Clock className="h-3.5 w-3.5" />, color: '#0EA5E9', bg: '#F0F9FF', label: 'Scheduled' },
  approved: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: '#8B5CF6', bg: '#F5F3FF', label: 'Approved' },
  generated: { icon: <Sparkles className="h-3.5 w-3.5" />, color: '#F59E0B', bg: '#FFFBEB', label: 'Generated' },
  draft: { icon: <FileEdit className="h-3.5 w-3.5" />, color: '#9CA3AF', bg: '#F3F4F6', label: 'Draft' },
  other: { icon: <FileEdit className="h-3.5 w-3.5" />, color: '#9CA3AF', bg: '#F3F4F6', label: 'Update' },
}

export function ActivityFeed({
  items, filterCampaign, onClearFilter,
}: {
  items: Array<AnalyticsActivityItem>
  filterCampaign: string | null
  onClearFilter: () => void
}) {
  const shown = filterCampaign ? items.filter((i) => i.campaign === filterCampaign) : items
  return (
    <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[#C3002F]" />
        <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Recent Activity</h2>
        {filterCampaign && (
          <button onClick={onClearFilter} className="ml-auto flex items-center gap-1 rounded-full bg-[#FFF0F3] px-2 py-0.5 text-[10px] font-semibold text-[#C3002F]">
            {filterCampaign} <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[#9CA3AF]">
          {filterCampaign ? 'No recent posts for this campaign.' : 'No activity in this period.'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((it) => {
            const m = KIND_META[it.kind]
            return (
              <div key={it.id} className="flex items-center gap-2.5 rounded-[10px] border border-[#F5F5F5] px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ background: m.bg, color: m.color }}>{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-[#1A1A1A]">{it.title}</p>
                  <p className="truncate text-[10px] text-[#9CA3AF]">
                    {m.label}{it.channel ? ` · ${channelLabel(it.channel)}` : ''}{it.campaign ? ` · ${it.campaign}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-[#C4C4C4]">{it.at ? it.at.substring(0, 10) : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Honest "not tracked" placeholder (Content Performance, Audience Insights) ──
export function NotTracked({ title, lines }: { title: string; lines: Array<string> }) {
  return (
    <div className="rounded-[18px] border border-dashed border-[#E5E7EB] bg-[#FAFAFA] p-5">
      <div className="mb-2 flex items-center gap-2">
        <Lock className="h-4 w-4 text-[#9CA3AF]" />
        <h2 className="text-[14px] font-semibold text-[#6B7280]">{title}</h2>
      </div>
      <p className="text-[12px] text-[#9CA3AF]">Requires per-post / audience metrics that aren't tracked yet:</p>
      <ul className="mt-1.5 space-y-0.5">
        {lines.map((l) => (
          <li key={l} className="text-[11px] text-[#B0B0B0]">• {l}</li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-[#C4C4C4]">Connect channel insight ingestion to populate this section.</p>
    </div>
  )
}
