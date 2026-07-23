import type { PublishNotification, PublishPlatformResult } from './types'

// Pure derivation used by getPublishNotifications (lib/marketing.ts): turn one
// publishing row + the tenant's connected channels into a bell notification.
export interface PublishRowLike {
  kind: string
  group_id: string
  title?: string | null
  date?: string | number | null
  publish_status?: string | null
  published_at?: string | null
  scheduled_at?: string | null
  channel_status?: string | null
}

export function derivePublishNotification(
  row: PublishRowLike,
  connectedChannels: Array<string>,
): PublishNotification {
  let perChannel: Record<string, PublishPlatformResult> = {}
  try {
    const parsed = row.channel_status ? JSON.parse(row.channel_status) : null
    if (parsed && typeof parsed === 'object') perChannel = parsed
  } catch { /* malformed → treat as no per-channel detail */ }

  const posted: Array<string> = []
  const failed: PublishNotification['failed'] = []
  const missing: PublishNotification['missing'] = []
  for (const [channel, res] of Object.entries(perChannel)) {
    if (res.status === 'success') posted.push(channel)
    else if (res.status === 'error') failed.push({ channel, message: res.error ?? res.reason ?? null })
    else missing.push({ channel, message: res.reason ?? null })
  }
  // Connected channels this publish never touched at all. Only claimable when
  // the row actually recorded per-channel outcomes: the manual "Publish Now"
  // path (and an all-succeeded agent run) writes NO channel_status, so an empty
  // map means "no detail", not "nothing was posted".
  const hasDetail = Object.keys(perChannel).length > 0
  if (hasDetail) {
    for (const channel of connectedChannels) {
      if (!(channel in perChannel)) missing.push({ channel, message: 'Not included in this publish' })
    }
  }

  const tone: PublishNotification['tone'] =
    failed.length > 0 ? (posted.length > 0 ? 'partial' : 'error')
    : row.publish_status === 'failed' ? 'error'
    : missing.length > 0 && posted.length > 0 ? 'partial'
    : 'success'

  const date = String(row.date ?? '').substring(0, 10)
  return {
    id: `${row.kind}_${row.group_id}_${date}`,
    title: `${row.title ?? (row.kind === 'event' ? 'Event' : 'Campaign')}${date ? ` · ${date}` : ''}`,
    at: row.published_at ?? row.scheduled_at ?? new Date().toISOString(),
    tone,
    posted,
    failed,
    missing,
  }
}
