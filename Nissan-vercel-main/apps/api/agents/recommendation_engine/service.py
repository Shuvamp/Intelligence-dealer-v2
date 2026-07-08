"""Integration surface for the Recommendation Engine (Phase 6).

Two independent entry points, mirroring seo_agent/aeo_agent's precedent:
  - create_report(): fire-and-forget (asyncio.create_task), poll via
    get_report()/list_reports().
  - stream_run(): live per-node progress via an async generator, for the SSE
    endpoint — each of the 7 pipeline nodes yields a `node` event the
    instant it finishes (pipeline-stage progress, not per-recommendation).

Reads website_extractions/seo_analyses/aeo_analyses read-only via data.py;
never writes to them (owned by their respective phases, which this package
does not import).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from .data import RecommendationEngineData
from .graph import RecommendationEngineGraph
from .state import RecommendationEngineState

logger = logging.getLogger(__name__)
_data = RecommendationEngineData()


class ReportNotEligible(ValueError):
    """Raised when the referenced extraction doesn't exist/isn't ready, or
    no ready seo_analyses/aeo_analyses row exists for it."""


def _initial_state(
    report_id: str, tenant_id: str, context_id: str, extraction_id: str,
    seo_analysis_id: str, aeo_analysis_id: str, website_json: dict[str, Any],
    seo_analysis_data: dict[str, Any], aeo_analysis_data: dict[str, Any],
    seo_overall_score: int, aeo_overall_score: int,
) -> RecommendationEngineState:
    state: dict = {
        "report_id": report_id,
        "tenant_id": tenant_id,
        "context_id": context_id,
        "extraction_id": extraction_id,
        "seo_analysis_id": seo_analysis_id,
        "aeo_analysis_id": aeo_analysis_id,
        "website_json": website_json,
        "seo_analysis_data": seo_analysis_data,
        "aeo_analysis_data": aeo_analysis_data,
        "seo_overall_score": seo_overall_score,
        "aeo_overall_score": aeo_overall_score,
        "seo_items": None,
        "aeo_items": None,
        "merged_items": None,
        "severity_groups": None,
        "report_data": None,
        "combined_score": None,
        "status": "queued",
        "errors": [],
    }
    return state  # type: ignore[return-value]


async def prepare_report(tenant_id: str, extraction_id: str) -> dict:
    """Validates the extraction is ready and a latest-ready SEO+AEO analysis
    exists for it, then creates a `queued` row."""
    extraction = await _data.get_extraction(extraction_id, tenant_id)
    if not extraction:
        raise ReportNotEligible(f"extraction {extraction_id} not found")
    if extraction.get("status") != "ready":
        raise ReportNotEligible(f"extraction status is '{extraction.get('status')}', expected 'ready'")

    seo_analysis = await _data.get_latest_ready_seo_analysis(extraction_id, tenant_id)
    if not seo_analysis:
        raise ReportNotEligible(f"no ready SEO analysis found for extraction {extraction_id}")

    aeo_analysis = await _data.get_latest_ready_aeo_analysis(extraction_id, tenant_id)
    if not aeo_analysis:
        raise ReportNotEligible(f"no ready AEO analysis found for extraction {extraction_id}")

    report_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": report_id,
        "tenant_id": tenant_id,
        "extraction_id": extraction_id,
        "context_id": extraction["context_id"],
        "seo_analysis_id": seo_analysis["id"],
        "aeo_analysis_id": aeo_analysis["id"],
        "status": "queued",
        "report_data": None,
        "combined_score": None,
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
        "seo_analysis_data": seo_analysis.get("analysis_data") or {},
        "aeo_analysis_data": aeo_analysis.get("analysis_data") or {},
        "seo_overall_score": seo_analysis.get("overall_score") or 0,
        "aeo_overall_score": aeo_analysis.get("overall_score") or 0,
    }


async def _run_and_track(initial_state: RecommendationEngineState) -> AsyncIterator[tuple[str | None, dict]]:
    """Runs the graph node-by-node via astream. Yields (node_name, merged
    state) per step, then a final (None, merged state)."""
    merged: dict = dict(initial_state)
    async for step in RecommendationEngineGraph.astream(initial_state, stream_mode="updates"):
        for node_name, partial in step.items():
            # LangGraph represents a node's empty-dict return as None in the
            # updates stream, not {} — dict.update(None) would raise.
            if partial:
                merged.update(partial)
            yield node_name, merged
    yield None, merged


async def run_report(
    report_id: str, tenant_id: str, context_id: str, extraction_id: str,
    seo_analysis_id: str, aeo_analysis_id: str, website_json: dict[str, Any],
    seo_analysis_data: dict[str, Any], aeo_analysis_data: dict[str, Any],
    seo_overall_score: int, aeo_overall_score: int,
) -> dict:
    """Background task body for the fire-and-forget POST path. Never raises —
    a pipeline crash is caught and persisted as status='failed'."""
    initial = _initial_state(
        report_id, tenant_id, context_id, extraction_id, seo_analysis_id, aeo_analysis_id,
        website_json, seo_analysis_data, aeo_analysis_data, seo_overall_score, aeo_overall_score,
    )
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_report(report_id, {"status": "generating", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("recommendation_engine.start_update_failed report_id=%s", report_id)

    final_state = initial
    try:
        async for _node_name, merged in _run_and_track(initial):
            final_state = merged
    except Exception as exc:  # noqa: BLE001
        logger.exception("recommendation_engine.pipeline_crashed report_id=%s", report_id)
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

    completed = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_report(report_id, {
            "status": final_state.get("status", "failed"),
            "report_data": final_state.get("report_data"),
            "combined_score": final_state.get("combined_score"),
            "errors": final_state.get("errors", []),
            "completed_at": completed, "updated_at": completed,
        })
    except Exception:  # noqa: BLE001
        logger.exception("recommendation_engine.final_persist_failed report_id=%s", report_id)
    return final_state


async def create_report(tenant_id: str, extraction_id: str) -> dict:
    """POST entry point — fires report generation in the background, returns
    immediately with the queued row."""
    prepared = await prepare_report(tenant_id, extraction_id)
    row = prepared["row"]
    asyncio.create_task(run_report(
        row["id"], tenant_id, row["context_id"], extraction_id,
        row["seo_analysis_id"], row["aeo_analysis_id"],
        prepared["website_json"], prepared["seo_analysis_data"], prepared["aeo_analysis_data"],
        prepared["seo_overall_score"], prepared["aeo_overall_score"],
    ))
    return row


async def stream_run(
    report_id: str, tenant_id: str, context_id: str, extraction_id: str,
    seo_analysis_id: str, aeo_analysis_id: str, website_json: dict[str, Any],
    seo_analysis_data: dict[str, Any], aeo_analysis_data: dict[str, Any],
    seo_overall_score: int, aeo_overall_score: int,
) -> AsyncIterator[tuple]:
    """SSE entry point body — same pipeline as run_report, but yields
    node-by-node progress instead of running purely in the background."""
    initial = _initial_state(
        report_id, tenant_id, context_id, extraction_id, seo_analysis_id, aeo_analysis_id,
        website_json, seo_analysis_data, aeo_analysis_data, seo_overall_score, aeo_overall_score,
    )
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_report(report_id, {"status": "generating", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("recommendation_engine.start_update_failed report_id=%s", report_id)

    final_state = initial
    try:
        async for node_name, merged in _run_and_track(initial):
            final_state = merged
            if node_name:
                yield ("node", node_name, merged)
    except Exception as exc:  # noqa: BLE001
        logger.exception("recommendation_engine.stream_pipeline_crashed report_id=%s", report_id)
        final_state = {**final_state, "status": "failed", "errors": [*final_state.get("errors", []), f"pipeline_crashed: {exc}"]}

    completed = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_report(report_id, {
            "status": final_state.get("status", "failed"),
            "report_data": final_state.get("report_data"),
            "combined_score": final_state.get("combined_score"),
            "errors": final_state.get("errors", []),
            "completed_at": completed, "updated_at": completed,
        })
    except Exception:  # noqa: BLE001
        logger.exception("recommendation_engine.stream_persist_failed report_id=%s", report_id)
    yield ("done", None, final_state)


async def get_report(report_id: str, tenant_id: str) -> dict | None:
    return await _data.get_report(report_id, tenant_id)


async def list_reports(
    tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[dict]:
    return await _data.list_reports(tenant_id, extraction_id, context_id, status, limit)
