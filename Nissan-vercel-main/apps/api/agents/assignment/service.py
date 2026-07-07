"""Integration surface for the pipeline's assign node (KEERTHANA).

`assign_scored_lead(...)` bridges the pipeline's NormalizedLead + Scoring into
Keerthana's LangGraph assignment agent (least-loaded executive selection with
capacity limits, Claude-assisted when ANTHROPIC_API_KEY is set). It lazily
builds + seeds a singleton in-process DuckDB of sales executives, runs the
agent, and maps the result to the pipeline's Assignment contract
({assigned_to, assignee_name, reason}). It NEVER raises — on any failure it
returns a safe default so the intake pipeline can't break.
"""

import os
import logging
from uuid import uuid4

from .database import Database
from .seeding import init_demo_data, ABC_TENANT_ID
from .agent import AssignmentAgent

logger = logging.getLogger(__name__)

_db: Database | None = None
_agent: AssignmentAgent | None = None
_seeded = False


async def _ensure_ready() -> AssignmentAgent:
    global _db, _agent, _seeded
    if _db is None:
        _db = Database()
    if not _seeded:
        await init_demo_data(_db)
        _seeded = True
    if _agent is None:
        _agent = AssignmentAgent(_db, anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"))
    return _agent


async def assign_scored_lead(normalized: dict, scoring: dict, tenant_id: str | None = None,
                             lead_id: str | None = None) -> dict:
    """
    NormalizedLead + Scoring → { assigned_to, assignee_name, reason }.

    assigned_to  = executive id, assignee_name = executive name.
    Never raises; returns a safe default on any failure.
    """
    score = (scoring or {}).get("score") or "warm"
    if score == "dead":          # agent vocabulary is hot/warm/cold
        score = "cold"
    tenant = tenant_id or ABC_TENANT_ID
    lid = lead_id or str(uuid4())

    try:
        agent = await _ensure_ready()
        result = await agent.assign_lead_with_graph(tenant, {"lead_id": lid, "score": score})
        if result.get("success") and result.get("executive_id"):
            return {
                "assigned_to": result["executive_id"],
                "assignee_name": result.get("assigned_to"),
                "reason": result.get("reasoning") or "least-loaded assignment",
            }
        logger.warning("assignment agent returned no executive: %s", result.get("error"))
    except Exception:
        logger.exception("assign_scored_lead failed; returning safe default")

    return {"assigned_to": None, "assignee_name": None, "reason": "assignment unavailable"}
