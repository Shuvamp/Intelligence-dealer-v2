"""AEO Analysis Graph (Phase 5).

Linear chain, 14 nodes: load_extraction -> 11 analyzer nodes (one per spec
agent, in spec order) -> aggregate_and_build -> validator -> END.

Each analyzer node is self-contained (build_node() wraps the pure analyzer
function with a try/except that degrades to a FAIL result on any crash) —
these 11 checks have no sequential data dependency on each other, so a bug
in one must not abort the rest. Mirrors seo_agent/graph.py exactly.
"""
from __future__ import annotations

from langgraph.graph import END, StateGraph

from ._common import agent_result_key, build_node
from .nodes import (
    _ANALYZERS,
    aggregate_and_build_node,
    llm_semantic_analysis_node,
    load_extraction_node,
    validator_node,
)
from .schema import AGENT_NAMES
from .state import AEOAnalysisState


def _node_name(agent: str) -> str:
    return agent_result_key(agent)[: -len("_result")]


def build_graph() -> StateGraph:
    g = StateGraph(AEOAnalysisState)

    g.add_node("load_extraction", load_extraction_node)
    g.add_node("llm_semantic_analysis", llm_semantic_analysis_node)

    analyzer_node_names: list[str] = []
    for agent in AGENT_NAMES:
        name = _node_name(agent)
        analyzer_node_names.append(name)
        g.add_node(name, build_node(agent, agent_result_key(agent), _ANALYZERS[agent]))

    g.add_node("aggregate_and_build", aggregate_and_build_node)
    g.add_node("validator", validator_node)

    g.set_entry_point("load_extraction")
    chain = ["load_extraction", "llm_semantic_analysis", *analyzer_node_names, "aggregate_and_build", "validator"]
    for a, b in zip(chain, chain[1:]):
        g.add_edge(a, b)
    g.add_edge("validator", END)

    return g.compile()


AEOAnalysisGraph = build_graph()

__all__ = ["AEOAnalysisGraph"]
