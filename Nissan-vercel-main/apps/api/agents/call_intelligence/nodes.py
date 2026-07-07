"""Call Intelligence Agent nodes (Phase 5).

transcribe → extract → persist → handoff → END

Every node follows the "never break the platform" rule: no node raises, a
partial failure degrades to a safe default and is recorded in `errors`. The
recording's `status` column tracks progress (transcribing → analyzing →
completed | failed) so the UI and the manual /analyze retry can resume.
"""
from __future__ import annotations

import asyncio
import logging
import os

from agents.events import bus, DomainEvent, EventType

from .data import CallData
from .extract import extract_analysis
from .state import CallIntelligenceState
from .transcribe import transcribe_audio

logger = logging.getLogger(__name__)
_data = CallData()

# Phase 7: the call→re-score handoff is now an event, not a direct HTTP call.
# `CALL_AUTO_RESCORE=0` skips publishing the CALL_COMPLETED event.
AUTO_RESCORE = os.getenv("CALL_AUTO_RESCORE", "1") != "0"


async def transcribe_node(state: CallIntelligenceState) -> dict:
    errors = list(state.get("errors", []))
    try:
        await _data.update_recording(state["call_id"], {"status": "transcribing"})
    except Exception:  # noqa: BLE001
        logger.warning("could not set status=transcribing for %s", state["call_id"])

    # transcribe_audio is sync + CPU-bound — off-load so it never blocks the loop.
    loop = asyncio.get_event_loop()
    transcript, language = await loop.run_in_executor(None, transcribe_audio, state["audio_path"])

    try:
        await _data.create_transcript({
            "tenant_id": state["tenant_id"],
            "call_id": state["call_id"],
            "transcript": transcript,
            "language_detected": language,
        })
    except Exception:  # noqa: BLE001
        logger.exception("call_transcripts insert failed")
        errors.append("persist_transcript_failed")

    return {"transcript": transcript, "language": language, "errors": errors}


async def extract_node(state: CallIntelligenceState) -> dict:
    try:
        await _data.update_recording(state["call_id"], {"status": "analyzing"})
    except Exception:  # noqa: BLE001
        logger.warning("could not set status=analyzing for %s", state["call_id"])

    loop = asyncio.get_event_loop()
    analysis, extracted_by = await loop.run_in_executor(
        None, extract_analysis, state.get("transcript") or ""
    )
    return {"analysis": analysis, "extracted_by": extracted_by}


async def persist_node(state: CallIntelligenceState) -> dict:
    analysis = state.get("analysis") or {}
    errors = list(state.get("errors", []))
    if not analysis:
        return {"analysis_id": None, "errors": [*errors, "no_analysis_to_persist"]}

    tenant_id, call_id, lead_id = state["tenant_id"], state["call_id"], state["lead_id"]

    try:
        await _data.create_sentiment({
            "tenant_id": tenant_id,
            "call_id": call_id,
            "sentiment": analysis["sentiment"],
            "confidence": 0.7 if state.get("extracted_by") == "groq" else 0.5,
        })
    except Exception:  # noqa: BLE001
        logger.exception("call_sentiment insert failed")
        errors.append("persist_sentiment_failed")

    analysis_id = None
    try:
        analysis_id = await _data.upsert_analysis(call_id, {
            "tenant_id": tenant_id,
            "customer_summary": analysis["customer_summary"],
            "interest_level": analysis["interest_level"],
            "buying_intent_score": analysis["buying_intent_score"],
            "competitors": analysis["competitors"],
            "competitor_risk": analysis["competitor_risk"],
            "price_sensitivity": analysis["price_sensitivity"],
            "purchase_timeline": analysis["purchase_timeline"],
            "test_drive_interest": analysis["test_drive_interest"],
            "followup_requested": analysis["followup_requested"],
            "recommended_action": analysis["recommended_action"],
            "reasoning": analysis["reasoning"],
            "raw_analysis": analysis,
        })
    except Exception:  # noqa: BLE001
        logger.exception("call_analysis upsert failed")
        errors.append("persist_analysis_failed")

    try:
        await _data.add_event(
            tenant_id, lead_id,
            f"Call analysed — {analysis['sentiment']} sentiment, "
            f"{analysis['interest_level']} interest, recommends {analysis['recommended_action'].replace('_', ' ')}.",
            {"call_id": call_id, "competitors": analysis["competitors"], "source": "call_intelligence"},
        )
    except Exception:  # noqa: BLE001
        logger.exception("lead_events (call) insert failed")
        errors.append("persist_timeline_failed")

    try:
        await _data.update_recording(call_id, {"status": "completed"})
    except Exception:  # noqa: BLE001
        logger.warning("could not set status=completed for %s", call_id)

    return {"analysis_id": analysis_id, "errors": errors}


async def handoff_node(state: CallIntelligenceState) -> dict:
    """Phase 7: publish CALL_COMPLETED. The Re-Scoring subscriber consumes it and
    re-scores the lead (no direct agent-to-agent call). Best-effort — a publish
    failure never affects the already-persisted analysis."""
    if not AUTO_RESCORE or not state.get("analysis_id"):
        return {"handoff_fired": False}
    analysis = state.get("analysis") or {}
    try:
        await bus.publish(DomainEvent(
            type=EventType.CALL_COMPLETED,
            tenant_id=state["tenant_id"],
            lead_id=state["lead_id"],
            payload={
                "call_id": state["call_id"],
                "call_sentiment": analysis.get("sentiment"),
                "interest_level": analysis.get("interest_level"),
            },
            source="call_intelligence",
        ))
        return {"handoff_fired": True}
    except Exception as exc:  # noqa: BLE001
        logger.info("CALL_COMPLETED publish skipped: %s", exc)
        return {"handoff_fired": False}
