"""State contract for the Dynamic Re-Scoring Agent (Phase 6).

Phase 5 integration point
─────────────────────────
`call_sentiment` is the only field sourced from Phase 5 (Call Intelligence).
It is always None today — the scoring agent handles None gracefully (it maps to
an empty call_recordings list, so the sentiment_score dimension simply uses its
default weight). When Phase 5 is integrated it will pass a sentiment string in
the POST /rescore/{lead_id} body; no structural changes are needed here.
"""
from typing import Optional, TypedDict


class RescoringState(TypedDict):
    # ── Input ─────────────────────────────────────────────────────────────────
    lead_id: str
    tenant_id: str
    # Trigger vocabulary:
    #   intake | manual | stage_change | whatsapp_replied | test_drive_booked
    #   lead_activity | email_opened | manager_interaction
    #   call_completed  ← TEMP: fires only when Phase 5 is integrated
    trigger: str

    # TEMP: Phase 5 integration point.
    # Call Intelligence Agent sets this when trigger="call_completed".
    # Accepted values: positive|neutral|negative|interested|price_concern|
    #   competitor_mention|follow_up_requested|no_interest
    # Currently always None — scoring agent falls back to 0 for sentiment dim.
    call_sentiment: Optional[str]

    # ── Context (fetch_lead_context) ──────────────────────────────────────────
    lead: dict
    events: list[dict]
    messages: list[dict]
    previous_score: Optional[str]       # hot|warm|cold|dead
    previous_score_value: Optional[int]

    # ── Scoring result (compute_new_score) ────────────────────────────────────
    new_score: Optional[str]
    new_score_value: Optional[int]
    score_reasons: list[str]
    scored_by: Optional[str]            # claude|groq|groq_backup|nvidia|deterministic
    score_changed: bool

    # ── Persistence (store_history) ───────────────────────────────────────────
    history_id: Optional[str]
    score_event_id: Optional[str]

    # ── Errors ────────────────────────────────────────────────────────────────
    errors: list[str]
