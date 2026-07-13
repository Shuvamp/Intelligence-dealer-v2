from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

ExtractionStatus = Literal[
    "queued", "crawling", "parsing", "extracting", "building", "ready", "failed"
]


class ParsedPage(TypedDict):
    """Shared per-page parse cache — built once by html_parser_node, read by
    every extractor/detector node downstream instead of re-parsing HTML."""
    url: str
    title: Optional[str]
    meta: dict[str, str]           # name/property -> content, incl. og:*
    canonical: Optional[str]
    headings: list[str]            # h1-h3 text, in document order
    links: list[dict[str, str]]    # [{href, text}]
    json_ld: list[dict[str, Any]]  # parsed <script type="application/ld+json"> blocks
    text: str                      # visible text, whitespace-collapsed
    heading_blocks: list[dict[str, str]]  # [{heading, text}] — heading + its
                                           # sibling content, reused by product/
                                           # service/FAQ extraction so they don't
                                           # each re-parse the raw HTML


class WebsiteExtractionState(TypedDict):
    # input
    extraction_id: str
    tenant_id: str
    context_id: str
    seed_url: str            # context_plans.normalized_url
    seed_host: Optional[str]  # set by url_validator_node after DNS/SSRF checks

    # crawler output
    pages_crawled: list[str]
    pages_discovered_count: int
    has_sitemap: bool
    has_robots_txt: bool
    robots_txt_respected: bool
    sitemap_used: bool
    crawl_started_at: Optional[str]
    crawl_completed_at: Optional[str]

    # html_downloader output
    final_url: Optional[str]
    raw_html: dict[str, str]  # url -> html
    crawl_duration_ms: Optional[int]

    # html_parser output (shared cache)
    parsed_pages: dict[str, ParsedPage]

    # metadata_parser / navigation_parser output
    company: dict[str, Any]
    technical_seo: dict[str, Any]
    pages: list[dict[str, Any]]  # [{url, title, type, text_excerpt, headings}]

    # link_graph output
    links: dict[str, Any]  # {internal_count, external_count, internal, external}

    # extract.py output
    products: list[dict[str, Any]]
    services: list[dict[str, Any]]
    contact: dict[str, Any]

    # detect.py output
    technology: dict[str, Any]
    blog: dict[str, Any]
    faq: list[dict[str, Any]]
    images: list[dict[str, Any]]
    videos: list[dict[str, Any]]
    trust: dict[str, Any]

    # build.py output
    extraction_data: Optional[dict[str, Any]]

    # lifecycle
    status: ExtractionStatus
    errors: list[str]
