"""Agent 5 — Brand Compliance: rule checks."""
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END

_COMPETITORS = ["maruti", "suzuki", "hyundai", "tata", "honda", "toyota", "ford", "mahindra"]
_CHANNEL_MAX_LEN = {"instagram": 2200, "facebook": 63206, "google_business": 1500, "whatsapp": 1000}


class ComplianceState(TypedDict):
    caption: str
    hashtags: list[str]
    offer: Optional[str]
    channel: str
    result: Optional[dict]


def _check(state: ComplianceState) -> ComplianceState:
    caption = state["caption"]
    hashtags = state["hashtags"]
    flags: list[str] = []

    # Rule 1: Nissan branding required
    if not any("nissan" in s.lower() for s in [caption] + hashtags):
        flags.append("Missing Nissan branding")

    # Rule 2: Caption length
    max_len = _CHANNEL_MAX_LEN.get(state["channel"], 280)
    if len(caption) > max_len:
        flags.append(f"Caption too long for {state['channel']} (max {max_len} chars)")

    # Rule 3: No competitor mentions
    if any(c in caption.lower() for c in _COMPETITORS):
        flags.append("Contains competitor brand mention")

    return {**state, "result": {"compliance": "flagged" if flags else "approved", "flags": flags}}


_g = StateGraph(ComplianceState)
_g.add_node("check", _check)
_g.set_entry_point("check")
_g.add_edge("check", END)
compliance_agent = _g.compile()
