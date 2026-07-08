"""AEO Agent API (Phase 5) — see docs/planner/05_AEO_AGENT.md.

A standalone vertical (reads website_extractions read-only; never modifies
agents/website_extraction/, agents/seo_agent/, or any other prior phase's
package), so it gets its own router — mirrors app/routers/seo_agent.py's
dual poll+SSE shape. SSE payload key is `agent` (not `dimension`), matching
this spec's own vocabulary ("independent agents").
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.aeo_agent._common import agent_result_key
from agents.aeo_agent.schema import AGENT_NAMES
from agents.aeo_agent.service import (
    ExtractionNotEligible,
    create_analysis,
    get_analysis,
    list_analyses,
    prepare_analysis,
    stream_run,
)

router = APIRouter()

# node_name (e.g. "entity_detection") -> spec agent name (e.g. "Entity Detection")
_NODE_TO_AGENT = {agent_result_key(a)[: -len("_result")]: a for a in AGENT_NAMES}


# ── Request / Response models ────────────────────────────────────────────────

class CreateAnalysisRequest(BaseModel):
    tenant_id: str
    extraction_id: str


class AnalysisResponse(BaseModel):
    analysis_id: str
    tenant_id: str
    extraction_id: str
    context_id: str
    status: str
    analysis_data: dict | None = None
    overall_score: int | None = None
    errors: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


def _row_to_response(row: dict) -> AnalysisResponse:
    return AnalysisResponse(
        analysis_id=row["id"],
        tenant_id=row["tenant_id"],
        extraction_id=row["extraction_id"],
        context_id=row["context_id"],
        status=row.get("status", "queued"),
        analysis_data=row.get("analysis_data"),
        overall_score=row.get("overall_score"),
        errors=row.get("errors") or [],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/analyses", response_model=AnalysisResponse)
async def create_analysis_endpoint(body: CreateAnalysisRequest) -> AnalysisResponse:
    """Fire-and-forget: creates a `queued` row and starts the 11-agent
    analysis in the background, returning immediately. Poll
    GET /analyses/{id} for progress/result. NOTE: calling this and
    GET /analyses/stream for the same extraction_id runs two independent
    analyses (two rows) — mirrors seo_agent's POST + /stream precedent."""
    try:
        row = await create_analysis(body.tenant_id, body.extraction_id)
    except ExtractionNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _row_to_response(row)


@router.get("/analyses", response_model=list[AnalysisResponse])
async def list_analyses_endpoint(
    tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[AnalysisResponse]:
    rows = await list_analyses(tenant_id, extraction_id, context_id, status, limit)
    return [_row_to_response(r) for r in rows]


# NOTE: this literal route MUST be registered before the parameterized
# "/analyses/{analysis_id}" route below — FastAPI/Starlette matches routes
# in registration order (the exact bug Phase 2's /extractions/stream hit).
@router.get("/analyses/stream")
async def stream_analysis_endpoint(extraction_id: str, tenant_id: str):
    """SSE — live per-agent progress. Creates its OWN analysis row
    (independent of POST /analyses, see its docstring) and streams
    `event: node` per completed analyzer (with the agent name and its
    PASS/WARNING/FAIL status already known), ending with `event: result`."""
    try:
        prepared = await prepare_analysis(tenant_id, extraction_id)
    except ExtractionNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))
    row = prepared["row"]
    total = len(AGENT_NAMES)

    async def gen():
        yield f"event: created\ndata: {json.dumps({'analysis_id': row['id']})}\n\n"
        try:
            async for kind, node_name, state in stream_run(
                row["id"], tenant_id, row["context_id"], extraction_id, prepared["extraction_data"],
            ):
                if kind == "node" and node_name in _NODE_TO_AGENT:
                    agent = _NODE_TO_AGENT[node_name]
                    agent_result = state.get(agent_result_key(agent)) or {}
                    index = AGENT_NAMES.index(agent) + 1
                    payload = {
                        "node": node_name, "agent": agent,
                        "status": agent_result.get("status"), "index": index, "total": total,
                    }
                    yield f"event: node\ndata: {json.dumps(payload)}\n\n"
                elif kind == "done":
                    payload = _row_to_response({
                        **row,
                        "status": state.get("status"),
                        "analysis_data": state.get("analysis_data"),
                        "overall_score": state.get("overall_score"),
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


@router.get("/analyses/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis_endpoint(analysis_id: str, tenant_id: str) -> AnalysisResponse:
    row = await get_analysis(analysis_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Analysis {analysis_id} not found")
    return _row_to_response(row)
