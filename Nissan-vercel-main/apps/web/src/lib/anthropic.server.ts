// Server-only. Marketing generation agents.
// Key priority: ANTHROPIC_API_KEY → template fallback.
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-opus-4-8'

export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

let _anthropic: Anthropic | null = null
function client(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic() // reads ANTHROPIC_API_KEY
  return _anthropic
}


// Stable brand guidelines — first in the prefix and cached so repeated
// generations reuse it (prompt caching; see the claude-api skill).
const BRAND_SYSTEM = `You are the Content Generation and Creative Poster agents for "Dealer Intelligence OS", a marketing platform for Nissan dealerships in India (Tamil Nadu).

Brand & voice:
- Brand: Nissan. Confident, aspirational, friendly. Indian audience; ₹ for prices.
- Vehicles: Magnite (compact SUV), X-Trail (premium SUV), Kicks, Terrano, Sunny.
- Captions: punchy, social-ready, 1–2 tasteful emojis, under ~280 characters, end with a clear next step.
- Hashtags: 5 total, always include #Nissan and a vehicle tag; mix brand + campaign + local.
- CTA: 2–4 words, action-oriented (e.g. "Book a Test Drive").
- Never invent specific prices unless an offer is provided. Stay on-brand and compliant.

Always return ONLY the requested JSON. No preamble.`

async function callJSON(
  userPrompt: string,
  schema: Record<string, unknown>,
  system: string = BRAND_SYSTEM,
  maxTokens = 1024,
): Promise<any> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: userPrompt }],
  })
  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return null
  return JSON.parse(text.text)
}

// ---- Content Generation Agent (real) ----
export async function generateMarketingContent(input: {
  vehicle: string
  channel: string
  offer?: string
  objective?: string
  theme?: string
}): Promise<{ headline: string; subheadline: string; caption: string; hashtags: Array<string>; cta: string } | null> {
  if (!hasAnthropicKey()) return null
  try {
    const prompt =
      `Write one ${input.channel} post for the Nissan ${input.vehicle}.\n` +
      `Objective: ${input.objective ?? 'awareness'}. Theme/occasion: ${input.theme ?? 'New arrival'}.` +
      (input.offer ? ` Offer to feature: ${input.offer}.` : '') +
      `\nReturn headline (3–6 words, punchy banner title), subheadline (6–10 words, expands headline), caption, hashtags (array of 5), and cta.`
    const out = await callJSON(prompt, {
      type: 'object',
      properties: {
        headline:    { type: 'string' },
        subheadline: { type: 'string' },
        caption:     { type: 'string' },
        hashtags:    { type: 'array', items: { type: 'string' } },
        cta:         { type: 'string' },
      },
      required: ['headline', 'subheadline', 'caption', 'hashtags', 'cta'],
      additionalProperties: false,
    })
    if (!out?.caption) return null
    return {
      headline:    out.headline    ?? `Drive the Nissan ${input.vehicle}`,
      subheadline: out.subheadline ?? `Experience ${input.theme ?? 'excellence'} today`,
      caption:     out.caption,
      hashtags:    out.hashtags ?? [],
      cta:         out.cta ?? 'Enquire Now',
    }
  } catch {
    return null
  }
}

// ---- Executive Copilot (real): grounded answer over a live dealership snapshot ----
const COPILOT_SYSTEM = `You are the Executive Copilot for "Dealer Intelligence OS", a Nissan dealership platform. You are the dealer's sharp, trusted chief-of-staff.

Rules:
- Answer the dealer's question using ONLY the live dealership data provided in the message (hot leads, top campaigns, market signals, today's numbers). Do not invent leads, campaigns, names, or figures.
- Be concise, specific, and action-oriented — lead with the recommendation, then the why. 1–3 sentences for simple questions.
- Indian dealership context; ₹ for money.
- Cite the specific records you used in "citations" (kind: "lead" | "campaign" | "signal" | "metric", label: a short human label like "Ravi Kumar · Magnite" or "Independence Day SUV Drive").
- If the provided data doesn't answer the question, say briefly what you'd need.
- Return ONLY the requested JSON.`

export interface CopilotSnapshot {
  hotLeads: Array<{ name: string | null; vehicle: string | null; stage: string }>
  campaigns: Array<{ name: string | null; leads: number; conversion: number; cpl: number }>
  signals: Array<{ title: string; metric: string | null; kind: string }>
  today: Array<{ label: string; value: string }>
}

export async function copilotAnswer(
  question: string,
  snapshot: CopilotSnapshot,
): Promise<{ answer: string; citations: Array<{ kind: string; label: string }> } | null> {
  if (!hasAnthropicKey()) return null
  try {
    const prompt =
      `The dealer asks: "${question}"\n\n` +
      `Live dealership data (use ONLY this):\n` +
      `Hot leads needing attention (oldest first): ${JSON.stringify(snapshot.hotLeads)}\n` +
      `Top campaigns by leads: ${JSON.stringify(snapshot.campaigns)}\n` +
      `Market signals: ${JSON.stringify(snapshot.signals)}\n` +
      `Today's numbers: ${JSON.stringify(snapshot.today)}\n\n` +
      `Answer the dealer's question grounded in this data, and cite what you used.`
    const out = await callJSON(
      prompt,
      {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: { kind: { type: 'string' }, label: { type: 'string' } },
              required: ['kind', 'label'],
              additionalProperties: false,
            },
          },
        },
        required: ['answer', 'citations'],
        additionalProperties: false,
      },
      COPILOT_SYSTEM,
    )
    if (!out?.answer) return null
    return { answer: out.answer, citations: Array.isArray(out.citations) ? out.citations : [] }
  } catch {
    return null
  }
}

// ---- Campaign Setup Helpers: fast haiku calls for wizard AI-suggest buttons ----

export async function suggestCampaignDescription(
  name: string, type: string, occasion: string,
): Promise<string | null> {
  if (!hasAnthropicKey()) return null
  try {
    const out = await callJSON(
      `Write a 2–3 sentence campaign description for a Nissan dealership campaign: "${name}". Type: ${type}. Occasion: ${occasion || 'general'}. Keep it concise and action-oriented for the marketing team.`,
      { type: 'object', properties: { description: { type: 'string' } }, required: ['description'], additionalProperties: false },
      BRAND_SYSTEM,
      300,
    )
    return out?.description ?? null
  } catch {
    return null
  }
}

export async function suggestCampaignHashtags(
  name: string, type: string, region: string, occasion: string,
): Promise<string[] | null> {
  if (!hasAnthropicKey()) return null
  try {
    const city = region.split(' ')[0]
    const out = await callJSON(
      `Generate 8 campaign hashtags for Nissan campaign "${name}". Type: ${type}. Region: ${region} (city: ${city}). Occasion: ${occasion || 'general'}. Always include #Nissan and #NissanIndia. Mix campaign-specific, vehicle, regional (#${city}), and occasion hashtags.`,
      { type: 'object', properties: { hashtags: { type: 'array', items: { type: 'string' } } }, required: ['hashtags'], additionalProperties: false },
      BRAND_SYSTEM,
      300,
    )
    return Array.isArray(out?.hashtags) ? out.hashtags as string[] : null
  } catch {
    return null
  }
}

// ---- Creative Poster Agent — structured template prompt ----
// Fills the Marketing Creative Director template, calls Gemini text → Anthropic → static fallback.

export interface PosterPromptResult {
  poster_prompt: string
  headline: string
  offer_badge: string | null
  visual_theme: string
  background_scene: string
  lighting: string
  camera_angle: string
  color_palette: string
  negative_prompt: string
}

// ---- Campaign mode detection ----
type CampaignMode = 'festival' | 'family' | 'lifestyle' | 'adventure' | 'safety' | 'offer' | 'awareness' | 'seasonal'

const FESTIVAL_KEYWORDS = [
  'diwali', 'pongal', 'christmas', 'holi', 'eid', 'new year',
  'onam', 'navratri', 'durga puja', 'ganesh', 'ugadi', 'vishu', 'baisakhi', 'sankranti',
]

function detectCampaignMode(input: {
  campaign_name?: string | null
  caption?: string | null
  objective?: string | null
  theme?: string | null
  offer?: string | null
}): CampaignMode {
  const corpus = [input.campaign_name, input.caption, input.objective, input.theme]
    .filter(Boolean).join(' ').toLowerCase()
  if (FESTIVAL_KEYWORDS.some(k => corpus.includes(k))) return 'festival'
  if (input.offer) return 'offer'
  const obj = (input.objective ?? '').toLowerCase()
  if (obj.includes('safety')) return 'safety'
  if (obj.includes('family')) return 'family'
  if (obj.includes('adventure') || obj.includes('offroad') || obj.includes('off-road')) return 'adventure'
  if (obj.includes('seasonal') || obj.includes('season')) return 'seasonal'
  if (obj.includes('lifestyle')) return 'lifestyle'
  return 'awareness'
}

const CAMPAIGN_ENV: Record<CampaignMode, string[]> = {
  festival: [
    'vibrant Diwali night street lined with glowing oil diyas, marigold garland archways, golden bokeh light trails, and silhouetted celebrants in traditional attire',
    'festive Pongal morning with elaborate kolam rangoli patterns filling the foreground, clay pots with sugarcane, sunrise light painting the sky gold and amber',
    'Christmas evening with warm fairy lights draped across a tree-lined avenue, light snow dusting rooftops, a joyful family gathering at a warmly lit home entrance in the background',
    'Holi celebration in a public square, vivid powder clouds of pink, yellow, and violet filling the air, laughing crowds in the mid-ground, bright festive chaos all around',
    'Eid night scene with a crescent moon over a grand mosque, warm lantern light, families in traditional dress celebrating near a beautifully decorated gate and courtyard',
    'New Year midnight countdown with fireworks bursting over a gleaming city skyline, confetti streaming down, a jubilant crowd celebrating below in a wide plaza',
  ],
  family: [
    'golden hour family picnic at a hilltop park, children flying colorful kites in the background, parents relaxed on a blanket, lush green valley and soft amber sky behind them',
    'beach sunrise road trip scene, a happy Indian family unloading luggage and gear, turquoise waves and palm trees framing the setting, joyful morning energy',
    'warm suburban evening, children returning from school and parents from work converging at a home driveway, neighborhood trees and glowing house lights creating a welcoming scene',
    'misty mountain resort entrance, a family walking toward a scenic viewpoint, a lush valley panorama visible below, cool morning light and fresh mountain air',
  ],
  lifestyle: [
    'rooftop terrace at sunset overlooking a gleaming metropolitan skyline, warm amber-gold light casting long editorial shadows, an aspirational urban atmosphere',
    'coastal highway at dusk, palm trees lining the median, deep blue ocean visible on the horizon, a sense of effortless freedom and premium living',
    'rain-slicked city boulevard at night, neon signs of upscale restaurants and boutiques reflecting on wet asphalt, sophisticated urban energy in every corner',
    'modern architectural plaza at blue hour, geometric glass towers, warm interior lights glowing, stylish pedestrians mid-stride, a thriving city in motion',
  ],
  adventure: [
    'dramatic mountain trail at sunrise, rocky red terrain in the foreground, a misty valley of trees far below, streaks of golden light breaking through dramatic clouds overhead',
    'dense tropical forest track at dawn, shafts of light piercing the forest canopy, low fog hugging the mossy ground, a sense of untamed exploration ahead',
    'vast desert at golden hour, rippling sand dunes stretching to the horizon, a single dusty track curving through the scene, deep orange sky with sparse clouds',
    'jungle river crossing, mossy boulders and rushing water in the foreground, a cascading waterfall and lush green canopy in the background, pure adventure and discovery',
  ],
  safety: [
    'safe school drop-off scene on a quiet tree-lined street, children waving goodbye, a crossing guard at the zebra crossing, warm morning light and a calm neighbourhood atmosphere',
    'rain-soaked expressway at dusk, clean lane markings glowing through the wet surface, a calm family commute with soft interior light, a reassuring sense of control and protection',
    'suburban driveway at night, a family arriving home safely after a journey, warm house lights welcoming them, a neighbour waving, the quiet comfort of arrival',
  ],
  offer: [
    'dynamic dealership exterior at night, large illuminated offer banners and spotlights framing the forecourt, an excited crowd of buyers queuing under festive bunting',
    'bold urban advertising environment — a wide city boulevard with large promotional hoardings, traffic and pedestrians below, high-energy commercial atmosphere',
    'festive launch event at an outdoor venue, colourful stage lights and banners in the background, a buzzing crowd of enthusiastic onlookers gathered in anticipation',
  ],
  awareness: [
    'elevated urban freeway at blue hour, an iconic city skyline silhouetted against a deep indigo-to-amber gradient sky, premium and aspirational atmosphere',
    'coastal cliff road at sunset, crashing waves far below on one side, a dramatic gradient sky in layers of orange, pink, and violet above',
    'sleek modern cable bridge at night, city lights perfectly reflected in the still river below, a serene yet powerful sense of achievement and progress',
  ],
  seasonal: [
    'monsoon landscape with lush emerald rice paddies, dramatic overcast sky, silver rain mist rolling across layered green hills, the fresh energy of the wet season',
    'summer coastal highway scene, blazing sun high overhead, turquoise water shimmering in the distance, heat haze rising gently from sun-baked tarmac',
    'winter mountain road, frost-tipped pine trees lining both sides, pale silver morning light, crisp clean air and a sense of quiet serene beauty',
  ],
}

const VARIATION_MOODS = [
  'dramatic chiaroscuro with deep shadows and sharp highlights',
  'warm golden hour glow with long soft shadows and rich amber tones',
  'cool twilight blue with violet undertones and glowing city ambience',
  'high-contrast neon night with vivid colour reflections on wet surfaces',
  'cinematic overcast silver with diffused light and rich mid-tones',
  'warm commercial lighting with controlled fill and premium colour depth',
]

const STORYTELLING_ELEMENTS: Record<CampaignMode, string> = {
  festival:  'Include joyful people in festive attire in the mid-ground, traditional decorative elements (diyas, rangoli, lanterns, garlands, or powder colours) layering the foreground and background, rich cultural storytelling in every part of the frame.',
  family:    'Show a happy Indian family in the mid-ground — parents and children sharing a genuine moment of connection, warm relatable emotion, real human energy that makes the scene feel lived-in and aspirational.',
  lifestyle: 'Feature a confident urban professional (25–40 years, stylish) in the scene periphery — not posed, naturally part of the environment — suggesting a premium, forward-looking lifestyle narrative.',
  adventure: 'Convey movement and exploration: tyre tracks on terrain, a faint dust trail, outdoor gear or a backpack visible somewhere in frame, a sense of journey extending beyond the horizon.',
  safety:    'Suggest reassurance and protection — a warm family interaction, clear safe road conditions, a moment of calm arrival or peaceful daily routine, no dramatic action, only quiet confidence.',
  offer:     'Integrate visual urgency and excitement — bold atmospheric colour energy hinting at a limited-time event, an enthusiastic crowd in the background, the sense that something special and unmissable is happening right now.',
  awareness: 'Convey brand aspiration and prestige — premium architecture or landscape, confident editorial composition, subtle luxury cues in the surroundings that elevate the brand without shouting.',
  seasonal:  'Reflect the season through rich environmental texture — weather effects, foliage colours, sky mood, and the human activities that naturally accompany that time of year.',
}

export function _buildPosterTemplate(input: {
  vehicle: string
  channel: string
  offer?: string | null
  theme?: string | null
  campaign_name?: string | null
  objective?: string | null
  caption?: string | null
}): string {
  const mode       = detectCampaignMode(input)
  const envOptions = CAMPAIGN_ENV[mode]
  const env        = envOptions[Math.floor(Math.random() * envOptions.length)]!
  const mood       = VARIATION_MOODS[Math.floor(Math.random() * VARIATION_MOODS.length)]!
  const story      = STORYTELLING_ELEMENTS[mode]

  const campaignName = input.campaign_name ?? input.theme ?? `Nissan ${input.vehicle} Campaign`
  void (input.caption ?? `Drive the Nissan ${input.vehicle} — experience the difference today`)

  return `You are a Senior Art Director at a premium automotive advertising agency specialising in Indian market social media campaigns.

Your task: write a complete AI image generation prompt for a PREMIUM AUTOMOTIVE MARKETING POSTER, not a simple vehicle render.

CAMPAIGN BRIEF:

* Campaign Name: ${campaignName}
* Vehicle: Nissan ${input.vehicle}
* Campaign Mode: ${mode.toUpperCase()}
* Objective: ${input.objective ?? 'Brand Awareness'}
* Target Audience: Indian car buyers, families, professionals, SUV enthusiasts
* Channel: ${input.channel}
* Featured Offer: ${input.offer ?? 'None'}

CREATIVE DIRECTION:

Generate a COMPLETE SOCIAL MEDIA POSTER COMPOSITION.

The final image should resemble a professionally designed Nissan India advertising campaign similar to premium festival, lifestyle, family, seasonal, awareness, or promotional campaigns.

PRIMARY FOCUS:
Campaign story, environment, people, culture, lifestyle, atmosphere.

SECONDARY FOCUS:
Nissan ${input.vehicle} integrated naturally into the scene.

COMPOSITION:

1. CAMPAIGN STORY
   Create an emotional campaign narrative inspired by "${campaignName}".

2. ENVIRONMENT
   ${env}

Rich, immersive environment occupying 60-70% of the composition.

3. STORYTELLING
   ${story}

Include realistic people, lifestyle moments, cultural elements and campaign-relevant visual storytelling.

4. VEHICLE
   Nissan ${input.vehicle} occupying 25-35% of the composition.
   Positioned naturally in lower-left or lower-right area.
   Full vehicle visible.
   All wheels grounded.
   Premium automotive photography.

5. DECORATIVE ELEMENTS
   Campaign-relevant decorations, lighting accents, atmospheric effects, premium foreground and background details, bokeh lighting, environmental depth and visual richness.

6. POSTER LAYOUT
   Top section reserved for headline.
   Center section for campaign story.
   Side section for promotional message.
   Bottom section for features and offer highlights.
   Maintain clean structured areas suitable for marketing overlays.

7. ART DIRECTION
   ${mood} lighting.
   Premium advertising photography.
   Luxury commercial aesthetic.
   Rule-of-thirds composition.
   Indian cultural relevance.
   Instagram and Facebook campaign quality.

8. TECHNICAL QUALITY
   Ultra realistic.
   8K.
   Photorealistic.
   Professional commercial retouching.
   Premium colour grading.
   High-end advertising poster quality.

FACTUALITY RULES:
Use only information provided in the campaign brief.
Do not invent vehicle features, specifications, offers, awards, mileage, technology or pricing.
Do not introduce other vehicle models.
Do not create fictional claims.

STRICTLY AVOID:
showroom, studio, isolated car render, floating vehicle, dealership floor, launch stage, plain background, empty gradient background, revolving platform, duplicate vehicles, cropped vehicle, unrealistic proportions, blurry details, watermark.

OUTPUT FORMAT — return ONLY valid JSON:

{
"poster_prompt": "Detailed image generation prompt",
"headline": "Short campaign headline",
"offer_badge": "Offer text or null",
"visual_theme": "Campaign theme",
"background_scene": "Dominant environment",
"lighting": "Lighting style",
"camera_angle": "Vehicle placement and angle",
"color_palette": "Primary colours",
"negative_prompt": "showroom, studio, isolated render, floating vehicle, plain background, watermark, blurry, distorted proportions"
}`
}

// Gemini text generation for poster prompt (free tier supports text)
export async function _generatePosterPromptGemini(templatePrompt: string): Promise<PosterPromptResult | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const model = 'gemini-2.5-flash'
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: templatePrompt }] }],
          generationConfig: { responseModalities: ['TEXT'] },
        }),
      },
    )
    const rawText = await res.text()
    if (!res.ok) {
      console.error('[generatePosterPromptGemini] HTTP', res.status, rawText.slice(0, 400))
      return null
    }
    const data = JSON.parse(rawText) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text
    if (!text) {
      console.error('[generatePosterPromptGemini] no text in response:', rawText.slice(0, 400))
      return null
    }
    // Strip markdown fences if Gemini wraps JSON in ```json ... ```
    const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const json = JSON.parse(clean)
    if (!json?.poster_prompt) {
      console.error('[generatePosterPromptGemini] missing poster_prompt field:', clean.slice(0, 200))
      return null
    }
    return json as PosterPromptResult
  } catch (e) {
    console.error('[generatePosterPromptGemini] failed:', e)
    return null
  }
}

export async function generatePosterPrompt(input: {
  vehicle: string
  channel: string
  offer?: string | null
  theme?: string | null
  campaign_name?: string | null
  objective?: string | null
  caption?: string | null
}): Promise<PosterPromptResult> {
  const mode       = detectCampaignMode(input)
  const envOptions = CAMPAIGN_ENV[mode]
  const env        = envOptions[Math.floor(Math.random() * envOptions.length)]!
  const mood       = VARIATION_MOODS[Math.floor(Math.random() * VARIATION_MOODS.length)]!
  const story      = STORYTELLING_ELEMENTS[mode]

  const campaignName = input.campaign_name ?? input.theme ?? `Nissan ${input.vehicle} Campaign`
  const caption      = input.caption ?? `Drive the Nissan ${input.vehicle}`

  // Campaign-first static fallback: environment dominates, vehicle is supporting hero (25-40%)
  const poster_prompt =
    `${mode.charAt(0).toUpperCase() + mode.slice(1)} marketing campaign creative for "${campaignName}". ` +
    `The image is a premium advertising creative first and a vehicle photograph second. ` +
    `Dominant setting (60-75% of frame): ${env}. ` +
    `${story} ` +
    `The Nissan ${input.vehicle} occupies 25-40% of the frame, positioned in the mid-left or mid-right third — never dead centre. ` +
    `Shown at 3/4 front angle or side profile. All four wheels grounded. Full body visible, no cropping. ` +
    `Nissan red #C3002F accents on grille and trim, silver chrome finish, integrating naturally into the scene. ` +
    (input.offer ? `Featured offer highlight: ${input.offer}. ` : '') +
    `Caption context: "${caption.slice(0, 100)}". ` +
    `Lighting: ${mood}. ` +
    `Clean empty lower third (30% of height) for text overlays. Clean upper strip for logo. ` +
    `Agency-quality commercial photography. Rule-of-thirds composition. Cinematic depth of field. ` +
    `Premium Indian automotive advertisement aesthetic. 8K hyperrealistic. Optimised for ${input.channel}. ` +
    `No text, no watermarks, no showroom, no studio backdrop, no isolated vehicle render, no plain gradient background.`

  return {
    poster_prompt,
    headline: `Drive the Nissan ${input.vehicle}`,
    offer_badge: input.offer ?? null,
    visual_theme: `${mode} campaign — ${mood}`,
    background_scene: env,
    lighting: mood,
    camera_angle: '3/4 or side profile, mid-ground placement in left or right third',
    color_palette: `Nissan red #C3002F, deep black, silver chrome, ${mode}-environment tones`,
    negative_prompt:
      'showroom, studio, isolated render, plain background, product launch stage, pedestal, ' +
      'floating car, catalog photography, grey backdrop, empty gradient, duplicate vehicle, ' +
      'blurry, watermark, text artifacts, logo overlay, cropped wheels, distorted proportions',
  }
}

// ---- Gemini Image Generation (priority 1) ----
// Uses gemini-2.0-flash-preview-image-generation via the Generative Language REST API.
// Returns a data: URL with the base64-encoded image.
export function hasGeminiKey(): boolean {
  return !!process.env.GEMINI_API_KEY
}

async function generatePosterImageGemini(imagePrompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  // gemini-2.0-flash-exp is the stable model with image generation support.
  // Override with GEMINI_IMAGE_MODEL env var (e.g. imagen-3.0-generate-002).
  // gemini-2.5-flash-image supports generateContent with IMAGE modality.
  // Override with GEMINI_IMAGE_MODEL env var if needed.
  const model = (process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image').trim()

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagePrompt }] }],
          // IMAGE alone is rejected by some models — include TEXT to avoid 400.
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      },
    )

    const rawText = await res.text()
    if (!res.ok) {
      console.error('[generatePosterImageGemini] API error', res.status, rawText)
      return null
    }

    let data: {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType: string; data: string }
          }>
        }
      }>
    }
    try {
      data = JSON.parse(rawText)
    } catch {
      console.error('[generatePosterImageGemini] non-JSON response:', rawText.slice(0, 300))
      return null
    }

    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
    if (!inline?.data) {
      console.error('[generatePosterImageGemini] no inlineData in response:', JSON.stringify(data).slice(0, 300))
      return null
    }
    return `data:${inline.mimeType};base64,${inline.data}`
  } catch (e) {
    console.error('[generatePosterImageGemini] failed:', e)
    return null
  }
}

// ---- NVIDIA NIM Image Generation (priority 2 / fallback) ----
// Calls stabilityai/stable-diffusion-xl via NVIDIA NIM and returns a base64
// data URL. Prompt should describe the background/car scene only — text is
// overlaid in CSS so the model doesn't need to render readable characters.
export async function _generatePosterImageNvidia(imagePrompt: string): Promise<string | null> {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) return null

  const model = (process.env.NVIDIA_IMAGE_MODEL ?? 'stabilityai/stable-diffusion-xl').trim()
  const endpoint = `https://ai.api.nvidia.com/v1/genai/${model}`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text_prompts: [
          { text: imagePrompt, weight: 1 },
          {
            text: 'text, watermark, logo overlay, blurry, low quality, distorted, cartoon, anime, oversaturated, duplicate',
            weight: -1,
          },
        ],
        cfg_scale: 7,
        sampler: 'K_DPM_2_ANCESTRAL',
        seed: 0,
        steps: 25,
        width: 1024,
        height: 1024,
      }),
    })

    if (!res.ok) {
      console.error('[generatePosterImageNvidia] NVIDIA API error', res.status, await res.text().catch(() => ''))
      return null
    }

    const data = await res.json() as {
      artifacts?: Array<{ base64?: string; finishReason?: string }>
    }
    const b64 = data.artifacts?.[0]?.base64
    if (!b64) return null
    return `data:image/png;base64,${b64}`
  } catch (e) {
    console.error('[generatePosterImageNvidia] failed:', e)
    return null
  }
}

// ---- HuggingFace Inference — FLUX.1-schnell via router endpoint ----
export function hasHfToken(): boolean {
  return !!process.env.HF_TOKEN
}

async function generatePosterImageHuggingFace(imagePrompt: string): Promise<string> {
  const token = process.env.HF_TOKEN
  if (!token) throw new Error('HF_TOKEN not set')

  const model = (process.env.HF_IMAGE_MODEL ?? 'black-forest-labs/FLUX.1-schnell').trim()

  // Manual AbortController — AbortSignal.timeout() is unreliable inside Nitro SSR.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  const t0 = Date.now()

  try {
    console.log('[HF] fetch START model=', model)
    const res = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          // tells HF to hold the request until the model is warm instead of 503
          'x-wait-for-model': 'true',
        },
        body: JSON.stringify({
          inputs: imagePrompt,
          parameters: { seed: Math.floor(Math.random() * 2_147_483_647) },
        }),
        signal: controller.signal,
      },
    )
    console.log('[HF] fetch returned status=', res.status, 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's')

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HuggingFace HTTP ${res.status}: ${body.slice(0, 200)}`)
    }

    const buf = await res.arrayBuffer()
    console.log('[HF] body read bytes=', buf.byteLength)
    const mime = res.headers.get('content-type') ?? 'image/jpeg'
    const b64 = Buffer.from(buf).toString('base64')
    return `data:${mime};base64,${b64}`
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`HuggingFace timed out after 90s (model="${model}")`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export interface PosterImageResult {
  url: string
  provider: 'gemini' | 'huggingface'
}

// ---- Image generation dispatcher — HuggingFace primary, Gemini if explicitly enabled ----
// Gemini image generation requires a paid plan (free-tier quota = 0).
// Set GEMINI_IMAGE_ENABLED=true in .env to re-enable it when on a paid plan.
// Returns { url, provider } on success. Throws user-visible message when all fail.
export async function generatePosterImage(imagePrompt: string): Promise<PosterImageResult> {
  if (hasGeminiKey() && process.env.GEMINI_IMAGE_ENABLED === 'true') {
    const url = await generatePosterImageGemini(imagePrompt)
    if (url) return { url, provider: 'gemini' }
  }
  if (hasHfToken()) {
    const url = await generatePosterImageHuggingFace(imagePrompt)  // throws on failure
    return { url, provider: 'huggingface' }
  }
  throw new Error(
    'Poster generation unavailable. No AI image model is currently connected. ' +
    'Please verify Hugging Face token configuration.',
  )
}
