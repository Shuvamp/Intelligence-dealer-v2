"""SEO Analysis Graph (Phase 4).

Linear chain, 27 nodes: load_extraction -> 24 analyzer nodes (one per spec
dimension, in spec order) -> aggregate_and_build -> validator -> END.

Each analyzer node is self-contained (build_node() wraps the pure analyzer
function with a try/except that degrades to a FAIL result on any crash) —
unlike Phase 2's crawl pipeline, these 24 checks have no real sequential data
dependency on each other, so a bug in one must not abort the rest.
"""
from __future__ import annotations

from langgraph.graph import StateGraph, END

from .schema import DIMENSION_NAMES
from .nodes._common import build_node, dimension_result_key
from .nodes.authority_trust import (
    analyze_brand_authority,
    analyze_conversion_optimization,
    analyze_local_seo,
    analyze_trust,
)
from .nodes.build import aggregate_and_build_node, load_extraction_node, validator_node
from .nodes.business_info import (
    analyze_company_information,
    analyze_contact_information,
    analyze_products,
    analyze_services,
    analyze_website_information,
)
from .nodes.content_seo import (
    analyze_accessibility,
    analyze_blog,
    analyze_content_analysis,
    analyze_faq,
    analyze_keyword_analysis,
    analyze_page_analysis,
)
from .nodes.links_media import analyze_external_links, analyze_images, analyze_internal_links, analyze_videos
from .nodes.llm_semantic import llm_semantic_analysis_node
from .nodes.pagespeed import fetch_pagespeed_node
from .nodes.technical import (
    analyze_core_web_vitals,
    analyze_performance,
    analyze_schema,
    analyze_security,
    analyze_technical_seo,
)
from .state import SEOAnalysisState

_ANALYZERS = {
    "Website Information": analyze_website_information,
    "Company Information": analyze_company_information,
    "Contact Information": analyze_contact_information,
    "Products": analyze_products,
    "Services": analyze_services,
    "Page Analysis": analyze_page_analysis,
    "Technical SEO": analyze_technical_seo,
    "Content Analysis": analyze_content_analysis,
    "Keyword Analysis": analyze_keyword_analysis,
    "Internal Links": analyze_internal_links,
    "External Links": analyze_external_links,
    "Images": analyze_images,
    "Videos": analyze_videos,
    "Blog": analyze_blog,
    "FAQ": analyze_faq,
    "Schema": analyze_schema,
    "Performance": analyze_performance,
    "Core Web Vitals": analyze_core_web_vitals,
    "Accessibility": analyze_accessibility,
    "Security": analyze_security,
    "Trust": analyze_trust,
    "Local SEO": analyze_local_seo,
    "Brand Authority": analyze_brand_authority,
    "Conversion Optimization": analyze_conversion_optimization,
}


def _node_name(dimension: str) -> str:
    return dimension_result_key(dimension)[: -len("_result")]


def build_graph() -> StateGraph:
    g = StateGraph(SEOAnalysisState)

    g.add_node("load_extraction", load_extraction_node)
    g.add_node("fetch_pagespeed", fetch_pagespeed_node)
    g.add_node("llm_semantic_analysis", llm_semantic_analysis_node)

    analyzer_node_names: list[str] = []
    for dimension in DIMENSION_NAMES:
        name = _node_name(dimension)
        analyzer_node_names.append(name)
        g.add_node(name, build_node(dimension, dimension_result_key(dimension), _ANALYZERS[dimension]))

    g.add_node("aggregate_and_build", aggregate_and_build_node)
    g.add_node("validator", validator_node)

    g.set_entry_point("load_extraction")
    chain = [
        "load_extraction", "fetch_pagespeed", "llm_semantic_analysis",
        *analyzer_node_names, "aggregate_and_build", "validator",
    ]
    for a, b in zip(chain, chain[1:]):
        g.add_edge(a, b)
    g.add_edge("validator", END)

    return g.compile()


SEOAnalysisGraph = build_graph()

__all__ = ["SEOAnalysisGraph"]
