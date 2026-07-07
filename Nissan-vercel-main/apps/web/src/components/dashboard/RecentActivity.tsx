import { Activity } from 'lucide-react'
import { Panel, PanelHeader, timeAgo } from '#/components/ui/kit'
import type { AuditRow } from '#/lib/types'

function describe(row: AuditRow) {
  const who = (row.metadata?.actor as string) || ''
  const what = (row.metadata?.summary as string) || row.action.replace(/[._]/g, ' ')
  return { who, what }
}

export function RecentActivity({ rows }: { rows: Array<AuditRow> }) {
  return (
    <Panel className="fade-up" style={{ animationDelay: '220ms' }}>
      <PanelHeader title="Recent Activity" kicker="Live · Audit log" />
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ul className="px-5 py-1.5">
          {rows.map((row, i) => {
            const { who, what } = describe(row)
            return (
              <li key={row.id} className="flex gap-3 py-2.5">
                <div className="relative flex flex-col items-center">
                  <span className="mt-1.5 h-2 w-2 rounded-full brand-bg" />
                  {i < rows.length - 1 ? (
                    <span className="mt-1 w-px flex-1 bg-border" />
                  ) : null}
                </div>
                <div className="min-w-0 pb-0.5">
                  <p className="text-[13px] leading-snug text-foreground">
                    {who ? <span className="font-semibold">{who} </span> : null}
                    <span className="text-muted-foreground">{what}</span>
                  </p>
                  <span className="text-[11px] text-muted-foreground/60">
                    {timeAgo(row.created_at)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <Activity className="h-6 w-6 text-muted-foreground/40" />
      <p className="text-[13px] text-muted-foreground">No recent activity yet.</p>
    </div>
  )
}
