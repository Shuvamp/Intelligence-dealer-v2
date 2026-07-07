'use strict'

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LEAD INTAKE PIPELINE — SHARED CONTRACT  (read this FIRST before coding)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Every lead — from the Website form, Facebook demo, or Instagram demo —
 * flows through ONE pipeline of 4 agent nodes, in this exact order:
 *
 *     Source ─▶ validate ─▶ normalize ─▶ score ─▶ assign ─▶ DuckDB
 *               (Amirtha)   (Partha)     (Csriram) (Keerthana)
 *
 * Each node is a PLAIN async function:  async (state, deps) => partialState
 *   • It RECEIVES the shared `state` (everything produced so far) + `deps`.
 *   • It RETURNS only the slice of state it owns (merged into the pipeline).
 *   • It NEVER imports LangGraph and NEVER touches another node's file.
 *
 * The orchestrator (lead-intake-agent.js) wires the 4 nodes together. You only
 * edit YOUR node file. That's how 4 people work without merge conflicts.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  THE SHARED STATE  (grows as it passes through the pipeline)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @typedef {Object} PipelineState
 * @property {Object}          rawLead     INPUT — raw fields from the source
 * @property {string}          source      INPUT — 'website' | 'facebook' | 'instagram'
 * @property {string[]}        errors      ← validate writes  (non-empty = reject)
 * @property {NormalizedLead}  normalized  ← normalize writes
 * @property {Scoring}         scoring     ← score writes
 * @property {Assignment}      assignment  ← assign writes
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  PER-NODE INPUT / OUTPUT CONTRACTS  (this is the integration boundary)
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  NODE 1 — validate   (owner: AMIRTHA)        file: nodes/validate.node.js
 *    reads : state.rawLead, state.source
 *    writes: { errors: string[] }              // [] = pass, [..] = reject (HTTP 400)
 *
 *  NODE 2 — normalize  (owner: PARTHA ✅)       file: nodes/normalize.node.js
 *    reads : state.rawLead, state.source
 *    writes: { normalized: NormalizedLead }
 *
 *  NODE 3 — score      (owner: CSRIRAM)        file: nodes/score.node.js
 *    reads : state.normalized
 *    writes: { scoring: Scoring }
 *
 *  NODE 4 — assign     (owner: KEERTHANA)      file: nodes/assign.node.js
 *    reads : state.normalized, state.scoring
 *    writes: { assignment: Assignment }
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  SHARED OUTPUT SHAPES  (do not change field names — the DB layer depends on them)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @typedef {Object} NormalizedLead
 * @property {string}      name      properly-capitalized full name (required)
 * @property {string}      phone     digits + leading '+' only (required)
 * @property {string|null} email     lowercase email or null
 * @property {string|null} vehicle   vehicle model of interest or null
 * @property {string|null} city      city name or null
 * @property {boolean}     test_drive_required   wants a test drive?           → leads.test_drive_required
 * @property {number|null} budget                expected budget (₹, numeric)  → leads.budget
 * @property {number|null} buy_timeline_days     expects to buy within N days  → leads.purchase_timeline_days
 * @property {number|null} callback_days         wants a callback within N days → leads.callback_within_days
 * @property {string|null} contact_medium        preferred channel (WhatsApp / Phone call / Email / SMS) → leads.contact_medium
 * @property {string|null} financing             cash | pre_approved | loan_needed | unsure → leads.financing
 * @property {string|null} nissan_relationship   current_owner | past_owner | referred | new → leads.nissan_relationship
 * @property {string|null} brand_consideration   only_nissan | comparing → leads.brand_consideration
 * @property {string|null} comparing_brands      free text rivals when brand_consideration=comparing → leads.comparing_brands
 * @property {string|null} purchase_reason       replacement | occasion | business | first_car | researching → leads.purchase_reason
 * @property {string}      source    echoed source channel
 * @property {string}      status    'New'
 *
 * @typedef {Object} Scoring
 * @property {'hot'|'warm'|'cold'} score        bucket  → leads.score
 * @property {number}              score_value  0..100  → leads.score_value
 * @property {string[]}            reasons       human-readable scoring factors
 *
 * @typedef {Object} Assignment
 * @property {string|null} assigned_to    user id of the sales rep → leads.assigned_to
 * @property {string|null} assignee_name  rep's name (for the toast / activity log)
 * @property {string}      reason         why this rep (round-robin, territory, etc.)
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  `deps` — everything a node needs, injected by the orchestrator
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @typedef {Object} NodeDeps
 * @property {(sql:string,params?:any[])=>Promise<any[]>} all    run a SELECT, get rows
 * @property {(sql:string,params?:any[])=>Promise<void>}  run    run an INSERT/UPDATE
 * @property {string}        tenantId     ABC tenant id (all intake leads belong here)
 * @property {() => any|null} getModel    returns a Claude chat model, or null if no API key
 */

/** Canonical empty pipeline state — the orchestrator seeds every run with this. */
function emptyState(rawLead, source) {
  return {
    rawLead,
    source,
    errors: [],
    normalized: null,
    scoring: null,
    assignment: null,
  }
}

/** Score buckets, in order of heat. Shared so score + UI agree on the vocabulary. */
const SCORE_BUCKETS = ['cold', 'warm', 'hot']

/** Map a 0..100 score_value to a bucket. Used as the default scoring heuristic. */
function bucketFor(value) {
  if (value >= 70) return 'hot'
  if (value >= 40) return 'warm'
  return 'cold'
}

module.exports = { emptyState, SCORE_BUCKETS, bucketFor }
