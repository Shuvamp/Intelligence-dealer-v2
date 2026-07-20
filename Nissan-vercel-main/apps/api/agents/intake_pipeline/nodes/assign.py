"""
NODE 4 — ASSIGN    OWNER: KEERTHANA
Position: Source → validate → normalize → score → [ASSIGN] → DB
Reads   : state["normalized"], state["scoring"]
Writes  : { "assignment": { "assigned_to", "assignee_name", "reason" } }

Delegates to Keerthana's LangGraph assignment agent via
`agents/assignment/service.py` — least-loaded executive selection with
capacity limits (Claude-assisted when ANTHROPIC_API_KEY is set, deterministic
fallback otherwise). `assign_scored_lead` NEVER raises, so the pipeline can't
break. See docs/ASSIGNMENT-AGENT.md.
"""
import logging

from ..contracts import PipelineState, NodeDeps
from agents.assignment.service import assign_scored_lead

logger = logging.getLogger(__name__)


async def assign_node(state: PipelineState, deps: NodeDeps) -> dict:
    normalized = state.get("normalized") or {}
    scoring = state.get("scoring") or {}
    tenant_id = deps.get("tenant_id") if isinstance(deps, dict) else None

    # Pass the real lead_id (persisted by validate_node) so the agent's
    # lead_assignments row FKs a real lead instead of a random uuid (→ 409).
    assignment = await assign_scored_lead(
        normalized, scoring, tenant_id=tenant_id, lead_id=state.get("lead_id"),
    )
    return {"assignment": assignment}
