import { Megaphone, CalendarClock, Bell, CheckCircle2, Clock } from 'lucide-react'
import { Panel, PanelHeader, Badge, timeAgo, formatINTime } from '#/components/ui/kit'
import { CHANNEL_COLORS } from '#/components/marketing/analytics/AnalyticsCharts'
import type { MarketingPulse as MarketingPulseData } from '#/lib/queries'
import type { CampaignPost, NotificationRow } from '#/lib/types'

const channelLabel = (c: string) =>
  ({ instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', google_business: 'Google Business', whatsapp: 'WhatsApp', x: 'X' } as Record<string, string>)[c]
  ?? c.charAt(0).toUpperCase() + c.slice(1)

function PostRow({ post }: { post: CampaignPost }) {
  const color = CHANNEL_COLORS[post.channel] ?? 'var(--brand)'
  const when = post.status === 'published' ? post.published_at : post.scheduled_at
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">
          {post.title || post.vehicle || 'Untitled post'}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          {channelLabel(post.channel)}
          {post.campaign_name ? ` · ${post.campaign_name}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={post.status === 'published' ? 'emerald' : 'sky'}>
          {post.status === 'published' ? 'Published' : 'Scheduled'}
        </Badge>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
          <Clock className="h-3 w-3" /> {formatINTime(when)}
        </span>
      </div>
    </li>
  )
}

function Section({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-5 pt-4 pb-1">
        {icon}
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="num ml-auto text-[12px] font-bold text-foreground">{count}</span>
      </div>
      {children}
    </div>
  )
}

export function MarketingPulse({
  pulse, notifications,
}: { pulse: MarketingPulseData; notifications: Array<NotificationRow> }) {
  const upcoming = pulse.upcoming.slice(0, 4)
  const reminders = notifications.slice(0, 4)
  return (
    <Panel className="fade-up h-full" style={{ animationDelay: '200ms' }}>
      <PanelHeader
        title="Marketing Pulse"
        kicker="Today · Upcoming · Reminders"
        action={pulse.pendingApproval > 0 ? <Badge tone="amber">{pulse.pendingApproval} to approve</Badge> : null}
      />

      <Section
        title="Today"
        icon={<Megaphone className="h-3.5 w-3.5 text-[var(--brand)]" />}
        count={pulse.today.length}
      >
        {pulse.today.length === 0 ? (
          <p className="px-5 py-3 text-[12.5px] text-muted-foreground">
            {pulse.publishedToday} published · {pulse.scheduledToday} scheduled today.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pulse.today.slice(0, 3).map((p) => <PostRow key={p.id} post={p} />)}
          </ul>
        )}
      </Section>

      <div className="border-t border-border">
        <Section
          title="Upcoming"
          icon={<CalendarClock className="h-3.5 w-3.5 text-sky-500" />}
          count={pulse.upcoming.length}
        >
          {upcoming.length === 0 ? (
            <p className="px-5 py-3 text-[12.5px] text-muted-foreground">No scheduled posts ahead.</p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((p) => <PostRow key={p.id} post={p} />)}
            </ul>
          )}
        </Section>
      </div>

      <div className="border-t border-border">
        <Section
          title="Reminders"
          icon={<Bell className="h-3.5 w-3.5 text-amber-500" />}
          count={notifications.filter((n) => n.status === 'unread').length}
        >
          {reminders.length === 0 ? (
            <div className="flex items-center gap-2 px-5 py-3 text-[12.5px] text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500/60" /> All caught up.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {reminders.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Bell className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-semibold text-foreground">{n.title}</p>
                      {n.status === 'unread' ? <span className="h-1.5 w-1.5 shrink-0 rounded-full brand-bg" /> : null}
                    </div>
                    <p className="truncate text-[12px] text-muted-foreground">{n.message}</p>
                    <span className="text-[11px] text-muted-foreground/55">{timeAgo(n.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Panel>
  )
}
