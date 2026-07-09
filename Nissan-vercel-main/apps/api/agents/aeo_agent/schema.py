"""Pydantic models for the ONE normalized JSON this agent produces — the
final, validated AEO analysis report. Mirrors website_extraction/schema.py's
and seo_agent/schema.py's precedent: this phase's literal deliverable is a
validated multi-section JSON contract, so it gets its own schema file.

Unlike seo_agent's 6-field SeoRecommendation, this phase's spec (verbatim,
docs/planner/05_AEO_AGENT.md) asks for a 3-field recommendation shape ("Why
AI search engines may fail" / "How to improve" / "Expected impact") and
explicitly asks the frontend to display "strengths" and "weaknesses" rather
than a PASS/WARNING/FAIL-per-agent grid — so strengths/weaknesses are
computed and persisted server-side as part of this one JSON, not derived
ad hoc in the frontend.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Level = Literal["high", "medium", "low"]
AeoAgentStatus = Literal["PASS", "WARNING", "FAIL"]

# The exact 11 agent names from docs/planner/05_AEO_AGENT.md, in spec order.
AGENT_NAMES: list[str] = [
    "Entity Detection",
    "Question Detection",
    "Answer Quality",
    "FAQ Analysis",
    "Citation Analysis",
    "Schema Analysis",
    "AI Readability",
    "Content Chunking",
    "Trust Analysis",
    "LLM Readability",
    "Brand Context",
]


class AeoRecommendation(BaseModel):
    why_ai_may_fail: str
    how_to_improve: str
    expected_impact: Level


class AeoAgentResult(BaseModel):
    agent: str
    status: AeoAgentStatus
    recommendations: list[AeoRecommendation] = Field(default_factory=list)


class AeoStrength(BaseModel):
    agent: str
    note: str


class AeoWeakness(BaseModel):
    agent: str
    recommendations: list[AeoRecommendation]


class AeoSummary(BaseModel):
    pass_count: int
    warning_count: int
    fail_count: int
    aeo_score: int  # 0-100, same PASS=2/WARNING=1/FAIL=0 formula as seo_agent


class AEOAnalysisResult(BaseModel):
    """The ONE normalized JSON — the agent's entire literal deliverable."""
    agents: list[AeoAgentResult]  # exactly 11, fixed spec order
    strengths: list[AeoStrength]
    weaknesses: list[AeoWeakness]
    summary: AeoSummary
