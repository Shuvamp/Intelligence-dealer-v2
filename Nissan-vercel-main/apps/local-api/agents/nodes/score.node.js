'use strict'

const { bucketFor } = require('../pipeline-contracts')

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NODE 3 — SCORE            OWNER: CSRIRAM ✅ (done)                         ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  Position : Source ─▶ validate ─▶ normalize ─▶ [SCORE] ─▶ assign ─▶ DB     ║
 * ║  Reads    : state.normalized   (clean name / phone / email / vehicle / city)║
 * ║  Writes   : { scoring: { score, score_value, reasons } }                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * This node delegates to the REAL scoring agent — a Python LangGraph pipeline
 * (8 weighted dimensions + Groq LLM for intent/sentiment/reasoning, plus all of
 * CSRIRAM's edge cases) running as a FastAPI service (apps/api, POST /score).
 *
 *   score.node.js ──HTTP──▶ apps/api /score ──▶ Python LangGraph agent (Groq)
 *
 * If that service is unreachable (zero-config local dev with no Python API up),
 * it falls back to a deterministic heuristic so the pipeline NEVER breaks. The
 * full agent's rich output is mapped down to the team contract { score,
 * score_value, reasons }.
 *
 * Config: SCORING_API_URL env (default http://localhost:8000).
 * Contract: see ../pipeline-contracts.js
 */

const SCORING_API_URL = process.env.SCORING_API_URL || 'http://localhost:8000'

const HIGH_INTENT_SOURCES = new Set(['website', 'book-test-drive', 'test_drive_form'])
const SOCIAL_SOURCES = new Set(['facebook', 'instagram'])

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/** Map the Python agent's 5-way category → the app's 4 score bands. */
function categoryToBucket(category, scoreValue) {
  switch ((category || '').toUpperCase()) {
    case 'HOT+':
    case 'HOT':
      return 'hot'
    case 'WARM':
      return 'warm'
    case 'COLD':
      return 'cold'
    case 'DEAD':
      return 'dead'
    default:
      return bucketFor(scoreValue) // fall back to numeric thresholds
  }
}

/**
 * Deterministic fallback — used ONLY when the Python scoring service is down.
 * Mirrors the agent's dimensions so a no-service run still produces a sane score.
 * @returns {{ value:number, reasons:string[] }}
 */
function staticScore(lead = {}) {
  const reasons = []
  let intent = 0
  if (lead.vehicle) { intent += 10; reasons.push('specific vehicle interest') }
  if (lead.test_drive_required) { intent += 10; reasons.push('wants a test drive') }
  if (HIGH_INTENT_SOURCES.has(lead.source)) { intent += 5; reasons.push('high-intent website/form lead') }
  intent = clamp(intent, 0, 25)

  let engagement = 0
  if (lead.email) { engagement += 6; reasons.push('email provided') }
  if (lead.city) { engagement += 4; reasons.push('city known') }
  if (lead.contact_medium) { engagement += 6; reasons.push(`reachable via ${lead.contact_medium}`) }
  if (lead.callback_days != null && lead.callback_days <= 2) { engagement += 4; reasons.push('wants a quick callback') }
  engagement = clamp(engagement, 0, 20)

  let urgency = 0
  const t = lead.buy_timeline_days
  if (t != null) {
    if (t <= 7) { urgency += 20; reasons.push('buying within a week') }
    else if (t <= 30) { urgency += 14; reasons.push('buying this month') }
    else if (t <= 90) { urgency += 8; reasons.push('buying in 1–3 months') }
    else { urgency += 3; reasons.push('buying later (3+ months)') }
  }
  urgency = clamp(urgency, 0, 20)

  let financial = 0
  if (lead.budget != null) {
    const lakh = lead.budget / 100000
    if (lakh >= 25) financial += 12
    else if (lakh >= 18) financial += 10
    else if (lakh >= 12) financial += 8
    else if (lakh >= 8) financial += 6
    else financial += 3
    reasons.push(`budget ~₹${Math.round(lakh)}L`)
  }
  // financing readiness (new enquiry-form field) is a stronger purchase signal
  // than budget band alone — cash/pre-approved buyers convert fastest.
  switch (lead.financing) {
    case 'cash': financial += 8; reasons.push('paying by cash / own funds'); break
    case 'pre_approved': financial += 7; reasons.push('loan pre-approved'); break
    case 'loan_needed': financial += 3; reasons.push('needs a car loan'); break
    default: break
  }
  financial = clamp(financial, 0, 20)

  const productFit = lead.vehicle ? 10 : 0
  if (productFit) reasons.push('matched to a model in range')

  // relationship (new field) — existing/returning Nissan customers and referrals
  // carry trust the source channel can't express on its own.
  let relationship = 0
  switch (lead.nissan_relationship) {
    case 'current_owner': relationship = 5; reasons.push('existing Nissan owner'); break
    case 'referred': relationship = 4; reasons.push('referred by a customer'); break
    case 'past_owner': relationship = 3; reasons.push('past Nissan owner'); break
    default: break
  }

  // urgency boost from purchase reason (new field).
  if (lead.purchase_reason === 'occasion') { urgency = clamp(urgency + 5, 0, 20); reasons.push('buying for a wedding/festival') }
  else if (lead.purchase_reason === 'researching') { urgency = clamp(urgency - 4, 0, 20); reasons.push('just researching, no hurry') }

  // competitive trust (new field) — "only Nissan" is a positive; actively
  // comparing rivals is a mild risk.
  let competitive = 0
  if (lead.brand_consideration === 'only_nissan') { competitive = 3; reasons.push('set on Nissan, no rivals') }
  else if (lead.brand_consideration === 'comparing') { competitive = -2; reasons.push('comparing other brands') }

  let sourceTrust = 2
  if (HIGH_INTENT_SOURCES.has(lead.source)) sourceTrust = 5
  else if (SOCIAL_SOURCES.has(lead.source)) sourceTrust = 3

  const value = clamp(
    Math.round(intent + engagement + urgency + financial + productFit + relationship + competitive + sourceTrust), 0, 100,
  )
  return { value, reasons }
}

/** Call the Python scoring agent. Throws on any failure so caller can fall back. */
// 30s: the holistic scorer sends the full md rubric to Groq, which can take
// several seconds. Keep generous so a slow LLM call isn't discarded for the
// deterministic JS heuristic.
async function callScoringAgent(lead, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${SCORING_API_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`scoring API ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {import('../pipeline-contracts').PipelineState} state
 * @param {import('../pipeline-contracts').NodeDeps} deps
 * @returns {Promise<{ scoring: import('../pipeline-contracts').Scoring }>}
 */
async function scoreNode(state, deps) {
  const lead = state.normalized ?? {}

  // ── Primary path: the real Python LangGraph scoring agent ──────────────────
  try {
    const out = await callScoringAgent(lead)
    const scoreValue = clamp(Math.round(Number(out.lead_score?.total ?? 0)), 0, 100)
    const reasons = [
      ...(out.strengths || []),
      ...(out.risks || []).map((r) => `risk: ${r}`),
    ]
    if (out.recommended_action) reasons.push(`action: ${out.recommended_action}`)

    return {
      scoring: {
        score: categoryToBucket(out.category, scoreValue),
        score_value: scoreValue,
        reasons: reasons.length ? reasons : ['scored by agent'],
        // surfaced at top level for the DB/SSE layer; null means normal scoring.
        score_notice: out.score_notice ?? null,
        // full agent output preserved for downstream/UI use (extra field, ignored by DB layer)
        detail: out,
      },
    }
  } catch (err) {
    console.warn('[score] Python scoring agent unavailable, deterministic fallback:', err.message)
  }

  // ── Fallback: deterministic heuristic (zero-config, never breaks pipeline) ─
  const base = staticScore(lead)
  return {
    scoring: {
      score: bucketFor(base.value),
      score_value: base.value,
      reasons: base.reasons,
      score_notice: "Python scoring API (:8000) unreachable — used the shim's built-in static heuristic.",
    },
  }
}

module.exports = { scoreNode, staticScore, callScoringAgent, categoryToBucket }
