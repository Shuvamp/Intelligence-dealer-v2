from __future__ import annotations
from typing import TypedDict


class CallIntelligenceState(TypedDict):
    # Input
    call_id: str
    tenant_id: str
    lead_id: str
    audio_path: str            # local filesystem path to the uploaded recording

    # Produced by transcribe
    transcript: str | None
    language: str | None

    # Produced by extract (the single-LLM analysis, already validated/clamped)
    analysis: dict | None
    extracted_by: str          # "groq" | "deterministic" | "none"

    # Produced by persist
    analysis_id: str | None

    # Produced by handoff
    handoff_fired: bool

    errors: list[str]
