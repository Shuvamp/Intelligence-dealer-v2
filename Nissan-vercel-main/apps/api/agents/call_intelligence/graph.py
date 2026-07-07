from langgraph.graph import StateGraph, END
from .state import CallIntelligenceState
from .nodes import transcribe_node, extract_node, persist_node, handoff_node


def build_graph() -> StateGraph:
    g = StateGraph(CallIntelligenceState)

    g.add_node("transcribe", transcribe_node)
    g.add_node("extract", extract_node)
    g.add_node("persist", persist_node)
    g.add_node("handoff", handoff_node)

    g.set_entry_point("transcribe")
    g.add_edge("transcribe", "extract")
    g.add_edge("extract", "persist")
    g.add_edge("persist", "handoff")
    g.add_edge("handoff", END)

    return g.compile()


call_intelligence_agent = build_graph()
