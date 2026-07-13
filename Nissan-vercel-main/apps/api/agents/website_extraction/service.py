"""Integration surface for the Website Extraction Agent (Phase 2).

Two independent entry points for the same operation, mirroring
agents/followup's POST + `/stream` precedent — each creates its own row and
runs its own crawl:
  - create_extraction(): fire-and-forget (asyncio.create_task), poll via
    get_extraction()/list_extractions() — mirrors call_intelligence's
    upload -> background task -> poll pattern.
  - stream_run(): live per-node progress via an async generator, for the SSE
    endpoint — mirrors agents/followup/graph.py's stream_followup_agent.

Reads context_plans read-only via data.py; never writes to it (owned by
agents/context_planner/, which this package does not import or modify).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

from .data import WebsiteExtractionData
from .graph import WebsiteExtractionGraph
from .state import WebsiteExtractionState

logger = logging.getLogger(__name__)
_data = WebsiteExtractionData()

# Maps a just-completed node to the status the extraction row should show
# while later nodes are still running — gives GET-polling callers a
# meaningful in-progress status, not just "queued" until the very end.
_NODE_STATUS_AFTER = {
    "crawler": "crawling",
    "html_downloader": "parsing",
    "navigation_parser": "extracting",
    "trust_detector": "building",
}


class ContextNotEligible(ValueError):
    """Raised when the referenced context_plans row doesn't exist, isn't a
    url-type context, or isn't status='ready'."""


def _initial_state(extraction_id: str, tenant_id: str, context_id: str, seed_url: str) -> WebsiteExtractionState:
    return {
        "extraction_id": extraction_id,
        "tenant_id": tenant_id,
        "context_id": context_id,
        "seed_url": seed_url,
        "seed_host": None,
        "pages_crawled": [],
        "pages_discovered_count": 0,
        "has_sitemap": False,
        "has_robots_txt": False,
        "robots_txt_respected": True,
        "sitemap_used": False,
        "crawl_started_at": None,
        "crawl_completed_at": None,
        "final_url": None,
        "raw_html": {},
        "crawl_duration_ms": None,
        "parsed_pages": {},
        "company": {},
        "technical_seo": {},
        "pages": [],
        "links": {},
        "products": [],
        "services": [],
        "contact": {},
        "technology": {},
        "blog": {},
        "faq": [],
        "images": [],
        "videos": [],
        "trust": {},
        "extraction_data": None,
        "status": "queued",
        "errors": [],
    }


async def prepare_extraction(tenant_id: str, context_id: str) -> dict:
    """Validates the referenced context and creates a `queued` row. Shared by
    both create_extraction() and the SSE stream endpoint so each gets its own
    row before diverging into fire-and-forget vs. live-stream execution."""
    context = await _data.get_context(context_id, tenant_id)
    if not context:
        raise ContextNotEligible(f"context {context_id} not found")
    if context.get("input_type") != "url":
        raise ContextNotEligible("context is not a url-type context")
    if context.get("status") != "ready":
        raise ContextNotEligible(f"context status is '{context.get('status')}', expected 'ready'")

    seed_url = context.get("normalized_url") or context.get("website")
    if not seed_url:
        raise ContextNotEligible("context has no normalized_url/website to crawl")

    extraction_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": extraction_id,
        "tenant_id": tenant_id,
        "context_id": context_id,
        "url": seed_url,
        "status": "queued",
        "extraction_data": None,
        "errors": [],
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }
    await _data.insert_extraction(row)
    return row


async def _run_and_track(
    initial_state: WebsiteExtractionState, extraction_id: str,
) -> AsyncIterator[tuple[str | None, dict]]:
    """Runs the graph node-by-node via astream, persisting a coarse status
    transition to the DB as key nodes complete. Yields (node_name, merged
    state) per step, then a final (None, merged state)."""
    merged: dict = dict(initial_state)
    async for step in WebsiteExtractionGraph.astream(initial_state, stream_mode="updates"):
        for node_name, partial in step.items():
            # LangGraph represents a node's empty-dict return (a deliberate
            # no-op — see every node's "nothing to do" early return) as None
            # in the updates stream, not {} — dict.update(None) would raise.
            if partial:
                merged.update(partial)
            if node_name in _NODE_STATUS_AFTER:
                try:
                    await _data.update_extraction(extraction_id, {
                        "status": _NODE_STATUS_AFTER[node_name],
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception:  # noqa: BLE001
                    logger.exception("website_extraction.status_update_failed extraction_id=%s", extraction_id)
            yield node_name, merged
    yield None, merged


async def run_extraction(extraction_id: str, tenant_id: str, context_id: str, seed_url: str) -> dict:
    """Background task body for the fire-and-forget POST path. Never raises —
    a pipeline crash is caught and persisted as status='failed'."""
    initial = _initial_state(extraction_id, tenant_id, context_id, seed_url)
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_extraction(extraction_id, {"status": "crawling", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("website_extraction.start_update_failed extraction_id=%s", extraction_id)

    final_state = initial
    try:
        async for _node_name, merged in _run_and_track(initial, extraction_id):
            final_state = merged
    except Exception as exc:  # noqa: BLE001
        logger.exception("website_extraction.pipeline_crashed extraction_id=%s", extraction_id)
        completed = datetime.now(timezone.utc).isoformat()
        try:
            await _data.update_extraction(extraction_id, {
                "status": "failed",
                "errors": [*final_state.get("errors", []), f"pipeline_crashed: {exc}"],
                "completed_at": completed, "updated_at": completed,
            })
        except Exception:  # noqa: BLE001
            pass
        return final_state

    completed = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_extraction(extraction_id, {
            "status": final_state.get("status", "failed"),
            "extraction_data": final_state.get("extraction_data"),
            "errors": final_state.get("errors", []),
            "completed_at": completed, "updated_at": completed,
        })
    except Exception:  # noqa: BLE001
        logger.exception("website_extraction.final_persist_failed extraction_id=%s", extraction_id)
    return final_state


async def create_extraction(tenant_id: str, context_id: str) -> dict:
    """POST entry point — fires the crawl in the background, returns
    immediately with the queued row."""
    row = await prepare_extraction(tenant_id, context_id)
    asyncio.create_task(run_extraction(row["id"], tenant_id, context_id, row["url"]))
    return row


async def stream_run(extraction_id: str, tenant_id: str, context_id: str, seed_url: str) -> AsyncIterator[tuple]:
    """SSE entry point body — same pipeline as run_extraction, but yields
    node-by-node progress instead of running purely in the background."""
    initial = _initial_state(extraction_id, tenant_id, context_id, seed_url)
    now = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_extraction(extraction_id, {"status": "crawling", "started_at": now, "updated_at": now})
    except Exception:  # noqa: BLE001
        logger.exception("website_extraction.start_update_failed extraction_id=%s", extraction_id)

    final_state = initial
    try:
        async for node_name, merged in _run_and_track(initial, extraction_id):
            final_state = merged
            if node_name:
                yield ("node", node_name, merged)
    except Exception as exc:  # noqa: BLE001
        logger.exception("website_extraction.stream_pipeline_crashed extraction_id=%s", extraction_id)
        final_state = {**final_state, "status": "failed", "errors": [*final_state.get("errors", []), f"pipeline_crashed: {exc}"]}

    completed = datetime.now(timezone.utc).isoformat()
    try:
        await _data.update_extraction(extraction_id, {
            "status": final_state.get("status", "failed"),
            "extraction_data": final_state.get("extraction_data"),
            "errors": final_state.get("errors", []),
            "completed_at": completed, "updated_at": completed,
        })
    except Exception:  # noqa: BLE001
        logger.exception("website_extraction.stream_persist_failed extraction_id=%s", extraction_id)
    yield ("done", None, final_state)


async def get_extraction(extraction_id: str, tenant_id: str) -> dict | None:
    return await _data.get_extraction(extraction_id, tenant_id)


async def list_extractions(
    tenant_id: str, context_id: str | None = None, status: str | None = None, limit: int = 50,
) -> list[dict]:
    return await _data.list_extractions(tenant_id, context_id, status, limit)
