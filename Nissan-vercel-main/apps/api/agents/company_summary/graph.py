"""Company Summary Graph (Phase 3).

Linear chain — matches the majority of agents in this codebase:
START -> load_extraction -> generate_summary -> store_summary -> END
"""
from __future__ import annotations

from langgraph.graph import StateGraph, END

from .nodes import generate_summary_node, load_extraction_node, store_summary_node
from .state import CompanySummaryState


def build_graph() -> StateGraph:
    g = StateGraph(CompanySummaryState)

    g.add_node("load_extraction", load_extraction_node)
    g.add_node("generate_summary", generate_summary_node)
    g.add_node("store_summary", store_summary_node)

    g.set_entry_point("load_extraction")
    g.add_edge("load_extraction", "generate_summary")
    g.add_edge("generate_summary", "store_summary")
    g.add_edge("store_summary", END)

    return g.compile()


CompanySummaryGraph = build_graph()

__all__ = ["CompanySummaryGraph"]
