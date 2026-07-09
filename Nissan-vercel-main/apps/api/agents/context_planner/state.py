from __future__ import annotations

from typing import Literal, Optional, TypedDict

ContextInputType = Literal["url", "manual"]

# pending: transient, only ever seen mid-graph.
# ready:   validated + stored successfully — later phases pick up on this.
# invalid: validation failed; still persisted (audit trail), never picked up by later phases.
# failed:  validation passed but the DB write itself failed.
ContextStatus = Literal["pending", "ready", "invalid", "failed"]


class ManualCompanyInput(TypedDict, total=False):
    company_name: Optional[str]
    website: Optional[str]
    region: Optional[str]
    industry: Optional[str]
    products: Optional[str]
    services: Optional[str]
    description: Optional[str]


class ContextPlannerState(TypedDict):
    # input
    context_id: str
    tenant_id: str
    input_type: ContextInputType
    raw_url: Optional[str]
    manual: ManualCompanyInput

    # url path output
    normalized_url: Optional[str]

    # shared output fields (flattened, whatever the input path populated)
    company_name: Optional[str]
    website: Optional[str]
    region: Optional[str]
    industry: Optional[str]
    products: Optional[str]
    services: Optional[str]
    description: Optional[str]

    # lifecycle
    status: ContextStatus
    errors: list[str]
    stored: bool
    created_at: Optional[str]
    updated_at: Optional[str]
