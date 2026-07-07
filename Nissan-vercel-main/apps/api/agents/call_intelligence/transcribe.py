"""Local speech-to-text for sales calls (Phase 5).

Uses faster-whisper (model behind WHISPER_MODEL, default "small", CPU int8) — no
transcription API, so $0 marginal cost and Tamil/Tanglish/English support.

Zero-config safety: if faster-whisper isn't installed, or CALL_TRANSCRIBE_MODE=mock
is set, a deterministic sample transcript is returned so the whole pipeline
(extraction → persistence → UI → handoff) runs end-to-end without the ~150-500 MB
model download. Real transcription kicks in automatically once the package is
present. Mirrors the "zero-config, never break" philosophy of the mock WhatsApp
provider and the deterministic scoring fallback.

transcribe_audio() is SYNCHRONOUS and CPU-bound — callers MUST run it off the
event loop via run_in_executor (see nodes.py), never inline in an async node.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")

# A realistic Tanglish sales-call sample so the Groq extraction produces genuine
# analysis in mock mode (used for local dev/CI without the model download).
_MOCK_TRANSCRIPT = (
    "Executive: Good morning sir, ABC Nissan. Magnite enquiry panninga la?\n"
    "Customer: Aama, Magnite price enna? On-road evlo varum?\n"
    "Executive: Top variant on-road 11 lakh sir.\n"
    "Customer: EMI evlo varum? Naan bank loan pannanum.\n"
    "Executive: Down payment 2 lakh panna, monthly 18,000 varum sir.\n"
    "Customer: Creta vum paatheen, but Magnite better value mathiri iruku. "
    "Next week test drive book pannalama? Indha month la decide pannanum.\n"
    "Executive: Sure sir, call panren.\n"
)

# Module-level cache so the model loads once per process, not per call.
_model = None


def _mock_mode() -> bool:
    return os.getenv("CALL_TRANSCRIBE_MODE", "").lower() == "mock"


def _get_model():
    global _model
    if _model is not None:
        return _model
    from faster_whisper import WhisperModel  # imported lazily — heavy dep
    _model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _model


def transcribe_audio(audio_path: str) -> tuple[str, str]:
    """Return (transcript, language_detected). Never raises — on any failure it
    falls back to the mock transcript so the pipeline keeps moving."""
    if _mock_mode():
        logger.info("CALL_TRANSCRIBE_MODE=mock — using sample transcript")
        return _MOCK_TRANSCRIPT, "ta"

    try:
        model = _get_model()
        segments, info = model.transcribe(audio_path)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        language = getattr(info, "language", None) or "unknown"
        if not text:
            logger.warning("Empty transcript for %s — using mock fallback", audio_path)
            return _MOCK_TRANSCRIPT, "ta"
        return text, language
    except ImportError:
        logger.warning(
            "faster-whisper not installed — using mock transcript. "
            "Install it (pip install faster-whisper) for real transcription."
        )
        return _MOCK_TRANSCRIPT, "ta"
    except Exception:  # noqa: BLE001
        logger.exception("Transcription failed for %s — using mock fallback", audio_path)
        return _MOCK_TRANSCRIPT, "unknown"
