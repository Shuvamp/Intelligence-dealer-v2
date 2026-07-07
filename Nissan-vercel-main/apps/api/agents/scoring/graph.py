from langgraph.graph import StateGraph, END
from .state import LeadState
from .nodes import (
    ingest_and_validate,
    score_dimensions,
    aggregate_and_classify,
    generate_reasoning_and_action,
    format_output,
)


def _route_after_aggregate(state: LeadState) -> str:
    """
    Skip the standalone reasoning LLM call when:
      - the lead is DEAD (not worth a narrative), or
      - the holistic scorer already produced reasoning + action in its single call.
    """
    if state.get("category") == "DEAD":
        return "format_output"
    if state.get("reasoning") and state.get("recommended_action"):
        return "format_output"
    return "generate_reasoning"


def build_scoring_graph():
    g = StateGraph(LeadState)

    g.add_node("ingest_and_validate", ingest_and_validate)
    g.add_node("score_dimensions", score_dimensions)
    g.add_node("aggregate_classify", aggregate_and_classify)
    g.add_node("generate_reasoning", generate_reasoning_and_action)
    g.add_node("format_output", format_output)

    g.set_entry_point("ingest_and_validate")
    g.add_edge("ingest_and_validate", "score_dimensions")
    g.add_edge("score_dimensions", "aggregate_classify")
    g.add_conditional_edges(
        "aggregate_classify",
        _route_after_aggregate,
        {"generate_reasoning": "generate_reasoning", "format_output": "format_output"},
    )
    g.add_edge("generate_reasoning", "format_output")
    g.add_edge("format_output", END)

    return g.compile()


lead_scorer = build_scoring_graph()
