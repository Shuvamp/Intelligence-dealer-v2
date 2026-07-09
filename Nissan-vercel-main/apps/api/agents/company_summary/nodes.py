"""Company Summary nodes (Phase 3).

load_extraction -> generate_summary -> store_summary -> END

Every node follows this codebase's "never break the platform" convention:
a failure degrades to a safe status + recorded error, never an unhandled
exception.
"""
from __future__ import annotations

import logging

from . import llm
from .data import CompanySummaryData
from .state import CompanySummaryState

logger = logging.getLogger(__name__)
_data = CompanySummaryData()


def load_extraction_node(state: CompanySummaryState) -> dict:
    """No DB I/O here — service.prepare_summary() already fetched
    extraction_data once. This node just validates it's usable."""
    if not state.get("extraction_data"):
        return {"status": "failed", "errors": [*state.get("errors", []), "extraction_data missing or empty"]}
    return {}


def generate_summary_node(state: CompanySummaryState) -> dict:
    if state.get("status") == "failed":
        return {}  # load_extraction_node already rejected this run

    extraction = state["extraction_data"]
    website = extraction.get("website") or {}
    website_url = website.get("final_url") or website.get("url") or None

    data = llm.generate_summary(extraction)
    engine = "groq"
    if data is None:
        data = llm.deterministic_summary(extraction)
        engine = "deterministic"

    return {
        "company_name": data["company_name"],
        "website": website_url or "Unknown",
        "region": data["region"],
        "industry": data["industry"],
        "products": data["products"],
        "services": data["services"],
        "description": data["description"],
        "verdict": data["verdict"],
        "engine": engine,
        "status": "ready",
    }


async def store_summary_node(state: CompanySummaryState) -> dict:
    if state.get("status") == "failed":
        # Still persist the failed row so it's visible in history/audit.
        try:
            await _data.update_summary(state["summary_id"], {
                "status": "failed",
                "errors": state.get("errors", []),
            })
        except Exception:  # noqa: BLE001
            logger.exception("company_summary.store_failed_row_failed summary_id=%s", state.get("summary_id"))
        return {}

    record = {
        "company_name": state.get("company_name"),
        "website": state.get("website"),
        "region": state.get("region"),
        "industry": state.get("industry"),
        "products": state.get("products", []),
        "services": state.get("services", []),
        "description": state.get("description"),
        "verdict": state.get("verdict"),
        "status": "ready",
        "errors": state.get("errors", []),
    }
    try:
        await _data.update_summary(state["summary_id"], record)
        return {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("company_summary.store_failed summary_id=%s", state.get("summary_id"))
        return {"status": "failed", "errors": [*state.get("errors", []), f"store_failed: {exc}"]}
