import { Sparkles } from 'lucide-react'
import type { InstagramPostInsight } from '#/lib/marketing'
import { DashCard, EmptyState, SectionHeader } from './shared'

const MEDIA_LABEL: Record<string, string> = { IMAGE: 'Images', VIDEO: 'Videos', CAROUSEL_ALBUM: 'Carousels' }

// Heuristic, not an LLM call — every line here is a plain aggregate over
// real Instagram posts/campaign data already loaded on this page. No new
// backend endpoint; this is presentation logic over existing responses.
function buildInsights(posts: Array<InstagramPostInsight>, bestCampaign: { name: string; leads: number; reach: number } | null): Array<string> {
  const out: Array<string> = []

  const byType = new Map<string, { engagement: number; count: number }>()
  for (const p of posts) {
    const label = MEDIA_LABEL[p.mediaType ?? ''] ?? null
    if (!label) continue
    const e = byType.get(label) ?? { engagement: 0, count: 0 }
    e.engagement += (p.likes ?? 0) + (p.comments ?? 0)
    e.count += 1
    byType.set(label, e)
  }
  const avgByType = [...byType.entries()]
    .map(([label, v]) => ({ label, avg: v.engagement / v.count }))
    .filter((r) => r.avg > 0)
    .sort((a, b) => b.avg - a.avg)
  if (avgByType.length >= 2) {
    const [top, ...rest] = avgByType
    const worst = rest[rest.length - 1]
    const multiplier = worst.avg > 0 ? (top.avg / worst.avg).toFixed(1) : null
    out.push(
      multiplier
        ? `${top.label} get ${multiplier}x more engagement (likes + comments) per post than ${worst.label.toLowerCase()} this period.`
        : `${top.label} are your best-performing content type this period.`,
    )
  }

  const hourBuckets = new Map<number, number>()
  for (const p of posts) {
    if (!p.at) continue
    const h = new Date(p.at).getUTCHours()
    hourBuckets.set(h, (hourBuckets.get(h) ?? 0) + (p.likes ?? 0) + (p.comments ?? 0))
  }
  const bestHour = [...hourBuckets.entries()].sort((a, b) => b[1] - a[1])[0]
  if (bestHour && bestHour[1] > 0) {
    const h = bestHour[0]
    const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
    out.push(`Posts published around ${label} UTC get the most likes and comments this period.`)
  }

  if (bestCampaign) {
    out.push(`"${bestCampaign.name}" is your top campaign this period — ${bestCampaign.leads} leads from ${bestCampaign.reach.toLocaleString('en-IN')} reach.`)
  }

  return out
}

const TILES = [
  'bg-[#FEF3C7] text-[#B45309]', 'bg-[#DBEAFE] text-[#2563EB]', 'bg-[#DCFCE7] text-[#16A34A]',
  'bg-[#FCE7F3] text-[#DB2777]', 'bg-[#EDE9FE] text-[#7C3AED]',
]

export function AiInsightsPanel({ posts, bestCampaign }: {
  posts: Array<InstagramPostInsight>
  bestCampaign: { name: string; leads: number; reach: number } | null
}) {
  const insights = buildInsights(posts, bestCampaign)
  return (
    <DashCard className="flex h-full flex-col">
      <SectionHeader kicker="AI" title="AI Insights" />
      {insights.length === 0 ? (
        <EmptyState label="Not enough activity in this period to generate insights yet" />
      ) : (
        <ul className="space-y-2.5">
          {insights.map((line, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TILES[i % TILES.length]}`}>
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <p className="pt-1 text-[12px] leading-relaxed text-[#1A1A1A]">{line}</p>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  )
}
