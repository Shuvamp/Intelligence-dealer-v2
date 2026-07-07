import { createServerFn } from '@tanstack/react-start'
import type { WhatsAppMessageStatus } from './types'

export interface WhatsAppSendResult {
  success: boolean
  lead_id: string
  wamid: string | null
  status: WhatsAppMessageStatus | null
  provider: string | null
  message_id: string | null
  message: string
  reason: string | null   // 'whatsapp_not_configured' when provider unavailable
  errors: Array<string>
}

export type WhatsAppMediaType = 'image' | 'video' | 'document'

// Sends a WhatsApp message via the Python WhatsApp Agent (apps/api).
// Runs server-side — no browser CORS concern talking to the FastAPI service.
export const sendWhatsAppMessage = createServerFn({ method: 'POST' })
  .validator((d: {
    lead_id: string
    message: string
    attachment_id?: string | null
    media_url?: string | null
    media_type?: WhatsAppMediaType | null
  }) => d)
  .handler(async ({ data }): Promise<WhatsAppSendResult> => {
    const apiUrl =
      (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    const res = await fetch(`${apiUrl}/whatsapp/send/${data.lead_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: data.message,
        attachment_id: data.attachment_id ?? null,
        media_url: data.media_url ?? null,
        media_type: data.media_type ?? null,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        (err as { detail?: string }).detail ?? `WhatsApp send failed: ${res.status}`,
      )
    }
    return res.json() as Promise<WhatsAppSendResult>
  })
