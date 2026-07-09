"""Website Extraction Engine API (Phase 2) — see docs/planner/02_WEBSITE_EXTRACTION_ENGINE.md.

A standalone vertical (reads context_plans read-only; never modifies
agents/context_planner/), so it gets its own router — mirrors
app/routers/context_planner.py's shape.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.website_extraction.service import (
    ContextNotEligible,
    create_extraction,
    get_extraction,
    list_extractions,
    prepare_extraction,
    stream_run,
)

router = APIRouter()


# ── Request / Response models ────────────────────────────────────────────────

class CreateExtractionRequest(BaseModel):
    tenant_id: str
    context_id: str


class ExtractionResponse(BaseModel):
    extraction_id: str
    tenant_id: str
    context_id: str
    url: str | None = None
    status: str
    extraction_data: dict | None = None
    errors: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


def _row_to_response(row: dict) -> ExtractionResponse:
    return ExtractionResponse(
        extraction_id=row["id"],
        tenant_id=row["tenant_id"],
        context_id=row["context_id"],
        url=row.get("url"),
        status=row.get("status", "queued"),
        extraction_data=row.get("extraction_data"),
        errors=row.get("errors") or [],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/extractions", response_model=ExtractionResponse)
async def create_extraction_endpoint(body: CreateExtractionRequest) -> ExtractionResponse:
    """Fire-and-forget: creates a `queued` row and starts the crawl in the
    background, returning immediately. Poll GET /extractions/{id} for
    progress/result. NOTE: calling this and GET /extractions/stream for the
    same context_id runs two independent crawls (two rows) — each is a
    self-contained execution, same as this codebase's existing
    POST /followup/{lead_id} + GET /followup/{lead_id}/stream precedent."""
    try:
        row = await create_extraction(body.tenant_id, body.context_id)
    except ContextNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _row_to_response(row)


@router.get("/extractions", response_model=list[ExtractionResponse])
async def list_extractions_endpoint(
    tenant_id: str, context_id: str | None = None, status: str | None = None, limit: int = 50,
) -> list[ExtractionResponse]:
    rows = await list_extractions(tenant_id, context_id, status, limit)
    return [_row_to_response(r) for r in rows]


# NOTE: this literal route MUST be registered before the parameterized
# "/extractions/{extraction_id}" route below — FastAPI/Starlette matches
# routes in registration order, so a parameterized route registered first
# would otherwise greedily match "/extractions/stream" with
# extraction_id="stream".
@router.get("/extractions/stream")
async def stream_extraction_endpoint(context_id: str, tenant_id: str):
    """SSE — live per-node progress. Creates its OWN extraction row
    (independent of POST /extractions, see its docstring) and streams
    `event: node` per completed graph node, ending with `event: result`."""
    try:
        row = await prepare_extraction(tenant_id, context_id)
    except ContextNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def gen():
        yield f"event: created\ndata: {json.dumps({'extraction_id': row['id']})}\n\n"
        try:
            async for kind, node_name, state in stream_run(row["id"], tenant_id, context_id, row["url"]):
                if kind == "node":
                    yield f"event: node\ndata: {json.dumps({'node': node_name})}\n\n"
                else:
                    payload = _row_to_response({
                        **row,
                        "status": state.get("status"),
                        "extraction_data": state.get("extraction_data"),
                        "errors": state.get("errors", []),
                    }).model_dump()
                    yield f"event: result\ndata: {json.dumps(payload)}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/extractions/{extraction_id}", response_model=ExtractionResponse)
async def get_extraction_endpoint(extraction_id: str, tenant_id: str) -> ExtractionResponse:
    row = await get_extraction(extraction_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Extraction {extraction_id} not found")
    return _row_to_response(row)
