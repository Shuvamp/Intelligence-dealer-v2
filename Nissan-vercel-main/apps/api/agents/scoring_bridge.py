"""
Bridge: pipeline normalized-lead  →  your scoring agent's LeadState input.

The Node.js intake pipeline (validate→normalize→score→assign) produces a
NormalizedLead with structured fields. Your Python LangGraph scoring agent
reads an interaction_log of natural-language notes. This deterministic
transformer (no LLM) builds those notes so NONE of your scoring edge cases
are starved of input.
"""

from datetime import datetime


def _budget_note(budget) -> str:
    try:
        lakh = float(budget) / 100000.0
    except (TypeError, ValueError):
        return ""
    return f"Budget around {round(lakh)} lakh."


def _timeline_note(days) -> str:
    try:
        d = int(days)
    except (TypeError, ValueError):
        return ""
    if d <= 7:
        return "Wants to buy within a week."
    if d <= 30:
        return "Looking to buy this month."
    if d <= 90:
        return "Planning to purchase in 1-3 months."
    return "Planning to purchase later, no hurry."


SOURCE_NOTE = {
    "instagram":       "Instagram ad lead.",
    "facebook":        "Facebook ad lead.",
    "website":         "High-intent website form enquiry.",
    "book-test-drive": "Booked via test-drive form.",
    "walk_in":         "Walk-in to showroom.",
    "referral":        "Referred by existing customer.",
}


# ── Enquiry-form signal fields → scoring notes ────────────────────────────────
#
# The website enquiry form now asks four high-signal questions whose answers feed
# the scoring agent's weakest-on-a-first-touch dimensions. Each option maps to a
# phrase that the deterministic keyword detectors AND the holistic Claude prompt
# recognise, so financial_readiness / relationship_strength / competitive_risk /
# urgency all get real input instead of defaulting low.

# financing → financial_readiness (nodes.py keyword detectors: cash/own funds=15,
# pre-approved=13, loan→budget-alignment). "unsure" intentionally has no note so
# the dimension stays unknown rather than being inflated.
_FINANCING_NOTE = {
    "cash":         "Paying by cash from own funds.",
    "pre_approved": "Car loan already pre-approved.",
    "loan_needed":  "Will arrange a bank loan for the purchase.",
    "unsure":       "",
}

# nissan_relationship → relationship_strength (existing customer=5, referred=4,
# service history=3).
_RELATIONSHIP_NOTE = {
    "current_owner": "Existing Nissan customer — currently owns a Nissan.",
    "past_owner":    "Has prior Nissan service history, owned a Nissan before.",
    "referred":      "Referred by an existing customer.",
    "new":           "",
}

# purchase_reason → urgency (wedding/festival=+8, "no hurry"=-6) + intent context.
_REASON_NOTE = {
    "replacement": "Replacing their current car.",
    "occasion":    "Buying for an upcoming wedding/festival.",
    "business":    "Purchase is for business use.",
    "first_car":   "This will be their first car.",
    "researching": "Just exploring for now, no hurry.",
}


def _brand_note(consideration, brands) -> str:
    """brand_consideration → competitive_risk. 'only_nissan' boosts (penalty model
    reduces its deduction on "only nissan"); 'comparing' with named rivals lets
    the competitor detector apply its per-brand penalty."""
    c = (consideration or "").lower()
    if c == "only_nissan":
        return "Not considering other brands, only Nissan."
    if c == "comparing":
        named = (brands or "").strip()
        return f"Also comparing with {named}." if named else "Also comparing other car brands."
    return ""


def normalized_to_scoring_input(lead: dict) -> dict:
    """
    lead = the pipeline's NormalizedLead (name/phone/email/vehicle/city/
    test_drive_required/budget/buy_timeline_days/callback_days/contact_medium/source).
    Returns a LeadState-compatible dict for the scoring agent.
    """
    now = datetime.now()
    notes = []

    src = (lead.get("source") or "").lower()
    if src in SOURCE_NOTE:
        notes.append(SOURCE_NOTE[src])

    if lead.get("vehicle"):
        notes.append(f"Interested in {lead['vehicle']}.")

    b = _budget_note(lead.get("budget"))
    if b:
        notes.append(b)

    t = _timeline_note(lead.get("buy_timeline_days"))
    if t:
        notes.append(t)

    if lead.get("test_drive_required"):
        notes.append("Wants test drive.")

    cb = lead.get("callback_days")
    if cb is not None:
        try:
            if int(cb) <= 2:
                notes.append("Asked for a quick callback.")
        except (TypeError, ValueError):
            pass

    medium = lead.get("contact_medium")
    if medium:
        notes.append(f"Preferred contact: {medium}.")

    # New enquiry-form signal fields (see the *_NOTE maps above). Each appends a
    # phrase the scoring dimensions key off — this is what lets a first-touch
    # website lead reach WARM/HOT instead of defaulting COLD for lack of input.
    fin = _FINANCING_NOTE.get((lead.get("financing") or "").lower())
    if fin:
        notes.append(fin)

    rel = _RELATIONSHIP_NOTE.get((lead.get("nissan_relationship") or "").lower())
    if rel:
        notes.append(rel)

    brand = _brand_note(lead.get("brand_consideration"), lead.get("comparing_brands"))
    if brand:
        notes.append(brand)

    reason = _REASON_NOTE.get((lead.get("purchase_reason") or "").lower())
    if reason:
        notes.append(reason)

    interaction_type = "walk_in" if src == "walk_in" else "inbound_call"

    return {
        "lead_id":          str(lead.get("lead_id") or ""),
        "customer_name":    lead.get("name") or "",
        "phone":            lead.get("phone") or "",
        "email":            lead.get("email") or "",
        "interaction_log": [
            {
                "date": now,
                "type": interaction_type,
                "notes": " ".join(notes) if notes else "New lead enquiry.",
                "salesperson_id": "",
            }
        ],
        "call_recordings":  [],
        "whatsapp_log":     [],
        "website_analytics": {},
        "missing_data_flags": [],
        "validation_flags":   [],
        "strengths":          [],
        "risks":              [],
    }


# ── Validator → scoring bridge ────────────────────────────────────────────────
#
# The lead_validator agent (agents/lead_validator) works on a *categorical* lead
# shape — budget_range / purchase_timeframe / preferred_channel etc. — and emits
# a persisted result (lead_id, customer_id, normalized_phone). The scoring agent
# reads natural-language interaction notes. These maps turn the validator's enums
# into phrases that the scoring nodes' keyword detectors recognise, so financial,
# urgency and intent dimensions all get real signal.

# upper bound (in lakh) per budget bucket → financial node reads "budget ... N lakh"
_BUDGET_RANGE_LAKH = {
    "under_8l": 8,
    "8_12l":    12,
    "12_18l":   18,
    "18_25l":   25,
    "above_25l": 30,
}

# phrases the urgency node scores on
_TIMEFRAME_NOTE = {
    "immediately":   "Wants to buy immediately, urgent requirement.",
    "this_month":    "Looking to buy this month.",
    "1_3_months":    "Planning to purchase in 1-3 months.",
    "3_6_months":    "Planning to purchase within the next 6 months.",
    "just_exploring": "Just exploring for now, no hurry.",
}

_CALL_TIME_NOTE = {
    "today":          "Asked for a callback today.",
    "within_2_days":  "Asked for a quick callback within 2 days.",
    "this_week":      "Happy to be contacted this week.",
    "no_rush":        "No rush on the callback.",
}

# validator source enums → the SOURCE_NOTE keys above
_VALIDATOR_SOURCE_ALIAS = {
    "walkin": "walk_in",
    "oem":    "website",
    "phone":  "referral",   # inbound phone enquiry — treat as a warm channel note
    "event":  "walk_in",
}


def validated_lead_to_scoring_input(lead: dict, validator_result: dict | None = None) -> dict:
    """
    Map the lead_validator's input + persisted result into a LeadState the
    scoring agent can consume.

    lead              = the validator's LeadInput (full_name, phone, email,
                        vehicle_interest, city, test_drive_requested,
                        budget_range, purchase_timeframe, preferred_call_time,
                        preferred_channel, source).
    validator_result  = the validator's output (lead_id, customer_id,
                        normalized_phone) — used so the score is keyed to the
                        same lead row that was just persisted.
    """
    validator_result = validator_result or {}
    now = datetime.now()
    notes = []

    src_raw = (lead.get("source") or "").lower()
    src = _VALIDATOR_SOURCE_ALIAS.get(src_raw, src_raw)
    if src in SOURCE_NOTE:
        notes.append(SOURCE_NOTE[src])

    if lead.get("vehicle_interest"):
        notes.append(f"Interested in {lead['vehicle_interest']}.")

    budget_lakh = _BUDGET_RANGE_LAKH.get((lead.get("budget_range") or "").lower())
    if budget_lakh:
        notes.append(f"Budget around {budget_lakh} lakh.")

    tf = _TIMEFRAME_NOTE.get((lead.get("purchase_timeframe") or "").lower())
    if tf:
        notes.append(tf)

    if lead.get("test_drive_requested"):
        notes.append("Wants test drive.")

    ct = _CALL_TIME_NOTE.get((lead.get("preferred_call_time") or "").lower())
    if ct:
        notes.append(ct)

    if lead.get("preferred_channel"):
        notes.append(f"Preferred contact: {lead['preferred_channel']}.")

    interaction_type = "walk_in" if src == "walk_in" else "inbound_call"
    phone = validator_result.get("normalized_phone") or lead.get("phone") or ""

    return {
        "lead_id":          str(validator_result.get("lead_id") or lead.get("lead_id") or ""),
        "customer_name":    lead.get("full_name") or "",
        "phone":            phone,
        "email":            lead.get("email") or "",
        "interaction_log": [
            {
                "date": now,
                "type": interaction_type,
                "notes": " ".join(notes) if notes else "New lead enquiry.",
                "salesperson_id": "",
            }
        ],
        "call_recordings":  [],
        "whatsapp_log":     [],
        "website_analytics": {},
        "missing_data_flags": [],
        "validation_flags":   [],
        "strengths":          [],
        "risks":              [],
    }
