from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

RecommendationReportStatus = Literal["queued", "generating", "ready", "failed"]


class RecommendationEngineState(TypedDict):
    # input
    report_id: str
    tenant_id: str
    context_id: str
    extraction_id: str
    seo_analysis_id: str
    aeo_analysis_id: str
    website_json: Optional[dict[str, Any]]
    seo_analysis_data: Optional[dict[str, Any]]  # the seo_analyses.analysis_data JSON
    aeo_analysis_data: Optional[dict[str, Any]]  # the aeo_analyses.analysis_data JSON
    seo_overall_score: Optional[int]
    aeo_overall_score: Optional[int]

    # per-stage intermediates
    seo_items: Optional[list[dict]]  # flattened RecommendationItem dicts, from SEO
    aeo_items: Optional[list[dict]]  # flattened RecommendationItem dicts, from AEO
    merged_items: Optional[list[dict]]  # seo_items + aeo_items, sorted
    severity_groups: Optional[dict[str, list[dict]]]  # merged_items partitioned by severity

    # build node output
    report_data: Optional[dict[str, Any]]  # final RecommendationReportResult, as a dict
    combined_score: Optional[int]
    status: RecommendationReportStatus
    errors: list[str]
