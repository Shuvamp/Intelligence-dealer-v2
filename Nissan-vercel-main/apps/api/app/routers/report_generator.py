"""Report Generator API (Phase 7) — see docs/planner/07_REPORT_GENERATOR.md.

A standalone vertical (reads website_extractions/recommendation_reports/
seo_analyses/aeo_analyses/company_summaries read-only; never modifies any
prior phase's package or router) — mirrors recommendation_engine.py's dual
poll+SSE shape. The graph is a short 6-node transformation pipeline, so each
SSE `node` event represents pipeline-stage completion.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.report_generator.service import (
    ReportNotEligible,
    create_report,
    get_report,
    list_reports,
    prepare_report,
    stream_run,
)

router = APIRouter()

# node_name -> human label, in pipeline order (the 6 ReportGraph nodes).
_NODE_STAGES: list[tuple[str, str]] = [
    ("load_inputs", "Loading SEO + AEO + recommendation inputs"),
    ("generate_narratives", "Generating narrative sections"),
    ("assemble_structured", "Assembling structured sections"),
    ("build_report", "Building report"),
    ("render_markdown", "Rendering Markdown"),
    ("validator", "Validating report"),
]
_NODE_LABELS = {name: label for name, label in _NODE_STAGES}


# ── Request / Response models ────────────────────────────────────────────────

class CreateReportRequest(BaseModel):
    tenant_id: str
    extraction_id: str


class ReportResponse(BaseModel):
    report_id: str
    tenant_id: str
    extraction_id: str
    context_id: str
    recommendation_report_id: str
    seo_analysis_id: str
    aeo_analysis_id: str
    company_summary_id: str | None = None
    status: str
    report_data: dict | None = None
    markdown_content: str | None = None
    overall_score: int | None = None
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
        recommendation_report_id=row.get("recommendation_report_id", ""),
        seo_analysis_id=row.get("seo_analysis_id", ""),
        aeo_analysis_id=row.get("aeo_analysis_id", ""),
        company_summary_id=row.get("company_summary_id"),
        status=row.get("status", "queued"),
        report_data=row.get("report_data"),
        markdown_content=row.get("markdown_content"),
        overall_score=row.get("overall_score"),
        errors=row.get("errors") or [],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/reports", response_model=ReportResponse)
async def create_report_endpoint(body: CreateReportRequest) -> ReportResponse:
    """Fire-and-forget: validates a latest-ready recommendation report (Phase
    6 anchor) exists for `extraction_id`, creates a `queued` row, and runs
    the 6-node report pipeline in the background, returning immediately. Poll
    GET /reports/{id} for progress/result. NOTE: calling this and
    GET /reports/stream for the same extraction_id generates two independent
    reports (two rows) — mirrors the POST + /stream precedent of prior phases."""
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
    """SSE — live per-pipeline-stage progress (6 stages). Creates its OWN
    report row (independent of POST /reports) and streams `event: node` per
    completed stage, ending with `event: result`."""
    try:
        prepared = await prepare_report(tenant_id, extraction_id)
    except ReportNotEligible as e:
        raise HTTPException(status_code=400, detail=str(e))
    row = prepared["row"]
    total = len(_NODE_STAGES)

    async def gen():
        yield f"event: created\ndata: {json.dumps({'report_id': row['id']})}\n\n"
        try:
            async for kind, node_name, state in stream_run(prepared):
                if kind == "node" and node_name in _NODE_LABELS:
                    index = [n for n, _ in _NODE_STAGES].index(node_name) + 1
                    payload = {"node": node_name, "label": _NODE_LABELS[node_name], "index": index, "total": total}
                    yield f"event: node\ndata: {json.dumps(payload)}\n\n"
                elif kind == "done":
                    payload = _row_to_response({
                        **row,
                        "status": state.get("status"),
                        "report_data": state.get("report_data"),
                        "markdown_content": state.get("markdown_content"),
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


@router.get("/reports/{report_id}", response_model=ReportResponse)
async def get_report_endpoint(report_id: str, tenant_id: str) -> ReportResponse:
    row = await get_report(report_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    return _row_to_response(row)
