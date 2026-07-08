"""Integration surface for the Company Summary Agent (Phase 3).

Unlike Phase 2's fire-and-forget crawl, `create_summary()` runs
synchronously — one bounded Groq call plus a couple of PostgREST reads fits
comfortably in a normal request/response cycle, so no background task or
polling is needed here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .data import CompanySummaryData
from .graph import CompanySummaryGraph
from .state import CompanySummaryState

_data = CompanySummaryData()


class ExtractionNotEligible(ValueError):
    """Raised when the referenced website_extractions row doesn't exist,
    isn't status='ready', or doesn't belong to the tenant."""


def _initial_state(summary_id: str, tenant_id: str, context_id: str, extraction_id: str, extraction_data: dict) -> CompanySummaryState:
    return {
        "summary_id": summary_id,
        "tenant_id": tenant_id,
        "context_id": context_id,
        "extraction_id": extraction_id,
        "extraction_data": extraction_data,
        "company_name": None,
        "website": None,
        "region": None,
        "industry": None,
        "products": [],
        "services": [],
        "description": None,
        "verdict": None,
        "engine": None,
        "status": "pending",
        "errors": [],
    }


async def prepare_summary(tenant_id: str, extraction_id: str) -> dict:
    """Validates the referenced extraction and creates a `pending` row."""
    extraction = await _data.get_extraction(extraction_id, tenant_id)
    if not extraction:
        raise ExtractionNotEligible(f"extraction {extraction_id} not found")
    if extraction.get("status") != "ready":
        raise ExtractionNotEligible(f"extraction status is '{extraction.get('status')}', expected 'ready'")
    if not extraction.get("extraction_data"):
        raise ExtractionNotEligible("extraction has no extraction_data to summarize")

    summary_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": summary_id,
        "tenant_id": tenant_id,
        "extraction_id": extraction_id,
        "context_id": extraction["context_id"],
        "company_name": None, "website": None, "region": None, "industry": None,
        "products": [], "services": [], "description": None, "verdict": None,
        "status": "pending", "errors": [],
        "created_at": now, "updated_at": now,
    }
    await _data.insert_summary(row)
    return {"row": row, "extraction_data": extraction["extraction_data"]}


async def create_summary(tenant_id: str, extraction_id: str) -> dict:
    """POST entry point — runs the graph synchronously and returns the
    completed (ready or failed) summary in one response."""
    prepared = await prepare_summary(tenant_id, extraction_id)
    row = prepared["row"]
    initial = _initial_state(row["id"], tenant_id, row["context_id"], extraction_id, prepared["extraction_data"])
    final_state = await CompanySummaryGraph.ainvoke(initial)

    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": row["id"],
        "tenant_id": tenant_id,
        "extraction_id": extraction_id,
        "context_id": row["context_id"],
        "company_name": final_state.get("company_name"),
        "website": final_state.get("website"),
        "region": final_state.get("region"),
        "industry": final_state.get("industry"),
        "products": final_state.get("products", []),
        "services": final_state.get("services", []),
        "description": final_state.get("description"),
        "verdict": final_state.get("verdict"),
        "status": final_state.get("status", "failed"),
        "errors": final_state.get("errors", []),
        "created_at": row["created_at"],
        "updated_at": now,
    }


async def get_summary(summary_id: str, tenant_id: str) -> dict | None:
    return await _data.get_summary(summary_id, tenant_id)


async def list_summaries(
    tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[dict]:
    return await _data.list_summaries(tenant_id, extraction_id, context_id, status, limit)
