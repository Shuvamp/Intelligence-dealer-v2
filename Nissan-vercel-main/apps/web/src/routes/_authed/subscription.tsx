import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { getAccountUsage } from '#/lib/subscription'
import { PLANS, planByKey } from '#/lib/plans'
import { StatTile } from '#/components/intelligence/intelligence-ui'
import { CurrentPlanCard, PlanCard } from '#/components/settings/billing-ui'

export const Route = createFileRoute('/_authed/subscription')({
  loader: async () => ({ usage: await getAccountUsage() }),
  component: SubscriptionPage,
})

const authed = getRouteApi('/_authed')

function SubscriptionPage() {
  const { user } = authed.useRouteContext()
  const { usage } = Route.useLoaderData()
  const currentPlan = planByKey(usage.plan)

  return (
    <div className="space-y-7">
      <header className="fade-up">
        <div className="kicker text-muted-foreground/70">Subscription</div>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-foreground">
          Subscription &amp; Billing
        </h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Plan, usage and billing for {user.tenant.name}
        </p>
      </header>

      <CurrentPlanCard plan={currentPlan} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Usage this period</h2>
          <span className="text-[12px] text-muted-foreground">Live counts across your account</span>
        </div>
        <div className="fade-up grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" style={{ animationDelay: '120ms' }}>
          <StatTile label="Team Members" value={usage.users.toLocaleString('en-IN')} sub="active users" accent="brand" />
          <StatTile label="Locations" value={usage.locations.toLocaleString('en-IN')} sub="showrooms" accent="sky" />
          <StatTile label="Customers" value={usage.customers.toLocaleString('en-IN')} sub="in Customer 360" accent="emerald" />
          <StatTile label="Leads" value={usage.leads.toLocaleString('en-IN')} sub="all-time" accent="amber" />
          <StatTile label="Campaigns" value={usage.campaigns.toLocaleString('en-IN')} sub="marketing" accent="brand" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Compare plans</h2>
          <span className="text-[12px] text-muted-foreground">Upgrade to unlock more modules</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p, i) => (
            <PlanCard key={p.key} plan={p} current={usage.plan} delay={120 + i * 60} />
          ))}
        </div>
      </section>

      <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        Module access is enforced by your plan — locked modules appear greyed in the sidebar.
      </p>
    </div>
  )
}
