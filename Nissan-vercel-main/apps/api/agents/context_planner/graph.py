"""Context Planner Graph (Phase 1).

url path:    START → validate_url → normalize_url → create_context → store_context → track_status → END
manual path: START → validate_manual → create_context → store_context → track_status → END

Both branches always flow through create_context/store_context/track_status —
even a submission that fails validation gets a full record persisted with
status="invalid" (audit trail), rather than being dropped before storage.
"""
from __future__ import annotations

from langgraph.graph import StateGraph, END

from .nodes import (
    validate_url_node,
    validate_manual_node,
    normalize_url_node,
    create_context_node,
    store_context_node,
    track_status_node,
)
from .state import ContextPlannerState


def _route_by_input_type(state: ContextPlannerState) -> str:
    return "url" if state["input_type"] == "url" else "manual"


def build_graph() -> StateGraph:
    g = StateGraph(ContextPlannerState)

    g.add_node("validate_url", validate_url_node)
    g.add_node("validate_manual", validate_manual_node)
    g.add_node("normalize_url", normalize_url_node)
    g.add_node("create_context", create_context_node)
    g.add_node("store_context", store_context_node)
    g.add_node("track_status", track_status_node)

    g.set_conditional_entry_point(
        _route_by_input_type,
        {"url": "validate_url", "manual": "validate_manual"},
    )
    g.add_edge("validate_url", "normalize_url")
    g.add_edge("normalize_url", "create_context")
    g.add_edge("validate_manual", "create_context")
    g.add_edge("create_context", "store_context")
    g.add_edge("store_context", "track_status")
    g.add_edge("track_status", END)

    return g.compile()


ContextPlannerGraph = build_graph()

__all__ = ["ContextPlannerGraph"]
