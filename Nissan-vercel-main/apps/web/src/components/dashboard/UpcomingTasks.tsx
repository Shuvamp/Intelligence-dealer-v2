import { Bell, CheckCircle2 } from 'lucide-react'
import { Panel, PanelHeader, Badge, timeAgo } from '#/components/ui/kit'
import type { NotificationRow } from '#/lib/types'

export function UpcomingTasks({ rows }: { rows: Array<NotificationRow> }) {
  return (
    <Panel className="fade-up" style={{ animationDelay: '280ms' }}>
      <PanelHeader
        title="Upcoming Tasks"
        kicker="Notifications"
        action={
          rows.some((r) => r.status === 'unread') ? (
            <Badge tone="brand">{rows.filter((r) => r.status === 'unread').length} new</Badge>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 px-5 py-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Bell className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-foreground">{row.title}</p>
                  {row.status === 'unread' ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full brand-bg" />
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                  {row.message}
                </p>
                <span className="text-[11px] text-muted-foreground/55">
                  {timeAgo(row.created_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <CheckCircle2 className="h-6 w-6 text-emerald-500/50" />
      <p className="text-[13px] text-muted-foreground">You’re all caught up.</p>
    </div>
  )
}
