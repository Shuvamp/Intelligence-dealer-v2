"""Integration surface for the AEO Agent (Phase 5).

Two independent entry points, mirroring seo_agent's precedent:
  - create_analysis(): fire-and-forget (asyncio.create_task), poll via
    get_analysis()/list_analyses().
  - stream_run(): live per-node progress via an async generator, for the SSE
    endpoint — each of the 11 analyzer nodes yields a `node` event the
    instant it finishes, satisfying the spec's "display every completed
    agent live" requirement.

Reads website_extractions read-only via data.py; never writes to it (owned
by agents/website_extraction/, which this package does not import).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

from ._common import agent_result_key
from .data import AeoAgentData
from .graph import AEOAnalysisGraph
from .schema import AGENT_NAMES
from .state import AEOAnalysisState

logger = logging.getLogger(__name__)
_data = AeoAgentData()


class ExtractionNotEligible(ValueError):
    """Raised when the referenced website_extractions row doesn't exist,
    isn't status='ready', or doesn't belong to the tenant."""


def _initial_state(analysis_id: str, tenant_id: str, context_id: str, extraction_id: str, extraction_data: dict) -> AEOAnalysisState:
    state: dict = {
        "analysis_id": analysis_id,
        "tenant_id": tenant_id,
        "context_id": context_id,
        "extraction_id": extraction_id,
        "extraction_data": extraction_data,
        "analysis_data": None,
        "overall_score": None,
        "status": "queued",
        "errors": [],
    }
    for agent in AGENT_NAMES:
        state[agent_result_key(agent)] = None
    return state  # type: ignore[return-value]


async def prepare_analysis(tenant_id: str, extraction_id: str) -> dict:
    """Validates the referenced extraction and creates a `queued` row."""
    extraction = await _data.get_extraction(extraction_id, tenant_id)
    if not extraction:
        raise ExtractionNotEligible(f"extraction {extraction_id} not found")
    if extraction.get("status") != "ready":
        raise ExtractionNotEligible(f"extraction status is '{extraction.get('status')}', expected 'ready'")
    if not extraction.get("extraction_data"):
        raise ExtractionNotEligible("extraction has no extraction_data to analyze")

    analysis_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": analysis_id,
        "tenant_id": tenant_id,
        "extraction_id": extraction_id,
        "context_id": extraction["context_id"],
        "status": "queued",
        "analysis_data": None,
        "overall_score": None,
        "errors": [],
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }
    await _data.insert_analysis(row)
    return {"row": row, "extraction_data": extraction["extraction_data"]}


async def _run_and_track(initial_state: AEOAnalysisState) -> AsyncIterator[tuple[str | None, dict]]:
    """Runs the graph node-by-node via astream. Yields (node_name, merged
    state) per step, then a final (None, merged state)."""
    merged: dict = dict(initial_state)
    async for step in AEOAnalysisGraph.astream(initial_state, stream_mode="updates"):
        for node_name, partial in step.items():
            # LangGraph represents a node's empty-dict return as None in the
            # updates stream, not {} — dict.update(None) would raise.
            if partial:
                merged.update(partial)
            yield node_name, merged
    yield None, merged


async def run_analysis(analysis_id: str, tenant_id: str, context_id: str, extraction_id: str, extraction_data: dict) -> dict:
    """Background task body for the fire-and-forget POST path. Never raises —
    a pipeline crash is caught and persisted as status='failed'."""
    initial = _initial_state(analysis_id, tenant_id, context_id, extraction_id, extraction_data)
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_analysis(analysis_id, {"status": "analyzing", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("aeo_agent.start_update_failed analysis_id=%s", analysis_id)

    final_state = initial
    try:
        async for _node_name, merged in _run_and_track(initial):
            final_state = merged
    except Exception as exc:  # noqa: BLE001
        logger.exception("aeo_agent.pipeline_crashed analysis_id=%s", analysis_id)
        completed = datetime.now(timezone.utc).isoformat()
        try:
            await _data.update_analysis(analysis_id, {
                "status": "failed",
                "errors": [*final_state.get("errors", []), f"pipeline_crashed: {exc}"],
                "completed_at": completed, "updated_at": completed,
            })
        except Exception:  # noqa: BLE001
            pass
        return final_state

    completed = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_analysis(analysis_id, {
            "status": final_state.get("status", "failed"),
            "analysis_data": final_state.get("analysis_data"),
            "overall_score": final_state.get("overall_score"),
            "errors": final_state.get("errors", []),
            "completed_at": completed, "updated_at": completed,
        })
    except Exception:  # noqa: BLE001
        logger.exception("aeo_agent.final_persist_failed analysis_id=%s", analysis_id)
    return final_state


async def create_analysis(tenant_id: str, extraction_id: str) -> dict:
    """POST entry point — fires the analysis in the background, returns
    immediately with the queued row."""
    prepared = await prepare_analysis(tenant_id, extraction_id)
    row = prepared["row"]
    asyncio.create_task(run_analysis(row["id"], tenant_id, row["context_id"], extraction_id, prepared["extraction_data"]))
    return row


async def stream_run(analysis_id: str, tenant_id: str, context_id: str, extraction_id: str, extraction_data: dict) -> AsyncIterator[tuple]:
    """SSE entry point body — same pipeline as run_analysis, but yields
    node-by-node progress instead of running purely in the background."""
    initial = _initial_state(analysis_id, tenant_id, context_id, extraction_id, extraction_data)
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_analysis(analysis_id, {"status": "analyzing", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("aeo_agent.start_update_failed analysis_id=%s", analysis_id)

    final_state = initial
    try:
        async for node_name, merged in _run_and_track(initial):
            final_state = merged
            if node_name:
                yield ("node", node_name, merged)
    except Exception as exc:  # noqa: BLE001
        logger.exception("aeo_agent.stream_pipeline_crashed analysis_id=%s", analysis_id)
        final_state = {**final_state, "status": "failed", "errors": [*final_state.get("errors", []), f"pipeline_crashed: {exc}"]}

    completed = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_analysis(analysis_id, {
            "status": final_state.get("status", "failed"),
            "analysis_data": final_state.get("analysis_data"),
            "overall_score": final_state.get("overall_score"),
            "errors": final_state.get("errors", []),
            "completed_at": completed, "updated_at": completed,
        })
    except Exception:  # noqa: BLE001
        logger.exception("aeo_agent.stream_persist_failed analysis_id=%s", analysis_id)
    yield ("done", None, final_state)


async def get_analysis(analysis_id: str, tenant_id: str) -> dict | None:
    return await _data.get_analysis(analysis_id, tenant_id)


async def list_analyses(
    tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[dict]:
    return await _data.list_analyses(tenant_id, extraction_id, context_id, status, limit)
