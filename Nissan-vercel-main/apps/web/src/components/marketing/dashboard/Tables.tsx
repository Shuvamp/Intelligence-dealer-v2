import { useState } from 'react'
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import type { AnalyticsCampaignRow, InstagramPostInsight } from '#/lib/marketing'
import type { CampaignSummary } from '#/lib/types'
import { DashCard, EmptyState, SectionHeader, compact } from './shared'

const NA = <span className="text-[#C4C4C4]">—</span>

// Real likes/comments per post; reach/shares/engagement-rate per post aren't
// tracked anywhere in the schema, shown as "—" not 0.
export function TopPerformingPosts({ posts }: { posts: Array<InstagramPostInsight> }) {
  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader kicker="Instagram" title="Top Performing Posts" />
      {posts.length === 0 ? (
        <EmptyState label="No Instagram posts in this period" />
      ) : (
        <div className="space-y-2">
          {posts.slice(0, 5).map((p, i) => (
            <div key={p.mediaId} className="flex items-center gap-3 rounded-[12px] border border-[#F3F4F6] p-2 transition-all duration-200 hover:border-[#ECECEF] hover:bg-[#FAFAFA] hover:shadow-[0_4px_16px_-6px_rgba(16,24,40,0.12)]">
              <div className="relative shrink-0">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[10px] bg-[#F3F4F6] ring-1 ring-[#EDEFF2]">
                  {p.imageUrl
                    ? <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                    : <ImageOff className="h-4 w-4 text-[#C4C4C4]" />}
                </div>
                <span className={`absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-white ${
                  i === 0 ? 'bg-[#FEF3C7] text-[#B45309]'
                  : i === 1 ? 'bg-[#F1F5F9] text-[#64748B]'
                  : i === 2 ? 'bg-[#FEE9DC] text-[#C2571A]'
                  : 'bg-[#F9FAFB] text-[#9CA3AF]'
                }`}>{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-[#1A1A1A]">{p.caption || 'Untitled post'}</p>
                <p className="text-[10px] text-[#9CA3AF]">{p.at ? p.at.substring(0, 10) : '—'}</p>
                <div className="mt-1 flex gap-3 text-[10px] text-[#6B7280]">
                  <span>Reach {NA}</span>
                  <span>Likes <b className="font-semibold text-[#1A1A1A]">{p.likes ?? '—'}</b></span>
                  <span>Comments <b className="font-semibold text-[#1A1A1A]">{p.comments ?? '—'}</b></span>
                  <span>Eng. rate {NA}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashCard>
  )
}

// Posts is real (campaign_posts count); Reach/Engagement/Leads real per
// campaign from campaign_insights (analytics.leaderboard).
export function CampaignPerformanceTable({ leaderboard, campaigns }: {
  leaderboard: Array<AnalyticsCampaignRow>
  campaigns: Array<CampaignSummary>
}) {
  const postCountById = new Map(campaigns.map((c) => [c.id, c.postCount]))
  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader kicker="Campaigns" title="Campaign Performance" />
      {leaderboard.length === 0 ? (
        <EmptyState label="No campaign insights in this period" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#ECECEF] text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                <th className="pb-2.5 font-semibold">Campaign</th>
                <th className="pb-2.5 font-semibold">Posts</th>
                <th className="pb-2.5 font-semibold">Reach</th>
                <th className="pb-2.5 font-semibold">Engagement</th>
                <th className="pb-2.5 text-right font-semibold">Leads</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.slice(0, 8).map((row) => (
                <tr key={row.campaign_id} className="border-t border-[#F3F4F6] transition-colors hover:bg-[#FAFAFA]">
                  <td className="max-w-[140px] truncate py-2.5 font-medium text-[#C3002F]">{row.name}</td>
                  <td className="py-2.5 text-[#4B5563]">{postCountById.get(row.campaign_id) ?? NA}</td>
                  <td className="py-2.5 text-[#4B5563]">{compact(row.reach)}</td>
                  <td className="py-2.5 text-[#4B5563]">{compact(row.engagement)}</td>
                  <td className="py-2.5 text-right">
                    <span className="inline-flex min-w-[28px] items-center justify-center rounded-full bg-[#FDF2F4] px-2 py-0.5 text-[11px] font-bold text-[#C3002F]">{row.leads}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashCard>
  )
}

const PAGE_SIZES = [10, 25, 50]

// Full-width paginated post table. Date/Likes/Comments real; Campaign is null
// for organic IG posts (no campaign_id on instagram_posts); Reach/Impressions/
// Shares/Saves/Engagement-rate per post aren't tracked anywhere.
export function PostPerformanceTable({ posts }: { posts: Array<InstagramPostInsight> }) {
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(posts.length / pageSize))
  const current = Math.min(page, pages - 1)
  const rows = posts.slice(current * pageSize, current * pageSize + pageSize)

  return (
    <DashCard>
      <SectionHeader kicker="Instagram" title="Post Performance" />
      {posts.length === 0 ? (
        <EmptyState label="No Instagram posts in this period" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#ECECEF] text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                  {['Date', 'Post', 'Campaign', 'Reach', 'Impressions', 'Likes', 'Comments', 'Shares', 'Saves', 'Engagement rate'].map((h) => (
                    <th key={h} className="whitespace-nowrap pb-2.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.mediaId} className="border-t border-[#F3F4F6] transition-colors hover:bg-[#FAFAFA]">
                    <td className="whitespace-nowrap py-2.5 text-[#4B5563]">{p.at ? p.at.substring(0, 10) : NA}</td>
                    <td className="max-w-[220px] truncate py-2.5 font-medium text-[#1A1A1A]">{p.caption || 'Untitled post'}</td>
                    <td className="py-2.5 text-[#9CA3AF]">{NA}</td>
                    <td className="py-2.5 text-[#9CA3AF]">{NA}</td>
                    <td className="py-2.5 text-[#9CA3AF]">{NA}</td>
                    <td className="py-2.5 font-semibold text-[#1A1A1A]">{p.likes ?? NA}</td>
                    <td className="py-2.5 font-semibold text-[#1A1A1A]">{p.comments ?? NA}</td>
                    <td className="py-2.5 text-[#9CA3AF]">{NA}</td>
                    <td className="py-2.5 text-[#9CA3AF]">{NA}</td>
                    <td className="py-2.5 text-[#9CA3AF]">{NA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-3 border-t border-[#F3F4F6] pt-3 text-[11px] text-[#6B7280]">
            <label className="flex items-center gap-1.5">
              Rows per page:
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
                className="rounded-[8px] border border-[#ECECEF] bg-white px-2 py-1 text-[11px] font-medium text-[#1A1A1A] outline-none"
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <span>{current * pageSize + 1}–{Math.min(posts.length, (current + 1) * pageSize)} of {posts.length}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page"
                className="rounded-[8px] border border-[#ECECEF] p-1 disabled:opacity-40 enabled:hover:bg-[#FAFAFA]"
              ><ChevronLeft className="h-3.5 w-3.5" /></button>
              <button
                onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Next page"
                className="rounded-[8px] border border-[#ECECEF] p-1 disabled:opacity-40 enabled:hover:bg-[#FAFAFA]"
              ><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </>
      )}
    </DashCard>
  )
}
