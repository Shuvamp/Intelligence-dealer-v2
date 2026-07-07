import re
import os
import uuid
import httpx
from datetime import datetime
from .state import LeadValidatorState, ValidationError

SUPABASE_URL = os.getenv("SUPABASE_URL", "http://localhost:54321")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "local-dev-anon-key")

VALID_SOURCES = {"oem", "website", "facebook", "instagram", "walkin", "phone", "event", "referral"}
VALID_BUDGET_RANGES = {"under_8l", "8_12l", "12_18l", "18_25l", "above_25l"}
VALID_TIMEFRAMES = {"immediately", "this_month", "1_3_months", "3_6_months", "just_exploring"}
VALID_CALL_TIMES = {"today", "within_2_days", "this_week", "no_rush"}
VALID_CHANNELS = {"whatsapp", "phone_call", "email", "sms"}

# After stripping +91/91 prefix, the number must be exactly 10 digits starting 6-9.
MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


def _normalize_phone(raw: str) -> str:
    """Strip formatting and +91 prefix → 10-digit string. Bare '91...' without + is not stripped."""
    phone = re.sub(r"[\s\-()]", "", raw)
    if phone.startswith("+91"):
        phone = phone[3:]
    return phone


def _headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


# ── validation_logs: persisted on every outcome, pass or fail ────────────────

def _write_validation_log(state: LeadValidatorState, status: str) -> None:
    """Best-effort — a logging failure must never mask the real validation
    result, so this never raises."""
    lead = state["lead"]
    try:
        with httpx.Client(base_url=SUPABASE_URL, headers=_headers(), timeout=5.0) as client:
            client.post(
                "/rest/v1/validation_logs",
                json={
                    "id": str(uuid.uuid4()),
                    "tenant_id": lead.get("tenant_id"),
                    "lead_id": state.get("lead_id"),
                    "phone": lead.get("phone"),
                    "email": lead.get("email"),
                    "status": status,
                    "errors": [dict(e) for e in state["errors"]],
                    "warnings": list(state["warnings"]),
                    "source": lead.get("source"),
                    "created_at": datetime.utcnow().isoformat(),
                },
                headers={"Prefer": "return=minimal"},
            )
    except Exception:  # noqa: BLE001
        pass


# ── node 1: phone ─────────────────────────────────────────────────────────────

def validate_phone(state: LeadValidatorState) -> LeadValidatorState:
    phone = (state["lead"].get("phone") or "").strip()
    if not phone:
        state["errors"].append(ValidationError(field="phone", message="Phone number is required"))
        state["status"] = "invalid"
        _write_validation_log(state, "rejected")
        return state

    normalized = _normalize_phone(phone)
    if not MOBILE_RE.match(normalized):
        state["errors"].append(ValidationError(
            field="phone",
            message=f"'{phone}' is not a valid Indian mobile number — expected +91XXXXXXXXXX or 10 digits starting with 6-9",
        ))
        state["status"] = "invalid"
        _write_validation_log(state, "rejected")

    return state


# ── node 2: email ─────────────────────────────────────────────────────────────

def validate_email(state: LeadValidatorState) -> LeadValidatorState:
    email = (state["lead"].get("email") or "").strip()
    if not email:
        state["warnings"].append("Email not provided — lead will be saved without email")
        return state

    if not EMAIL_RE.match(email):
        # Email is optional, but a malformed one (when present) is rejected
        # with the same severity as a bad phone number — not just a warning.
        state["errors"].append(ValidationError(
            field="email",
            message=f"'{email}' does not look like a valid email address",
        ))
        state["status"] = "invalid"
        _write_validation_log(state, "rejected")

    return state


# ── node 3: other fields ──────────────────────────────────────────────────────

def validate_fields(state: LeadValidatorState) -> LeadValidatorState:
    lead = state["lead"]

    if not lead.get("tenant_id"):
        state["warnings"].append("tenant_id is missing — DB insert may fail")

    source = (lead.get("source") or "").strip().lower()
    if not source:
        state["warnings"].append("source is missing")
    elif source not in VALID_SOURCES:
        state["warnings"].append(f"'{source}' is not a recognised source. Expected one of: {', '.join(sorted(VALID_SOURCES))}")

    if not (lead.get("vehicle_interest") or "").strip():
        state["warnings"].append("vehicle_interest is missing")

    budget_range = (lead.get("budget_range") or "").strip().lower()
    if budget_range and budget_range not in VALID_BUDGET_RANGES:
        state["warnings"].append(f"'{budget_range}' is not a recognised budget range. Expected one of: {', '.join(sorted(VALID_BUDGET_RANGES))}")

    timeframe = (lead.get("purchase_timeframe") or "").strip().lower()
    if timeframe and timeframe not in VALID_TIMEFRAMES:
        state["warnings"].append(f"'{timeframe}' is not a recognised purchase timeframe. Expected one of: {', '.join(sorted(VALID_TIMEFRAMES))}")

    call_time = (lead.get("preferred_call_time") or "").strip().lower()
    if call_time and call_time not in VALID_CALL_TIMES:
        state["warnings"].append(f"'{call_time}' is not a recognised call time. Expected one of: {', '.join(sorted(VALID_CALL_TIMES))}")

    channel = (lead.get("preferred_channel") or "").strip().lower()
    if channel and channel not in VALID_CHANNELS:
        state["warnings"].append(f"'{channel}' is not a recognised channel. Expected one of: {', '.join(sorted(VALID_CHANNELS))}")

    return state


# ── node 4: dedup + persist ───────────────────────────────────────────────────

def dedup_and_persist(state: LeadValidatorState) -> LeadValidatorState:
    lead = state["lead"]
    phone = _normalize_phone((lead.get("phone") or "").strip())
    email = (lead.get("email") or "").strip().lower() or None
    tenant_id = lead.get("tenant_id")
    now = datetime.utcnow().isoformat()

    with httpx.Client(base_url=SUPABASE_URL, headers=_headers()) as client:

        # 1. look up customer by phone, then by email if no phone match.
        # Two separate eq. lookups rather than a single `or=` filter — the
        # local DuckDB shim's PostgREST emulation doesn't support `or=`, only
        # plain eq./neq./etc., so this is the one form that works against
        # both the shim and real Supabase.
        resp = client.get(
            "/rest/v1/customers",
            params={"select": "id", "phone": f"eq.{phone}", "limit": "1"},
        )
        resp.raise_for_status()
        customers = resp.json()

        if not customers and email:
            resp = client.get(
                "/rest/v1/customers",
                params={"select": "id", "email": f"eq.{email}", "limit": "1"},
            )
            resp.raise_for_status()
            customers = resp.json()

        if customers:
            customer_id = customers[0]["id"]

            # 2. check if a lead already exists for this customer
            resp = client.get(
                "/rest/v1/leads",
                params={"select": "id,enquiry_count", "customer_id": f"eq.{customer_id}", "limit": "1"},
            )
            resp.raise_for_status()
            existing_leads = resp.json()

            if existing_leads:
                # duplicate — increment enquiry_count
                lead_id = existing_leads[0]["id"]
                new_count = (existing_leads[0].get("enquiry_count") or 1) + 1
                client.patch(
                    f"/rest/v1/leads?id=eq.{lead_id}",
                    json={"enquiry_count": new_count},
                ).raise_for_status()
                client.post(
                    "/rest/v1/lead_interactions",
                    json={
                        "id": str(uuid.uuid4()),
                        "tenant_id": tenant_id,
                        "lead_id": lead_id,
                        "customer_id": customer_id,
                        "interaction_type": "duplicate_enquiry",
                        "source": lead.get("source"),
                        "summary": f"Repeat enquiry — enquiry_count now {new_count}.",
                        "metadata": {},
                        "created_at": now,
                    },
                    headers={"Prefer": "return=minimal"},
                )
                state["is_duplicate"] = True
                state["lead_id"] = lead_id
                state["customer_id"] = customer_id
                state["enquiry_count"] = new_count
                state["normalized_phone"] = phone
                state["status"] = "duplicate"
                _write_validation_log(state, "duplicate")
                return state

        else:
            # new customer — insert into customers first
            customer_id = str(uuid.uuid4())
            client.post(
                "/rest/v1/customers",
                json={
                    "id": customer_id,
                    "tenant_id": tenant_id,
                    "full_name": lead.get("full_name"),
                    "phone": phone,
                    # Stored lowercased — must match the lowercased lookup
                    # above, or a later submission with different casing on
                    # the same address would silently miss the dedup match.
                    "email": email,
                    "city": lead.get("city") or None,
                    "preferred_vehicle": lead.get("vehicle_interest") or None,
                    "source_channel": lead.get("source"),
                    "created_at": now,
                },
                headers={"Prefer": "return=minimal"},
            ).raise_for_status()

        # new lead — insert
        new_lead_id = str(uuid.uuid4())
        client.post(
            "/rest/v1/leads",
            json={
                "id": new_lead_id,
                "tenant_id": tenant_id,
                "customer_id": customer_id,
                "source": lead.get("source"),
                "vehicle_interest": lead.get("vehicle_interest"),
                "budget_range": lead.get("budget_range") or None,
                "test_drive_requested": lead.get("test_drive_requested"),
                "purchase_timeframe": lead.get("purchase_timeframe") or None,
                "preferred_call_time": lead.get("preferred_call_time") or None,
                "preferred_channel": lead.get("preferred_channel") or None,
                "stage": "new",
                "score": "cold",
                "score_value": 0,
                "enquiry_count": 1,
                "created_at": now,
                "updated_at": now,
                "last_activity_at": now,
            },
            headers={"Prefer": "return=minimal"},
        ).raise_for_status()
        state["lead_id"] = new_lead_id
        state["customer_id"] = customer_id
        state["enquiry_count"] = 1
        state["normalized_phone"] = phone
        state["status"] = "inserted"
        _write_validation_log(state, "passed")

    return state
