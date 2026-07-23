import type { CSSProperties, ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import type { PublishNotification, SessionUser } from '#/lib/types'

export function AppShell({
  user,
  notifications,
  onSignOut,
  children,
}: {
  user: SessionUser
  notifications: Array<PublishNotification>
  onSignOut: () => void
  children: ReactNode
}) {
  // Tenant branding drives the accent color across the whole app.
  const brand = user.tenant.branding?.primary_color || '#c3002f'
  const style = { '--brand': brand } as CSSProperties

  return (
    <div style={style} className="flex h-screen overflow-hidden">
      <Sidebar tenant={user.tenant} />
      <div className="flex min-w-0 flex-1 flex-col app-canvas">
        <TopBar user={user} notifications={notifications} onSignOut={onSignOut} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1240px] px-6 py-7">{children}</div>
        </main>
      </div>
    </div>
  )
}
