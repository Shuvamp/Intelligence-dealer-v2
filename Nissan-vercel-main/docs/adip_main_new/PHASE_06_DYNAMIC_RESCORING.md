# PHASE 6 — DYNAMIC RE-SCORING AGENT

## Status

Planned — **owner: Sriram.** Consumes the signal produced by Phase 5 (Call
Intelligence, see `PHASE_05_CALL_INTELLIGENCE.md`).

Lifecycle position:

```
… → Workflow → Follow-up → Call Intelligence (Phase 5) → Dynamic Re-Scoring (Phase 6)
```

## Objective

Keep a lead's score current as new interactions happen. Today scoring runs
**once, at intake**. Phase 6 re-evaluates the score when something material
changes (a call is analysed, a WhatsApp reply arrives, a test drive is booked),
persists score history, and re-triggers the Workflow Agent so the next-best
action reflects the new score.

## Scope

**In scope (Phase 6 owns):**
- A `/rescore/{lead_id}` entry point that other agents call
- Computing the new score and updating `leads.score` / `score_value`
- Persisting score history (`lead_score_history`) and the triggering events
  (`score_events`)
- Re-triggering the Workflow Agent (`trigger_source` propagated)
- Audit trail for every score change

**Out of scope (other phases):**
- Producing call analysis (Phase 5)
- The Workflow Agent's decision logic itself (already exists, Phase 3)

## Triggers

Phase 6 is event-driven. Each trigger is a thin caller that hands Phase 6 a
`lead_id` + a `trigger_source` + (optionally) a reference to the source record:

| trigger_source | Fired by | Reference |
|---|---|---|
| `call_intelligence` | **Phase 5 Call Intelligence** | `call_id` → `call_analysis` |
| `whatsapp_reply` | WhatsApp Agent inbound webhook (Phase 4) | message id |
| `test_drive` | stage change to `test_drive` | lead event |
| `manual` | rep-initiated re-score (UI button) | — |

(Start with `call_intelligence`; the others are additive — same entry point.)

## Integration contract with Phase 5  ⚠️ KEEP IN SYNC WITH PHASE 5 DOC

- **Inbound trigger:** `POST /rescore/{lead_id}` with body
  `{ "trigger_source": "call_intelligence", "call_id": "<uuid>" }`
  (fire-and-forget from the caller's side).
- **What Phase 6 reads:** the `call_analysis` row keyed by `call_id`
  (sentiment, interest_level, buying_intent_score, competitors, competitor_risk,
  price_sensitivity, purchase_timeline, test_drive_interest, followup_requested).
  Phase 5 guarantees the row is `completed` before it fires the trigger.
- **Phase 6 must be resilient:** if `call_id` is missing or the row isn't ready,
  log and no-op rather than raising — never break the caller.

## Process

```
Trigger (POST /rescore/{lead_id})
   → load lead + the source interaction (e.g. call_analysis by call_id)
   → compute new score  (see "Re-scoring engine" below)
   → if classification/score changed:
        update leads.score / score_value
        write lead_score_history row
        write score_events row
   → POST /workflow/{lead_id}  { "trigger_source": <propagated> }
   → audit
```

## Re-scoring engine — recommended approach

There is **already a Scoring Agent** (`apps/api/agents/scoring/`) that scores
from a natural-language `interaction_log` across 8 holistic dimensions, with a
Claude → Groq → NVIDIA → deterministic failover ladder. **Reuse it as the
re-scoring engine** rather than building a second scoring model:

- Build the scorer's input from the lead **plus the accumulated interactions**
  (original enquiry + every completed `call_analysis` customer_summary, etc.) —
  extend `agents/scoring_bridge.py` with a `lead_with_calls_to_scoring_input()`
  helper, then call the existing `lead_scorer.invoke()`.
- **Why this beats deterministic `+20 / -15` deltas:**
  - no second scoring model (the master plan forbids one);
  - **idempotent** — recomputes from the full interaction set, so a retried
    call analysis can't double-count;
  - identical classification thresholds (same agent) — no drift;
  - holistic — picks up engagement/urgency/competitive, not just N hardcoded rules.
- For cost, the re-score path can prefer Groq (env `RESCORE_LLM=groq`) since it
  runs per-interaction, not per-pageview.

A deterministic delta table is an acceptable interim if the LLM path is
deferred — but keep the adjustment logic in one pure, unit-tested function so it
can be swapped for the Scoring Agent later.

## Database tables — migration `0023` (after Phase 5's `0022`) + shim parity + RLS

**lead_score_history** (append-only)
- id, tenant_id, lead_id, old_value, new_value, old_band, new_band,
  trigger_source, source_ref (e.g. call_id), created_at

**score_events**
- id, tenant_id, lead_id, event_type, trigger_source, payload (jsonb),
  created_at

## Workflow integration

After a score change, re-trigger the existing Workflow Agent:
`POST /workflow/{lead_id}` with the propagated `trigger_source`. The Workflow
Agent already accepts `trigger_source="rescore"` / `"call_intelligence"` as
wired-but-unused extension points (see CURRENT_ARCHITECTURE §13). Phase 6 never
decides actions itself — Workflow stays authoritative.

## Idempotency

Recompute from the full interaction set (preferred), or store the per-source
adjustment and recompute `score = base + Σ(adjustments)` if using deltas — so
re-running the same trigger yields the same score. `lead_score_history` is
append-only and doubles as an audit/history.

## Acceptance criteria

- ✓ `POST /rescore/{lead_id}` accepts `{trigger_source, call_id}` and is resilient
  to a missing/not-ready source row
- ✓ Reads Phase 5's `call_analysis` by `call_id`
- ✓ Updates `leads.score` / `score_value` only when the score changes
- ✓ `lead_score_history` + `score_events` written; history retained
- ✓ Re-triggers the Workflow Agent with the propagated `trigger_source`
- ✓ Idempotent — a retried trigger does not double-count
- ✓ No second scoring engine introduced (reuse the Scoring Agent) — or a single
  pure-function delta interim, documented as such
- ✓ Audit trail for every score change
