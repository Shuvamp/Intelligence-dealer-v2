"""Integration surface for the Context Planner Agent (Phase 1).

`create_context(...)` is called by the FastAPI router
(apps/api/app/routers/context_planner.py). Reads (`get_context`/
`list_contexts`) don't need the graph — they call the data layer directly.
"""
from __future__ import annotations

import uuid

from .data import ContextPlannerData
from .graph import ContextPlannerGraph
from .state import ContextPlannerState, ManualCompanyInput

_data = ContextPlannerData()


def _initial_state(
    tenant_id: str,
    input_type: str,
    raw_url: str | None,
    manual: ManualCompanyInput,
) -> ContextPlannerState:
    return {
        "context_id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "input_type": input_type,  # type: ignore[typeddict-item]
        "raw_url": raw_url,
        "manual": manual,
        "normalized_url": None,
        "company_name": None,
        "website": None,
        "region": None,
        "industry": None,
        "products": None,
        "services": None,
        "description": None,
        "status": "pending",
        "errors": [],
        "stored": False,
        "created_at": None,
        "updated_at": None,
    }


async def create_context(
    tenant_id: str,
    input_type: str,
    raw_url: str | None = None,
    manual: ManualCompanyInput | None = None,
) -> ContextPlannerState:
    initial = _initial_state(tenant_id, input_type, raw_url, manual or {})
    return await ContextPlannerGraph.ainvoke(initial)


async def get_context(context_id: str, tenant_id: str) -> dict | None:
    return await _data.get_context(context_id, tenant_id)


async def list_contexts(tenant_id: str, status: str | None = None, limit: int = 50) -> list[dict]:
    return await _data.list_contexts(tenant_id, status, limit)
