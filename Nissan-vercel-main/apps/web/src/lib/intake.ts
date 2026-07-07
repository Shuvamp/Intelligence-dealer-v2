import { createServerFn } from '@tanstack/react-start'

export interface LeadInput {
  name: string
  phone: string
  email?: string
  vehicle?: string
  city?: string
  // intake preferences
  test_drive?: boolean
  budget?: number
  buy_timeline_days?: number
  callback_days?: number
  contact_medium?: string
  // scoring-signal fields captured by the enquiry form
  financing?: 'cash' | 'pre_approved' | 'loan_needed' | 'unsure'
  nissan_relationship?: 'current_owner' | 'past_owner' | 'referred' | 'new'
  brand_consideration?: 'only_nissan' | 'comparing'
  comparing_brands?: string
  purchase_reason?: 'replacement' | 'occasion' | 'business' | 'first_car' | 'researching'
  source: 'website' | 'facebook' | 'instagram' | 'walkin' | 'phone' | 'referral' | 'event'
}

interface IntakeResult {
  success: boolean
  lead: { id: string; customer_name: string; source: string }
}

export const submitLead = createServerFn({ method: 'POST' })
  .validator((data: LeadInput) => data)
  .handler(async ({ data }) => {
    const rawApiUrl =
      (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    // Tolerate a scheme-less env value (e.g. "host.up.railway.app"): fetch/new URL
    // require a protocol, so default a bare host to https://.
    const apiUrl = /^https?:\/\//.test(rawApiUrl) ? rawApiUrl : `https://${rawApiUrl}`
    const res = await fetch(`${apiUrl}/intake/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: 'Submission failed' }))) as {
        error?: string
      }
      throw new Error(err.error ?? 'Failed to submit lead')
    }
    return res.json() as Promise<IntakeResult>
  })
