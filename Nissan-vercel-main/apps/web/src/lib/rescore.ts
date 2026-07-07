import { createServerFn } from '@tanstack/react-start'

export interface RescoreResult {
  score_changed: boolean
  new_score: string | null
  previous_score: string | null
  new_score_value: number | null
  trigger: string
  trigger_label: string
  scored_by: string | null
  errors: Array<string>
}

// Phase 6: Trigger a dynamic re-score for a lead via the FastAPI rescoring service.
// The existing scoring agent (Claude → Groq → deterministic) runs against the
// lead's full event + message history and updates leads.score if it changed.
export const runRescore = createServerFn({ method: 'POST' })
  .validator((d: { lead_id: string; trigger: string }) => d)
  .handler(async ({ data }): Promise<RescoreResult> => {
    const apiUrl =
      (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    const res = await fetch(`${apiUrl}/rescore/${data.lead_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: data.trigger }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        (err as { detail?: string }).detail ?? `Re-score failed: ${res.status}`,
      )
    }
    return res.json() as Promise<RescoreResult>
  })
