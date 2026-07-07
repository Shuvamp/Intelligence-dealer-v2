// Server-only. Content Studio generation via NVIDIA NIM API (OpenAI-compatible).
// Reads NVIDIA_API_KEY from the environment; never exposed to the client.
// Used by the Content Studio server functions in marketing.ts as a drop-in
// replacement for the Anthropic-based generation while ANTHROPIC_API_KEY is unavailable.
import OpenAI from 'openai'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const MODEL = 'meta/llama-3.3-70b-instruct'

const BRAND_SYSTEM = `You are the Content Generation and Creative Poster agents for "Dealer Intelligence OS", a marketing platform for Nissan dealerships in India (Tamil Nadu).

Brand & voice:
- Brand: Nissan. Confident, aspirational, friendly. Indian audience; ₹ for prices.
- Vehicles: Magnite (compact SUV), X-Trail (premium SUV), Kicks, Terrano, Sunny.
- Captions: punchy, social-ready, 1–2 tasteful emojis, under ~280 characters, end with a clear next step.
- Hashtags: 5 total, always include #Nissan and a vehicle tag; mix brand + campaign + local.
- CTA: 2–4 words, action-oriented (e.g. "Book a Test Drive").
- Never invent specific prices unless an offer is provided. Stay on-brand and compliant.

Always return ONLY the requested JSON. No preamble, no markdown fences.`

export function hasNvidiaKey(): boolean {
  return !!process.env.NVIDIA_API_KEY
}

let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client)
    _client = new OpenAI({
      baseURL: NVIDIA_BASE_URL,
      apiKey: process.env.NVIDIA_API_KEY,
    })
  return _client
}

async function callJSON(userPrompt: string, maxTokens = 1024): Promise<any> {
  const res = await client().chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: BRAND_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
  })
  const text = res.choices[0]?.message?.content
  if (!text) return null
  return JSON.parse(text)
}

// ---- Content Generation (mirrors generateMarketingContent in anthropic.server.ts) ----
export async function generateMarketingContentNvidia(input: {
  vehicle: string
  channel: string
  offer?: string
  objective?: string
  theme?: string
}): Promise<{ caption: string; hashtags: Array<string>; cta: string } | null> {
  if (!hasNvidiaKey()) return null
  try {
    const prompt =
      `Write one ${input.channel} post for the Nissan ${input.vehicle}.\n` +
      `Objective: ${input.objective ?? 'awareness'}. Theme/occasion: ${input.theme ?? 'New arrival'}.` +
      (input.offer ? ` Offer to feature: ${input.offer}.` : '') +
      `\nReturn JSON with keys: caption, hashtags (array of 5 strings), cta.`
    const out = await callJSON(prompt)
    if (!out?.caption) return null
    return { caption: out.caption, hashtags: out.hashtags ?? [], cta: out.cta ?? 'Enquire Now' }
  } catch {
    return null
  }
}

// ---- Creative Poster (mirrors generatePosterPrompt in anthropic.server.ts) ----
export async function generatePosterPromptNvidia(input: {
  vehicle: string
  channel: string
  offer?: string | null
  theme?: string | null
}): Promise<{ poster_prompt: string; headline: string; offer_badge: string | null } | null> {
  if (!hasNvidiaKey()) return null
  try {
    const prompt =
      `Design a social poster for the Nissan ${input.vehicle} on ${input.channel}.` +
      (input.theme ? ` Occasion/theme: ${input.theme}.` : '') +
      (input.offer ? ` Offer to feature: ${input.offer}.` : '') +
      ` Return JSON with keys:\n` +
      `- headline: a punchy 2–5 word poster headline.\n` +
      `- offer_badge: a very short offer badge (e.g. "₹50k OFF") or "" if no offer.\n` +
      `- poster_prompt: a vivid image-generation prompt (composition, lighting, Nissan red accent, dealership branding, social-ready).`
    const out = await callJSON(prompt)
    if (!out?.poster_prompt) return null
    return {
      poster_prompt: out.poster_prompt,
      headline: out.headline || input.vehicle,
      offer_badge: out.offer_badge?.trim() ? out.offer_badge.trim() : null,
    }
  } catch {
    return null
  }
}
