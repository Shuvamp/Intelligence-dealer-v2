import { createFileRoute } from '@tanstack/react-router'
import { Car, Phone, Plus } from 'lucide-react'
import { getCustomers } from '#/lib/queries'
import { Panel, Badge, Button, initials } from '#/components/ui/kit'
import type { Customer } from '#/lib/types'

export const Route = createFileRoute('/_authed/customers')({
  loader: async () => ({ customers: await getCustomers() }),
  component: CustomersPage,
})

const CHANNEL_TONE: Record<string, 'sky' | 'rose' | 'amber' | 'emerald' | 'neutral'> = {
  instagram: 'rose',
  facebook: 'sky',
  website: 'emerald',
  'walk-in': 'amber',
}

function CustomersPage() {
  const { customers } = Route.useLoaderData()

  return (
    <div className="fade-up space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="kicker text-muted-foreground/70">Customer 360</div>
          <h1 className="mt-1 text-[26px] font-bold tracking-tight text-foreground">Customers</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {customers.length} {customers.length === 1 ? 'customer' : 'customers'} · the
            canonical record every module connects to
          </p>
        </div>
        <Button variant="brand">
          <Plus className="h-4 w-4" /> Add customer
        </Button>
      </div>

      <Panel className="overflow-hidden">
        <div className="grid grid-cols-[1.6fr_1.2fr_1fr_0.8fr] gap-3 border-b border-border bg-muted/40 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Customer</div>
          <div>Contact</div>
          <div>Interest</div>
          <div>Source</div>
        </div>

        {customers.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">
            No customers yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {customers.map((c) => (
              <CustomerRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function CustomerRow({ c }: { c: Customer }) {
  return (
    <li
      data-testid="customer-row"
      className="grid grid-cols-[1.6fr_1.2fr_1fr_0.8fr] items-center gap-3 px-5 py-3 transition hover:bg-muted/30"
    >
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] text-[12px] font-bold brand-text">
          {initials(c.full_name)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-foreground">
            {c.full_name}
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {c.email || 'No email on file'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Phone className="h-3.5 w-3.5" />
        {c.phone || '—'}
      </div>
      <div className="flex items-center gap-1.5 text-[13px] text-foreground">
        <Car className="h-3.5 w-3.5 text-muted-foreground" />
        {c.preferred_vehicle || '—'}
      </div>
      <div>
        {c.source_channel ? (
          <Badge tone={CHANNEL_TONE[c.source_channel] ?? 'neutral'}>
            {c.source_channel}
          </Badge>
        ) : (
          <span className="text-[12px] text-muted-foreground">—</span>
        )}
      </div>
    </li>
  )
}
