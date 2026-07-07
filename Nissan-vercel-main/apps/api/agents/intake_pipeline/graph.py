"""
INTAKE PIPELINE ORCHESTRATOR    OWNER: PARTHA — do not edit
Source → validate → normalize → score → assign → (return) → DB
Each node is in nodes/<name>.py. Teammates edit ONLY their node file.
"""
from langgraph.graph import StateGraph, END, START
from .contracts import PipelineState, empty_state, NodeDeps
from .nodes.validate import validate_node
from .nodes.normalize import normalize_node
from .nodes.score import score_node
from .nodes.assign import assign_node


def _stop_if_invalid(state: PipelineState) -> str:
    return "stop" if state["errors"] else "continue"


def build_pipeline() -> StateGraph:
    graph = StateGraph(PipelineState)

    graph.add_node("validate",  validate_node)
    graph.add_node("normalize", normalize_node)
    graph.add_node("score",     score_node)
    graph.add_node("assign",    assign_node)

    graph.set_entry_point("validate")
    graph.add_conditional_edges(
        "validate",
        _stop_if_invalid,
        {"stop": END, "continue": "normalize"},
    )
    graph.add_edge("normalize", "score")
    graph.add_edge("score", "assign")
    graph.add_edge("assign", END)

    return graph.compile()


intake_pipeline = build_pipeline()

__all__ = ["intake_pipeline", "empty_state", "NodeDeps"]
