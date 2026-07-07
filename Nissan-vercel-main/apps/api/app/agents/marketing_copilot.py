"""Agent 8 — Marketing Copilot: NL answers over dealership snapshot."""
import logging
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END
from app.llm import llm_text, has_llm

logger = logging.getLogger(__name__)

COPILOT_SYSTEM = (
    "You are a marketing advisor for a Nissan dealership in India. "
    "Give concise, actionable advice based on dealership data. "
    "Answer in 2-3 sentences. Be specific and data-driven."
)


class CopilotState(TypedDict):
    question: str
    campaign_context: list[dict]
    snapshot_context: str   # pre-formatted snapshot string from web BFF
    result: Optional[str]


def _answer(state: CopilotState) -> CopilotState:
    if not has_llm():
        logger.warning("[copilot] no LLM key configured — using rule-based fallback")
        return {**state, "result": _rule_based(state)}

    # Use snapshot_context if provided, else format from campaign_context
    context = state.get("snapshot_context") or ""
    if not context:
        ctx_lines = [
            f"- {c.get('name', 'Campaign')}: {c.get('leads_generated', 0)} leads, "
            f"{c.get('conversion_rate', 0)}% conversion, ₹{c.get('cost_per_lead', 0)} CPL"
            for c in state["campaign_context"][:5]
        ]
        context = "\n".join(ctx_lines) or "No dealership data available yet."

    logger.info("[copilot] calling LLM for question=%r", state["question"][:60])
    answer = llm_text(
        f"Dealership data:\n{context}\n\nQuestion: {state['question']}",
        system=COPILOT_SYSTEM,
        temperature=0.3,
        max_tokens=512,
    )
    if not answer:
        logger.warning("[copilot] LLM empty/failed — using rule-based fallback")
        return {**state, "result": _rule_based(state)}

    logger.info("[copilot] LLM response OK")
    return {**state, "result": answer}


def _rule_based(state: CopilotState) -> str:
    ctx = state["campaign_context"]
    if not ctx:
        return "No campaign data yet. Launch a campaign to get recommendations."
    best = ctx[0]
    name = best.get("name", "your top campaign")
    leads = best.get("leads_generated", 0)
    q = state["question"].lower()
    if any(w in q for w in ["best", "perform", "top"]):
        return f'"{name}" performed best — {leads} leads at ₹{best.get("cost_per_lead", 0)} CPL.'
    if any(w in q for w in ["next", "should", "recommend"]):
        return f'Run a Magnite-focused festive campaign next — mirror "{name}" which delivered your best results.'
    return f'Your strongest campaign is "{name}" ({leads} leads). Double down on that vehicle and festive timing.'


_g = StateGraph(CopilotState)
_g.add_node("answer", _answer)
_g.set_entry_point("answer")
_g.add_edge("answer", END)
copilot_agent = _g.compile()
