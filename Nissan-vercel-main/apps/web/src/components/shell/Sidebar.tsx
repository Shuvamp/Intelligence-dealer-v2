'use client'

import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Lock, Gauge, ChevronDown } from 'lucide-react'
import { NAV_ITEMS, planAllows } from './nav-items'
import { cn } from '#/lib/utils'
import type { Tenant } from '#/lib/types'

export function Sidebar({ tenant }: { tenant: Tenant }) {
  const main = NAV_ITEMS.filter((i) => i.group === 'main')
  const system = NAV_ITEMS.filter((i) => i.group === 'system')

  return (
    <aside className="flex h-full w-[252px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg brand-bg shadow-sm">
          <Gauge className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold tracking-tight text-white">
            Dealer Intelligence
          </div>
          <div className="text-[11px] text-sidebar-foreground/70">OS · {tenant.brand}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        <NavGroup label="Workspace" items={main} plan={tenant.subscription_plan} />
        <NavGroup label="System" items={system} plan={tenant.subscription_plan} />
      </nav>

      <div className="px-5 py-4 text-[11px] text-sidebar-foreground/50">
        <PlanChip plan={tenant.subscription_plan} /> plan
      </div>
    </aside>
  )
}

function NavGroup({
  label,
  items,
  plan,
}: {
  label: string
  items: typeof NAV_ITEMS
  plan: Tenant['subscription_plan']
}) {
  return (
    <div>
      <div className="kicker px-3 pb-2 text-sidebar-foreground/45">{label}</div>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const allowed = planAllows(plan, item.minPlan)
          const Icon = item.icon
          if (!allowed) {
            return (
              <li key={item.to}>
                <div
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-sidebar-foreground/35"
                  title={`Requires ${item.minPlan} plan`}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  <span className="flex-1">{item.label}</span>
                  <Lock className="h-3.5 w-3.5" />
                </div>
              </li>
            )
          }
          if (item.children) {
            return <ExpandableNavItem key={item.to} item={item} />
          }
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-sidebar-foreground/80 transition hover:bg-sidebar-accent hover:text-white"
                activeProps={{
                  className: cn(
                    'bg-sidebar-accent text-white',
                    'relative before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--brand)]',
                  ),
                }}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ExpandableNavItem({ item }: { item: (typeof NAV_ITEMS)[number] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Active when the current path is under this item's top-level section — derived
  // from item.to so any expandable nav works (Marketing, Context Planner, …).
  const base = `/${item.to.split('/')[1] ?? ''}`
  const isActive = pathname === base || pathname.startsWith(`${base}/`)
  const [open, setOpen] = useState(isActive)
  const Icon = item.icon

  return (
    <li>
      <div className="flex items-center">
        <Link
          to={item.to}
          onClick={() => setOpen(true)}
          className={cn(
            'flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition hover:bg-sidebar-accent hover:text-white',
            isActive
              ? 'bg-sidebar-accent text-white relative before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--brand)]'
              : 'text-sidebar-foreground/80',
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
          <span className="flex-1">{item.label}</span>
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/60 hover:text-white transition"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
            strokeWidth={2}
          />
        </button>
      </div>

      {open && item.children && (
        <ul className="mt-0.5 space-y-0.5 pl-9">
          {item.children.map((child) => (
            <li key={child.to}>
              <Link
                to={child.to}
                className="flex items-center rounded-md px-3 py-1.5 text-[12.5px] font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-white"
                activeOptions={{ exact: true }}
                activeProps={{ className: 'text-white bg-sidebar-accent/60' }}
              >
                {child.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function PlanChip({ plan }: { plan: Tenant['subscription_plan'] }) {
  return (
    <span className="font-semibold capitalize text-sidebar-foreground/80">{plan}</span>
  )
}
