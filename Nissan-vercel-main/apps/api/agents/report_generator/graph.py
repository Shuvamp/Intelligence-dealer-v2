"""Report Generator Graph (Phase 7).

Linear chain, 6 nodes: load_inputs -> generate_narratives ->
assemble_structured -> build_report -> render_markdown -> validator -> END.

Like recommendation_engine (Phase 6), these nodes have a real sequential
data dependency on each other (each consumes the previous node's output), so
there's no per-node crash isolation — a genuine pipeline, not N independent
checks.
"""
from __future__ import annotations

from langgraph.graph import END, StateGraph

from .nodes import (
    assemble_structured_node,
    build_report_node,
    generate_narratives_node,
    load_inputs_node,
    render_markdown_node,
    validator_node,
)
from .state import ReportGeneratorState


def build_graph() -> StateGraph:
    g = StateGraph(ReportGeneratorState)

    g.add_node("load_inputs", load_inputs_node)
    g.add_node("generate_narratives", generate_narratives_node)
    g.add_node("assemble_structured", assemble_structured_node)
    g.add_node("build_report", build_report_node)
    g.add_node("render_markdown", render_markdown_node)
    g.add_node("validator", validator_node)

    g.set_entry_point("load_inputs")
    chain = [
        "load_inputs", "generate_narratives", "assemble_structured",
        "build_report", "render_markdown", "validator",
    ]
    for a, b in zip(chain, chain[1:]):
        g.add_edge(a, b)
    g.add_edge("validator", END)

    return g.compile()


ReportGraph = build_graph()

__all__ = ["ReportGraph"]
