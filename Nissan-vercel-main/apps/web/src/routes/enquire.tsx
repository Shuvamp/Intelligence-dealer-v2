import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Car, ArrowLeft, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { submitLead } from '#/lib/intake'
import type { LeadInput } from '#/lib/intake'
import { Button } from '#/components/ui/kit'

export const Route = createFileRoute('/enquire')({
  component: EnquirePage,
})

const VEHICLES = [
  'Nissan Magnite',
  'Nissan Kicks',
  'Nissan Tekton',
  'Nissan X-Trail',
  'Nissan Terrano',
  'Nissan Sunny',
  'Other / Not sure yet',
]

const BUDGET_BANDS = [
  { label: 'Under ₹8 Lakh', value: '700000' },
  { label: '₹8 – 12 Lakh', value: '1000000' },
  { label: '₹12 – 18 Lakh', value: '1500000' },
  { label: '₹18 – 25 Lakh', value: '2100000' },
  { label: 'Above ₹25 Lakh', value: '2800000' },
]
const BUY_TIMELINE = [
  { label: 'Immediately (within a week)', value: '7' },
  { label: 'This month', value: '30' },
  { label: 'In 1 – 3 months', value: '90' },
  { label: 'In 3 – 6 months', value: '180' },
  { label: 'Just exploring', value: '365' },
]
const CALLBACK = [
  { label: 'Today', value: '1' },
  { label: 'Within 2 days', value: '2' },
  { label: 'This week', value: '7' },
  { label: 'No rush', value: '14' },
]
const CONTACT_MEDIUM = ['WhatsApp', 'Phone call', 'Email', 'SMS']

// Indicative on-road price ranges — shown as a hint so the budget the customer
// picks aligns with the model. A budget far below the model's price tanks the
// scoring agent's financial_readiness + product_fit dimensions.
const VEHICLE_PRICE: Record<string, string> = {
  'Nissan Magnite': '₹6 – 11 Lakh',
  'Nissan Kicks': '₹10 – 16 Lakh',
  'Nissan Tekton': 'Price details on request',
  'Nissan X-Trail': '₹36 – 50 Lakh',
  'Nissan Terrano': '₹10 – 16 Lakh',
  'Nissan Sunny': '₹9 – 14 Lakh',
}

// Each of these maps to a scoring dimension the agent otherwise can't read from a
// first-touch website lead (financial readiness / relationship / urgency).
const FINANCING = [
  { label: 'Paying by cash / own funds', value: 'cash' },
  { label: 'Car loan already approved', value: 'pre_approved' },
  { label: "I'll need a car loan", value: 'loan_needed' },
  { label: "Haven't decided yet", value: 'unsure' },
]
const RELATIONSHIP = [
  { label: 'I currently own a Nissan', value: 'current_owner' },
  { label: "I've owned / serviced one before", value: 'past_owner' },
  { label: 'A friend or family referred me', value: 'referred' },
  { label: "I'm new to Nissan", value: 'new' },
]
const PURCHASE_REASON = [
  { label: 'Replacing my current car', value: 'replacement' },
  { label: 'For a wedding / festival', value: 'occasion' },
  { label: 'Business use', value: 'business' },
  { label: 'My first car', value: 'first_car' },
  { label: 'Just researching for now', value: 'researching' },
]

function EnquirePage() {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    vehicle: '',
    city: '',
    test_drive: 'yes',
    budget: '',
    buy_timeline_days: '',
    callback_days: '',
    contact_medium: '',
    financing: '',
    nissan_relationship: '',
    brand_consideration: 'only_nissan',
    comparing_brands: '',
    purchase_reason: '',
  })
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg(null)
    try {
      await submitLead({
        data: {
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          vehicle: form.vehicle || undefined,
          city: form.city || undefined,
          test_drive: form.test_drive === 'yes',
          budget: form.budget ? Number(form.budget) : undefined,
          buy_timeline_days: form.buy_timeline_days ? Number(form.buy_timeline_days) : undefined,
          callback_days: form.callback_days ? Number(form.callback_days) : undefined,
          contact_medium: form.contact_medium || undefined,
          financing: (form.financing || undefined) as LeadInput['financing'],
          nissan_relationship: (form.nissan_relationship || undefined) as LeadInput['nissan_relationship'],
          brand_consideration: form.brand_consideration as LeadInput['brand_consideration'],
          comparing_brands:
            form.brand_consideration === 'comparing' ? form.comparing_brands || undefined : undefined,
          purchase_reason: (form.purchase_reason || undefined) as LeadInput['purchase_reason'],
          source: 'website',
        },
      })
      setStatus('success')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h2 className="text-[22px] font-bold text-foreground">Enquiry received!</h2>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Our team will reach out within 24 hours to discuss your requirements.
          </p>
          <Button variant="brand" className="mt-6 w-full" onClick={() => setStatus('idle')}>
            Submit another enquiry
          </Button>
          <Link
            to="/login"
            className="mt-3 block text-[13px] text-muted-foreground hover:text-foreground"
          >
            Sign in to the dealer portal
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg brand-bg">
          <Car className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
        <span className="text-[14px] font-bold tracking-tight text-foreground">
          Nissan — Dealer Intelligence
        </span>
        <Link
          to="/login"
          className="ml-auto flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sign in
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10">
        <div className="w-full max-w-md">
          {/* Hero */}
          <div className="mb-8">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-[11.5px] font-semibold text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Quick 2-minute form
            </div>
            <h1 className="font-display text-[30px] font-bold leading-tight text-foreground">
              Enquire Now
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              Tell us what you're looking for and our Nissan team will get in touch with the best options for you.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            {/* Contact details section */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Your details
              </p>
              <Field label="Full name *">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  className="input"
                  placeholder="e.g. Ravi Kumar"
                  required
                  autoComplete="name"
                />
              </Field>
              <Field label="Phone number *">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  className="input"
                  placeholder="+91 99999 99999"
                  required
                  autoComplete="tel"
                />
              </Field>
              <Field label="Email address">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  className="input"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </Field>
              <Field label="City">
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  className="input"
                  placeholder="Chennai"
                  autoComplete="address-level2"
                />
              </Field>
            </div>

            {/* Vehicle preference section */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Vehicle preference
              </p>
              <Field label="Which model interests you?">
                <select
                  value={form.vehicle}
                  onChange={(e) => update('vehicle', e.target.value)}
                  className="input"
                >
                  <option value="">— Select a model —</option>
                  {VEHICLES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                {VEHICLE_PRICE[form.vehicle] ? (
                  <span className="mt-1.5 block text-[11.5px] text-muted-foreground">
                    Typical on-road price: <span className="font-semibold text-foreground">{VEHICLE_PRICE[form.vehicle]}</span> — pick a matching budget below.
                  </span>
                ) : null}
              </Field>
              <Field label="Would you like a test drive?">
                <div className="flex gap-2">
                  {(['yes', 'no'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => update('test_drive', opt)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold capitalize transition ${
                        form.test_drive === opt
                          ? 'border-transparent brand-bg text-white'
                          : 'border-border text-foreground hover:bg-muted'
                      }`}
                    >
                      {opt === 'yes' ? 'Yes, please' : 'No thanks'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Expected budget">
                <select
                  value={form.budget}
                  onChange={(e) => update('budget', e.target.value)}
                  className="input"
                >
                  <option value="">— Select a budget range —</option>
                  {BUDGET_BANDS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="When are you planning to buy?">
                <select
                  value={form.buy_timeline_days}
                  onChange={(e) => update('buy_timeline_days', e.target.value)}
                  className="input"
                >
                  <option value="">— Select a timeframe —</option>
                  {BUY_TIMELINE.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Contact preference section */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                How should we reach you?
              </p>
              <Field label="Best time to call you back">
                <select
                  value={form.callback_days}
                  onChange={(e) => update('callback_days', e.target.value)}
                  className="input"
                >
                  <option value="">— Select —</option>
                  {CALLBACK.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Preferred contact method">
                <select
                  value={form.contact_medium}
                  onChange={(e) => update('contact_medium', e.target.value)}
                  className="input"
                >
                  <option value="">— Select a channel —</option>
                  {CONTACT_MEDIUM.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Purchase readiness section — these answers let our team prioritise
                you correctly (they feed the lead scoring). */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                A few quick details
              </p>
              <Field label="How are you planning to finance this?">
                <select
                  value={form.financing}
                  onChange={(e) => update('financing', e.target.value)}
                  className="input"
                >
                  <option value="">— Select —</option>
                  {FINANCING.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="What's prompting your purchase?">
                <select
                  value={form.purchase_reason}
                  onChange={(e) => update('purchase_reason', e.target.value)}
                  className="input"
                >
                  <option value="">— Select —</option>
                  {PURCHASE_REASON.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Your history with Nissan">
                <select
                  value={form.nissan_relationship}
                  onChange={(e) => update('nissan_relationship', e.target.value)}
                  className="input"
                >
                  <option value="">— Select —</option>
                  {RELATIONSHIP.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Are you comparing other brands?">
                <div className="flex gap-2">
                  {([
                    ['only_nissan', "I'm set on Nissan"],
                    ['comparing', 'Comparing others'],
                  ] as const).map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => update('brand_consideration', val)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${
                        form.brand_consideration === val
                          ? 'border-transparent brand-bg text-white'
                          : 'border-border text-foreground hover:bg-muted'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {form.brand_consideration === 'comparing' ? (
                  <input
                    type="text"
                    value={form.comparing_brands}
                    onChange={(e) => update('comparing_brands', e.target.value)}
                    className="input mt-2"
                    placeholder="Which models? e.g. Hyundai Creta, Kia Seltos"
                  />
                ) : null}
              </Field>
            </div>

            {status === 'error' && errorMsg ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
                {errorMsg}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="brand"
              className="w-full"
              disabled={status === 'submitting'}
            >
              {status === 'submitting' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                'Submit enquiry'
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-[11.5px] text-muted-foreground/70">
            By submitting, you agree to be contacted by our Nissan sales team.
          </p>
        </div>
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-foreground">{label}</span>
      {children}
    </label>
  )
}
