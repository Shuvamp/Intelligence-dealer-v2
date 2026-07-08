from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

SeoAnalysisStatus = Literal["queued", "analyzing", "ready", "failed"]


class SEOAnalysisState(TypedDict):
    # input
    analysis_id: str
    tenant_id: str
    context_id: str
    extraction_id: str
    extraction_data: Optional[dict[str, Any]]  # loaded once by load_extraction_node

    # one result slot per dimension (24 total), each holding a dict shaped
    # like schema.SeoDimensionResult once its analyzer node runs
    website_information_result: Optional[dict]
    company_information_result: Optional[dict]
    contact_information_result: Optional[dict]
    products_result: Optional[dict]
    services_result: Optional[dict]
    page_analysis_result: Optional[dict]
    technical_seo_result: Optional[dict]
    content_analysis_result: Optional[dict]
    keyword_analysis_result: Optional[dict]
    internal_links_result: Optional[dict]
    external_links_result: Optional[dict]
    images_result: Optional[dict]
    videos_result: Optional[dict]
    blog_result: Optional[dict]
    faq_result: Optional[dict]
    schema_result: Optional[dict]
    performance_result: Optional[dict]
    core_web_vitals_result: Optional[dict]
    accessibility_result: Optional[dict]
    security_result: Optional[dict]
    trust_result: Optional[dict]
    local_seo_result: Optional[dict]
    brand_authority_result: Optional[dict]
    conversion_optimization_result: Optional[dict]

    # build.py output
    analysis_data: Optional[dict[str, Any]]  # final SEOAnalysisResult, as a dict
    overall_score: Optional[int]
    status: SeoAnalysisStatus
    errors: list[str]
