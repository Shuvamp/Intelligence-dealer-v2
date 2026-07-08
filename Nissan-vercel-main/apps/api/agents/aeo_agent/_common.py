"""Shared helpers for the 11 AEO analyzer functions.

Each analyzer is a PURE function `(extraction: dict) -> dict` — no LangGraph
state, no I/O — shaped like schema.AeoAgentResult. `build_node()` wraps one
into an actual LangGraph node: it reads `extraction_data` from state, calls
the analyzer, and — critically — catches any exception and degrades to a
FAIL "agent crashed" result rather than propagating. Mirrors
seo_agent/nodes/_common.py's exact pattern, with "agent" in place of
"dimension" throughout to match this phase's own spec vocabulary
("independent agents").
"""
from __future__ import annotations

from typing import Callable

Level = str  # "high" | "medium" | "low" — kept as plain str here (validated later by schema.py)


def rec(
    why_ai_may_fail: str,
    how_to_improve: str,
    expected_impact: Level = "medium",
) -> dict:
    return {
        "why_ai_may_fail": why_ai_may_fail,
        "how_to_improve": how_to_improve,
        "expected_impact": expected_impact,
    }


def result(agent: str, status: str, recommendations: list[dict] | None = None) -> dict:
    return {"agent": agent, "status": status, "recommendations": recommendations or []}


def always_warning(agent: str, why_ai_may_fail: str, how_to_improve: str) -> dict:
    """For agents with zero exploitable signal in the Phase 2 JSON — an
    honest WARNING with an explanation, never a fabricated verdict."""
    return result(agent, "WARNING", [rec(why_ai_may_fail, how_to_improve, "medium")])


_STATUS_RANK = {"FAIL": 2, "WARNING": 1, "PASS": 0}


def worst(statuses: list[str]) -> str:
    """Worst-of-N status combination (FAIL > WARNING > PASS)."""
    if not statuses:
        return "PASS"
    return max(statuses, key=lambda s: _STATUS_RANK.get(s, 0))


def agent_result_key(agent: str) -> str:
    """"Entity Detection" -> "entity_detection_result" — the state field
    name for an agent. Derived programmatically (not a hand-maintained
    dict) so state.py's field names, graph.py's node wiring, and the build
    node's aggregation all stay in sync automatically."""
    return agent.lower().replace(" ", "_") + "_result"


def build_node(agent: str, result_key: str, analyzer: Callable[[dict], dict]) -> Callable[[dict], dict]:
    def node(state: dict) -> dict:
        extraction = state.get("extraction_data") or {}
        try:
            data = analyzer(extraction)
        except Exception as exc:  # noqa: BLE001
            data = result(agent, "FAIL", [rec(
                f"{agent} agent crashed: {exc}",
                "Investigate and fix the agent; this check could not be evaluated.",
                "medium",
            )])
        return {result_key: data}

    node.__name__ = result_key
    return node
