"""Context Planner API (Phase 1) — see docs/planner/01_CONTEXT_PLANNER.md.

A standalone vertical (not a lead-pipeline extension), so it gets its own
router — mirrors app/routers/marketing.py's shape — rather than more inline
endpoints in main.py.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents.context_planner.service import create_context, get_context, list_contexts

router = APIRouter()


# ── Request / Response models ────────────────────────────────────────────────

class CreateContextRequest(BaseModel):
    tenant_id: str
    input_type: Literal["url", "manual"]
    url: str | None = None
    company_name: str | None = None
    website: str | None = None
    region: str | None = None
    industry: str | None = None
    products: str | None = None
    services: str | None = None
    description: str | None = None


class ContextResponse(BaseModel):
    context_id: str
    tenant_id: str
    input_type: str
    status: str
    url: str | None = None
    normalized_url: str | None = None
    company_name: str | None = None
    website: str | None = None
    region: str | None = None
    industry: str | None = None
    products: str | None = None
    services: str | None = None
    description: str | None = None
    errors: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None


def _state_to_response(state: dict) -> ContextResponse:
    return ContextResponse(
        context_id=state["context_id"],
        tenant_id=state["tenant_id"],
        input_type=state["input_type"],
        status=state.get("status", "pending"),
        url=state.get("raw_url"),
        normalized_url=state.get("normalized_url"),
        company_name=state.get("company_name"),
        website=state.get("website"),
        region=state.get("region"),
        industry=state.get("industry"),
        products=state.get("products"),
        services=state.get("services"),
        description=state.get("description"),
        errors=state.get("errors", []),
        created_at=state.get("created_at"),
        updated_at=state.get("updated_at"),
    )


def _row_to_response(row: dict) -> ContextResponse:
    return ContextResponse(
        context_id=row["id"],
        tenant_id=row["tenant_id"],
        input_type=row["input_type"],
        status=row.get("status", "pending"),
        url=row.get("url"),
        normalized_url=row.get("normalized_url"),
        company_name=row.get("company_name"),
        website=row.get("website"),
        region=row.get("region"),
        industry=row.get("industry"),
        products=row.get("products"),
        services=row.get("services"),
        description=row.get("description"),
        errors=row.get("errors") or [],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/contexts", response_model=ContextResponse)
async def create_context_endpoint(body: CreateContextRequest) -> ContextResponse:
    manual = {
        "company_name": body.company_name,
        "website": body.website,
        "region": body.region,
        "industry": body.industry,
        "products": body.products,
        "services": body.services,
        "description": body.description,
    }
    state = await create_context(
        tenant_id=body.tenant_id,
        input_type=body.input_type,
        raw_url=body.url,
        manual=manual,
    )
    return _state_to_response(state)


@router.get("/contexts/{context_id}", response_model=ContextResponse)
async def get_context_endpoint(context_id: str, tenant_id: str) -> ContextResponse:
    row = await get_context(context_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Context {context_id} not found")
    return _row_to_response(row)


@router.get("/contexts", response_model=list[ContextResponse])
async def list_contexts_endpoint(
    tenant_id: str, status: str | None = None, limit: int = 50
) -> list[ContextResponse]:
    rows = await list_contexts(tenant_id, status, limit)
    return [_row_to_response(row) for row in rows]
