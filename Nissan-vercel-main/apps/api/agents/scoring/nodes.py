"""
LangGraph node functions for the automotive lead scoring agent.
Uses Groq (llama-3.3-70b-versatile) for LLM nodes.
GROQ_API_KEY is read from environment — never hardcoded.
"""

import os
import logging
from typing import Optional
from groq import Groq
from datetime import datetime

# Groq raises typed exceptions for HTTP errors. Import defensively so this module
# still imports (and the deterministic fallback still works) if groq isn't
# installed or the SDK surface changes.
try:
    from groq import RateLimitError, APIStatusError
except Exception:  # pragma: no cover - defensive
    RateLimitError = APIStatusError = None

from .state import LeadState
from .knowledge import load_rubric, rubric_available
from .utils import (
    parse_json_safely,
    format_interactions_for_llm,
    validate_phone_number,
    run_duplicate_detection,
    compute_emi_affordability,
    check_budget_alignment,
    extract_desired_variant,
    check_inventory,
    inventory_has_7_seater,
    decay_factor,
)

logger = logging.getLogger(__name__)

# llama-3.1-8b-instant has a far higher free-tier daily token budget than the
# 70b model (which exhausts the 100k TPD limit after ~10 full-rubric calls).
# Override with GROQ_MODEL env if you have a paid tier and want the larger model.
MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")


# NVIDIA NIM is an OpenAI-compatible inference API (integrate.api.nvidia.com).
# It has far higher per-request limits than Groq's free tier, so it's the 3rd-tier
# fallback for the heavy holistic call. Model is configurable; defaults to a
# hosted Llama. The key is read from NVIDIA_API_KEY (never hardcoded).
NVIDIA_BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
NVIDIA_MODEL = os.environ.get("NVIDIA_MODEL", "meta/llama-3.1-8b-instruct")

# Claude (Anthropic) is the PRIMARY LLM for scoring. Groq → NVIDIA → deterministic
# remain as automatic fallbacks. Key is read from ANTHROPIC_API_KEY (never hardcoded).
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# Module-level record of what the LAST _llm() call did, so callers (e.g.
# score_dimensions) can surface a human-readable notice and know WHICH provider
# carried the call — without changing _llm()'s return type.
_LAST_LLM_NOTICE: Optional[str] = None
_LAST_LLM_USED_BACKUP: bool = False
_LAST_LLM_PROVIDER: Optional[str] = None  # "groq" | "groq_backup" | "nvidia" | None


def take_llm_notice() -> Optional[str]:
    """Return the notice from the last _llm() call and clear it (read-once)."""
    global _LAST_LLM_NOTICE
    notice = _LAST_LLM_NOTICE
    _LAST_LLM_NOTICE = None
    return notice


def llm_used_backup() -> bool:
    """True if the last _llm() call succeeded via the backup Groq key."""
    return _LAST_LLM_USED_BACKUP


def last_llm_provider() -> Optional[str]:
    """Which provider carried the last _llm() call: groq / groq_backup / nvidia."""
    return _LAST_LLM_PROVIDER


def _call_anthropic(api_key: str, prompt: str, max_tokens: int) -> str:
    """Call Claude via the Anthropic Messages API. Returns the concatenated text
    output. max_retries=0 + a bounded timeout so a transient failure surfaces
    immediately and the Groq → NVIDIA → deterministic ladder takes over fast."""
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key, max_retries=0, timeout=60.0)
    resp = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=max_tokens,
        # Speed: thinking off + low effort. Scoring is a structured-JSON extraction
        # task that doesn't need extended reasoning, so this keeps sonnet-4-6 fast
        # for the demo without changing the model. output_config goes via
        # extra_body for compatibility with the installed SDK.
        thinking={"type": "disabled"},
        messages=[{"role": "user", "content": prompt}],
        extra_body={"output_config": {"effort": "low"}},
    )
    # Sonnet 4.6 with thinking off returns text blocks; concat any text parts.
    parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    return "".join(parts)


def _anthropic_reason(exc: Exception) -> str:
    """Short, human phrase describing why a Claude call failed."""
    status = getattr(exc, "status_code", None)
    if status == 429:
        return "Claude hit its rate limit (429)"
    if status == 401:
        return "the Claude API key was rejected (401)"
    reason = str(exc).strip() or exc.__class__.__name__
    if len(reason) > 90:
        reason = reason[:87] + "..."
    return f"Claude was unavailable ({reason})"


def _call_nvidia(api_key: str, prompt: str, max_tokens: int) -> str:
    """Call NVIDIA NIM's OpenAI-compatible chat endpoint. Uses httpx (a groq dep,
    so always available). Raises on any HTTP error so the caller can fall back."""
    import httpx

    resp = httpx.post(
        f"{NVIDIA_BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json={
            "model": NVIDIA_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.2,
        },
        timeout=60.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def _is_rate_limit(exc: Exception) -> bool:
    """429 detection that survives groq not being installed."""
    if RateLimitError is not None and isinstance(exc, RateLimitError):
        return True
    return getattr(exc, "status_code", None) == 429


def _is_payload_too_large(exc: Exception) -> bool:
    """413 detection that survives groq not being installed."""
    if APIStatusError is not None and isinstance(exc, APIStatusError):
        return getattr(exc, "status_code", None) == 413
    return getattr(exc, "status_code", None) == 413


def _call_groq(api_key: str, prompt: str, max_tokens: int) -> str:
    # max_retries=0: do NOT let the SDK silently sleep ~39s and retry on a 429.
    # We want a 429 to surface immediately so our own ladder (backup key → NVIDIA)
    # takes over fast, instead of stalling the whole scoring request.
    client = Groq(api_key=api_key, max_retries=0)
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content


def _groq_reason(exc: Exception) -> str:
    """Short, human phrase describing why a Groq call failed."""
    if _is_rate_limit(exc):
        return "Groq hit its free-tier rate limit (429)"
    if _is_payload_too_large(exc):
        return "the scoring prompt exceeded Groq's free-tier token-per-minute limit (413)"
    reason = str(exc).strip() or exc.__class__.__name__
    if len(reason) > 90:
        reason = reason[:87] + "..."
    return f"Groq was unavailable ({reason})"


def _llm(prompt: str, max_tokens: int = 1024) -> Optional[str]:
    """
    Call an LLM with multi-provider failover, returning the completion text or
    None. Returning None — never raising — lets each node fall back to a
    deterministic heuristic, so the agent runs zero-config in local dev.

    Failover ladder (each tier tried only if the previous is unavailable):
      1. Groq primary key (GROQ_API_KEY) — fast, free.
      2. Groq backup key (GROQ_API_KEY_BACKUP) — only on a 429 rate-limit.
      3. NVIDIA NIM (NVIDIA_API_KEY) — different provider with far higher limits;
         tried on ANY Groq failure (429 both keys, 413 prompt-too-large, errors).
      4. None → deterministic heuristic scoring.

    What happened (provider used, human notice) is recorded in module-level state
    (last_llm_provider / take_llm_notice / llm_used_backup) so callers can set
    scored_by and surface a clear message to the UI.
    """
    global _LAST_LLM_NOTICE, _LAST_LLM_USED_BACKUP, _LAST_LLM_PROVIDER
    _LAST_LLM_NOTICE = None
    _LAST_LLM_USED_BACKUP = False
    _LAST_LLM_PROVIDER = None

    groq_reason: Optional[str] = None  # why Groq (both keys) didn't carry the call
    anthropic_reason: Optional[str] = None  # why Claude (the primary) didn't carry it

    # ── Tier 0: Claude (Anthropic) — PRIMARY ───────────────────────────────────
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            text = _call_anthropic(anthropic_key, prompt, max_tokens)
            _LAST_LLM_PROVIDER = "anthropic"
            return text  # success — notice stays None
        except Exception as anthropic_exc:
            anthropic_reason = _anthropic_reason(anthropic_exc)
            logger.warning("Claude unavailable (%s); trying Groq fallback.", anthropic_reason)

    api_key = os.environ.get("GROQ_API_KEY")

    # ── Tier 1: Groq primary ──────────────────────────────────────────────────
    if api_key:
        try:
            text = _call_groq(api_key, prompt, max_tokens)
            _LAST_LLM_PROVIDER = "groq"
            return text  # success — notice stays None
        except Exception as primary_exc:
            groq_reason = _groq_reason(primary_exc)
            # ── Tier 2: Groq backup, only for a true 429 ──────────────────────
            if _is_rate_limit(primary_exc):
                backup_key = os.environ.get("GROQ_API_KEY_BACKUP")
                if backup_key and backup_key != api_key:
                    try:
                        text = _call_groq(backup_key, prompt, max_tokens)
                        _LAST_LLM_USED_BACKUP = True
                        _LAST_LLM_PROVIDER = "groq_backup"
                        _LAST_LLM_NOTICE = (
                            "Primary Groq key hit its rate limit (429). "
                            "Automatically switched to the backup key."
                        )
                        logger.warning("Primary Groq key 429; succeeded via backup key.")
                        return text
                    except Exception as backup_exc:
                        groq_reason = "both Groq keys were rate-limited (429)"
                        logger.warning("Both Groq keys failed: %s / %s", primary_exc, backup_exc)
            logger.warning("Groq unavailable (%s); trying NVIDIA fallback.", groq_reason)
    else:
        groq_reason = "no Groq key is configured"

    # Combine why the primary (Claude) and Groq tiers didn't carry the call, for a
    # single human-readable notice. "no Groq key is configured" is dropped — that's
    # an expected zero-config state, not a failure worth surfacing on its own.
    why = "; ".join(
        r for r in (anthropic_reason, groq_reason)
        if r and r != "no Groq key is configured"
    ) or None

    # ── Tier 3: NVIDIA NIM (different provider, higher limits) ─────────────────
    nvidia_key = os.environ.get("NVIDIA_API_KEY")
    if nvidia_key:
        try:
            text = _call_nvidia(nvidia_key, prompt, max_tokens)
            _LAST_LLM_PROVIDER = "nvidia"
            _LAST_LLM_NOTICE = (
                f"{_cap(why)}. Automatically scored with NVIDIA "
                f"({NVIDIA_MODEL}) instead."
            )
            logger.warning("Scored via NVIDIA fallback (%s).", NVIDIA_MODEL)
            return text
        except Exception as nv_exc:
            logger.warning("NVIDIA fallback also failed: %s", nv_exc)
            _LAST_LLM_NOTICE = (
                f"{_cap(why)}, and the NVIDIA fallback also failed "
                f"({str(nv_exc).strip()[:80] or nv_exc.__class__.__name__}). "
                "Used deterministic heuristic scoring."
            )
            return None

    # ── Tier 4: deterministic ──────────────────────────────────────────────────
    if why:
        _LAST_LLM_NOTICE = (
            f"{_cap(why)} and no NVIDIA fallback key is set. "
            "Used deterministic heuristic scoring."
        )
    # else: zero-config (no keys at all) — stay silent, no notice.
    return None


def _cap(s: Optional[str]) -> str:
    """Capitalize the first letter of a notice fragment."""
    if not s:
        return "The LLM was unavailable"
    return s[0].upper() + s[1:]


# ── Deterministic fallbacks (used when the LLM is unavailable) ────────────────

def _heuristic_intent(interaction_text: str) -> tuple[int, list[str]]:
    """Keyword version of the intent prompt — same signals, no LLM."""
    t = interaction_text.lower()
    score = 0
    evidence: list[str] = []

    positives = [
        (8, ["on-road", "on road", "final quotation", "final price", "final on-road"], "asked for an on-road quotation"),
        (7, ["confirmed variant", "variant and colour", "variant and color", "finalised variant"], "confirmed variant and colour"),
        (7, ["booking process", "documents", "paperwork", "down payment"], "asked about the booking process / documents"),
        (6, ["delivery timeline", "delivery time", "when can i get", "delivery date"], "asked about delivery timeline"),
        (5, ["this weekend", "book today", "by month end", "purchase deadline"], "stated a personal purchase deadline"),
        (4, ["registration", "insurance", "rto"], "asked about registration / insurance"),
        (3, ["feature", "mileage", "sunroof", "adas", "boot space"], "specific feature questions"),
    ]
    for pts, keywords, label in positives:
        if any(k in t for k in keywords):
            score += pts
            evidence.append(label)

    negatives = [
        (3, ["just browsing", "general enquiry", "casual look"], "general browsing"),
        (4, ["for reference", "reference only"], "framed as 'for reference only'"),
        (5, ["no hurry", "just exploring", "just looking"], "no hurry / just exploring"),
    ]
    for pts, keywords, label in negatives:
        if any(k in t for k in keywords):
            score -= pts
            evidence.append(f"negative: {label}")

    # baseline: a stated vehicle interest is itself a mild intent signal
    if "interested in" in t and score <= 0:
        score = max(score, 3)
        evidence.append("expressed interest in a specific model")

    return max(min(score, 25), 0), evidence


def _heuristic_sentiment(recent_notes: list[str]) -> int:
    t = " ".join(recent_notes).lower()
    positive = ["interested", "excited", "happy", "love", "approved", "keen", "impressed", "liked"]
    negative = ["angry", "upset", "disappointed", "not interested", "frustrated", "complaint", "rude"]
    if any(w in t for w in negative):
        return 2
    if any(w in t for w in positive):
        return 4
    return 3


def _heuristic_reasoning(state: LeadState) -> tuple[str, str]:
    """Templated, fact-grounded reasoning + action from the computed scores."""
    total = state.get("total_score")
    category = state.get("category")
    strengths = state.get("strengths", [])
    risks = state.get("risks", [])
    missing = state.get("missing_data_flags", [])

    parts = [f"Scored {total}/100 ({category})."]
    if strengths:
        parts.append("Strengths: " + "; ".join(strengths[:4]) + ".")
    if risks:
        parts.append("Risks: " + "; ".join(risks[:3]) + ".")
    if missing:
        parts.append("Missing data: " + ", ".join(missing) + ".")
    if state.get("competitor_details"):
        parts.append(state["competitor_details"] + ".")
    reasoning = " ".join(parts)

    action_map = {
        "HOT+": "Call within the next hour and push to close; escalate to the manager.",
        "HOT": "Call today, confirm the variant/price, and propose a test drive or booking.",
        "WARM": "Follow up within 2–3 days with a tailored offer and an invite to visit.",
        "COLD": "Add to the nurture sequence; send model info and check back in ~2 weeks.",
        "DEAD": "Low priority — verify contact details before any further outreach.",
    }
    action = action_map.get(category, "Follow up based on the lead's stated timeline.")
    return reasoning, action


# ── Node 1: Ingest & Validate ─────────────────────────────────────────────────

def ingest_and_validate(state: LeadState) -> LeadState:
    flags = list(state.get("missing_data_flags", []))
    validation_flags = list(state.get("validation_flags", []))

    if not state.get("phone"):
        flags.append("PHONE_MISSING")

    if not state.get("interaction_log"):
        flags.append("NO_INTERACTIONS_LOGGED")

    duplicate_check = run_duplicate_detection(
        state.get("phone", ""), state.get("customer_name", "")
    )
    if duplicate_check["match_probability"] > 0.85:
        validation_flags.append(
            f"POTENTIAL_DUPLICATE: {duplicate_check['matched_lead_id']}"
        )

    if not validate_phone_number(state.get("phone", "")):
        flags.append("INVALID_PHONE_NUMBER")
        validation_flags.append("PHONE_VALIDATION_FAILED")

    financial_data_present = any(
        "budget" in i.get("notes", "").lower()
        or "salary" in i.get("notes", "").lower()
        or "loan" in i.get("notes", "").lower()
        for i in state.get("interaction_log", [])
    )
    if not financial_data_present:
        flags.append("FINANCIAL_DATA_MISSING")

    return {
        **state,
        "missing_data_flags": flags,
        "validation_flags": validation_flags,
        "computed_at": datetime.now(),
    }


# ── Node 2: Engagement Score ──────────────────────────────────────────────────

def compute_engagement_score(state: LeadState) -> LeadState:
    score = 0.0
    now = datetime.now()
    walk_in_count = 0

    for interaction in state.get("interaction_log", []):
        raw_date = interaction.get("date")
        if not isinstance(raw_date, datetime):
            continue
        decay = decay_factor(raw_date, now)
        itype = interaction.get("type", "")

        if itype == "walk_in":
            walk_in_count += 1
            base = 5 if walk_in_count == 1 else (8 if walk_in_count == 2 else 10)
            score += base * decay
        elif itype == "test_drive_completed":
            score += 6 * decay
        elif itype == "inbound_call":
            score += 8 * decay
        elif itype == "outbound_call_answered_meaningful":
            score += 5 * decay

    for msg in state.get("whatsapp_log", []):
        raw_date = msg.get("date")
        if not isinstance(raw_date, datetime):
            continue
        decay = decay_factor(raw_date, now)
        if msg.get("direction") == "inbound":
            score += 7 * decay
        elif msg.get("response_time_hours", 999) <= 1:
            score += 5 * decay
        elif msg.get("response_time_hours", 999) <= 24:
            score += 3 * decay
        elif msg.get("blue_tick_no_reply"):
            score -= 2 * decay

    website = state.get("website_analytics", {})
    if website.get("page_views", 0) >= 5:
        score += 4
    if website.get("emi_calculator_used"):
        score += 5
    if website.get("test_drive_booking_clicked"):
        score += 7

    return {**state, "engagement_score": max(min(round(score), 20), 0)}


# ── Node 3: Intent Score (LLM) ────────────────────────────────────────────────

def compute_intent_score(state: LeadState) -> LeadState:
    interaction_text = format_interactions_for_llm(state.get("interaction_log", []))

    prompt = f"""
You are an automotive sales intent analyser. Analyse the following customer interactions and score the intent from 0–25.

SCORING RULES:
- Asked for final on-road quotation: +8
- Confirmed variant and colour: +7
- Asked about booking process/documents: +7
- Asked delivery timeline for specific unit: +6
- Stated personal purchase deadline: +5
- Asked about registration/insurance: +4
- Multiple specific feature questions on one variant: +3

NEGATIVE:
- General browsing questions: -3
- "For reference only" framing: -4
- "No hurry, just exploring": -5

INTERACTION LOG:
{interaction_text}

Return ONLY a JSON object: {{"intent_score": <0-25>, "evidence": ["list of specific signals found"], "flags": ["any contradictions"]}}
"""

    text = _llm(prompt, max_tokens=600)
    if text is not None:
        result = parse_json_safely(text)
        intent_score = max(min(int(result.get("intent_score", 0)), 25), 0)
        evidence = result.get("evidence", [])
    else:
        intent_score, evidence = _heuristic_intent(interaction_text)

    return {
        **state,
        "intent_score": intent_score,
        "strengths": state.get("strengths", []) + evidence,
    }


# ── Node 4: Financial Score ───────────────────────────────────────────────────

def compute_financial_score(state: LeadState) -> LeadState:
    score = 0
    financial_status = "unknown"
    risks = list(state.get("risks", []))
    notes_text = " ".join(
        i.get("notes", "") for i in state.get("interaction_log", [])
    ).lower()
    missing_flags = list(state.get("missing_data_flags", []))

    if "cash" in notes_text or "own funds" in notes_text:
        score = 15
        financial_status = "own_funds"
    elif "pre-approved" in notes_text or "loan approved" in notes_text:
        score = 13
        financial_status = "loan_approved"
    elif "loan rejected" in notes_text:
        score = 2
        financial_status = "loan_rejected"
        risks.append("Loan rejection recorded — explore NBFC options")
    elif "waiting for bonus" in notes_text:
        score = 8
        financial_status = "loan_pending"
    elif "salary" in notes_text or "income" in notes_text:
        score = compute_emi_affordability(notes_text, state)
        financial_status = "loan_pending"
    elif "budget" in notes_text or "bank loan" in notes_text or "loan" in notes_text:
        score = check_budget_alignment(notes_text, state)
        financial_status = "loan_pending"
    else:
        score = 0
        financial_status = "unknown"
        if "FINANCIAL_DATA_MISSING" not in missing_flags:
            missing_flags.append("FINANCIAL_DATA_MISSING")

    return {
        **state,
        "financial_readiness": min(score, 15),
        "financial_status": financial_status,
        "risks": risks,
        "missing_data_flags": missing_flags,
    }


# ── Node 5: Urgency Score ─────────────────────────────────────────────────────

def compute_urgency_score(state: LeadState) -> LeadState:
    score = 0
    notes_combined = " ".join(
        i.get("notes", "") for i in state.get("interaction_log", [])
    ).lower()

    if any(p in notes_combined for p in ["book today", "this weekend", "before month end", "this week", "this month"]):
        score += 10
    if any(p in notes_combined for p in ["immediately", "urgent", "asap"]):
        score += 10
    if any(p in notes_combined for p in ["marriage", "wedding", "festival", "pongal", "diwali", "new year"]):
        score += 8
    if any(p in notes_combined for p in ["march 31", "financial year", "tax saving", "april 1"]):
        score += 7
    if any(p in notes_combined for p in ["breakdown", "accident", "repair", "urgent", "immediate"]):
        score += 9

    visit_dates = [
        i["date"] for i in state.get("interaction_log", [])
        if i.get("type") == "walk_in" and isinstance(i.get("date"), datetime)
    ]
    if len(visit_dates) >= 3:
        visit_dates.sort()
        gap_1 = (visit_dates[1] - visit_dates[0]).days
        gap_2 = (visit_dates[2] - visit_dates[1]).days
        if gap_2 < gap_1 * 0.5:
            score += 5

    if any(p in notes_combined for p in ["no hurry", "next year", "6 months", "after increment", "just exploring"]):
        score -= 6
    if any(p in notes_combined for p in ["someday", "eventually", "when time comes"]):
        score -= 8

    return {**state, "urgency_score": max(min(score, 15), 0)}


# ── Node 6: Competitive Risk ──────────────────────────────────────────────────

def compute_competitive_risk(state: LeadState) -> LeadState:
    base = 5
    alert = False
    details = None
    notes_combined = " ".join(
        i.get("notes", "") for i in state.get("interaction_log", [])
    ).lower()

    competitors = {
        "hyundai": 1, "creta": 2, "kia": 1, "seltos": 2,
        "tata": 1, "nexon": 2, "mahindra": 1, "xuv": 2,
        "toyota": 1, "honda": 1, "mg": 1, "hector": 2,
        "maruti": 1, "suzuki": 1, "scorpio": 2,
    }

    deduction = 0
    detected = []

    for name, penalty in competitors.items():
        if name in notes_combined:
            deduction += penalty
            detected.append(name)

    if "test drove" in notes_combined and detected:
        deduction += 2

    if "booked" in notes_combined and detected:
        deduction = 5
        alert = True
        details = f"Competitor booking detected: {', '.join(detected)}"

    # "not considering other cars" is a strong positive signal
    if "not considering other" in notes_combined or "only nissan" in notes_combined:
        deduction = max(deduction - 2, 0)

    final_score = max(base - deduction, 0)

    if detected and not alert:
        alert = True
        details = f"Comparing with: {', '.join(detected)}"

    return {
        **state,
        "competitive_risk": final_score,
        "competitor_alert": alert,
        "competitor_details": details,
    }


# ── Node 7: Relationship & Sentiment (LLM) ───────────────────────────────────

def compute_relationship_and_sentiment(state: LeadState) -> LeadState:
    relationship_score = 1
    notes_combined = " ".join(
        i.get("notes", "") for i in state.get("interaction_log", [])
    ).lower()

    if "existing customer" in notes_combined or "repeat" in notes_combined:
        relationship_score = 5
    elif "referred by" in notes_combined:
        relationship_score = 4
    elif "service history" in notes_combined:
        relationship_score = 3

    recent_notes = [i.get("notes", "") for i in state.get("interaction_log", [])[-5:]]
    sentiment_prompt = f"""
Rate the overall customer sentiment in these automotive dealership interaction notes from 1–5 (1=hostile, 3=neutral, 5=enthusiastic).

Notes: {" | ".join(recent_notes)}

Return ONLY: {{"sentiment_score": <1-5>, "tone": "hostile|negative|neutral|positive|enthusiastic"}}
"""

    text = _llm(sentiment_prompt, max_tokens=150)
    if text is not None:
        result = parse_json_safely(text)
        sentiment_score = int(result.get("sentiment_score", 3))
    else:
        sentiment_score = _heuristic_sentiment(recent_notes)

    return {
        **state,
        "relationship_strength": relationship_score,
        "sentiment_score": max(min(sentiment_score, 5), 1),
    }


# ── Node 8: Product Fit ───────────────────────────────────────────────────────

def compute_product_fit(state: LeadState) -> LeadState:
    score = 5
    risks = list(state.get("risks", []))
    notes = " ".join(i.get("notes", "") for i in state.get("interaction_log", [])).lower()

    desired_variant = extract_desired_variant(notes)
    if desired_variant:
        stock = check_inventory(desired_variant)
        if stock["available"]:
            score = 10
        elif stock["eta_days"] <= 30:
            score = 7
        elif stock["eta_days"] <= 60:
            score = 5
        else:
            score = 3
            risks.append(f"Long wait for preferred variant: {stock['eta_days']} days")

    if "7 seater" in notes and not inventory_has_7_seater():
        score -= 3
        risks.append("Customer wants 7-seater; limited/no stock")

    return {**state, "product_fit": max(min(score, 10), 0), "risks": risks}


# ── Holistic LLM scoring (md rubric + Groq, single call) ─────────────────────

def _clamp_int(v, lo, hi):
    try:
        v = int(round(float(v)))
    except (TypeError, ValueError):
        v = lo
    return max(lo, min(hi, v))


def _build_holistic_prompt(rubric: str, state: LeadState, interaction_text: str) -> str:
    flags = state.get("missing_data_flags", []) or []
    vflags = state.get("validation_flags", []) or []
    return f"""You are the automotive lead scoring engine for a Nissan dealership.
Score the lead STRICTLY using the framework below — the documented point values,
caps, edge cases, buying/negative signals, budget bands, competitor and journey
rules are authoritative. Use ONLY evidence present in the lead; never invent
interactions. If data for a dimension is absent, score it low and add a missing-
data flag rather than guessing high.

================= SCORING FRAMEWORK (authoritative) =================
{rubric}
====================================================================

LEAD TO SCORE
- Name: {state.get('customer_name') or '(unknown)'}
- Phone: {state.get('phone') or '(missing)'}
- Email: {state.get('email') or '(missing)'}
- System missing-data flags: {flags}
- System validation flags: {vflags}
- Interaction log:
{interaction_text}

Score each of the 8 dimensions within its maximum:
intent (0-25), engagement (0-20), urgency (0-15), financial_readiness (0-15),
product_fit (0-10), competitive_risk (0-5, penalty model starting at 5),
relationship_strength (0-5), sentiment_score (0-5).
List up to 2 specific evidence items as `strengths` and up to 1 `risk`. Be
terse: keep reasoning <=25 words and recommended_action <=12 words.

Return ONLY this JSON (no prose, no markdown fences):
{{
  "breakdown": {{
    "intent_score": <int 0-25>,
    "engagement_score": <int 0-20>,
    "urgency_score": <int 0-15>,
    "financial_readiness": <int 0-15>,
    "product_fit": <int 0-10>,
    "competitive_risk": <int 0-5>,
    "relationship_strength": <int 0-5>,
    "sentiment_score": <int 0-5>
  }},
  "strengths": ["specific evidence found", "..."],
  "risks": ["specific risk", "..."],
  "missing_data_flags": ["FINANCIAL_DATA_MISSING", "..."],
  "financial_status": "own_funds|loan_approved|loan_pending|loan_rejected|unknown",
  "competitor_alert": true|false,
  "competitor_details": "string or null",
  "reasoning": "<=25 word justification grounded in the evidence",
  "recommended_action": "<=12 word specific next step"
}}"""


# Maps the LLM provider that carried the holistic call → the scored_by tag the
# UI shows. Keep in sync with SCORED_BY_LABEL in the web app's lead detail page.
_SCORED_BY_FOR_PROVIDER = {
    "anthropic": "claude_holistic",
    "groq": "groq_holistic",
    "groq_backup": "groq_holistic_backup",
    "nvidia": "nvidia_llm",
}


def score_dimensions(state: LeadState) -> LeadState:
    """
    Primary path: ONE LLM call scores all 8 dimensions against the md rubric,
    with Groq→Groq-backup→NVIDIA failover (see _llm). Falls back to deterministic
    per-dimension nodes when no LLM is available, so the agent always produces a
    score (zero-config safe).
    """
    interaction_text = format_interactions_for_llm(state.get("interaction_log", []))

    notice: Optional[str] = None
    if rubric_available():
        prompt = _build_holistic_prompt(load_rubric(), state, interaction_text)
        # max_tokens kept at 1000 so prompt(~3.6k) + completion stays under Groq's
        # free-tier 6000 TPM cap; NVIDIA (no such cap) gets the same budget.
        text = _llm(prompt, max_tokens=600)
        # Capture which provider carried the call + the human-readable notice
        # (rate-limit / fallback path) — read-once, so grab them now.
        provider = last_llm_provider()
        notice = take_llm_notice()
        if text is not None:
            result = parse_json_safely(text)
            bd = result.get("breakdown") or {}
            if bd:
                merged_missing = list(dict.fromkeys(
                    (state.get("missing_data_flags", []) or [])
                    + [f for f in result.get("missing_data_flags", []) if f]
                ))
                return {
                    **state,
                    "intent_score":          _clamp_int(bd.get("intent_score", 0), 0, 25),
                    "engagement_score":      _clamp_int(bd.get("engagement_score", 0), 0, 20),
                    "urgency_score":         _clamp_int(bd.get("urgency_score", 0), 0, 15),
                    "financial_readiness":   _clamp_int(bd.get("financial_readiness", 0), 0, 15),
                    "product_fit":           _clamp_int(bd.get("product_fit", 0), 0, 10),
                    "competitive_risk":      _clamp_int(bd.get("competitive_risk", 5), 0, 5),
                    "relationship_strength": _clamp_int(bd.get("relationship_strength", 1), 0, 5),
                    "sentiment_score":       _clamp_int(bd.get("sentiment_score", 3), 1, 5),
                    "strengths": (state.get("strengths", []) or []) + [s for s in result.get("strengths", []) if s],
                    "risks":     (state.get("risks", []) or []) + [r for r in result.get("risks", []) if r],
                    "missing_data_flags": merged_missing,
                    "financial_status": result.get("financial_status") or "unknown",
                    "competitor_alert": bool(result.get("competitor_alert")),
                    "competitor_details": result.get("competitor_details"),
                    "reasoning": result.get("reasoning", "") or "",
                    "recommended_action": result.get("recommended_action", "") or "",
                    "scored_by": _SCORED_BY_FOR_PROVIDER.get(provider, "groq_holistic"),
                    "score_notice": notice,
                }
            logger.warning("Holistic LLM returned no usable breakdown; using deterministic dimensions.")

    # Deterministic fallback — reuse the per-dimension nodes (each LLM node has
    # its own heuristic fallback, so this works with zero config too).
    s = compute_engagement_score(state)
    s = compute_intent_score(s)
    s = compute_financial_score(s)
    s = compute_urgency_score(s)
    s = compute_competitive_risk(s)
    s = compute_relationship_and_sentiment(s)
    s = compute_product_fit(s)
    # Carry any LLM-failure notice (429/413/unavailable) through the
    # deterministic fallback so the UI can explain why scoring took this path.
    return {**s, "scored_by": "deterministic", "score_notice": notice}


# ── Node 9: Aggregate & Classify ─────────────────────────────────────────────

def aggregate_and_classify(state: LeadState) -> LeadState:
    total = (
        (state.get("intent_score") or 0)
        + (state.get("engagement_score") or 0)
        + (state.get("urgency_score") or 0)
        + (state.get("financial_readiness") or 0)
        + (state.get("product_fit") or 0)
        + (state.get("competitive_risk") or 0)
        + (state.get("relationship_strength") or 0)
        + (state.get("sentiment_score") or 0)
    )

    missing_flags = state.get("missing_data_flags", [])
    validation_flags = list(state.get("validation_flags", []))

    if "FINANCIAL_DATA_MISSING" in missing_flags:
        total = min(total, 74)

    evidence_count = len(state.get("strengths", []))
    if total > 70 and evidence_count < 5:
        total = min(total, 65)
        validation_flags.append("INSUFFICIENT_EVIDENCE_FOR_HIGH_SCORE")

    intent = state.get("intent_score") or 0
    engagement = state.get("engagement_score") or 0
    if abs((intent / 25 * 20) - engagement) > 15:
        if "DIMENSION_INCONSISTENCY_DETECTED" not in validation_flags:
            validation_flags.append("DIMENSION_INCONSISTENCY_DETECTED")

    if "PHONE_VALIDATION_FAILED" in validation_flags or "PHONE_MISSING" in missing_flags:
        total = min(total, 10)

    if total >= 85:
        category = "HOT+"
        probability = 0.85 + (total - 85) * 0.01
    elif total >= 65:
        category = "HOT"
        probability = 0.60 + (total - 65) * 0.01
    elif total >= 40:
        category = "WARM"
        probability = 0.25 + (total - 40) * 0.012
    elif total >= 15:
        category = "COLD"
        probability = 0.05 + (total - 15) * 0.006
    else:
        category = "DEAD"
        probability = 0.02

    previous = state.get("previous_score")
    trend = "stable"
    score_change = None
    if previous is not None:
        score_change = total - previous
        trend = "improving" if total > previous + 5 else ("declining" if total < previous - 5 else "stable")

    follow_up_map = {"HOT+": 6, "HOT": 24, "WARM": 120, "COLD": 336, "DEAD": 4380}

    if total >= 85:
        journey_stage = 5
    elif total >= 65:
        journey_stage = 4
    elif total >= 40:
        journey_stage = 3
    elif total >= 20:
        journey_stage = 2
    else:
        journey_stage = 1

    return {
        **state,
        "total_score": total,
        "category": category,
        "purchase_probability": round(min(probability, 0.99), 2),
        "score_trend": trend,
        "score_change": score_change,
        "journey_stage": journey_stage,
        "follow_up_interval_hours": follow_up_map[category],
        "validation_flags": validation_flags,
        "requires_manager_review": len(validation_flags) > 0 or total >= 85,
    }


# ── Node 10: Reasoning & Action (LLM) ────────────────────────────────────────

def generate_reasoning_and_action(state: LeadState) -> LeadState:
    # Fast path: the holistic scoring call (score_dimensions) already returns a
    # grounded `reasoning` + `recommended_action`. When both are present, reuse
    # them instead of making a second LLM round-trip — this roughly halves
    # scoring latency. We only make the dedicated reasoning call when the
    # holistic path fell back to deterministic dimensions (no reasoning set).
    existing_reasoning = (state.get("reasoning") or "").strip()
    existing_action = (state.get("recommended_action") or "").strip()
    if existing_reasoning and existing_action:
        return {**state, "reasoning": existing_reasoning, "recommended_action": existing_action}

    score_summary = f"""
Score: {state.get('total_score')}/100 | Category: {state.get('category')}

Dimension Breakdown:
- Intent: {state.get('intent_score')}/25
- Engagement: {state.get('engagement_score')}/20
- Urgency: {state.get('urgency_score')}/15
- Financial: {state.get('financial_readiness')}/15
- Product Fit: {state.get('product_fit')}/10
- Competitive Risk: {state.get('competitive_risk')}/5
- Relationship: {state.get('relationship_strength')}/5
- Sentiment: {state.get('sentiment_score')}/5

Strengths: {state.get('strengths', [])}
Risks: {state.get('risks', [])}
Missing Data: {state.get('missing_data_flags', [])}
Competitor Alert: {state.get('competitor_details')}
Financial Status: {state.get('financial_status')}
Journey Stage: {state.get('journey_stage')}
"""

    prompt = f"""
You are an automotive sales AI assistant generating a lead scoring report for a salesperson.

CRITICAL RULES:
1. Only reference facts from the score summary provided. Do not invent interactions.
2. If data is missing, say so explicitly.
3. Recommended action must be specific and immediately actionable.
4. Reasoning must justify the score given, not idealise the customer.
5. Maximum 150 words for reasoning. Maximum 60 words for recommended_action.

{score_summary}

Return ONLY JSON:
{{
  "reasoning": "<150 word explanation>",
  "recommended_action": "<60 word specific next step>"
}}
"""

    text = _llm(prompt, max_tokens=600)
    if text is not None:
        result = parse_json_safely(text)
        reasoning = result.get("reasoning", "")
        recommended_action = result.get("recommended_action", "")
        if not reasoning or not recommended_action:
            fb_reasoning, fb_action = _heuristic_reasoning(state)
            reasoning = reasoning or fb_reasoning
            recommended_action = recommended_action or fb_action
    else:
        reasoning, recommended_action = _heuristic_reasoning(state)

    return {
        **state,
        "reasoning": reasoning,
        "recommended_action": recommended_action,
    }


# ── Node 11: Format Output ────────────────────────────────────────────────────

def format_output(state: LeadState) -> LeadState:
    formatted = {
        "schema_version": "1.0",
        "lead_id": state.get("lead_id"),
        "timestamp": datetime.now().isoformat(),
        "lead_score": {
            "total": state.get("total_score"),
            "breakdown": {
                "intent_score": state.get("intent_score"),
                "engagement_score": state.get("engagement_score"),
                "urgency_score": state.get("urgency_score"),
                "financial_readiness": state.get("financial_readiness"),
                "product_fit": state.get("product_fit"),
                "competitive_risk": state.get("competitive_risk"),
                "relationship_strength": state.get("relationship_strength"),
                "sentiment_score": state.get("sentiment_score"),
            },
        },
        "category": state.get("category"),
        "purchase_probability": state.get("purchase_probability"),
        "strengths": state.get("strengths", []),
        "risks": state.get("risks", []),
        "missing_data_flags": state.get("missing_data_flags", []),
        "recommended_action": state.get("recommended_action"),
        "follow_up_interval_hours": state.get("follow_up_interval_hours"),
        "reasoning": state.get("reasoning"),
        "competitor_alert": state.get("competitor_alert", False),
        "competitor_details": state.get("competitor_details"),
        "financial_status": state.get("financial_status"),
        "journey_stage": state.get("journey_stage"),
        "score_trend": state.get("score_trend"),
        "previous_score": state.get("previous_score"),
        "score_change": state.get("score_change"),
        "validation_flags": state.get("validation_flags", []),
        "requires_manager_review": state.get("requires_manager_review", False),
        "scored_by": state.get("scored_by", "deterministic"),
        "score_notice": state.get("score_notice"),
        "algorithm_version": "1.0.0",
    }
    return {**state, "final_output": formatted}
