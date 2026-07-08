"""Shared helpers for the 24 SEO analyzer functions.

Each analyzer is a PURE function `(extraction: dict) -> dict` — no LangGraph
state, no I/O — shaped like schema.SeoDimensionResult. `build_node()` wraps
one into an actual LangGraph node: it reads `extraction_data` from state,
calls the analyzer, and — critically — catches any exception and degrades to
a FAIL "analyzer crashed" result rather than propagating. This is new
defensive plumbing this phase needs: unlike Phase 2's crawl pipeline (real
sequential data dependencies between nodes), these 24 checks are mutually
independent, so one bug must not abort the other 23 in a 27-node linear chain.
"""
from __future__ import annotations

from typing import Callable

Level = str  # "high" | "medium" | "low" — kept as plain str here (validated later by schema.py)


def rec(
    problem: str,
    reason: str,
    recommendation: str,
    estimated_impact: Level = "medium",
    priority: Level = "medium",
    difficulty: Level = "medium",
) -> dict:
    return {
        "problem": problem,
        "reason": reason,
        "recommendation": recommendation,
        "estimated_impact": estimated_impact,
        "priority": priority,
        "difficulty": difficulty,
    }


def result(dimension: str, status: str, recommendations: list[dict] | None = None) -> dict:
    return {"dimension": dimension, "status": status, "recommendations": recommendations or []}


def always_warning(dimension: str, problem: str, reason: str, recommendation: str) -> dict:
    """For the 7 dimensions with zero exploitable signal in the Phase 2 JSON —
    an honest WARNING with an explanation, never a fabricated verdict."""
    return result(dimension, "WARNING", [rec(problem, reason, recommendation, "medium", "low", "high")])


_STATUS_RANK = {"FAIL": 2, "WARNING": 1, "PASS": 0}


def worst(statuses: list[str]) -> str:
    """Worst-of-N status combination (FAIL > WARNING > PASS)."""
    if not statuses:
        return "PASS"
    return max(statuses, key=lambda s: _STATUS_RANK.get(s, 0))


def dimension_result_key(dimension: str) -> str:
    """"Technical SEO" -> "technical_seo_result" — the state field name for a
    dimension. Derived programmatically (not a hand-maintained dict) so
    state.py's field names, graph.py's node wiring, and build.py's
    aggregation all stay in sync automatically."""
    return dimension.lower().replace(" ", "_") + "_result"


def build_node(dimension: str, result_key: str, analyzer: Callable[[dict], dict]) -> Callable[[dict], dict]:
    def node(state: dict) -> dict:
        extraction = state.get("extraction_data") or {}
        try:
            data = analyzer(extraction)
        except Exception as exc:  # noqa: BLE001
            data = result(dimension, "FAIL", [rec(
                f"{dimension} analyzer crashed",
                str(exc),
                "Investigate and fix the analyzer; this dimension could not be evaluated.",
                "medium", "high", "medium",
            )])
        return {result_key: data}

    node.__name__ = result_key
    return node
