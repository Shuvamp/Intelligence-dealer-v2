"""
NODE 3 — SCORE    OWNER: CSRIRAM
Position: Source → validate → normalize → [SCORE] → assign → DB
Reads   : state["normalized"]
Writes  : { "scoring": { "score", "score_value", "reasons", "detail" } }

Delegates to the holistic Python LangGraph scoring agent
(`agents/scoring/service.py`). One Groq LLM call scored against the md rubric
in `docs/scoring_agent_md/`, returning the full 8-dimension breakdown +
category (HOT+/HOT/WARM/COLD/DEAD). `score_normalized_lead` NEVER raises — on
any failure it returns a safe deterministic default, so the pipeline can't break.
See docs/SCORING-AGENT.md.
"""
import asyncio

from ..contracts import PipelineState, NodeDeps
from agents.scoring.service import score_normalized_lead


async def score_node(state: PipelineState, deps: NodeDeps) -> dict:
    normalized = state.get("normalized") or {}
    # lead_scorer.invoke is sync (blocking Groq call) — off-load to a thread so
    # it doesn't block the event loop.
    scoring = await asyncio.get_event_loop().run_in_executor(
        None, score_normalized_lead, normalized
    )
    return {"scoring": scoring}
