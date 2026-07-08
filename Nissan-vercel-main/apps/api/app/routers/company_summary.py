"""Company Summary API (Phase 3) — see docs/planner/03_COMPANY_SUMMARY.md.

A standalone vertical (reads website_extractions read-only; never modifies
agents/website_extraction/ or agents/context_planner/), so it gets its own
router — mirrors app/routers/website_extraction.py's shape. Unlike Phase 2,
POST here is synchronous — one bounded Groq call, not a multi-page crawl.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents.company_summary.service import (
    ExtractionNotEligible,
    create_summary,
    get_summary,
    list_summaries,
)

router = APIRouter()


# ── Request / Response models ────────────────────────────────────────────────

class CreateSummaryRequest(BaseModel):
    tenant_id: str
    extraction_id: str


class SummaryResponse(BaseModel):
    summary_id: str
    tenant_id: str
    extraction_id: str
    context_id: str
    status: str
    company_name: str | None = None
    website: str | None = None
    region: str | None = None
    industry: str | None = None
    products: list[str] = []
    services: list[str] = []
    description: str | None = None
    verdict: str | None = None
    errors: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None


def _dict_to_response(d: dict) -> SummaryResponse:
    return SummaryResponse(
        summary_id=d["id"],
        tenant_id=d["tenant_id"],
        extraction_id=d["extraction_id"],
        context_id=d["context_id"],
        status=d.get("status", "pending"),
        company_name=d.get("company_name"),
        website=d.get("website"),
        region=d.get("region"),
        industry=d.get("industry"),
        products=d.get("products") or [],
        services=d.get("services") or [],
        description=d.get("description"),
        verdict=d.get("verdict"),
        errors=d.get("errors") or [],
        created_at=d.get("created_at"),
        updated_at=d.get("updated_at"),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/summaries", response_model=SummaryResponse)
async def create_summary_endpoint(body: CreateSummaryRequest) -> SummaryResponse:
    """Synchronous: validates the referenced extraction is ready, runs the
    graph inline, and returns the completed (ready or failed) summary in one
    response — no polling needed, unlike Phase 2's crawl."""
    try:
        result = await create_summary(body.tenant_id, body.extraction_id)
    except ExtractionNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _dict_to_response(result)


@router.get("/summaries/{summary_id}", response_model=SummaryResponse)
async def get_summary_endpoint(summary_id: str, tenant_id: str) -> SummaryResponse:
    row = await get_summary(summary_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Summary {summary_id} not found")
    return _dict_to_response(row)


@router.get("/summaries", response_model=list[SummaryResponse])
async def list_summaries_endpoint(
    tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[SummaryResponse]:
    rows = await list_summaries(tenant_id, extraction_id, context_id, status, limit)
    return [_dict_to_response(r) for r in rows]
