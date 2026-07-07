"""Tests for the Call Intelligence Agent's extraction (Phase 5).

Focus on the pure, deterministic surface: JSON validation/clamping of LLM output
and the keyword fallback. Transcription (faster-whisper) and persistence (HTTP)
are I/O-bound and mocked/out of scope here.
"""
from agents.call_intelligence import extract


def test_validate_clamps_and_coerces():
    raw = {
        "sentiment": "ecstatic",            # not in vocab → neutral
        "customer_summary": ["a", "", "b"],  # empty dropped
        "interest_level": "HIGH",            # case-insensitive
        "buying_intent_score": 250,          # clamp to 100
        "competitors": ["Hyundai Creta"],
        "competitor_risk": "severe",         # not in vocab → none
        "price_sensitivity": "medium",
        "purchase_timeline": "soon",         # not in vocab → unknown
        "test_drive_interest": "yes",        # coerce to bool
        "followup_requested": 1,
        "recommended_action": "schedule_test_drive",
        "reasoning": ["x"],
    }
    out = extract._validate(raw)
    assert out["sentiment"] == "neutral"
    assert out["customer_summary"] == ["a", "b"]
    assert out["interest_level"] == "high"
    assert out["buying_intent_score"] == 100
    assert out["competitor_risk"] == "none"
    assert out["purchase_timeline"] == "unknown"
    assert out["test_drive_interest"] is True
    assert out["followup_requested"] is True
    assert out["recommended_action"] == "schedule_test_drive"


def test_validate_defaults_on_garbage():
    out = extract._validate({})
    assert out["sentiment"] == "neutral"
    assert out["interest_level"] == "low"
    assert out["buying_intent_score"] == 0
    assert out["competitor_risk"] == "none"
    assert out["purchase_timeline"] == "unknown"
    assert out["test_drive_interest"] is False
    assert out["recommended_action"] == "follow_up"


def test_deterministic_detects_competitor_and_test_drive():
    transcript = (
        "Customer: Magnite price enna? EMI evlo? "
        "Creta vum compare panren. Next week test drive book pannalama?"
    )
    out = extract._deterministic(transcript)
    assert "Hyundai Creta" in out["competitors"]
    assert out["competitor_risk"] == "medium"
    assert out["test_drive_interest"] is True
    assert out["interest_level"] == "high"          # EMI/booking signals
    assert out["purchase_timeline"] == "30_days"     # "next week"


def test_extract_uses_groq_when_available(monkeypatch):
    monkeypatch.setattr(
        extract, "_groq_call",
        lambda _prompt: '{"sentiment":"positive","interest_level":"high",'
        '"buying_intent_score":88,"purchase_timeline":"immediate",'
        '"competitors":["Kia Seltos"],"competitor_risk":"medium",'
        '"price_sensitivity":"low","test_drive_interest":true,'
        '"followup_requested":true,"recommended_action":"book_now",'
        '"customer_summary":["ready to buy"],"reasoning":["asked to book"]}',
    )
    analysis, by = extract.extract_analysis("some transcript")
    assert by == "groq"
    assert analysis["sentiment"] == "positive"
    assert analysis["buying_intent_score"] == 88
    assert analysis["purchase_timeline"] == "immediate"


def test_extract_falls_back_when_groq_unparseable(monkeypatch):
    monkeypatch.setattr(extract, "_groq_call", lambda _prompt: "not json at all")
    analysis, by = extract.extract_analysis("Customer: just looking, no hurry")
    assert by == "deterministic"
    assert analysis["interest_level"] in {"low", "medium", "high"}


def test_extract_falls_back_when_groq_none(monkeypatch):
    monkeypatch.setattr(extract, "_groq_call", lambda _prompt: None)
    analysis, by = extract.extract_analysis("Customer: Magnite EMI evlo?")
    assert by == "deterministic"
