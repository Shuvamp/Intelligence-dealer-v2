"""Integration surface for the Report Generator (Phase 7).

Two independent entry points, mirroring recommendation_engine's precedent:
  - create_report(): fire-and-forget (asyncio.create_task), poll via
    get_report()/list_reports().
  - stream_run(): live per-node progress via an async generator, for the SSE
    endpoint — each of the 6 pipeline nodes yields a `node` event the instant
    it finishes (pipeline-stage progress).

Anchors on a latest-ready Phase 6 recommendation_reports row, then fetches
the exact seo_analyses/aeo_analyses rows it consolidated (via its stored
seo_analysis_id/aeo_analysis_id), the extraction, and the optional latest
company_summary — all read-only via data.py; never writes to any upstream
table.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from .data import ReportGeneratorData
from .graph import ReportGraph
from .state import ReportGeneratorState

logger = logging.getLogger(__name__)
_data = ReportGeneratorData()


class ReportNotEligible(ValueError):
    """Raised when the extraction doesn't exist/isn't ready, no ready
    recommendation report exists for it, or a referenced SEO/AEO row is
    missing."""


def _initial_state(prepared: dict) -> ReportGeneratorState:
    row = prepared["row"]
    state: dict = {
        "report_id": row["id"],
        "tenant_id": row["tenant_id"],
        "context_id": row["context_id"],
        "extraction_id": row["extraction_id"],
        "recommendation_report_id": row["recommendation_report_id"],
        "seo_analysis_id": row["seo_analysis_id"],
        "aeo_analysis_id": row["aeo_analysis_id"],
        "company_summary_id": row.get("company_summary_id"),
        "website_json": prepared["website_json"],
        "recommendation_report_data": prepared["recommendation_report_data"],
        "seo_analysis_data": prepared["seo_analysis_data"],
        "aeo_analysis_data": prepared["aeo_analysis_data"],
        "company_summary": prepared.get("company_summary"),
        "combined_score": prepared.get("combined_score"),
        "seo_score": prepared.get("seo_score"),
        "aeo_score": prepared.get("aeo_score"),
        "narratives": None,
        "structured": None,
        "engine": None,
        "report_data": None,
        "markdown_content": None,
        "overall_score": None,
        "status": "queued",
        "errors": [],
    }
    return state  # type: ignore[return-value]


async def prepare_report(tenant_id: str, extraction_id: str) -> dict:
    """Validates the extraction is ready and a latest-ready recommendation
    report (Phase 6 anchor) exists, fetches the exact SEO/AEO rows it used
    plus the optional company summary, then creates a `queued` row."""
    extraction = await _data.get_extraction(extraction_id, tenant_id)
    if not extraction:
        raise ReportNotEligible(f"extraction {extraction_id} not found")
    if extraction.get("status") != "ready":
        raise ReportNotEligible(f"extraction status is '{extraction.get('status')}', expected 'ready'")

    rec_report = await _data.get_latest_ready_recommendation_report(extraction_id, tenant_id)
    if not rec_report:
        raise ReportNotEligible(f"no ready recommendation report found for extraction {extraction_id}")

    seo_analysis_id = rec_report.get("seo_analysis_id")
    aeo_analysis_id = rec_report.get("aeo_analysis_id")
    seo_analysis = await _data.get_seo_analysis(seo_analysis_id, tenant_id) if seo_analysis_id else None
    aeo_analysis = await _data.get_aeo_analysis(aeo_analysis_id, tenant_id) if aeo_analysis_id else None
    if not seo_analysis:
        raise ReportNotEligible(f"SEO analysis {seo_analysis_id} referenced by the recommendation report was not found")
    if not aeo_analysis:
        raise ReportNotEligible(f"AEO analysis {aeo_analysis_id} referenced by the recommendation report was not found")

    company_summary = await _data.get_latest_ready_company_summary(extraction_id, tenant_id)  # optional

    rec_summary = (rec_report.get("report_data") or {}).get("summary") or {}
    report_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": report_id,
        "tenant_id": tenant_id,
        "extraction_id": extraction_id,
        "context_id": extraction["context_id"],
        "recommendation_report_id": rec_report["id"],
        "seo_analysis_id": seo_analysis_id,
        "aeo_analysis_id": aeo_analysis_id,
        "company_summary_id": company_summary["id"] if company_summary else None,
        "status": "queued",
        "report_data": None,
        "markdown_content": None,
        "overall_score": None,
        "errors": [],
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }
    await _data.insert_report(row)
    return {
        "row": row,
        "website_json": extraction.get("extraction_data") or {},
        "recommendation_report_data": rec_report.get("report_data") or {},
        "seo_analysis_data": seo_analysis.get("analysis_data") or {},
        "aeo_analysis_data": aeo_analysis.get("analysis_data") or {},
        "company_summary": company_summary,
        "combined_score": rec_report.get("combined_score") or rec_summary.get("combined_score") or 0,
        "seo_score": rec_summary.get("seo_score") or 0,
        "aeo_score": rec_summary.get("aeo_score") or 0,
    }


async def _run_and_track(initial_state: ReportGeneratorState) -> AsyncIterator[tuple[str | None, dict]]:
    """Runs the graph node-by-node via astream. Yields (node_name, merged
    state) per step, then a final (None, merged state)."""
    merged: dict = dict(initial_state)
    async for step in ReportGraph.astream(initial_state, stream_mode="updates"):
        for node_name, partial in step.items():
            # LangGraph represents a node's empty-dict return as None in the
            # updates stream, not {} — dict.update(None) would raise.
            if partial:
                merged.update(partial)
            yield node_name, merged
    yield None, merged


async def _persist_final(report_id: str, final_state: dict) -> None:
    completed = datetime.now(timezone.utc).isoformat()
    await _data.update_report(report_id, {
        "status": final_state.get("status", "failed"),
        "report_data": final_state.get("report_data"),
        "markdown_content": final_state.get("markdown_content"),
        "overall_score": final_state.get("overall_score"),
        "errors": final_state.get("errors", []),
        "completed_at": completed, "updated_at": completed,
    })


async def run_report(prepared: dict) -> dict:
    """Background task body for the fire-and-forget POST path. Never raises —
    a pipeline crash is caught and persisted as status='failed'."""
    initial = _initial_state(prepared)
    report_id = initial["report_id"]
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_report(report_id, {"status": "generating", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("report_generator.start_update_failed report_id=%s", report_id)

    final_state = initial
    try:
        async for _node_name, merged in _run_and_track(initial):
            final_state = merged
    except Exception as exc:  # noqa: BLE001
        logger.exception("report_generator.pipeline_crashed report_id=%s", report_id)
        completed = datetime.now(timezone.utc).isoformat()
        try:
            await _data.update_report(report_id, {
                "status": "failed",
                "errors": [*final_state.get("errors", []), f"pipeline_crashed: {exc}"],
                "completed_at": completed, "updated_at": completed,
            })
        except Exception:  # noqa: BLE001
            pass
        return final_state

    try:
        await _persist_final(report_id, final_state)
    except Exception:  # noqa: BLE001
        logger.exception("report_generator.final_persist_failed report_id=%s", report_id)
    return final_state


async def create_report(tenant_id: str, extraction_id: str) -> dict:
    """POST entry point — fires report generation in the background, returns
    immediately with the queued row."""
    prepared = await prepare_report(tenant_id, extraction_id)
    asyncio.create_task(run_report(prepared))
    return prepared["row"]


async def stream_run(prepared: dict) -> AsyncIterator[tuple]:
    """SSE entry point body — same pipeline as run_report, but yields
    node-by-node progress instead of running purely in the background."""
    initial = _initial_state(prepared)
    report_id = initial["report_id"]
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_report(report_id, {"status": "generating", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("report_generator.start_update_failed report_id=%s", report_id)

    final_state = initial
    try:
        async for node_name, merged in _run_and_track(initial):
            final_state = merged
            if node_name:
                yield ("node", node_name, merged)
    except Exception as exc:  # noqa: BLE001
        logger.exception("report_generator.stream_pipeline_crashed report_id=%s", report_id)
        final_state = {**final_state, "status": "failed", "errors": [*final_state.get("errors", []), f"pipeline_crashed: {exc}"]}

    try:
        await _persist_final(report_id, final_state)
    except Exception:  # noqa: BLE001
        logger.exception("report_generator.stream_persist_failed report_id=%s", report_id)
    yield ("done", None, final_state)


async def get_report(report_id: str, tenant_id: str) -> dict | None:
    return await _data.get_report(report_id, tenant_id)


async def list_reports(
    tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[dict]:
    return await _data.list_reports(tenant_id, extraction_id, context_id, status, limit)
