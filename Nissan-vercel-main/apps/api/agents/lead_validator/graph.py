from langgraph.graph import StateGraph, END
from .state import LeadValidatorState
from .nodes import validate_phone, validate_email, validate_fields, dedup_and_persist


def _stop_if_invalid(state: LeadValidatorState) -> str:
    return "stop" if state["status"] == "invalid" else "continue"


def build_graph() -> StateGraph:
    graph = StateGraph(LeadValidatorState)

    graph.add_node("validate_phone", validate_phone)
    graph.add_node("validate_email", validate_email)
    graph.add_node("validate_fields", validate_fields)
    graph.add_node("dedup_and_persist", dedup_and_persist)

    graph.set_entry_point("validate_phone")

    graph.add_conditional_edges(
        "validate_phone",
        _stop_if_invalid,
        {"stop": END, "continue": "validate_email"},
    )

    # validate_email can now also reject (malformed email, when one is
    # provided) — same short-circuit as validate_phone, so a rejected lead
    # never reaches dedup_and_persist.
    graph.add_conditional_edges(
        "validate_email",
        _stop_if_invalid,
        {"stop": END, "continue": "validate_fields"},
    )
    graph.add_edge("validate_fields", "dedup_and_persist")
    graph.add_edge("dedup_and_persist", END)

    return graph.compile()


lead_validator = build_graph()
