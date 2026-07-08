"""Recommendation Engine API (Phase 6) — see docs/planner/06_RECOMMENDATION_ENGINE.md.

A standalone vertical (reads website_extractions/seo_analyses/aeo_analyses
read-only; never modifies any prior phase's agent package or router) —
mirrors app/routers/seo_agent.py's / aeo_agent.py's dual poll+SSE shape.
Unlike those phases (per-check fan-out), this graph is a short 7-node
transformation pipeline, so each SSE `node` event represents pipeline-stage
completion, not a per-check result.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.recommendation_engine.service import (
    ReportNotEligible,
    create_report,
    get_report,
    list_reports,
    prepare_report,
    stream_run,
)

router = APIRouter()

# node_name -> (human label, state key whose length is a meaningful progress count, or None)
_NODE_STAGES: list[tuple[str, str, str | None]] = [
    ("load_reports", "Loading SEO + AEO reports", None),
    ("normalize_seo", "Normalizing SEO recommendations", "seo_items"),
    ("normalize_aeo", "Normalizing AEO recommendations", "aeo_items"),
    ("merge_and_sort", "Merging and sorting recommendations", "merged_items"),
    ("group_by_severity", "Grouping by severity", None),
    ("build_summary", "Building summary", None),
    ("validator", "Validating report", None),
]
_NODE_INFO = {name: (label, count_key) for name, label, count_key in _NODE_STAGES}


# ── Request / Response models ────────────────────────────────────────────────

class CreateReportRequest(BaseModel):
    tenant_id: str
    extraction_id: str


class ReportResponse(BaseModel):
    report_id: str
    tenant_id: str
    extraction_id: str
    context_id: str
    seo_analysis_id: str
    aeo_analysis_id: str
    status: str
    report_data: dict | None = None
    combined_score: int | None = None
    errors: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


def _row_to_response(row: dict) -> ReportResponse:
    return ReportResponse(
        report_id=row["id"],
        tenant_id=row["tenant_id"],
        extraction_id=row["extraction_id"],
        context_id=row["context_id"],
        seo_analysis_id=row.get("seo_analysis_id", ""),
        aeo_analysis_id=row.get("aeo_analysis_id", ""),
        status=row.get("status", "queued"),
        report_data=row.get("report_data"),
        combined_score=row.get("combined_score"),
        errors=row.get("errors") or [],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/reports", response_model=ReportResponse)
async def create_report_endpoint(body: CreateReportRequest) -> ReportResponse:
    """Fire-and-forget: validates a latest-ready SEO+AEO analysis exists for
    `extraction_id`, creates a `queued` row, and runs the 7-node
    consolidation pipeline in the background, returning immediately. Poll
    GET /reports/{id} for progress/result. NOTE: calling this and
    GET /reports/stream for the same extraction_id runs two independent
    report generations (two rows) — mirrors seo_agent/aeo_agent's POST +
    /stream precedent."""
    try:
        row = await create_report(body.tenant_id, body.extraction_id)
    except ReportNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _row_to_response(row)


@router.get("/reports", response_model=list[ReportResponse])
async def list_reports_endpoint(
    tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[ReportResponse]:
    rows = await list_reports(tenant_id, extraction_id, context_id, status, limit)
    return [_row_to_response(r) for r in rows]


# NOTE: this literal route MUST be registered before the parameterized
# "/reports/{report_id}" route below — FastAPI/Starlette matches routes in
# registration order (the exact bug Phase 2's /extractions/stream hit).
@router.get("/reports/stream")
async def stream_report_endpoint(extraction_id: str, tenant_id: str):
    """SSE — live per-pipeline-stage progress (7 stages). Creates its OWN
    report row (independent of POST /reports, see its docstring) and
    streams `event: node` per completed stage, ending with `event: result`."""
    try:
        prepared = await prepare_report(tenant_id, extraction_id)
    except ReportNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))
    row = prepared["row"]
    total = len(_NODE_STAGES)

    async def gen():
        yield f"event: created\ndata: {json.dumps({'report_id': row['id']})}\n\n"
        try:
            async for kind, node_name, state in stream_run(
                row["id"], tenant_id, row["context_id"], extraction_id,
                row["seo_analysis_id"], row["aeo_analysis_id"],
                prepared["website_json"], prepared["seo_analysis_data"], prepared["aeo_analysis_data"],
                prepared["seo_overall_score"], prepared["aeo_overall_score"],
            ):
                if kind == "node" and node_name in _NODE_INFO:
                    label, count_key = _NODE_INFO[node_name]
                    index = [n for n, _, _ in _NODE_STAGES].index(node_name) + 1
                    count = len(state.get(count_key) or []) if count_key else None
                    payload = {"node": node_name, "label": label, "index": index, "total": total, "count": count}
                    yield f"event: node\ndata: {json.dumps(payload)}\n\n"
                elif kind == "done":
                    payload = _row_to_response({
                        **row,
                        "status": state.get("status"),
                        "report_data": state.get("report_data"),
                        "combined_score": state.get("combined_score"),
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


@router.get("/reports/{report_id}", response_model=ReportResponse)
async def get_report_endpoint(report_id: str, tenant_id: str) -> ReportResponse:
    row = await get_report(report_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    return _row_to_response(row)
