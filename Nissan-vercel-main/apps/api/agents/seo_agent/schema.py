"""Pydantic models for the ONE normalized JSON this agent produces — the
final, validated SEO analysis report. Mirrors website_extraction/schema.py's
precedent: this phase's literal deliverable is a validated multi-section JSON
contract, so it gets its own schema file (unlike company_summary's flat
8-field output, which used a plain TypedDict).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Level = Literal["high", "medium", "low"]
DimensionStatus = Literal["PASS", "WARNING", "FAIL"]
Grade = Literal["A", "B", "C", "D", "F"]

# The exact 24 dimension names from docs/planner/04_SEO_AGENT.md, in spec order.
DIMENSION_NAMES: list[str] = [
    "Website Information",
    "Company Information",
    "Contact Information",
    "Products",
    "Services",
    "Page Analysis",
    "Technical SEO",
    "Content Analysis",
    "Keyword Analysis",
    "Internal Links",
    "External Links",
    "Images",
    "Videos",
    "Blog",
    "FAQ",
    "Schema",
    "Performance",
    "Core Web Vitals",
    "Accessibility",
    "Security",
    "Trust",
    "Local SEO",
    "Brand Authority",
    "Conversion Optimization",
]


class SeoRecommendation(BaseModel):
    problem: str
    reason: str
    recommendation: str
    estimated_impact: Level
    priority: Level
    difficulty: Level


class SeoDimensionResult(BaseModel):
    dimension: str
    status: DimensionStatus
    recommendations: list[SeoRecommendation] = Field(default_factory=list)


class SeoSummary(BaseModel):
    pass_count: int
    warning_count: int
    fail_count: int
    overall_score: int  # 0-100
    grade: Grade


class SEOAnalysisResult(BaseModel):
    """The ONE normalized JSON — the agent's entire literal deliverable."""
    dimensions: list[SeoDimensionResult]  # exactly 24, fixed spec order
    summary: SeoSummary
