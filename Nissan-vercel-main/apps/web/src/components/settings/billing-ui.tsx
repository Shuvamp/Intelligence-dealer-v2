import { ArrowUpRight, Boxes, Check, CreditCard, Sparkles } from 'lucide-react'
import { Badge, Button, Panel } from '#/components/ui/kit'
import { planRank, type PlanInfo } from '#/lib/plans'
import type { SubscriptionPlan } from '#/lib/types'
import { cn } from '#/lib/utils'

// Enterprise carries the literal price "Custom" — every concrete price gets the /mo suffix.
function priceParts(price: string) {
  return { amount: price, suffix: price === 'Custom' ? null : '/mo' }
}

function FeatureRow({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full',
          muted
            ? 'bg-muted text-muted-foreground/70'
            : 'bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] brand-text',
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span className={cn('text-[13px] leading-snug', muted ? 'text-muted-foreground' : 'text-foreground')}>
        {label}
      </span>
    </li>
  )
}

function ModuleChips({ modules, muted }: { modules: Array<string>; muted?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {modules.map((m) => (
        <span
          key={m}
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
            muted
              ? 'border-border bg-muted/50 text-muted-foreground'
              : 'border-[color-mix(in_oklab,var(--brand)_22%,transparent)] bg-[color-mix(in_oklab,var(--brand)_7%,transparent)] text-foreground',
          )}
        >
          {m}
        </span>
      ))}
    </div>
  )
}

// The hero: the dealership's current plan, brand-accented.
export function CurrentPlanCard({ plan }: { plan: PlanInfo }) {
  const { amount, suffix } = priceParts(plan.price)
  return (
    <Panel
      className="fade-up relative overflow-hidden p-6 md:p-7"
      style={{ animationDelay: '60ms' }}
    >
      {/* Brand wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.9]"
        style={{
          background:
            'radial-gradient(680px 280px at 100% -20%, color-mix(in oklab, var(--brand) 12%, transparent), transparent 62%)',
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-full w-[4px] brand-bg"
      />
      <div className="relative grid gap-7 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div>
          <div className="flex items-center gap-2">
            <span className="kicker text-muted-foreground/70">Current plan</span>
            <Badge tone="brand">
              <Sparkles className="h-3 w-3" /> Active
            </Badge>
          </div>
          <div className="mt-2 flex items-end gap-3">
            <h2 className="font-display text-[30px] font-semibold leading-none tracking-tight text-foreground">
              {plan.name}
            </h2>
            <div className="num flex items-baseline gap-1 pb-0.5">
              <span className="text-[22px] font-bold text-foreground">{amount}</span>
              {suffix ? (
                <span className="text-[13px] font-medium text-muted-foreground">{suffix}</span>
              ) : null}
            </div>
          </div>
          <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            {plan.tagline}
          </p>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Boxes className="h-3.5 w-3.5" /> Included modules
            </div>
            <ModuleChips modules={plan.modules} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="brand" type="button">
              <CreditCard className="h-4 w-4" /> Manage billing
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              Next invoice renews monthly · cancel anytime
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/60 p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            What you get
          </div>
          <ul className="space-y-2.5">
            {plan.features.map((f) => (
              <FeatureRow key={f} label={f} />
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  )
}

// One card in the Compare-plans grid. State is mutually exclusive.
export function PlanCard({
  plan,
  current,
  delay,
}: {
  plan: PlanInfo
  current: SubscriptionPlan
  delay: number
}) {
  const isCurrent = planRank(plan.key) === planRank(current)
  const isIncluded = planRank(plan.key) < planRank(current)
  const isUpgrade = planRank(plan.key) > planRank(current)
  const showPopular = !!plan.highlight && !isCurrent
  const { amount, suffix } = priceParts(plan.price)

  return (
    <div
      className={cn(
        'fade-up relative flex flex-col rounded-xl border bg-card p-5 shadow-card transition',
        isCurrent
          ? 'border-transparent ring-2 ring-[var(--brand)]'
          : 'border-border hover:border-[color-mix(in_oklab,var(--brand)_30%,var(--border))]',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Top-right status tag */}
      <div className="absolute right-4 top-4">
        {isCurrent ? (
          <Badge tone="brand">Current plan</Badge>
        ) : showPopular ? (
          <Badge tone="amber">Popular</Badge>
        ) : null}
      </div>

      <div className="pr-20">
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{plan.name}</h3>
        <div className="num mt-1 flex items-baseline gap-1">
          <span className="text-[24px] font-bold leading-none text-foreground">{amount}</span>
          {suffix ? (
            <span className="text-[12px] font-medium text-muted-foreground">{suffix}</span>
          ) : null}
        </div>
      </div>
      <p className="mt-2 min-h-[34px] text-[12.5px] leading-snug text-muted-foreground">
        {plan.tagline}
      </p>

      <div className="my-4 h-px bg-border" />

      <ul className="space-y-2">
        {plan.features.map((f) => (
          <FeatureRow key={f} label={f} muted={isIncluded} />
        ))}
      </ul>

      <div className="mt-4">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Unlocks
        </div>
        <ModuleChips modules={plan.modules} muted={isIncluded} />
      </div>

      <div className="mt-5 pt-1">
        {isCurrent ? (
          <div className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--brand)_22%,transparent)] bg-[color-mix(in_oklab,var(--brand)_8%,transparent)] text-sm font-semibold brand-text">
            <Check className="h-4 w-4" strokeWidth={3} /> Your plan
          </div>
        ) : isUpgrade ? (
          <Button variant="brand" type="button" className="w-full">
            Upgrade <ArrowUpRight className="h-4 w-4" />
          </Button>
        ) : (
          <div className="flex h-10 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
            Included
          </div>
        )}
      </div>
    </div>
  )
}
