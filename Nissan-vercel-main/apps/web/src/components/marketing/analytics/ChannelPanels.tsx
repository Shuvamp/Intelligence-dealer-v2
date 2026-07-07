import {
  Linkedin, ThumbsUp, MessageCircle, Activity, BarChart3, Share2, Users, Eye,
  Megaphone, Percent, Plug, CheckCircle2, XCircle, Clock, Trophy, Info,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { ChannelConnection } from '#/lib/types'
import type { LinkedInInsights, AnalyticsChannelCampaign } from '#/lib/marketing'
import { CHANNELS } from './ChannelFilter'

const fmt = (n: number) => n.toLocaleString('en-IN')

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso.substring(0, 10)
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Connected Channels status card ────────────────────────────────────────────
export function ConnectedChannelsCard({ connections }: { connections: Array<ChannelConnection> }) {
  const byKey = new Map(connections.map((c) => [c.channel, c]))
  return (
    <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Plug className="h-4 w-4 text-[#C3002F]" />
        <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Connected Channels</h2>
      </div>
      <div className="space-y-2">
        {CHANNELS.map((c) => {
          const conn = byKey.get(c.key)
          const connected = conn?.status === 'connected'
          return (
            <div key={c.key} className="flex items-center gap-2.5 rounded-[10px] border border-[#F5F5F5] px-3 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: connected ? c.color : '#E5E7EB' }} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-[#1A1A1A]">{c.label}</p>
                {connected && conn?.handle && <p className="truncate text-[10px] text-[#9CA3AF]">{conn.handle}</p>}
              </div>
              {connected ? (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-medium text-[#9CA3AF]">
                  <XCircle className="h-3 w-3" /> {conn ? 'Disconnected' : 'Not connected'}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-[#C4C4C4]" title={conn?.last_sync ?? ''}>
                <Clock className="h-3 w-3" /> {relTime(conn?.last_sync ?? null)}
              </span>
            </div>
          )
        })}
      </div>
      <Link to="/marketing/connected-channels" search={{} as any} className="mt-3 inline-block text-[11px] font-semibold text-[#C3002F]">
        Manage channels →
      </Link>
    </div>
  )
}

// ── Small metric tile (tracked or N/A) ────────────────────────────────────────
function Metric({
  label, value, icon, color, suffix, tracked = true,
}: { label: string; value?: string; icon: React.ReactNode; color: string; suffix?: string; tracked?: boolean }) {
  return (
    <div className={`rounded-[12px] border bg-white p-3 ${tracked ? 'border-[#E5E7EB]' : 'border-dashed border-[#E5E7EB]'}`}>
      <div className="flex items-center gap-1.5 text-[#9CA3AF]">
        <span style={{ color: tracked ? color : '#D1D5DB' }}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      {tracked ? (
        <p className="mt-1 text-[20px] font-bold text-[#1A1A1A]">{value}{suffix && <span className="text-[12px] text-[#9CA3AF]"> {suffix}</span>}</p>
      ) : (
        <p className="mt-1 text-[20px] font-bold text-[#D1D5DB]">—</p>
      )}
    </div>
  )
}

// ── LinkedIn insights panel (real likes/comments; rest N/A) ───────────────────
export function LinkedInInsightsPanel({ data }: { data: LinkedInInsights }) {
  if (!data.connected) {
    return (
      <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-6 text-center">
        <Linkedin className="mx-auto mb-2 h-8 w-8 text-[#0A66C2]" />
        <p className="text-[13px] font-semibold text-[#1A1A1A]">LinkedIn not connected</p>
        <p className="mt-0.5 text-[11px] text-[#9CA3AF]">Connect LinkedIn to see post insights.</p>
        <Link to="/marketing/connected-channels" search={{} as any} className="mt-3 inline-block rounded-[10px] bg-[#0A66C2] px-3 py-1.5 text-[12px] font-semibold text-white">
          Connect LinkedIn
        </Link>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Linkedin className="h-4 w-4 text-[#0A66C2]" />
          <h2 className="text-[14px] font-semibold text-[#1A1A1A]">LinkedIn Insights</h2>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-[#9CA3AF]" title="Member API exposes likes & comments only">
            <Info className="h-3 w-3" /> {data.postsWithStats}/{data.postsTracked} posts with stats
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Metric label="Likes" value={fmt(data.likes)} icon={<ThumbsUp className="h-4 w-4" />} color="#0A66C2" />
          <Metric label="Comments" value={fmt(data.comments)} icon={<MessageCircle className="h-4 w-4" />} color="#8B5CF6" />
          <Metric label="Engagement" value={fmt(data.engagement)} icon={<Activity className="h-4 w-4" />} color="#22C55E" />
          <Metric label="Avg / Post" value={String(data.avgEngagementPerPost)} icon={<BarChart3 className="h-4 w-4" />} color="#F59E0B" />
          <Metric label="Reach" icon={<Eye className="h-4 w-4" />} color="" tracked={false} />
          <Metric label="Impressions" icon={<Megaphone className="h-4 w-4" />} color="" tracked={false} />
          <Metric label="Shares" icon={<Share2 className="h-4 w-4" />} color="" tracked={false} />
          <Metric label="Engagement Rate" icon={<Percent className="h-4 w-4" />} color="" tracked={false} />
          <Metric label="Followers Growth" icon={<Users className="h-4 w-4" />} color="" tracked={false} />
          <Metric label="Profile Views" icon={<Eye className="h-4 w-4" />} color="" tracked={false} />
        </div>
        <p className="mt-3 text-[10px] text-[#C4C4C4]">
          Reach, impressions, shares, followers growth & profile views need a LinkedIn Organization page + Marketing Developer Platform access — not available for member connections.
        </p>
      </div>

      <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-[#0A66C2]" />
          <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Top Performing Posts</h2>
        </div>
        {data.topPosts.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-[#9CA3AF]">
            No post stats yet. Newly published LinkedIn posts appear here once they collect likes/comments.
          </p>
        ) : (
          <div className="space-y-2">
            {data.topPosts.map((p, i) => (
              <div key={p.urn} className="flex items-center gap-3 rounded-[10px] border border-[#F5F5F5] px-3 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#EFF6FF] text-[11px] font-bold text-[#0A66C2]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-[#1A1A1A]">{p.title}</p>
                  <p className="text-[10px] text-[#9CA3AF]">{p.at ? p.at.substring(0, 10) : ''}</p>
                </div>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-[#0A66C2]"><ThumbsUp className="h-3 w-3" /> {fmt(p.likes)}</span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-[#8B5CF6]"><MessageCircle className="h-3 w-3" /> {fmt(p.comments)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Channel-scoped campaigns (real post counts on the selected channel) ───────
export function ChannelCampaignsTable({ rows, channelLabel }: { rows: Array<AnalyticsChannelCampaign>; channelLabel: string }) {
  return (
    <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-[#C3002F]" />
        <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Campaigns on {channelLabel}</h2>
        <span className="ml-auto text-[10px] text-[#9CA3AF]">real post counts</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[#9CA3AF]">No posts on this channel in the selected period.</p>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[#F0F0F0] text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              <th className="px-2 py-2 text-left">Campaign</th>
              <th className="px-2 py-2 text-right">Posts</th>
              <th className="px-2 py-2 text-right">Published</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.campaign_id} className="border-b border-[#F7F7F7]">
                <td className="px-2 py-2.5 text-left font-semibold text-[#1A1A1A]">{r.name}</td>
                <td className="px-2 py-2.5 text-right text-[#4B5563]">{r.total}</td>
                <td className="px-2 py-2.5 text-right font-semibold text-[#22C55E]">{r.published}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
