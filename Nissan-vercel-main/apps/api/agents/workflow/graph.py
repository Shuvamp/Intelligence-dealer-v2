from langgraph.graph import StateGraph, END
from .state import WorkflowState
from .nodes import fetch_context_node, decide_action_node, persist_action_node, notify_manager_node


def _needs_escalation(state: WorkflowState) -> str:
    return "notify" if state.get("escalated") else "skip"


def build_graph() -> StateGraph:
    g = StateGraph(WorkflowState)

    g.add_node("fetch_context", fetch_context_node)
    g.add_node("decide_action", decide_action_node)
    g.add_node("persist_action", persist_action_node)
    g.add_node("notify_manager", notify_manager_node)

    g.set_entry_point("fetch_context")
    g.add_edge("fetch_context", "decide_action")
    g.add_edge("decide_action", "persist_action")
    g.add_conditional_edges(
        "persist_action",
        _needs_escalation,
        {"notify": "notify_manager", "skip": END},
    )
    g.add_edge("notify_manager", END)

    return g.compile()


workflow_agent = build_graph()
