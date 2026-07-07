"""Pure value mappers for the bridge loader.

These translate the pipeline's silver-layer string values into the exact
enum values declared in supabase/migrations/0009_leads.sql / 0011_intelligence.sql.
No DB access here — every function is a pure string->string transform so it
can be unit-tested without Postgres.

Unknown inputs RAISE, deliberately. The enum CHECK on the spine side would
reject a junk value anyway; failing fast in Python produces a cleaner error.
"""
from __future__ import annotations


# ---- lead_source (0009_leads.sql) ---------------------------------------
# enum: oem | website | facebook | instagram | walkin | phone | event | referral
_SOURCE_MAP = {
    "walkin": "walkin",
    "web":    "website",
    "meta":   "facebook",   # Meta lead-ads -> facebook (closest enum value)
    "call":   "phone",
    "oem":    "oem",
    "event":  "event",
}


def map_source(silver_source: str) -> str:
    """silver fact_touchpoint.source -> public.leads.source enum."""
    if silver_source is None:
        raise ValueError("source is None")
    try:
        return _SOURCE_MAP[silver_source]
    except KeyError:
        raise ValueError(f"unknown silver source: {silver_source!r}")


# ---- lead_score (0009_leads.sql) ----------------------------------------
# enum: hot | warm | cold
def map_score(silver_status: str) -> str:
    """silver fact_lead.status ('Hot'|'Warm'|'Cold') -> public.leads.score enum."""
    if silver_status is None:
        raise ValueError("status is None")
    s = silver_status.strip().lower()
    if s not in ("hot", "warm", "cold"):
        raise ValueError(f"unknown silver lead status: {silver_status!r}")
    return s


# ---- lead_stage (0009_leads.sql) ----------------------------------------
# enum: new | contacted | qualified | test_drive | quotation | negotiation | won | lost
def derive_stage(has_quotation: bool, has_test_drive: bool) -> str:
    """Spec-defined derivation: quotation > test_drive > new."""
    if has_quotation:
        return "quotation"
    if has_test_drive:
        return "test_drive"
    return "new"


# ---- lead_event_type (0009_leads.sql) -----------------------------------
# enum: note | call | email | whatsapp | stage_change | assignment | test_drive | quotation
_EVENT_TYPE_MAP = {
    "touchpoint": "note",
    "call":       "call",
    "test_drive": "test_drive",
    "quotation":  "quotation",
}


def map_event_type(silver_kind: str) -> str:
    """Kind tag the loader emits for each silver fact -> lead_event_type enum."""
    if silver_kind is None:
        raise ValueError("event kind is None")
    try:
        return _EVENT_TYPE_MAP[silver_kind]
    except KeyError:
        raise ValueError(f"unknown silver event kind: {silver_kind!r}")


# ---- market_signal severity (0011_intelligence.sql) ---------------------
# enum: low | medium | high
def severity_for_gap(demand_gap: int) -> str:
    """Severity buckets for opportunity signals from mart_opportunity."""
    if demand_gap >= 10:
        return "high"
    if demand_gap >= 5:
        return "medium"
    return "low"
