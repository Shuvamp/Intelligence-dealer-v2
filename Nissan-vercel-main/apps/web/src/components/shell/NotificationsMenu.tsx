import { useEffect, useState } from 'react'
import { Popover } from 'radix-ui'
import { Bell, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { timeAgo } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import type { PublishNotification } from '#/lib/types'

const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  google_business: 'Google Business',
  whatsapp: 'WhatsApp',
}
const label = (c: string) => CHANNEL_LABEL[c] ?? c

const TONE_ICON = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  partial: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
}

// "Seen" lives in localStorage — publish outcomes are derived on read, so there
// is no row to mark read. ponytail: per-device only, move to a table if the
// dealer needs read state shared across devices.
const SEEN_KEY = 'publish-notifications-seen-at'

export function NotificationsMenu({ items }: { items: Array<PublishNotification> }) {
  const [seenAt, setSeenAt] = useState<string>('')

  useEffect(() => {
    setSeenAt(localStorage.getItem(SEEN_KEY) ?? '')
  }, [])

  const unread = items.filter((n) => n.at > seenAt).length

  function markSeen() {
    const now = new Date().toISOString()
    localStorage.setItem(SEEN_KEY, now)
    setSeenAt(now)
  }

  return (
    <Popover.Root onOpenChange={(open) => { if (open && unread > 0) markSeen() }}>
      <Popover.Trigger
        className="relative grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 ? (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full brand-bg px-1 text-[10px] font-bold leading-none">
            {unread}
          </span>
        ) : null}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[340px] rounded-xl border border-border bg-card p-1.5 shadow-card"
        >
          <div className="px-2.5 py-2 text-[12px] font-semibold text-muted-foreground">
            Publishing activity
          </div>

          {items.length === 0 ? (
            <div className="px-2.5 pb-4 pt-2 text-center text-[13px] text-muted-foreground">
              Nothing published yet
            </div>
          ) : (
            <ul className="max-h-[420px] space-y-0.5 overflow-y-auto">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'flex gap-2.5 rounded-lg px-2.5 py-2',
                    n.at > seenAt && 'bg-muted/60',
                  )}
                >
                  <div className="pt-0.5">{TONE_ICON[n.tone]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-foreground">
                      {n.title}
                    </div>
                    {n.posted.length > 0 ? (
                      <div className="mt-0.5 text-[12px] text-foreground/80">
                        Posted to {n.posted.map(label).join(', ')}
                      </div>
                    ) : n.failed.length === 0 && n.missing.length === 0 ? (
                      // Published with no per-channel detail recorded.
                      <div className="mt-0.5 text-[12px] text-foreground/80">Published</div>
                    ) : null}
                    {n.failed.map((f) => (
                      <div key={f.channel} className="mt-0.5 text-[12px] text-destructive">
                        {label(f.channel)} failed{f.message ? ` — ${f.message}` : ''}
                      </div>
                    ))}
                    {n.missing.length > 0 && (
                      <div className="mt-0.5 text-[12px] text-amber-600">
                        Not posted to {n.missing.map((m) => label(m.channel)).join(', ')}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-muted-foreground">{timeAgo(n.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
