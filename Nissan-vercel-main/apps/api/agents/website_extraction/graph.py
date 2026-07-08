"""Website Extraction Graph (Phase 2).

Linear chain — matches every existing graph in this codebase (context_planner,
call_intelligence, workflow, intake_pipeline are all linear, no branching).
Node order matters because later nodes read the shared parsed-page cache
html_parser_node builds, and because every node degrades to a no-op when its
required upstream input is empty (e.g. a rejected seed URL means crawler,
downloader, and every extractor/detector after it just pass through
unchanged) rather than needing explicit conditional edges.

START → url_validator → crawler → html_downloader → html_parser
      → metadata_parser → navigation_parser
      → product_extractor → service_extractor → contact_extractor
      → technology_detector → blog_detector → faq_detector → media_detector → trust_detector
      → json_builder → validator → END
"""
from __future__ import annotations

from langgraph.graph import StateGraph, END

from .nodes.build import json_builder_node, validator_node
from .nodes.detect import (
    blog_detector_node,
    faq_detector_node,
    media_detector_node,
    technology_detector_node,
    trust_detector_node,
)
from .nodes.extract import contact_extractor_node, product_extractor_node, service_extractor_node
from .nodes.fetch import crawler_node, html_downloader_node, url_validator_node
from .nodes.parse import html_parser_node, metadata_parser_node, navigation_parser_node
from .state import WebsiteExtractionState

_NODE_ORDER = [
    "url_validator", "crawler", "html_downloader", "html_parser",
    "metadata_parser", "navigation_parser",
    "product_extractor", "service_extractor", "contact_extractor",
    "technology_detector", "blog_detector", "faq_detector", "media_detector", "trust_detector",
    "json_builder", "validator",
]


def build_graph() -> StateGraph:
    g = StateGraph(WebsiteExtractionState)

    g.add_node("url_validator", url_validator_node)
    g.add_node("crawler", crawler_node)
    g.add_node("html_downloader", html_downloader_node)
    g.add_node("html_parser", html_parser_node)
    g.add_node("metadata_parser", metadata_parser_node)
    g.add_node("navigation_parser", navigation_parser_node)
    g.add_node("product_extractor", product_extractor_node)
    g.add_node("service_extractor", service_extractor_node)
    g.add_node("contact_extractor", contact_extractor_node)
    g.add_node("technology_detector", technology_detector_node)
    g.add_node("blog_detector", blog_detector_node)
    g.add_node("faq_detector", faq_detector_node)
    g.add_node("media_detector", media_detector_node)
    g.add_node("trust_detector", trust_detector_node)
    g.add_node("json_builder", json_builder_node)
    g.add_node("validator", validator_node)

    g.set_entry_point("url_validator")
    for a, b in zip(_NODE_ORDER, _NODE_ORDER[1:]):
        g.add_edge(a, b)
    g.add_edge("validator", END)

    return g.compile()


WebsiteExtractionGraph = build_graph()

__all__ = ["WebsiteExtractionGraph", "_NODE_ORDER"]
