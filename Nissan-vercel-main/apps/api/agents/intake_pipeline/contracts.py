from typing import Optional, Literal
from typing_extensions import TypedDict


class NormalizedLead(TypedDict):
    name: str
    phone: str
    email: Optional[str]
    vehicle: Optional[str]
    city: Optional[str]
    test_drive_required: bool
    budget: Optional[float]
    buy_timeline_days: Optional[int]
    callback_days: Optional[int]
    contact_medium: Optional[str]
    source: str
    status: str


class Scoring(TypedDict):
    score: Literal["hot", "warm", "cold", "dead"]
    score_value: int
    reasons: list[str]


class Assignment(TypedDict):
    assigned_to: Optional[str]
    assignee_name: Optional[str]
    reason: str


class PipelineState(TypedDict):
    raw_lead: dict
    source: str
    errors: list[str]
    normalized: Optional[NormalizedLead]
    scoring: Optional[Scoring]
    assignment: Optional[Assignment]


class NodeDeps(TypedDict):
    supabase_url: str
    tenant_id: str
    anthropic_key: Optional[str]


def empty_state(raw_lead: dict, source: str) -> PipelineState:
    return {
        "raw_lead": raw_lead,
        "source": source,
        "errors": [],
        "normalized": None,
        "scoring": None,
        "assignment": None,
    }


SCORE_BUCKETS = ["dead", "cold", "warm", "hot"]


def bucket_for(value: int) -> Literal["hot", "warm", "cold", "dead"]:
    if value >= 70:
        return "hot"
    if value >= 40:
        return "warm"
    if value >= 15:
        return "cold"
    return "dead"
