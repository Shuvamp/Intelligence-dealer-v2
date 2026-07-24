import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts'
import { Eye, Heart, MessageCircle, MousePointerClick, Radio, Share2 } from 'lucide-react'
import type { AnalyticsTrendPoint, InstagramAudiencePoint, InstagramPostInsight  } from '#/lib/marketing'

import { DashCard, EmptyState, NotTrackedNote, SectionHeader, Segmented, compact } from './shared'

const GRAN = [{ value: 'daily' as const, label: 'Daily' }, { value: 'weekly' as const, label: 'Weekly' }]
type Granularity = 'daily' | 'weekly'

// Weekly = sum of each UTC week's daily points. Same series, coarser bins —
// no new data source, no re-fetch.
function rollUp(data: Array<AnalyticsTrendPoint>, granularity: Granularity): Array<AnalyticsTrendPoint> {
  if (granularity === 'daily') return data
  const weeks = new Map<string, AnalyticsTrendPoint>()
  for (const p of data) {
    const d = new Date(`${p.date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - d.getUTCDay())   // back to Sunday
    const key = d.toISOString().substring(0, 10)
    const acc = weeks.get(key) ?? { date: key, reach: 0, impressions: 0, engagement: 0 }
    acc.reach += p.reach
    acc.impressions += p.impressions
    acc.engagement += p.engagement
    weeks.set(key, acc)
  }
  return [...weeks.values()]
}

const axisProps = { tick: { fontSize: 11, fill: '#9CA3AF' }, axisLine: false, tickLine: false } as const
const tooltipStyle = { fontSize: 12, borderRadius: 12, border: '1px solid #ECECEF' }
const shortDate = (d: string) => d.substring(5)

// Reach over time — real (campaign_insights).
export function ReachTrendChart({ data }: { data: Array<AnalyticsTrendPoint> }) {
  const [granularity, setGranularity] = useState<Granularity>('daily')
  const rows = useMemo(() => rollUp(data, granularity), [data, granularity])
  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader
        kicker="Reach" title="Reach Over Time"
        action={<Segmented value={granularity} onChange={setGranularity} options={GRAN} />}
      />
      {rows.length === 0 ? (
        <EmptyState label="No insight snapshots in this period" />
      ) : (
        <div className="min-h-[240px] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="reachFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#EC4899" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#EC4899" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} />
              <YAxis tickFormatter={compact} width={40} {...axisProps} />
              <Tooltip formatter={(v: unknown) => (typeof v === 'number' ? v : 0).toLocaleString('en-IN')} contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="reach" name="Reach" stroke="#EC4899" strokeWidth={2.5} fill="url(#reachFill)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </DashCard>
  )
}

// Engagement overview — multi-series over the same real trend rows. Likes /
// comments / shares have no per-day series in the schema, so the series shown
// are the three that do: reach, impressions, engagement.
const SERIES = [
  { key: 'impressions', label: 'Impressions', color: '#8B5CF6' },
  { key: 'reach', label: 'Reach', color: '#EC4899' },
  { key: 'engagement', label: 'Engagement', color: '#F59E0B' },
]

export function EngagementOverviewChart({ data }: { data: Array<AnalyticsTrendPoint> }) {
  const [granularity, setGranularity] = useState<Granularity>('daily')
  const rows = useMemo(() => rollUp(data, granularity), [data, granularity])
  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader
        kicker="Engagement" title="Engagement Overview"
        action={<Segmented value={granularity} onChange={setGranularity} options={GRAN} />}
      />
      {rows.length === 0 ? (
        <EmptyState label="No insight snapshots in this period" />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-3">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-medium text-[#6B7280]">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
              </span>
            ))}
          </div>
          <div className="min-h-[210px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} />
                <YAxis tickFormatter={compact} width={40} {...axisProps} />
                <Tooltip formatter={(v: unknown) => (typeof v === 'number' ? v : 0).toLocaleString('en-IN')} contentStyle={tooltipStyle} />
                {SERIES.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </DashCard>
  )
}

// Content type performance — the content-type dimension is `mediaType` on real
// Instagram posts. Share of engagement per type, plus the derived callouts.
const MEDIA_LABEL: Record<string, string> = { IMAGE: 'Images', VIDEO: 'Videos', CAROUSEL_ALBUM: 'Carousels' }
const DONUT = ['#EC4899', '#8B5CF6', '#3B82F6', '#F59E0B', '#10B981']

export function ContentTypePerformance({ posts }: { posts: Array<InstagramPostInsight> }) {
  const rows = useMemo(() => {
    const byType = new Map<string, { engagement: number; count: number }>()
    for (const p of posts) {
      const label = MEDIA_LABEL[p.mediaType ?? ''] ?? p.mediaType
      if (!label) continue
      const e = byType.get(label) ?? { engagement: 0, count: 0 }
      e.engagement += (p.likes ?? 0) + (p.comments ?? 0)
      e.count += 1
      byType.set(label, e)
    }
    return [...byType.entries()]
      .map(([label, v]) => ({ label, engagement: v.engagement, count: v.count, avg: v.engagement / v.count }))
      .sort((a, b) => b.engagement - a.engagement)
  }, [posts])

  const total = rows.reduce((t, r) => t + r.engagement, 0)
  const best = rows[0]
  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader kicker="Content" title="Content Type Performance" />
      {rows.length === 0 || total === 0 ? (
        <EmptyState label="No Instagram posts with engagement in this period" />
      ) : (
        <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="h-[150px] w-full sm:w-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="engagement" nameKey="label" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none">
                  {rows.map((r, i) => <Cell key={r.label} fill={DONUT[i % DONUT.length]} />)}
                </Pie>
                <Tooltip formatter={(v: unknown) => (typeof v === 'number' ? v : 0).toLocaleString('en-IN')} contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5">
            {rows.map((r, i) => (
              <div key={r.label} className="flex items-center gap-2 text-[11px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DONUT[i % DONUT.length] }} />
                <span className="flex-1 truncate font-medium text-[#4B5563]">{r.label}</span>
                <span className="font-semibold text-[#1A1A1A]">{Math.round((r.engagement / total) * 100)}%</span>
              </div>
            ))}
            {best && (
              <div className="mt-3 space-y-2 border-t border-[#F3F4F6] pt-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">Best performing</p>
                  <p className="text-[13px] font-bold text-[#1A1A1A]">{best.label}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">Avg. engagement / post</p>
                  <p className="text-[13px] font-bold text-[#1A1A1A]">{compact(Math.round(best.avg))}</p>
                </div>
                <p className="text-[10px] text-[#9CA3AF]">Avg. reach per post isn't tracked per content type.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </DashCard>
  )
}

// Best time to post, bucketed from real post timestamps + likes/comments.
// ponytail: buckets by the UTC hour on the stored `published_at` — no per-tenant
// timezone stored anywhere, so "8pm" here means UTC 8pm, not local dealer time.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BUCKETS = [{ label: '12am', h0: 0 }, { label: '4am', h0: 4 }, { label: '8am', h0: 8 }, { label: '12pm', h0: 12 }, { label: '4pm', h0: 16 }, { label: '8pm', h0: 20 }]

// Same 4-hour UTC binning as before, plotted as a line over the day instead of
// a day×time grid: x = time window, y = likes + comments, one series per view
// (All days) or one per weekday when a specific day is picked.
export function BestTimeHeatmap({ posts }: { posts: Array<InstagramPostInsight> }) {
  const [day, setDay] = useState('all')

  const { rows, any } = useMemo(() => {
    const grid = DAYS.map(() => BUCKETS.map(() => 0))
    let seen = false
    for (const p of posts) {
      if (!p.at) continue
      const d = new Date(p.at)
      // A malformed timestamp gives Invalid Date → getUTCDay() is NaN → grid[NaN]
      // is undefined, and the non-null assertion turned that into a TypeError that
      // blanked the whole dashboard. One bad IG row should just be skipped.
      if (Number.isNaN(d.getTime())) continue
      grid[d.getUTCDay()][Math.min(5, Math.floor(d.getUTCHours() / 4))] += (p.likes ?? 0) + (p.comments ?? 0)
      seen = true
    }
    const dayIndex = DAYS.indexOf(day)
    return {
      any: seen,
      rows: BUCKETS.map((b, j) => ({
        label: b.label,
        engagement: dayIndex === -1 ? grid.reduce((t, row) => t + row[j], 0) : grid[dayIndex][j],
      })),
    }
  }, [posts, day])

  const peak = rows.reduce((best, r) => (r.engagement > best.engagement ? r : best), rows[0])

  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader
        kicker="Timing" title="Best Time to Post"
        action={
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="Weekday"
            className="rounded-[10px] border border-[#ECECEF] bg-white px-2 py-1 text-[11px] font-semibold text-[#1A1A1A] outline-none"
          >
            <option value="all">All days</option>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        }
      />
      {!any ? (
        <EmptyState label="No Instagram posts in this period" />
      ) : (
        <>
          <p className="mb-2 text-[11px] text-[#6B7280]">
            {peak.engagement > 0
              ? <>Peak window <b className="font-semibold text-[#1A1A1A]">{peak.label} UTC</b> — {compact(peak.engagement)} likes + comments</>
              : 'No likes or comments on posts in this window'}
          </p>
          <div className="min-h-[190px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="bestTimeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EC4899" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#EC4899" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis tickFormatter={compact} width={40} {...axisProps} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: unknown) => [(typeof v === 'number' ? v : 0).toLocaleString('en-IN'), 'Likes + comments']}
                />
                <Area type="monotone" dataKey="engagement" name="Likes + comments" stroke="#EC4899" strokeWidth={2.5} fill="url(#bestTimeFill)" dot={{ r: 3, fill: '#EC4899' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="pt-1 text-[10px] text-[#9CA3AF]">Likes + comments on posts published in each 4-hour window (UTC)</p>
        </>
      )}
    </DashCard>
  )
}

// Follower growth from real snapshots (instagram_account_metrics, written every
// poll tick by instagram_analytics_poller). The series only covers days the
// poller has actually run — there is no historical backfill, since Instagram's
// `followers_count` field is point-in-time and the daily `follower_count`
// insight needs a scope the app doesn't hold.
export function AudienceGrowthChart({ data }: { data: Array<InstagramAudiencePoint> }) {
  // First point has net === null (nothing to diff against) — dropping it keeps
  // the line honest rather than drawing a fabricated 0 for day one.
  const rows = data.filter((d) => d.net !== null)
  const gained = rows.reduce((t, r) => t + Math.max(0, r.net ?? 0), 0)
  const lost = rows.reduce((t, r) => t + Math.min(0, r.net ?? 0), 0)
  const net = gained + lost
  const followers = rows[rows.length - 1]?.followers ?? null

  const stats: Array<{ label: string; value: string; color: string }> = [
    { label: 'Followers', value: followers === null ? '—' : compact(followers), color: '#1A1A1A' },
    { label: 'Gained', value: `+${compact(gained)}`, color: '#16A34A' },
    { label: 'Lost', value: compact(lost), color: '#DC2626' },
    { label: 'Net growth', value: `${net >= 0 ? '+' : ''}${compact(net)}`, color: net >= 0 ? '#16A34A' : '#DC2626' },
  ]

  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader kicker="Audience" title="Audience Growth" />
      {rows.length === 0 ? (
        <EmptyState label="No follower snapshots yet — collected every poll tick" />
      ) : (
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="min-h-[160px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="audienceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} />
                <YAxis hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: unknown, _n, item: { payload?: InstagramAudiencePoint }) =>
                    [`${(typeof v === 'number' && v >= 0 ? '+' : '')}${v} (${item.payload?.followers.toLocaleString('en-IN')} total)`, 'Net followers']
                  }
                />
                <Area type="monotone" dataKey="net" name="Net follower growth" stroke="#8B5CF6" strokeWidth={2} fill="url(#audienceFill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:w-[104px] sm:grid-cols-1 sm:gap-2.5">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">{s.label}</p>
                <p className="text-[15px] font-bold leading-tight" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashCard>
  )
}

// Engagement funnel — horizontal step funnel, each step as % of the top stage.
// Impressions/Reach real (campaign_insights); Likes/Comments real (Instagram);
// everything past comments has no tracked source, shown grayed rather than invented.
const FUNNEL_ICONS = [Eye, Radio, Heart, MessageCircle, Share2, MousePointerClick]

export function EngagementFunnel({ impressions, reach, likes, comments, leads }: {
  impressions: number; reach: number; likes: number | null; comments: number | null; leads: number
}) {
  const steps: Array<{ label: string; value: number | null; tile: string }> = [
    { label: 'Impressions', value: impressions, tile: 'bg-[#EFF6FF] text-[#2563EB]' },
    { label: 'Reach', value: reach, tile: 'bg-[#EEF2FF] text-[#4F46E5]' },
    { label: 'Likes', value: likes, tile: 'bg-[#FDF2F8] text-[#DB2777]' },
    { label: 'Comments', value: comments, tile: 'bg-[#FFF7ED] text-[#EA580C]' },
    { label: 'Shares', value: null, tile: 'bg-[#ECFDF5] text-[#059669]' },
    { label: 'Leads', value: leads, tile: 'bg-[#ECFEFF] text-[#0891B2]' },
  ]
  const top = steps[0].value || 0
  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader kicker="Funnel" title="Engagement Funnel" />
      <div className="flex flex-1 flex-wrap items-start justify-between gap-y-4">
        {steps.map((s, i) => {
          const Icon = FUNNEL_ICONS[i]
          const tracked = s.value !== null
          const pct = tracked && top ? ((s.value as number) / top) * 100 : null
          return (
            <div key={s.label} className="flex min-w-[74px] flex-1 flex-col items-center text-center">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${tracked ? s.tile : 'bg-[#F3F4F6] text-[#C4C4C4]'}`}>
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <p className="mt-2 text-[10px] font-medium text-[#9CA3AF]">{s.label}</p>
              <p className="text-[14px] font-bold text-[#1A1A1A]">{tracked ? compact(s.value as number) : '—'}</p>
              <p className="text-[10px] font-semibold text-[#6B7280]">
                {pct === null ? 'N/A' : `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(2)}%`}
              </p>
            </div>
          )
        })}
      </div>
      <div className="mt-3">
        <NotTrackedNote lines={['Shares', 'Profile visits', 'Website click-throughs']} />
      </div>
    </DashCard>
  )
}
