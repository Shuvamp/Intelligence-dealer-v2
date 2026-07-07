import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { Pencil, UserPlus, MapPin, Plus, Building2, ArrowRight } from 'lucide-react'
import { getDealershipSettings } from '#/lib/account'
import { planByKey } from '#/lib/plans'
import { Panel, PanelHeader, Badge, Button, initials } from '#/components/ui/kit'
import type { UserRole } from '#/lib/types'

export const Route = createFileRoute('/_authed/settings')({
  loader: async () => ({ settings: await getDealershipSettings() }),
  component: SettingsPage,
})

const authed = getRouteApi('/_authed')
const ROLE_LABEL: Record<UserRole, string> = {
  dealer_owner: 'Owner',
  dealer_manager: 'Manager',
  sales_executive: 'Sales Executive',
  marketing_executive: 'Marketing Executive',
}

function SettingsPage() {
  const { user } = authed.useRouteContext()
  const { settings } = Route.useLoaderData()
  const tenant = user.tenant
  const plan = planByKey(tenant.subscription_plan)
  const brand = tenant.branding?.primary_color || '#c3002f'

  return (
    <div className="space-y-7">
      <header className="fade-up">
        <div className="kicker text-muted-foreground/70">Settings</div>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">Manage your profile, team and dealership</p>
      </header>

      <div className="grid grid-cols-12 gap-5">
        {/* Your profile */}
        <Panel className="fade-up col-span-12 p-5 lg:col-span-6">
          <div className="flex items-start justify-between">
            <div className="kicker text-muted-foreground/60">Your profile</div>
            <Button variant="outline" className="h-8 px-3 text-[12.5px]">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full brand-bg text-[18px] font-bold">
              {initials(user.profile.full_name)}
            </div>
            <div>
              <div className="text-[16px] font-semibold text-foreground">{user.profile.full_name}</div>
              <div className="text-[13px] text-muted-foreground">{user.profile.email}</div>
              <div className="mt-1.5">
                <Badge tone="brand">{ROLE_LABEL[user.profile.role]}</Badge>
              </div>
            </div>
          </div>
        </Panel>

        {/* Dealership */}
        <Panel className="fade-up col-span-12 p-5 lg:col-span-6" style={{ animationDelay: '80ms' }}>
          <div className="flex items-start justify-between">
            <div className="kicker text-muted-foreground/60">Dealership</div>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className="h-3 w-3 rounded-full" style={{ background: brand }} /> Brand color
            </span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg text-white" style={{ background: brand }}>
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-foreground">{tenant.name}</div>
              <div className="text-[12.5px] text-muted-foreground">
                {tenant.brand} · {settings.locations.length} location{settings.locations.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <Link
            to="/subscription"
            className="mt-4 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 transition hover:bg-muted/60"
          >
            <span className="text-[13px]">
              <span className="font-semibold text-foreground">{plan.name} plan</span>{' '}
              <span className="text-muted-foreground">· {plan.price}/mo</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold brand-text">
              Manage <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </Panel>
      </div>

      {/* Locations */}
      <Panel className="fade-up" style={{ animationDelay: '120ms' }}>
        <PanelHeader
          title="Locations"
          kicker={`${settings.locations.length} showrooms`}
          action={
            <Button variant="outline" className="h-8 px-3 text-[12.5px]">
              <Plus className="h-3.5 w-3.5" /> Add location
            </Button>
          }
        />
        <ul className="divide-y divide-border">
          {settings.locations.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                </span>
                <span className="text-[13.5px] font-medium text-foreground">{l.name}</span>
              </div>
              <Badge tone={l.status === 'active' ? 'emerald' : 'neutral'}>{l.status}</Badge>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Team */}
      <Panel className="fade-up" style={{ animationDelay: '160ms' }}>
        <PanelHeader
          title="Team members"
          kicker={`${settings.team.length} users`}
          action={
            <Button variant="brand" className="h-8 px-3 text-[12.5px]">
              <UserPlus className="h-3.5 w-3.5" /> Invite member
            </Button>
          }
        />
        <ul className="divide-y divide-border">
          {settings.team.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-5 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] text-[12px] font-bold brand-text">
                {initials(m.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-foreground">{m.full_name}</div>
                <div className="truncate text-[12px] text-muted-foreground">{m.email}</div>
              </div>
              <Badge tone="neutral">{ROLE_LABEL[m.role]}</Badge>
              <Badge tone={m.status === 'active' ? 'emerald' : 'amber'}>{m.status}</Badge>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
