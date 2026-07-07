'use strict'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NODE 2 — NORMALIZE         OWNER: PARTHA ✅ (done)                         ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  Position : Source ─▶ validate ─▶ [NORMALIZE] ─▶ score ─▶ assign ─▶ DB     ║
 * ║  Reads    : state.rawLead, state.source                                    ║
 * ║  Writes   : { normalized: NormalizedLead }                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Cleans + standardizes the raw lead. Uses Claude Haiku when ANTHROPIC_API_KEY
 * is set (deps.getModel() returns a model); otherwise deterministic fallback so
 * local dev always works with zero config.
 *
 * Contract: see ../pipeline-contracts.js
 */

const NORMALIZE_TEMPLATE = `You are a lead data normalization agent for a car dealership CRM.
Normalize the following raw lead data into a standard format.
Return ONLY a valid JSON object — no markdown, no explanation.

Raw lead data (JSON): {rawData}
Source channel: {source}

Return exactly this JSON structure:
{{
  "name": "full name, properly capitalized",
  "phone": "digits and leading + only",
  "email": "lowercase email or null",
  "vehicle": "vehicle model of interest or null",
  "city": "city name or null",
  "source": "{source}",
  "status": "New"
}}`

/** Coerce a value to a number, or null. */
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Coerce a truthy/"yes"/true value to boolean. */
function bool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return ['yes', 'true', '1', 'y'].includes(v.toLowerCase().trim())
  return Boolean(v)
}

/** Deterministic fallback — no LLM required. */
function staticNormalize(rawLead, source) {
  return {
    name: String(rawLead.name ?? '').trim(),
    phone: String(rawLead.phone ?? '').trim(),
    email: rawLead.email ? String(rawLead.email).toLowerCase().trim() || null : null,
    vehicle: rawLead.vehicle ?? rawLead.vehicle_interest ?? null,
    city: rawLead.city ?? null,
    // intake preferences (carried through the pipeline → stored on the lead)
    test_drive_required: bool(rawLead.test_drive ?? rawLead.test_drive_required),
    budget: num(rawLead.budget),
    buy_timeline_days: num(rawLead.buy_timeline_days),
    callback_days: num(rawLead.callback_days),
    contact_medium: rawLead.contact_medium ? String(rawLead.contact_medium).trim() : null,
    // Enquiry-form signal fields — carried verbatim so score.node.js → /score →
    // scoring_bridge can turn them into scoring notes (financial / relationship /
    // competitive / urgency dimensions). Pass-through strings, no coercion.
    financing: rawLead.financing ? String(rawLead.financing).trim() : null,
    nissan_relationship: rawLead.nissan_relationship ? String(rawLead.nissan_relationship).trim() : null,
    brand_consideration: rawLead.brand_consideration ? String(rawLead.brand_consideration).trim() : null,
    comparing_brands: rawLead.comparing_brands ? String(rawLead.comparing_brands).trim() : null,
    purchase_reason: rawLead.purchase_reason ? String(rawLead.purchase_reason).trim() : null,
    source,
    status: 'New',
  }
}

/**
 * @param {import('../pipeline-contracts').PipelineState} state
 * @param {import('../pipeline-contracts').NodeDeps} deps
 * @returns {Promise<{ normalized: import('../pipeline-contracts').NormalizedLead }>}
 */
async function normalizeNode(state, deps) {
  const base = staticNormalize(state.rawLead, state.source)
  const model = deps.getModel?.()
  if (model && deps.chain) {
    try {
      const result = await deps.chain.invoke({
        rawData: JSON.stringify(state.rawLead, null, 2),
        source: state.source,
      })
      // Claude cleans the identity fields; keep our coerced preference fields.
      return { normalized: { ...base, ...result, source: state.source, status: 'New' } }
    } catch (err) {
      console.warn('[normalize] Claude failed, static fallback:', err.message)
    }
  }
  return { normalized: base }
}

module.exports = { normalizeNode, staticNormalize, NORMALIZE_TEMPLATE }
