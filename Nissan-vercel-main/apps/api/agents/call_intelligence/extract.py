"""Single-LLM call analysis (Phase 5).

ONE Groq call (llama-3.1-8b-instant) extracts sentiment, customer summary,
intent, competitors, timeline, and recommended action from a transcript — the
model is told to infer the CUSTOMER's statements and ignore the sales exec's
(no speaker diarization). Groq is primary here by design (cost) — different from
the Claude-primary scoring/follow-up agents.

Zero-config safety: if Groq is unavailable, a deterministic keyword heuristic
produces a usable analysis so the pipeline never stalls. Output is always
validated and clamped to the allowed vocabularies before it leaves this module.
"""
from __future__ import annotations

import logging
import os

from agents.scoring.utils import parse_json_safely

logger = logging.getLogger(__name__)

GROQ_MODEL = os.getenv("CALL_GROQ_MODEL", "llama-3.1-8b-instant")
# Cap transcript length sent to the LLM so a long call stays under Groq's free-tier
# tokens-per-minute cap (avoids 413/429). ~6k chars ≈ a multi-minute call.
_MAX_TRANSCRIPT_CHARS = 6000

_INTEREST = {"high", "medium", "low"}
_RISK = {"none", "low", "medium", "high"}
_SENSITIVITY = {"low", "medium", "high"}
_TIMELINE = {"immediate", "30_days", "90_days", "unknown"}
_SENTIMENT = {"positive", "neutral", "negative"}

# Same rival vocabulary the Scoring Agent uses (agents/scoring/nodes.py) so
# competitor detection is consistent across agents.
_COMPETITORS = {
    "hyundai": "Hyundai", "creta": "Hyundai Creta", "kia": "Kia", "seltos": "Kia Seltos",
    "tata": "Tata", "nexon": "Tata Nexon", "mahindra": "Mahindra", "xuv": "Mahindra XUV",
    "scorpio": "Mahindra Scorpio", "toyota": "Toyota", "honda": "Honda", "mg": "MG",
    "hector": "MG Hector", "maruti": "Maruti", "suzuki": "Maruti Suzuki",
}


def _build_prompt(transcript: str) -> str:
    return f"""You are a Nissan dealership sales-call analyst. The transcript may mix
Tamil, Tanglish, and English, and contains two speakers: a Sales Executive and a
Customer. FIRST infer which statements belong to the CUSTOMER, then analyse ONLY
those — ignore the executive's lines. Never invent statements not in the transcript.

TRANSCRIPT:
{transcript}

Return ONLY this JSON (no prose, no markdown fences):
{{
  "sentiment": "positive|neutral|negative",
  "customer_summary": ["short factual point", "..."],
  "interest_level": "high|medium|low",
  "buying_intent_score": <int 0-100>,
  "competitors": ["competitor names the customer mentioned"],
  "competitor_risk": "none|low|medium|high",
  "price_sensitivity": "low|medium|high",
  "purchase_timeline": "immediate|30_days|90_days|unknown",
  "test_drive_interest": true|false,
  "followup_requested": true|false,
  "recommended_action": "<short snake_case action, e.g. schedule_test_drive>",
  "reasoning": ["why, grounded in customer statements"]
}}

Rules:
- interest_level high: asks about booking/EMI/delivery/test drive. medium: comparing/evaluating. low: passive/unclear.
- competitor_risk high: strongly prefers a rival. medium: actively comparing. low: casual mention. none: no rival.
- purchase_timeline: immediate | 30_days | 90_days | unknown."""


def _groq_call(prompt: str) -> str | None:
    """Single sync Groq call. Returns text or None (never raises)."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return None
    try:
        from groq import Groq

        client = Groq(api_key=api_key, max_retries=0)
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=700,
        )
        return resp.choices[0].message.content
    except Exception:  # noqa: BLE001
        logger.warning("Groq call-analysis call failed; using deterministic fallback", exc_info=True)
        return None


def _as_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in {"true", "1", "yes"}


def _clamp_int(v, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(round(float(v)))))
    except (TypeError, ValueError):
        return lo


def _one_of(v, allowed: set[str], default: str) -> str:
    s = str(v or "").strip().lower()
    return s if s in allowed else default


def _validate(raw: dict) -> dict:
    """Coerce/clamp the LLM output to the allowed vocabularies — never trust it raw."""
    summary = raw.get("customer_summary") or []
    competitors = raw.get("competitors") or []
    reasoning = raw.get("reasoning") or []
    return {
        "sentiment": _one_of(raw.get("sentiment"), _SENTIMENT, "neutral"),
        "customer_summary": [str(s) for s in summary if s][:6],
        "interest_level": _one_of(raw.get("interest_level"), _INTEREST, "low"),
        "buying_intent_score": _clamp_int(raw.get("buying_intent_score", 0), 0, 100),
        "competitors": [str(c) for c in competitors if c][:6],
        "competitor_risk": _one_of(raw.get("competitor_risk"), _RISK, "none"),
        "price_sensitivity": _one_of(raw.get("price_sensitivity"), _SENSITIVITY, "medium"),
        "purchase_timeline": _one_of(raw.get("purchase_timeline"), _TIMELINE, "unknown"),
        "test_drive_interest": _as_bool(raw.get("test_drive_interest")),
        "followup_requested": _as_bool(raw.get("followup_requested")),
        "recommended_action": (str(raw.get("recommended_action") or "follow_up").strip() or "follow_up")[:60],
        "reasoning": [str(r) for r in reasoning if r][:6],
    }


def _deterministic(transcript: str) -> dict:
    """Keyword heuristic used when Groq is unavailable. Conservative by design."""
    t = transcript.lower()
    competitors = sorted({name for kw, name in _COMPETITORS.items() if kw in t})

    summary: list[str] = []
    high_intent = any(k in t for k in ["emi", "loan", "booking", "book", "delivery", "on-road", "on road", "down payment"])
    test_drive = "test drive" in t or "test-drive" in t
    if "emi" in t or "loan" in t:
        summary.append("Asked about EMI / financing")
    if competitors:
        summary.append(f"Compared with {', '.join(competitors)}")
    if test_drive:
        summary.append("Interested in a test drive")

    if any(k in t for k in ["this month", "next week", "immediately", "urgent", "this week"]):
        timeline = "30_days"
    elif any(k in t for k in ["next month", "1-3 month", "couple of months"]):
        timeline = "90_days"
    else:
        timeline = "unknown"

    interest = "high" if high_intent else ("medium" if competitors else "low")
    risk = "medium" if competitors else "none"
    sentiment = "negative" if any(k in t for k in ["not interested", "expensive", "too costly", "cancel"]) else (
        "positive" if any(k in t for k in ["interested", "like", "good", "nice"]) else "neutral"
    )
    return _validate({
        "sentiment": sentiment,
        "customer_summary": summary or ["Customer enquiry on the call"],
        "interest_level": interest,
        "buying_intent_score": 70 if high_intent else (45 if competitors else 25),
        "competitors": competitors,
        "competitor_risk": risk,
        "price_sensitivity": "high" if any(k in t for k in ["discount", "offer", "expensive", "lowest price"]) else "medium",
        "purchase_timeline": timeline,
        "test_drive_interest": test_drive,
        "followup_requested": any(k in t for k in ["call", "callback", "follow up", "contact"]),
        "recommended_action": "schedule_test_drive" if test_drive else ("share_emi_quote" if high_intent else "nurture"),
        "reasoning": ["Deterministic keyword analysis (LLM unavailable)"],
    })


def extract_analysis(transcript: str) -> tuple[dict, str]:
    """transcript → (validated analysis dict, extracted_by). Never raises."""
    transcript = (transcript or "").strip()
    if not transcript:
        return _deterministic(""), "deterministic"

    text = _groq_call(_build_prompt(transcript[:_MAX_TRANSCRIPT_CHARS]))
    if text is not None:
        parsed = parse_json_safely(text)
        if parsed:
            return _validate(parsed), "groq"
        logger.warning("Groq returned unparseable JSON; using deterministic fallback")

    return _deterministic(transcript), "deterministic"
