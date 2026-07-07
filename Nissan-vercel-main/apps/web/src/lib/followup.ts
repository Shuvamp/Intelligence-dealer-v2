import { createServerFn } from '@tanstack/react-start'

export interface FollowupStep {
  n: number
  label: string
  engine: 'groq' | 'rule' | 'data'
  status: 'done' | 'fallback' | 'skipped'
  detail: string
}

export interface FollowupResult {
  success: boolean
  lead_id: string
  action_type: string | null
  channel: string | null
  rationale: string | null
  message: string | null
  nba_event_id: string | null
  assignee_notified: boolean
  days_idle: number
  talking_points: Array<string>
  steps: Array<FollowupStep>
}

// Runs the Python LangGraph Follow-up Agent (apps/api) for a lead. The agent logs
// an NBA event on the lead's timeline and notifies the assignee. Runs server-side,
// so there's no browser CORS concern talking to the FastAPI service.
export const runFollowup = createServerFn({ method: 'POST' })
  .validator((d: { lead_id: string }) => d)
  .handler(async ({ data }): Promise<FollowupResult> => {
    const apiUrl =
      (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    const res = await fetch(`${apiUrl}/followup/${data.lead_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`Follow-up agent failed: ${res.status}`)
    }
    return res.json() as Promise<FollowupResult>
  })
