import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useRouter, Link } from '@tanstack/react-router'
import {
  getPublishing, rejectCampaign, rejectEvent, getChannelStatus, publishGroupToConnected,
  getCampaigns,
} from '#/lib/marketing'
import type { PublishingItem, ChannelConnection } from '#/lib/types'
import {
  Send, Clock, CheckCircle2, RefreshCw, CalendarDays, XCircle, Star, Car, Inbox, Loader2,
  Link2, AlertCircle, MinusCircle,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_authed/marketing/publishing')({
  loader: async () => {
    const [items, channels, campaigns] = await Promise.all([
      getPublishing(), getChannelStatus(), getCampaigns(),
    ])
    return { items, channels, campaigns }
  },
  component: Publishing,
})

// Display metadata for the channels the publisher can target.
const CHANNEL_META: Record<string, { label: string; color: string }> = {
  instagram:       { label: 'Instagram',       color: '#E1306C' },
  facebook:        { label: 'Facebook',        color: '#1877F2' },
  linkedin:        { label: 'LinkedIn',        color: '#0A66C2' },
  google_business: { label: 'Google Business', color: '#34A853' },
  whatsapp:        { label: 'WhatsApp',        color: '#25D366' },
}

// Aggregated per-channel publish outcome, shown after a publish completes.
interface PublishOutcome {
  title: string
  postCount: number
  perChannel: Record<string, { success: number; skipped: number; error: number; message: string | null }>
}

// A queue/published group — one campaign (all its days) or one event.
interface PubGroup {
  kind: 'campaign' | 'event'
  group_id: string
  title: string
  items: PublishingItem[]      // sorted by scheduled_at
  firstAt: string              // earliest scheduled_at (sort key)
}

function groupItems(items: PublishingItem[], status: string): PubGroup[] {
  const filtered = items.filter((i) => i.publish_status === status)
  const map = new Map<string, PubGroup>()
  for (const it of filtered) {
    const key = `${it.kind}_${it.group_id}`
    if (!map.has(key)) {
      map.set(key, { kind: it.kind, group_id: it.group_id, title: it.title, items: [], firstAt: it.scheduled_at ?? '' })
    }
    const g = map.get(key)!
    g.items.push(it)
    if ((it.scheduled_at ?? '') < g.firstAt || !g.firstAt) g.firstAt = it.scheduled_at ?? ''
  }
  const groups = [...map.values()]
  for (const g of groups) g.items.sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
  groups.sort((a, b) => a.firstAt.localeCompare(b.firstAt))
  return groups
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const [d, t] = iso.split('T')
  if (!d) return iso
  const [y, m, day] = d.split('-').map(Number)
  const label = new Date(y!, m! - 1, day!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return t ? `${label} · ${t.substring(0, 5)}` : label
}

// Current IST wall-clock as 'YYYY-MM-DDTHH:MM'. scheduled_at is stored as a
// naive IST string (dealer-local), so dueness must compare in the SAME zone —
// not UTC (toISOString), which was off by IST's +5:30 offset.
function nowIstMinute(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().substring(0, 16)
}

// Returns true when the group's earliest scheduled time has already passed.
function isGroupDue(g: PubGroup): boolean {
  if (!g.firstAt) return true   // no schedule → treat as immediately due
  return g.firstAt <= nowIstMinute()
}

function Publishing() {
  const { items, channels, campaigns } = Route.useLoaderData()
  const router = useRouter()

  // Only connected channels can be published to.
  const connectedChannels = useMemo(
    () => channels.filter((c: ChannelConnection) => c.status === 'connected').map((c) => c.channel),
    [channels],
  )
  const hasConnected = connectedChannels.length > 0

  // campaign_id → channels chosen for that campaign (the post↔channel link).
  const campaignChannelMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const c of campaigns) m[c.id] = c.channels ?? []
    return m
  }, [campaigns])

  const [busy, setBusy] = useState<string | null>(null)  // group key being acted on
  const [confirm, setConfirm] = useState<{ action: 'publish' | 'reject'; group: PubGroup } | null>(null)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(connectedChannels)
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null)

  const togglePlatform = (ch: string) =>
    setSelectedPlatforms((prev) => (prev.includes(ch) ? prev.filter((p) => p !== ch) : [...prev, ch]))

  // The backend auto-publisher flips due posts every ~60s; refetch on the same
  // cadence so Scheduled → Published moves appear without a manual reload.
  useEffect(() => {
    const id = setInterval(() => { void router.invalidate() }, 60_000)
    return () => clearInterval(id)
  }, [router])

  // Channels a group publishes to: the campaign's linked channels (or every
  // connected channel for events / unlinked campaigns), narrowed to connected +
  // currently selected. Disconnected channels are never targeted.
  const groupTargets = (g: PubGroup): string[] => {
    const linked = g.kind === 'campaign' ? (campaignChannelMap[g.group_id] ?? []) : []
    const eligible = linked.length > 0 ? linked.filter((c) => connectedChannels.includes(c)) : connectedChannels
    return eligible.filter((c) => selectedPlatforms.includes(c))
  }

  const queued = useMemo(() => groupItems(items, 'queued'), [items])
  const published = useMemo(() => {
    const gs = groupItems(items, 'published')
    gs.sort((a, b) => b.firstAt.localeCompare(a.firstAt))
    return gs
  }, [items])
  const rejected = useMemo(() => groupItems(items, 'rejected'), [items])

  const scheduledCount = items.filter((i) => i.publish_status === 'queued').length
  const publishedCount = items.filter((i) => i.publish_status === 'published').length

  const act = async (g: PubGroup, action: 'reject' | 'publish') => {
    const key = `${action}_${g.kind}_${g.group_id}`
    setConfirm(null)
    setBusy(key)
    try {
      if (action === 'reject') {
        if (g.kind === 'campaign') await rejectCampaign({ data: { campaign_id: g.group_id } })
        else await rejectEvent({ data: { id: g.group_id } })
        await router.invalidate()
      } else {
        // Publish only to the group's linked + connected + selected channels;
        // the backend re-validates each connection and skips unlinked ones.
        const platforms = groupTargets(g)
        if (platforms.length === 0) return
        const res = await publishGroupToConnected({
          data: { kind: g.kind, group_id: g.group_id, platforms },
        })
        await router.invalidate()
        setOutcome({ title: g.title, postCount: res.postCount, perChannel: res.perChannel })
      }
    } finally {
      setBusy(null)
    }
  }

  const GroupCard = ({ g, showActions }: { g: PubGroup; showActions: boolean }) => {
    const due = isGroupDue(g)
    const publishKey = `publish_${g.kind}_${g.group_id}`
    const rejectKey = `reject_${g.kind}_${g.group_id}`
    const isPublishing = busy === publishKey
    const isRejecting = busy === rejectKey
    const targets = groupTargets(g)
    const groupCanPublish = hasConnected && targets.length > 0

    return (
      <div className="rounded-[14px] border border-border bg-white overflow-hidden">
        {/* Group header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            {g.kind === 'campaign'
              ? <Car className="h-4 w-4 text-[#C3002F] shrink-0" />
              : <Star className="h-4 w-4 text-[#7C3AED] shrink-0" />}
            <span className="text-[13px] font-bold text-foreground truncate">{g.title}</span>
            <span className={cn(
              'shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase',
              g.kind === 'campaign' ? 'bg-[#FFF0F3] text-[#C3002F]' : 'bg-violet-100 text-violet-700',
            )}>
              {g.kind === 'campaign' ? `Campaign · ${g.items.length} posts` : 'Monthly Event'}
            </span>
            {/* Scheduled / Due Now status chip */}
            {showActions && (
              due
                ? <span className="shrink-0 flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase">
                    <AlertCircle className="h-2.5 w-2.5" /> Due Now
                  </span>
                : <span className="shrink-0 flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 uppercase">
                    <Clock className="h-2.5 w-2.5" /> Scheduled
                  </span>
            )}
          </div>

          {showActions && (
            <div className="flex items-center gap-2 shrink-0">
              {/* Destination channels this group will publish to */}
              {targets.length > 0 && (
                <div className="hidden items-center gap-1 sm:flex" title={`Publishes to ${targets.map((c) => CHANNEL_META[c]?.label ?? c).join(', ')}`}>
                  {targets.map((ch) => {
                    const meta = CHANNEL_META[ch] ?? { label: ch, color: '#6B7280' }
                    return <span key={ch} className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                  })}
                </div>
              )}
              <button
                onClick={() => setConfirm({ action: 'reject', group: g })}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-[8px] border border-red-300 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
              >
                {isRejecting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                Reject
              </button>

              {/* Publish Now — only when overdue; otherwise show auto-publish note.
                  Manual publish still requires connected + selected channels. */}
              {due ? (
                isPublishing ? (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#C3002F]">
                    <Loader2 className="h-3 w-3 animate-spin" /> Publishing…
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirm({ action: 'publish', group: g })}
                    disabled={busy !== null || !groupCanPublish}
                    title={!hasConnected
                      ? 'No connected channels available for publishing'
                      : !groupCanPublish
                        ? 'No connected channels selected for this post'
                        : `Publish to ${targets.map((c) => CHANNEL_META[c]?.label ?? c).join(', ')}`}
                    className="flex items-center gap-1.5 rounded-[8px] bg-[#C3002F] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#a50027] disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    <Send className="h-3 w-3" />
                    Publish Now
                  </button>
                )
              ) : (
                <span className="text-[10px] text-muted-foreground italic">
                  Auto-publishes {fmtDateTime(g.firstAt)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Posts (each scheduled slot) */}
        <div className="divide-y divide-border">
          {g.items.map((it, i) => {
            const itemNow = nowIstMinute()
            const itemDue = !it.scheduled_at || it.scheduled_at <= itemNow
            return (
              <div key={`${it.group_id}_${it.date}_${i}`} className="flex items-start gap-3 px-4 py-2.5">
                <span className="shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-[4px] bg-muted text-muted-foreground">
                  {g.kind === 'campaign' ? `D${it.day_num ?? i + 1}` : '★'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-foreground truncate">
                    {it.headline || it.theme || it.title}
                  </p>
                  {it.caption && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{it.caption}</p>
                  )}
                </div>
                <div className="shrink-0 text-right space-y-0.5">
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-foreground justify-end">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {fmtDateTime(it.publish_status === 'published' ? (it.published_at ?? it.scheduled_at) : it.scheduled_at)}
                  </p>
                  {it.vehicle && <p className="text-[10px] text-muted-foreground">{it.vehicle}</p>}
                  {/* Show per-item overdue badge for mixed campaigns */}
                  {showActions && it.publish_status !== 'published' && itemDue && (
                    <span className="text-[8px] font-bold text-amber-600 uppercase">overdue</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-foreground">Publishing</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Approved campaigns auto-publish at their scheduled time · overdue items can be published manually
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-[12px] border border-border bg-white px-4 py-2 text-center">
            <p className="text-[18px] font-bold text-foreground leading-tight">{scheduledCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Scheduled</p>
          </div>
          <div className="rounded-[12px] border border-border bg-white px-4 py-2 text-center">
            <p className="text-[18px] font-bold text-green-600 leading-tight">{publishedCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Published</p>
          </div>
        </div>
      </div>

      {/* Publish-target channels — only connected channels can be selected */}
      {!hasConnected ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="flex-1 text-[13px] font-medium text-amber-800">
            No connected channels available for publishing.
          </p>
          <Link
            to="/connected-channels"
            search={{} as any}
            className="flex items-center gap-1.5 rounded-[10px] bg-[#C3002F] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#a50027] transition"
          >
            <Link2 className="h-3.5 w-3.5" />
            Connect a channel
          </Link>
        </div>
      ) : (
        <div className="rounded-[12px] border border-border bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Send className="h-3.5 w-3.5 text-[#C3002F]" />
              <span className="text-[12px] font-semibold text-foreground">Publish to</span>
              <span className="text-[11px] text-muted-foreground">select connected channels to target</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {connectedChannels.map((ch) => {
                const meta = CHANNEL_META[ch] ?? { label: ch, color: '#6B7280' }
                const on = selectedPlatforms.includes(ch)
                return (
                  <button
                    key={ch}
                    onClick={() => togglePlatform(ch)}
                    className="flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[11px] font-semibold transition"
                    style={{
                      background: on ? meta.color : '#fff',
                      color: on ? '#fff' : '#6B7280',
                      borderColor: on ? meta.color : '#e5e7eb',
                    }}
                  >
                    {on ? <CheckCircle2 className="h-3 w-3" /> : <MinusCircle className="h-3 w-3" />}
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>
          {selectedPlatforms.filter((p) => connectedChannels.includes(p)).length === 0 && (
            <p className="mt-2 text-[11px] font-medium text-amber-600">
              Select at least one channel to enable publishing.
            </p>
          )}
        </div>
      )}

      {/* Queue */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays className="h-4 w-4 text-[#C3002F]" />
          <h2 className="text-[15px] font-bold text-foreground">Publishing Queue</h2>
          <span className="text-[11px] text-muted-foreground">ordered by scheduled date</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Future campaigns are auto-published at their scheduled time (reload to trigger). Overdue items show <span className="font-semibold text-amber-600">Due Now</span> and can be published manually.
        </p>
        {queued.length === 0 ? (
          <div className="rounded-[14px] border-2 border-dashed border-border bg-muted/10 px-6 py-10 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-[13px] font-semibold text-muted-foreground">Queue is empty</p>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              Approve a campaign or monthly event in Content Studio to schedule it here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {queued.map((g) => <GroupCard key={`${g.kind}_${g.group_id}`} g={g} showActions />)}
          </div>
        )}
      </div>

      {/* Published */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <h2 className="text-[15px] font-bold text-foreground">Published</h2>
        </div>
        {published.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nothing published yet.</p>
        ) : (
          <div className="space-y-3">
            {published.map((g) => <GroupCard key={`${g.kind}_${g.group_id}`} g={g} showActions={false} />)}
          </div>
        )}
      </div>

      {/* Rejected */}
      {rejected.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-4 w-4 text-red-500" />
            <h2 className="text-[15px] font-bold text-foreground">Rejected</h2>
          </div>
          <div className="space-y-3 opacity-70">
            {rejected.map((g) => <GroupCard key={`${g.kind}_${g.group_id}`} g={g} showActions={false} />)}
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirm !== null} onOpenChange={(v) => { if (!v) setConfirm(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              {confirm?.action === 'reject'
                ? <XCircle className="h-4 w-4 text-red-500" />
                : <Send className="h-4 w-4 text-[#C3002F]" />}
              {confirm?.action === 'reject' ? 'Reject campaign?' : 'Publish overdue posts?'}
            </DialogTitle>
          </DialogHeader>
          {confirm && (
            <div className="space-y-4">
              <p className="text-[13px] text-foreground leading-relaxed">
                {confirm.action === 'reject' ? 'Remove ' : 'Publish '}
                <span className="font-semibold">{confirm.group.title}</span>
                {confirm.group.kind === 'campaign'
                  ? ` — all ${confirm.group.items.length} scheduled posts`
                  : ' — this event post'}
                {confirm.action === 'reject' ? ' from the publishing queue?' : '?'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {confirm.action === 'reject'
                  ? 'Rejected posts will no longer be published. You can re-approve from Content Studio.'
                  : `Only posts whose scheduled time has passed will be published to ${groupTargets(confirm.group)
                      .map((p) => CHANNEL_META[p]?.label ?? p)
                      .join(', ')}. Future posts remain scheduled and auto-publish at their assigned time; disconnected channels are skipped automatically.`}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirm(null)}
                  className="rounded-[10px] border border-border px-4 py-2 text-[12px] font-semibold text-foreground hover:bg-muted transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => act(confirm.group, confirm.action)}
                  disabled={confirm.action === 'publish' && groupTargets(confirm.group).length === 0}
                  className={cn(
                    'rounded-[10px] px-4 py-2 text-[12px] font-semibold text-white transition disabled:opacity-60 disabled:cursor-not-allowed',
                    confirm.action === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#C3002F] hover:bg-[#a50027]',
                  )}
                >
                  {confirm.action === 'reject' ? 'Yes, reject' : 'Yes, publish now'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Per-channel publish results */}
      <Dialog open={outcome !== null} onOpenChange={(v) => { if (!v) setOutcome(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Send className="h-4 w-4 text-[#C3002F]" />
              Publish results
            </DialogTitle>
          </DialogHeader>
          {outcome && (
            <div className="space-y-3">
              <p className="text-[13px] text-foreground">
                <span className="font-semibold">{outcome.title}</span> — {outcome.postCount} post
                {outcome.postCount === 1 ? '' : 's'} sent to {Object.keys(outcome.perChannel).length} channel
                {Object.keys(outcome.perChannel).length === 1 ? '' : 's'}.
              </p>
              <div className="space-y-2">
                {Object.entries(outcome.perChannel).map(([ch, r]) => {
                  const meta = CHANNEL_META[ch] ?? { label: ch, color: '#6B7280' }
                  const status = r.error > 0 ? 'error' : r.success > 0 ? 'success' : 'skipped'
                  return (
                    <div key={ch} className="rounded-[10px] border border-border px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                          {meta.label}
                        </span>
                        {status === 'success' ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Published{r.success > 1 ? ` ×${r.success}` : ''}
                          </span>
                        ) : status === 'error' ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600">
                            <XCircle className="h-3.5 w-3.5" /> Failed{r.error > 1 ? ` ×${r.error}` : ''}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                            <MinusCircle className="h-3.5 w-3.5" /> Skipped
                          </span>
                        )}
                      </div>
                      {status !== 'success' && r.success > 0 && (
                        <p className="mt-1 text-[10px] font-medium text-green-600">{r.success} published on other posts</p>
                      )}
                      {r.message && (
                        <p className="mt-1 break-words text-[10px] text-muted-foreground">{r.message}</p>
                      )}
                    </div>
                  )
                })}
                {Object.keys(outcome.perChannel).length === 0 && (
                  <p className="text-[12px] text-muted-foreground">No channels were targeted.</p>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                <CheckCircle2 className="inline h-3 w-3 text-green-600" /> published ·{' '}
                <MinusCircle className="inline h-3 w-3" /> skipped (not connected / not supported yet) ·{' '}
                <XCircle className="inline h-3 w-3 text-red-600" /> failed
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => setOutcome(null)}
                  className="rounded-[10px] bg-[#C3002F] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#a50027] transition"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
