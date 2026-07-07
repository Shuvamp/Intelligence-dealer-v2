import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, UserPlus, Loader2, CheckCircle2 } from 'lucide-react'
import { submitLead } from '#/lib/intake'
import { Button } from '#/components/ui/kit'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_authed/leads/new')({
  component: AddLeadPage,
})

const VEHICLES = [
  'Nissan Magnite',
  'Nissan Kicks',
  'Nissan X-Trail',
  'Nissan Terrano',
  'Nissan Sunny',
  'Other / Not sure yet',
]

const SOURCES = [
  { value: 'walkin', label: 'Walk-in' },
  { value: 'phone', label: 'Phone call' },
  { value: 'referral', label: 'Referral' },
  { value: 'event', label: 'Event / Expo' },
  { value: 'website', label: 'Website' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
]

const BUDGET_BANDS = [
  { label: 'Under ₹8 L', value: '700000' },
  { label: '₹8 – 12 L', value: '1000000' },
  { label: '₹12 – 18 L', value: '1500000' },
  { label: '₹18 – 25 L', value: '2100000' },
  { label: 'Above ₹25 L', value: '2800000' },
]

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground/50 focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_20%,transparent)] transition'
const SELECT = `${INPUT} cursor-pointer`

function AddLeadPage() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    vehicle: '',
    source: 'walkin' as string,
    budget: '',
    test_drive: false,
    buy_timeline_days: '30',
    city: '',
    notes: '',
  })

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Name and phone are required.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await submitLead({
        data: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          vehicle: form.vehicle || undefined,
          source: (form.source as 'website' | 'facebook' | 'instagram' | 'walkin' | 'phone' | 'referral' | 'event') || 'walkin',
          budget: form.budget ? Number(form.budget) : undefined,
          test_drive: form.test_drive,
          buy_timeline_days: form.buy_timeline_days ? Number(form.buy_timeline_days) : undefined,
          city: form.city.trim() || undefined,
        },
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lead.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg pt-16 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h2 className="font-display text-[22px] font-semibold text-foreground">Lead created</h2>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          The lead has been scored and assigned by the intake pipeline.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" onClick={() => void navigate({ to: '/leads' })}>
            View pipeline
          </Button>
          <Button
            variant="brand"
            onClick={() => {
              setDone(false)
              setForm({ name: '', phone: '', email: '', vehicle: '', source: 'walkin', budget: '', test_drive: false, buy_timeline_days: '30', city: '', notes: '' })
            }}
          >
            Add another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="fade-up flex items-center gap-3">
        <button
          type="button"
          onClick={() => void navigate({ to: '/leads' })}
          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <div className="kicker text-muted-foreground/70">Pipeline</div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">Add lead</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="fade-up space-y-6" style={{ animationDelay: '60ms' }}>
        {/* Customer details */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Customer</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <input
                className={INPUT}
                placeholder="e.g. Ravi Kumar"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
            <Field label="Phone" required>
              <input
                className={INPUT}
                placeholder="+91 98765 43210"
                type="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                className={INPUT}
                placeholder="ravi@email.com"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>
            <Field label="City">
              <input
                className={INPUT}
                placeholder="Chennai"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* Lead details */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Lead details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vehicle interest">
              <select
                className={SELECT}
                value={form.vehicle}
                onChange={(e) => set('vehicle', e.target.value)}
              >
                <option value="">Select vehicle…</option>
                {VEHICLES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Lead source">
              <select
                className={SELECT}
                value={form.source}
                onChange={(e) => set('source', e.target.value)}
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Budget">
              <select
                className={SELECT}
                value={form.budget}
                onChange={(e) => set('budget', e.target.value)}
              >
                <option value="">Select range…</option>
                {BUDGET_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Buy timeline">
              <select
                className={SELECT}
                value={form.buy_timeline_days}
                onChange={(e) => set('buy_timeline_days', e.target.value)}
              >
                <option value="7">Within a week</option>
                <option value="30">This month</option>
                <option value="90">1 – 3 months</option>
                <option value="180">3 – 6 months</option>
                <option value="365">6+ months</option>
              </select>
            </Field>
          </div>

          {/* Test drive checkbox */}
          <label className="mt-4 flex cursor-pointer items-center gap-3">
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition',
                form.test_drive
                  ? 'border-[var(--brand)] bg-[var(--brand)]'
                  : 'border-border bg-background',
              )}
              onClick={() => set('test_drive', !form.test_drive)}
            >
              {form.test_drive && (
                <svg viewBox="0 0 12 10" fill="none" className="h-3 w-3 text-white">
                  <path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="text-[13.5px] text-foreground">Test drive requested</span>
          </label>
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pb-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigate({ to: '/leads' })}
          >
            Cancel
          </Button>
          <Button type="submit" variant="brand" disabled={submitting}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
            ) : (
              <><UserPlus className="h-4 w-4" /> Create lead</>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
