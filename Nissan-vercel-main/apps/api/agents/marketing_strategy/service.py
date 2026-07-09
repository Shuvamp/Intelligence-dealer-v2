"""Integration surface for the Marketing Strategy Advisor.

Synchronous, stateless: fetch the context's latest analysis (company summary +
generated report), ask Groq for growth strategies, fall back to a deterministic
context-aware list. Never raises for the normal "no analysis yet" case — the
caller surfaces that as a friendly message.
"""
from __future__ import annotations

from . import llm
from .data import MarketingStrategyData

_data = MarketingStrategyData()


class ContextNotFound(ValueError):
    """Raised when the context doesn't exist or isn't the tenant's."""


async def suggest_strategies(tenant_id: str, context_id: str) -> dict:
    context = await _data.get_context(context_id, tenant_id)
    if not context:
        raise ContextNotFound(f"context {context_id} not found")

    summary = await _data.get_latest_summary(context_id, tenant_id)
    report = await _data.get_latest_report(context_id, tenant_id)

    # The advisor works off the recent analysis. If none exists yet, tell the
    # caller so the UI can nudge the user to run the analysis first.
    if not summary and not report:
        return {
            "context_id": context_id,
            "status": "no_analysis",
            "engine": None,
            "strategies": [],
            "errors": ["No analysis found for this context yet. Run the Context Planner analysis first."],
        }

    payload = llm.build_input(context, summary, report)

    engine = "deterministic"
    strategies = None
    if llm.has_groq():
        try:
            strategies = llm.generate_strategies(payload)
        except Exception:  # noqa: BLE001
            strategies = None
        if strategies:
            engine = "groq"

    if not strategies:
        strategies = llm.deterministic_strategies(payload)
        engine = "deterministic"

    return {
        "context_id": context_id,
        "status": "ready",
        "engine": engine,
        "strategies": strategies,
        "errors": [],
    }
