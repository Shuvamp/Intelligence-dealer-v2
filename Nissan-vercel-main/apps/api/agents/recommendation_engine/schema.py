"""Pydantic models for the ONE normalized JSON this agent produces — the
final, validated consolidated recommendation report. Mirrors seo_agent's
and aeo_agent's precedent: this phase's literal deliverable is a validated
multi-section JSON contract, so it gets its own schema file.

Unlike seo_agent's 6-field SeoRecommendation and aeo_agent's 3-field
AeoRecommendation, this phase's spec (verbatim, docs/planner/
06_RECOMMENDATION_ENGINE.md) asks for a unified 10-field recommendation
shape applied uniformly to items sourced from BOTH reports — see
agents/recommendation_engine/_common.py for the field-mapping/derivation
logic that produces these from the two upstream shapes.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Severity = Literal["Critical", "High", "Medium", "Low"]
Priority = Literal["high", "medium", "low"]
# A 4th "not_applicable" value beyond the usual high/medium/low — the
# direct analogue of seo_agent/aeo_agent's always_warning() "never
# fabricate a verdict where there's no signal" rule, applied to the
# cross-report impact fields (an SEO item has no AEO-specific signal, and
# vice versa).
ImpactLevel = Literal["high", "medium", "low", "not_applicable"]
# A 4th "unknown" value — AEO recommendations carry no difficulty signal at
# all, so this is left honestly unscoped rather than guessed.
DifficultyLevel = Literal["high", "medium", "low", "unknown"]
Source = Literal["seo", "aeo"]


class RecommendationItem(BaseModel):
    severity: Severity
    priority: Priority
    problem: str
    reason: str
    fix: str
    estimated_time: str
    expected_seo_impact: ImpactLevel
    expected_aeo_impact: ImpactLevel
    difficulty: DifficultyLevel
    category: str
    source: Source


class SeverityGroups(BaseModel):
    critical: list[RecommendationItem] = Field(default_factory=list)
    high: list[RecommendationItem] = Field(default_factory=list)
    medium: list[RecommendationItem] = Field(default_factory=list)
    low: list[RecommendationItem] = Field(default_factory=list)


class RecommendationSummary(BaseModel):
    total_count: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    seo_score: int
    aeo_score: int
    combined_score: int  # 0-100, average of seo_score and aeo_score
    combined_grade: Literal["A", "B", "C", "D", "F"]


class RecommendationReportResult(BaseModel):
    """The ONE normalized JSON — the agent's entire literal deliverable."""
    company_name: Optional[str] = None
    recommendations: list[RecommendationItem]  # flat, sorted — for filtering/sorting/export
    groups: SeverityGroups  # same items, partitioned by severity — for grouped display
    summary: RecommendationSummary
