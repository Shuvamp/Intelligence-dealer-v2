from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

CompanySummaryStatus = Literal["pending", "ready", "failed"]


class CompanySummaryState(TypedDict):
    # input
    summary_id: str
    tenant_id: str
    context_id: str
    extraction_id: str
    extraction_data: dict[str, Any]

    # output — the 8 spec-required display fields
    company_name: Optional[str]
    website: Optional[str]
    region: Optional[str]
    industry: Optional[str]
    products: list[str]
    services: list[str]
    description: Optional[str]
    verdict: Optional[str]

    # lifecycle
    engine: Optional[str]  # "groq" | "deterministic" — which path produced the fields
    status: CompanySummaryStatus
    errors: list[str]
