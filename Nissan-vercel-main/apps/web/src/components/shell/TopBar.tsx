import { Search, Bell, LogOut } from 'lucide-react'
import { initials } from '#/components/ui/kit'
import type { SessionUser } from '#/lib/types'

const ROLE_LABEL: Record<string, string> = {
  dealer_owner: 'Owner',
  dealer_manager: 'Manager',
  sales_executive: 'Sales Executive',
  marketing_executive: 'Marketing Executive',
}

export function TopBar({
  user,
  unread,
  onSignOut,
}: {
  user: SessionUser
  unread: number
  onSignOut: () => void
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-card/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <span className="text-[15px] font-bold tracking-tight text-foreground">
          {user.tenant.name}
        </span>
        <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground sm:inline">
          {user.tenant.brand}
        </span>
      </div>

      <div className="relative ml-2 hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search leads, customers, campaigns…"
          className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          className="relative grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full brand-bg px-1 text-[10px] font-bold leading-none">
              {unread}
            </span>
          ) : null}
        </button>

        <div className="mx-1 h-7 w-px bg-border" />

        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full brand-bg text-[13px] font-bold">
            {initials(user.profile.full_name)}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-[13px] font-semibold text-foreground">
              {user.profile.full_name}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {ROLE_LABEL[user.profile.role] ?? user.profile.role}
            </div>
          </div>
        </div>

        <button
          onClick={onSignOut}
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  )
}
