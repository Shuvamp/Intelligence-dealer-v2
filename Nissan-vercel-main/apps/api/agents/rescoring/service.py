"""Dynamic Re-Scoring Service (Phase 6).

Re-runs the EXISTING scoring agent whenever a significant lead event fires
(WhatsApp reply, stage change, test drive, manual trigger, etc.) and persists
the result to lead_score_history + score_events. If the score changes, the
Workflow Agent re-evaluates recommended actions.

This is intentionally a plain async function — NOT a new LangGraph agent.
The existing `score_normalized_lead()` (agents/scoring/service.py) already
handles the full Claude → Groq → deterministic fallback chain; all we do here
is build fresh context from the DB, call it, and persist the result.

Phase 5 integration points
──────────────────────────
Two # TEMP markers below are the only things that change when Phase 5 lands:
  1. `call_recordings=[]`  → provide real transcript chunks from call_transcripts table
  2. `call_sentiment` arg  → add as a natural-language note in interaction_log
Phase 5 calls `POST /rescore/{lead_id}` with {"trigger":"call_completed","call_sentiment":"positive"}.
No structural changes to this file are needed.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

import httpx

from agents.scoring.service import score_normalized_lead
from agents.events import bus, DomainEvent, EventType  # Phase 7 — publish LEAD_RESCORED
from .data import RescoringData

logger = logging.getLogger(__name__)

import os
SUPABASE_URL = os.getenv("SUPABASE_URL", "http://localhost:54321")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "local-dev-anon-key")

_data = RescoringData()

# Human-readable labels for the score history panel in the UI.
TRIGGER_LABEL = {
    "intake":              "Initial intake",
    "manual":              "Manual re-score",
    "stage_change":        "Stage change",
    "whatsapp_replied":    "WhatsApp reply",
    "test_drive_booked":   "Test drive booked",
    "call_completed":      "Call completed",   # Phase 5 trigger
    "lead_activity":       "Lead activity",
    "email_opened":        "Email opened",
    "manager_interaction": "Manager interaction",
}


def _build_scoring_input(
    lead: dict,
    events: list[dict],
    messages: list[dict],
    call_sentiment: str | None = None,
    call_analysis: dict | None = None,
) -> dict:
    """Build a LeadState-compatible dict from live DB rows.

    Mirrors the logic in agents/scoring_bridge.py (which converts form fields
    to scoring input at intake time). Here we read persisted DB rows instead.
    The scoring agent receives the same shape either way.
    """
    notes: list[str] = []

    source = (lead.get("source") or "").lower()
    source_note = {
        "instagram": "Instagram ad lead.",
        "facebook":  "Facebook ad lead.",
        "website":   "High-intent website form enquiry.",
        "walkin":    "Walk-in to showroom.",
        "referral":  "Referred by existing customer.",
        "phone":     "Inbound phone enquiry.",
    }.get(source, "")
    if source_note:
        notes.append(source_note)

    if lead.get("vehicle_interest"):
        notes.append(f"Interested in {lead['vehicle_interest']}.")

    if lead.get("budget"):
        try:
            lakh = float(lead["budget"]) / 100_000
            notes.append(f"Budget around {round(lakh)} lakh.")
        except (TypeError, ValueError):
            pass

    stage = lead.get("stage", "")
    if stage:
        notes.append(f"Current pipeline stage: {stage.replace('_', ' ')}.")

    # Enrich from event history
    for ev in events:
        ev_type = ev.get("type", "")
        summary = ev.get("summary", "")
        if ev_type == "test_drive":
            notes.append("Test drive completed.")
        elif ev_type == "call" and summary:
            notes.append(f"Call logged: {summary[:120]}")
        elif ev_type == "stage_change" and summary:
            notes.append(f"Stage change: {summary[:80]}")
        elif ev_type in ("note", "agent", "nba") and summary:
            notes.append(f"Note: {summary[:120]}")

    # Inbound WhatsApp replies are a strong positive engagement signal
    inbound_wa = [m for m in messages if m.get("direction") == "inbound" and m.get("channel") == "whatsapp"]
    if inbound_wa:
        notes.append(f"Customer has replied {len(inbound_wa)} time(s) via WhatsApp.")

    # Phase 5 integration — enrich scoring input from call analysis.
    if call_sentiment:
        notes.append(f"Call sentiment: {call_sentiment}.")
    if call_analysis:
        interest = call_analysis.get("interest_level")
        if interest:
            notes.append(f"Call interest level: {interest}.")
        intent = call_analysis.get("buying_intent_score")
        if intent is not None:
            notes.append(f"Buying intent score from call: {intent}/100.")
        competitors = call_analysis.get("competitors") or []
        if competitors:
            notes.append(f"Competitor mentions in call: {', '.join(str(c) for c in competitors)}.")
        comp_risk = call_analysis.get("competitor_risk")
        if comp_risk and comp_risk != "none":
            notes.append(f"Competitor risk from call: {comp_risk}.")
        if call_analysis.get("test_drive_interest"):
            notes.append("Customer expressed test drive interest on call.")
        if call_analysis.get("followup_requested"):
            notes.append("Customer requested a follow-up on call.")
        purchase_timeline = call_analysis.get("purchase_timeline")
        if purchase_timeline and purchase_timeline != "unknown":
            notes.append(f"Purchase timeline from call: {purchase_timeline.replace('_', ' ')}.")
        summary_lines = call_analysis.get("customer_summary") or []
        if summary_lines:
            summary_text = "; ".join(str(s) for s in summary_lines[:3])
            notes.append(f"Call summary: {summary_text}.")

    # Build call_recordings for the scoring agent's dedicated dimension.
    call_recordings: list = []
    if call_analysis:
        call_recordings = [{
            "date": call_analysis.get("created_at", ""),
            "transcript_summary": "; ".join(
                str(s) for s in (call_analysis.get("customer_summary") or [])[:5]
            ),
            "sentiment": call_analysis.get("sentiment", ""),
            "duration_seconds": None,
        }]

    # WhatsApp log for the scoring agent's dedicated dimension
    whatsapp_log = [
        {
            "date": m.get("created_at", ""),
            "direction": m.get("direction", "outbound"),
            "body": (m.get("body") or "")[:200],
        }
        for m in messages
        if m.get("channel") == "whatsapp"
    ]

    interaction_type = "walk_in" if source == "walkin" else "inbound_call"
    return {
        "lead_id":           str(lead.get("id") or ""),
        "customer_name":     lead.get("customer_name") or "",
        "phone":             lead.get("phone") or "",
        "email":             lead.get("email") or "",
        "interaction_log": [
            {
                "date": lead.get("created_at", datetime.now(timezone.utc).isoformat()),
                "type": interaction_type,
                "notes": " ".join(notes) if notes else "Lead activity.",
                "salesperson_id": "",
            }
        ],
        "call_recordings":   call_recordings,  # TEMP: Phase 5 integration point
        "whatsapp_log":      whatsapp_log,
        "website_analytics": {},
        "missing_data_flags": [],
        "validation_flags":   [],
        "strengths":          [],
        "risks":              [],
    }


async def rescore_lead(
    lead_id: str,
    tenant_id: str,
    trigger: str,
    call_sentiment: str | None = None,
    call_id: str | None = None,
) -> dict:
    """Re-score a lead using the existing scoring agent.

    Returns a result dict:
      { score_changed, new_score, previous_score, new_score_value, errors }

    Never raises — errors are captured and returned.
    """
    now = datetime.now(timezone.utc).isoformat()
    errors: list[str] = []

    # ── 1. Load context ───────────────────────────────────────────────────────
    try:
        lead = await _data.get_lead(lead_id)
    except Exception:
        logger.exception("rescore_lead: get_lead failed for %s", lead_id)
        return {"score_changed": False, "errors": ["get_lead_failed"]}

    if not lead:
        logger.warning("rescore_lead: lead %s not found", lead_id)
        return {"score_changed": False, "errors": ["lead_not_found"]}

    previous_score = lead.get("score")
    previous_value = lead.get("score_value") or 0

    try:
        events = await _data.get_events(lead_id)
        messages = await _data.get_messages(lead_id)
    except Exception:
        logger.exception("rescore_lead: context fetch failed for %s", lead_id)
        events, messages = [], []
        errors.append("context_fetch_partial")

    call_analysis: dict | None = None
    if call_id:
        try:
            call_analysis = await _data.get_call_analysis(call_id)
            if not call_analysis:
                logger.warning("rescore_lead: call_analysis %s not found for lead %s", call_id, lead_id)
            elif call_analysis.get("sentiment") and not call_sentiment:
                call_sentiment = call_analysis["sentiment"]
        except Exception:
            logger.exception("rescore_lead: get_call_analysis failed for call %s", call_id)
            errors.append("call_analysis_fetch_partial")

    # ── 2. Build scoring input + call existing agent ──────────────────────────
    scoring_input = _build_scoring_input(lead, events, messages, call_sentiment, call_analysis)

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, score_normalized_lead, scoring_input
        )
    except Exception:
        logger.exception("rescore_lead: score_normalized_lead failed for %s", lead_id)
        return {"score_changed": False, "errors": [*errors, "scoring_failed"]}

    new_score = result.get("score") or previous_score
    new_value = result.get("score_value") or 0
    score_reasons = result.get("reasons") or []
    scored_by = (result.get("detail") or {}).get("scored_by") or "deterministic"
    score_changed = new_score != previous_score

    # ── 3. Update lead row (only when score actually changed) ─────────────────
    if score_changed:
        try:
            await _data.update_lead_score(
                lead_id, new_score, new_value, score_reasons, scored_by, now
            )
        except Exception:
            logger.exception("rescore_lead: update_lead_score failed for %s", lead_id)
            errors.append("update_lead_failed")

    # ── 4. Persist history (always — gives a full audit trail) ───────────────
    try:
        await _data.create_score_history({
            "tenant_id":      tenant_id,
            "lead_id":        lead_id,
            "score":          new_score,
            "score_value":    new_value,
            "previous_score": previous_score,
            "previous_value": previous_value,
            "trigger":        trigger,
            "scored_by":      scored_by,
            "score_reasons":  score_reasons,
            "created_at":     now,
        })
    except Exception:
        logger.exception("rescore_lead: create_score_history failed for %s", lead_id)
        errors.append("history_insert_failed")

    try:
        await _data.create_score_event({
            "tenant_id":  tenant_id,
            "lead_id":    lead_id,
            "event_type": trigger,
            "metadata":   {"call_sentiment": call_sentiment} if call_sentiment else {},
            "processed":  True,
            "created_at": now,
        })
    except Exception:
        logger.exception("rescore_lead: create_score_event failed for %s", lead_id)
        errors.append("score_event_insert_failed")

    # ── 5. Phase 7: publish LEAD_RESCORED instead of calling Workflow directly.
    # The workflow subscriber (_on_lead_rescored) re-runs the Workflow Agent only
    # when the score changed. The whatsapp_replied special-case is gone — the
    # inbound path now also flows through events, so there's no duplicate run to
    # avoid: MESSAGE_READ → rescore → LEAD_RESCORED → workflow.
    try:
        await bus.publish(DomainEvent(
            type=EventType.LEAD_RESCORED,
            tenant_id=tenant_id,
            lead_id=lead_id,
            payload={
                "score_changed": score_changed,
                "new_score": new_score,
                "previous_score": previous_score,
                "trigger": trigger,
            },
            source="rescoring",
        ))
    except Exception:
        logger.exception("rescore_lead: LEAD_RESCORED publish failed for %s", lead_id)
        errors.append("event_publish_failed")

    # ── 6. Broadcast SSE so the browser score badge updates live ─────────────
    try:
        def _sb_headers() -> dict:
            return {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            }

        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=5) as c:
            await c.post("/events/rescore-complete", json={
                "type":           "rescore_complete",
                "lead_id":        lead_id,
                "new_score":      new_score,
                "previous_score": previous_score,
                "score_changed":  score_changed,
                "trigger":        trigger,
            }, headers=_sb_headers())
    except Exception:
        logger.warning("rescore_lead: SSE broadcast failed for %s", lead_id)

    label = TRIGGER_LABEL.get(trigger, trigger)
    if score_changed:
        logger.info(
            "rescore_lead: %s → %s→%s (trigger=%s via %s)",
            lead_id, previous_score, new_score, trigger, scored_by,
        )
    else:
        logger.info(
            "rescore_lead: %s score unchanged (%s, trigger=%s)",
            lead_id, previous_score, trigger,
        )

    return {
        "score_changed":    score_changed,
        "new_score":        new_score,
        "previous_score":   previous_score,
        "new_score_value":  new_value,
        "trigger":          trigger,
        "trigger_label":    label,
        "scored_by":        scored_by,
        "errors":           errors,
    }
