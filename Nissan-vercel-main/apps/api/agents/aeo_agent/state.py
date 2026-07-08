from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

AeoAnalysisStatus = Literal["queued", "analyzing", "ready", "failed"]


class AEOAnalysisState(TypedDict):
    # input
    analysis_id: str
    tenant_id: str
    context_id: str
    extraction_id: str
    extraction_data: Optional[dict[str, Any]]  # loaded once by load_extraction_node

    # one result slot per agent (11 total), each holding a dict shaped like
    # schema.AeoAgentResult once its analyzer node runs
    entity_detection_result: Optional[dict]
    question_detection_result: Optional[dict]
    answer_quality_result: Optional[dict]
    faq_analysis_result: Optional[dict]
    citation_analysis_result: Optional[dict]
    schema_analysis_result: Optional[dict]
    ai_readability_result: Optional[dict]
    content_chunking_result: Optional[dict]
    trust_analysis_result: Optional[dict]
    llm_readability_result: Optional[dict]
    brand_context_result: Optional[dict]

    # build node output
    analysis_data: Optional[dict[str, Any]]  # final AEOAnalysisResult, as a dict
    overall_score: Optional[int]
    status: AeoAnalysisStatus
    errors: list[str]
