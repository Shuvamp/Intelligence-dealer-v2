'use strict'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NODE 1 — VALIDATE          OWNER: AMIRTHA                                  ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  Position : Source ─▶ [VALIDATE] ─▶ normalize ─▶ score ─▶ assign ─▶ DB     ║
 * ║  Reads    : state.rawLead, state.source                                    ║
 * ║  Writes   : { errors: string[] }   // []  = pass, continue                 ║
 * ║                                    // [..] = reject → pipeline stops (400)  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Calls the Python lead_validator agent (apps/api — POST /validate-lead).
 * The validator runs phone/email/field checks and persists the customer+lead
 * to DuckDB. On success it writes lead_id and customer_id onto rawLead so
 * processIntakeLead can patch score/assignment onto the existing record.
 *
 * Falls back to basic name+phone check if the FastAPI is unreachable (local dev
 * without the Python server running).
 *
 * Contract: see ../pipeline-contracts.js
 */

// Map form numeric values → enums the FastAPI lead_validator expects.
// These are the exact select values from book-test-drive.tsx.
const BUDGET_MAP    = { 700000: 'under_8l', 1000000: '8_12l', 1500000: '12_18l', 2100000: '18_25l', 2800000: 'above_25l' }
const TIMELINE_MAP  = { 7: 'immediately', 30: 'this_month', 90: '1_3_months', 180: '3_6_months', 365: 'just_exploring' }
const CALLBACK_MAP  = { 1: 'today', 2: 'within_2_days', 7: 'this_week', 14: 'no_rush' }
const CHANNEL_MAP   = { WhatsApp: 'whatsapp', 'Phone call': 'phone_call', Email: 'email', SMS: 'sms' }

/**
 * @param {import('../pipeline-contracts').PipelineState} state
 * @param {import('../pipeline-contracts').NodeDeps} deps
 * @returns {Promise<{ errors: string[] }>}
 */
async function validateNode(state, deps) {
  const errors = []
  const raw = state.rawLead ?? {}

  // NOTE: was defaulting to :8001 — nothing listens there; the FastAPI agent
  // service (and the real lead_validator it serves) runs on :8000, same as
  // SCORING_API_URL in score.node.js.
  const VALIDATOR_URL = process.env.LEAD_VALIDATOR_URL ?? 'http://localhost:8000'
  const TENANT_ID     = deps.tenantId ?? process.env.LEAD_INTAKE_TENANT_ID ?? 'abc-nissan'

  const body = {
    tenant_id:          TENANT_ID,
    source:             state.source ?? 'website',
    full_name:          raw.name ?? null,
    phone:              raw.phone ?? null,
    email:              raw.email ?? null,
    vehicle_interest:   raw.vehicle ?? null,
    city:               raw.city ?? null,
    test_drive_requested: raw.test_drive ?? null,
    budget_range:       BUDGET_MAP[raw.budget] ?? null,
    purchase_timeframe: TIMELINE_MAP[raw.buy_timeline_days] ?? null,
    preferred_call_time: CALLBACK_MAP[raw.callback_days] ?? null,
    preferred_channel:  CHANNEL_MAP[raw.contact_medium] ?? null,
  }

  try {
    const res = await fetch(`${VALIDATOR_URL}/validate-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const result = await res.json()

    if (result.status === 'invalid') {
      for (const e of (result.errors ?? [])) errors.push(e.message)
    } else {
      // Attach IDs onto rawLead (passed by reference) so processIntakeLead
      // can patch score/assignment onto the record the validator created.
      raw._lead_id      = result.lead_id
      raw._customer_id  = result.customer_id
      raw._is_duplicate = result.is_duplicate
    }
  } catch (err) {
    console.warn('[validate] FastAPI unavailable, basic fallback:', err.message)
    if (!raw.name?.trim())  errors.push('name is required')
    if (!raw.phone?.trim()) errors.push('phone is required')
  }

  return { errors }
}

module.exports = { validateNode }
