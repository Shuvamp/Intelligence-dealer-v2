"""
Integration surface for the intake pipeline's SCORE step (node 3).

Both the Python intake pipeline (agents/intake_pipeline, from the lead-management
branch) and the JS shim need node 3 to turn a NormalizedLead into the team
contract { score, score_value, reasons }. This function runs the full holistic
scoring agent IN-PROCESS and maps its rich output to that contract — so the
pipeline's score node becomes a one-liner and there is ONE scoring
implementation instead of two.

MERGE USAGE (replace the TODO stub in
apps/api/agents/intake_pipeline/nodes/score.py with):

    from agents.scoring.service import score_normalized_lead

    async def score_node(state, deps):
        # invoke is sync; off-load so the Groq call doesn't block the loop
        import asyncio
        normalized = state.get("normalized") or {}
        scoring = await asyncio.get_event_loop().run_in_executor(
            None, score_normalized_lead, normalized
        )
        return {"scoring": scoring}

This never raises — on any failure it returns a safe default so the pipeline
never breaks.
"""

import logging
from .graph import lead_scorer
from ..scoring_bridge import normalized_to_scoring_input

logger = logging.getLogger(__name__)


def category_to_bucket(category: str | None, score_value: int) -> str:
    """Agent's 5-way category → 4 UI score bands (HOT+ and HOT collapse to hot)."""
    c = (category or "").upper()
    if c in ("HOT+", "HOT"):
        return "hot"
    if c == "WARM":
        return "warm"
    if c == "COLD":
        return "cold"
    if c == "DEAD":
        return "dead"
    # numeric fallback (matches the framework thresholds)
    if score_value >= 65:
        return "hot"
    if score_value >= 40:
        return "warm"
    if score_value >= 15:
        return "cold"
    return "dead"


def score_normalized_lead(normalized: dict) -> dict:
    """
    NormalizedLead → { score, score_value, reasons, detail }.

    `score` is one of hot|warm|cold|dead. `detail` carries the full agent
    output (8-dimension breakdown, reasoning, flags) for the UI / DB if wanted.
    Never raises.
    """
    try:
        scoring_input = normalized_to_scoring_input(normalized or {})
        out = lead_scorer.invoke(scoring_input).get("final_output", {}) or {}

        value = (out.get("lead_score") or {}).get("total") or 0
        try:
            value = max(0, min(100, int(round(float(value)))))
        except (TypeError, ValueError):
            value = 0

        reasons = list(out.get("strengths") or [])
        reasons += [f"risk: {r}" for r in (out.get("risks") or [])]
        if out.get("recommended_action"):
            reasons.append(f"action: {out['recommended_action']}")

        return {
            "score": category_to_bucket(out.get("category"), value),
            "score_value": value,
            "reasons": reasons or ["scored by agent"],
            "score_notice": out.get("score_notice"),
            "detail": out,
        }
    except Exception:
        logger.exception("score_normalized_lead failed; returning safe default")
        return {
            "score": "warm",
            "score_value": 50,
            "reasons": ["scoring unavailable — safe default"],
            "score_notice": None,
            "detail": {},
        }
