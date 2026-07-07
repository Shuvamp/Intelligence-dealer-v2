"""Agent 6 — Publishing: mock publish LangGraph agent."""
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END


class PublishState(TypedDict):
    post_id: str
    campaign_id: str
    channel: str
    scheduled_at: str
    content: dict
    result: Optional[dict]


def validate_publish(state: PublishState) -> PublishState:
    if not state.get("post_id") or not state.get("channel"):
        return {**state, "result": {"published": False, "error": "post_id and channel are required"}}
    return state


def mock_publish(state: PublishState) -> PublishState:
    if state.get("result") and not state["result"].get("published", True):
        return state  # already failed in validate
    post_id = state["post_id"]
    channel = state["channel"]
    platform_post_id = f"mock_{post_id[:8]}_{channel}"
    return {
        **state,
        "result": {
            "published": True,
            "platform_post_id": platform_post_id,
            "channel": channel,
            "published_at": state.get("scheduled_at", ""),
            "mock": True,
        },
    }


_g = StateGraph(PublishState)
_g.add_node("validate_publish", validate_publish)
_g.add_node("mock_publish", mock_publish)
_g.set_entry_point("validate_publish")
_g.add_edge("validate_publish", "mock_publish")
_g.add_edge("mock_publish", END)
publishing_agent = _g.compile()
