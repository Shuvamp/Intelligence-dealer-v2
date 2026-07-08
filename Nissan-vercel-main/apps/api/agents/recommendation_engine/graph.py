"""Recommendation Engine Graph (Phase 6).

Linear chain, 7 nodes: load_reports -> normalize_seo -> normalize_aeo ->
merge_and_sort -> group_by_severity -> build_summary -> validator -> END.

Unlike seo_agent/aeo_agent's per-check analyzer fan-out, these nodes have a
real sequential data dependency on each other (each consumes the previous
node's output), so there's no need for build_node()'s per-node crash
isolation here — a genuine pipeline, not N independent checks.
"""
from __future__ import annotations

from langgraph.graph import END, StateGraph

from .nodes import (
    build_summary_node,
    group_by_severity_node,
    load_reports_node,
    merge_and_sort_node,
    normalize_aeo_node,
    normalize_seo_node,
    validator_node,
)
from .state import RecommendationEngineState


def build_graph() -> StateGraph:
    g = StateGraph(RecommendationEngineState)

    g.add_node("load_reports", load_reports_node)
    g.add_node("normalize_seo", normalize_seo_node)
    g.add_node("normalize_aeo", normalize_aeo_node)
    g.add_node("merge_and_sort", merge_and_sort_node)
    g.add_node("group_by_severity", group_by_severity_node)
    g.add_node("build_summary", build_summary_node)
    g.add_node("validator", validator_node)

    g.set_entry_point("load_reports")
    chain = [
        "load_reports", "normalize_seo", "normalize_aeo", "merge_and_sort",
        "group_by_severity", "build_summary", "validator",
    ]
    for a, b in zip(chain, chain[1:]):
        g.add_edge(a, b)
    g.add_edge("validator", END)

    return g.compile()


RecommendationEngineGraph = build_graph()

__all__ = ["RecommendationEngineGraph"]
