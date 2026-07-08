from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

ReportGeneratorStatus = Literal["queued", "generating", "ready", "failed"]


class ReportGeneratorState(TypedDict):
    # input
    report_id: str
    tenant_id: str
    context_id: str
    extraction_id: str
    recommendation_report_id: str
    seo_analysis_id: str
    aeo_analysis_id: str
    company_summary_id: Optional[str]
    website_json: Optional[dict[str, Any]]  # website_extractions.extraction_data
    recommendation_report_data: Optional[dict[str, Any]]  # Phase 6 report_data
    seo_analysis_data: Optional[dict[str, Any]]  # Phase 4 analysis_data
    aeo_analysis_data: Optional[dict[str, Any]]  # Phase 5 analysis_data
    company_summary: Optional[dict[str, Any]]  # Phase 3 row (optional)
    combined_score: Optional[int]
    seo_score: Optional[int]
    aeo_score: Optional[int]

    # per-stage intermediates
    narratives: Optional[dict[str, str]]  # 5 prose sections keyed by section name
    structured: Optional[dict[str, Any]]  # 6 structured sections
    engine: Optional[str]  # "groq" | "deterministic" — which narrative path ran

    # build node output
    report_data: Optional[dict[str, Any]]  # final ReportResult, as a dict
    markdown_content: Optional[str]
    overall_score: Optional[int]
    status: ReportGeneratorStatus
    errors: list[str]
