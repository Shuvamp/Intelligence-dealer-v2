from typing import Literal
from typing_extensions import TypedDict


class LeadInput(TypedDict):
    """Raw lead data as it arrives from any source."""
    tenant_id: str
    source: str
    full_name: str | None
    phone: str | None
    email: str | None
    vehicle_interest: str | None
    city: str | None
    test_drive_requested: bool | None
    budget_range: str | None
    purchase_timeframe: str | None
    preferred_call_time: str | None
    preferred_channel: str | None


class ValidationError(TypedDict):
    field: str
    message: str


class LeadValidatorState(TypedDict):
    # --- input ---
    lead: LeadInput

    # --- validation ---
    errors: list[ValidationError]       # hard failures — stops the pipeline
    warnings: list[str]                 # soft issues — logged but pipeline continues

    # --- dedup ---
    is_duplicate: bool

    # --- persisted result ---
    lead_id: str | None
    customer_id: str | None
    enquiry_count: int | None
    normalized_phone: str | None

    # --- outcome ---
    status: Literal["pending", "invalid", "duplicate", "inserted"]
