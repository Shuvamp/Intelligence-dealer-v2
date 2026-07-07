from langgraph.graph import StateGraph, END
from .state import WhatsAppState
from .nodes import load_context_node, send_message_node, log_delivery_node


def build_graph() -> StateGraph:
    g = StateGraph(WhatsAppState)

    g.add_node("load_context", load_context_node)
    g.add_node("send_message", send_message_node)
    g.add_node("log_delivery", log_delivery_node)

    g.set_entry_point("load_context")
    g.add_edge("load_context", "send_message")
    g.add_edge("send_message", "log_delivery")
    g.add_edge("log_delivery", END)

    return g.compile()


whatsapp_agent = build_graph()
