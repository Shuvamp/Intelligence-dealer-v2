"""Pydantic models for the ONE normalized JSON this agent produces — the
final, validated 11-section narrative report. Mirrors the precedent set by
website_extraction/seo_agent/aeo_agent/recommendation_engine: this phase's
literal deliverable is a validated multi-section JSON contract, so it gets
its own schema file.

`RecommendationItem` (the unified 10-field shape + source) is DUPLICATED here
from recommendation_engine/schema.py rather than imported — preserving this
codebase's per-phase decoupling convention (each phase's data/schema is
self-contained). Priority Fixes and Recommendations pass Phase 6's already-
validated items through, re-validated by this phase's validator_node.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Grade = Literal["A", "B", "C", "D", "F"]
Severity = Literal["Critical", "High", "Medium", "Low"]
Priority = Literal["high", "medium", "low"]
ImpactLevel = Literal["high", "medium", "low", "not_applicable"]
DifficultyLevel = Literal["high", "medium", "low", "unknown"]
Source = Literal["seo", "aeo"]
Engine = Literal["groq", "deterministic"]


class RecommendationItem(BaseModel):
    """Duplicated from recommendation_engine/schema.py (decoupling)."""
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


class OverallScoreSection(BaseModel):
    combined_score: int
    combined_grade: Grade
    seo_score: int
    aeo_score: int


class StrengthItem(BaseModel):
    source: Source
    title: str
    detail: str


class WeaknessItem(BaseModel):
    source: Source
    title: str
    detail: str


class TechnicalDetails(BaseModel):
    has_sitemap: bool = False
    has_robots_txt: bool = False
    has_ssl: bool = False
    has_privacy_policy: bool = False
    has_terms: bool = False
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    schema_markup_types: list[str] = Field(default_factory=list)
    cms: Optional[str] = None
    ecommerce_platform: Optional[str] = None
    frameworks: list[str] = Field(default_factory=list)
    analytics: list[str] = Field(default_factory=list)
    pages_crawled_count: int = 0


class ReportSummary(BaseModel):
    total_recommendations: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    priority_fix_count: int
    strength_count: int
    weakness_count: int


class ReportMeta(BaseModel):
    company_name: Optional[str] = None
    website: Optional[str] = None
    generated_at: str
    engine: Engine  # "groq" | "deterministic" — which path produced the narratives


class ReportResult(BaseModel):
    """The ONE normalized JSON — the agent's entire literal deliverable.
    11 spec sections (5 narrative prose + 6 structured) + summary + meta."""
    # narrative (prose)
    executive_summary: str
    company_overview: str
    website_summary: str
    seo_summary: str
    aeo_summary: str
    # structured
    overall_score: OverallScoreSection
    strengths: list[StrengthItem]
    weaknesses: list[WeaknessItem]
    priority_fixes: list[RecommendationItem]
    technical_details: TechnicalDetails
    recommendations: list[RecommendationItem]
    # bookkeeping
    summary: ReportSummary
    meta: ReportMeta
