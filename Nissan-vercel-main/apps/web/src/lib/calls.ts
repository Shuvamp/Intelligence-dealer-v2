import { createServerFn } from '@tanstack/react-start'

// Call Intelligence Agent (Phase 5) client surface. Reads/retries go through the
// Python agent (apps/api, port 8000) — same as lib/whatsapp.ts. The upload itself
// is a direct multipart fetch from the browser (see uploadCallRecording below),
// since createServerFn doesn't carry multipart bodies cleanly.

export type CallStatus = 'uploaded' | 'transcribing' | 'analyzing' | 'completed' | 'failed'

export interface CallRecording {
  id: string
  lead_id: string
  file_name: string
  status: CallStatus
  error_reason?: string | null
  created_at: string
}

export interface CallAnalysis {
  customer_summary: Array<string>
  interest_level: string | null
  buying_intent_score: number | null
  competitors: Array<string>
  competitor_risk: string | null
  price_sensitivity: string | null
  purchase_timeline: string | null
  test_drive_interest: boolean | null
  followup_requested: boolean | null
  recommended_action: string | null
  reasoning: Array<string>
}

export interface CallTranscript {
  transcript: string
  language_detected: string | null
}

export interface CallSentiment {
  sentiment: 'positive' | 'neutral' | 'negative'
  confidence: number | null
}

export interface LeadCall {
  recording: CallRecording
  analysis: CallAnalysis | null
  transcript: CallTranscript | null
  sentiment: CallSentiment | null
}

function agentUrl(): string {
  return (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
}

export const getLeadCalls = createServerFn({ method: 'GET' })
  .validator((d: { lead_id: string }) => d)
  .handler(async ({ data }): Promise<Array<LeadCall>> => {
    const res = await fetch(`${agentUrl()}/leads/${data.lead_id}/calls`)
    if (!res.ok) return []
    const json = (await res.json()) as { calls?: Array<LeadCall> }
    return json.calls ?? []
  })

export const analyzeCall = createServerFn({ method: 'POST' })
  .validator((d: { call_id: string }) => d)
  .handler(async ({ data }): Promise<{ call_id: string; status: string }> => {
    const res = await fetch(`${agentUrl()}/calls/${data.call_id}/analyze`, { method: 'POST' })
    if (!res.ok) throw new Error(`Analyze failed: ${res.status}`)
    return res.json() as Promise<{ call_id: string; status: string }>
  })

// Direct browser → FastAPI multipart upload (CORS allows :3000). Returns the new
// call_id; the caller then polls getLeadCalls until status is terminal.
export async function uploadCallRecording(leadId: string, file: File): Promise<{ call_id: string; status: string }> {
  const url = (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
  const form = new FormData()
  form.append('lead_id', leadId)
  form.append('audio_file', file)
  const res = await fetch(`${url}/calls/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string }
    throw new Error(err.detail ?? `Upload failed: ${res.status}`)
  }
  return res.json() as Promise<{ call_id: string; status: string }>
}
