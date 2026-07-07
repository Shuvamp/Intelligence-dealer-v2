"""Integration surface for the Call Intelligence Agent (Phase 5).

`process_call(call_id)` runs the transcribe → extract → persist → handoff graph
for an already-uploaded recording. It is scheduled as a fire-and-forget async
task by the upload endpoint (and re-run by the manual /analyze retry), so the
upload request itself returns immediately. Read helpers back the GET endpoints.
"""
from __future__ import annotations

import logging

from .data import CallData
from .graph import call_intelligence_agent
from .state import CallIntelligenceState

logger = logging.getLogger(__name__)
_data = CallData()


async def process_call(call_id: str) -> dict | None:
    """Run the full pipeline for one recording. Never raises — marks the
    recording `failed` on any unexpected error so the UI can offer a retry."""
    recording = await _data.get_recording(call_id)
    if not recording:
        logger.warning("process_call: recording %s not found", call_id)
        return None

    initial: CallIntelligenceState = {
        "call_id": call_id,
        "tenant_id": recording["tenant_id"],
        "lead_id": recording["lead_id"],
        "audio_path": recording.get("recording_url") or "",
        "transcript": None,
        "language": None,
        "analysis": None,
        "extracted_by": "none",
        "analysis_id": None,
        "handoff_fired": False,
        "errors": [],
    }

    try:
        return await call_intelligence_agent.ainvoke(initial)
    except Exception:  # noqa: BLE001
        logger.exception("call intelligence pipeline crashed for %s", call_id)
        try:
            await _data.update_recording(call_id, {"status": "failed", "error_reason": "pipeline_error"})
        except Exception:  # noqa: BLE001
            pass
        return None


async def get_call_detail(call_id: str) -> dict | None:
    recording = await _data.get_recording(call_id)
    if not recording:
        return None
    transcript = await _data.get_transcript(call_id)
    sentiment = await _data.get_sentiment(call_id)
    analysis = await _data.get_analysis(call_id)
    return {
        "recording": recording,
        "transcript": transcript,
        "sentiment": sentiment,
        "analysis": analysis,
    }


async def list_lead_calls(lead_id: str) -> list[dict]:
    """One row per recording, each with its analysis (if completed) attached."""
    recordings = await _data.list_recordings(lead_id)
    out: list[dict] = []
    for rec in recordings:
        analysis = await _data.get_analysis(rec["id"])
        transcript = await _data.get_transcript(rec["id"])
        sentiment = await _data.get_sentiment(rec["id"])
        out.append({
            "recording": rec,
            "analysis": analysis,
            "transcript": transcript,
            "sentiment": sentiment,
        })
    return out
