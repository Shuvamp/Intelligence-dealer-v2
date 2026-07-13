"""Website Extraction — build stage: json_builder, validator.

json_builder_node is a pure function (no I/O) assembling every prior node's
output into the ONE normalized JSON the spec calls for. validator_node
Pydantic-validates it against schema.py and never raises — a schema mismatch
or a totally-failed crawl degrades to status="failed" + errors, not an
unhandled exception.
"""
from __future__ import annotations

from pydantic import ValidationError

from ..schema import WebsiteExtractionResult
from ..state import WebsiteExtractionState


def json_builder_node(state: WebsiteExtractionState) -> dict:
    extraction_data = {
        "website": {
            "url": state["seed_url"],
            "normalized_url": state["seed_url"],
            "final_url": state.get("final_url"),
            "domain": state.get("seed_host"),
            "pages_crawled": state.get("pages_crawled", []),
            "pages_discovered_count": state.get("pages_discovered_count", 0),
            "crawl_started_at": state.get("crawl_started_at"),
            "crawl_completed_at": state.get("crawl_completed_at"),
            "crawl_duration_ms": state.get("crawl_duration_ms"),
        },
        "company": state.get("company") or {},
        "contact": state.get("contact") or {},
        "products": state.get("products", []),
        "services": state.get("services", []),
        "pages": state.get("pages", []),
        "images": state.get("images", []),
        "videos": state.get("videos", []),
        "blog": state.get("blog") or {"has_blog": False, "post_count": 0, "recent_posts": []},
        "faq": state.get("faq", []),
        "technology": state.get("technology") or {},
        # crawler_node writes has_sitemap/has_robots_txt/robots_txt_respected/
        # sitemap_used as top-level state fields; metadata_parser_node writes
        # meta_title/meta_description/canonical_url/og_tags into a nested
        # "technical_seo" dict. Both halves must land in the same output
        # section — schema_markup_types is derived here too (unique JSON-LD
        # @type values across every crawled page).
        "technical_seo": {
            "has_sitemap": state.get("has_sitemap", False),
            "has_robots_txt": state.get("has_robots_txt", False),
            "robots_txt_respected": state.get("robots_txt_respected", True),
            "sitemap_used": state.get("sitemap_used", False),
            **(state.get("technical_seo") or {}),
            "schema_markup_types": _collect_schema_types(state),
        },
        "trust": state.get("trust") or {},
        "links": state.get("links") or {},
    }
    return {"extraction_data": extraction_data}


def _collect_schema_types(state: WebsiteExtractionState) -> list[str]:
    types: set[str] = set()
    for page in state.get("parsed_pages", {}).values():
        for entry in page["json_ld"]:
            entry_type = entry.get("@type")
            if isinstance(entry_type, str):
                types.add(entry_type)
            elif isinstance(entry_type, list):
                types.update(t for t in entry_type if isinstance(t, str))
    return sorted(types)


def validator_node(state: WebsiteExtractionState) -> dict:
    data = state.get("extraction_data") or {}
    try:
        validated = WebsiteExtractionResult.model_validate(data)
    except ValidationError as exc:
        return {
            "status": "failed",
            "errors": [*state.get("errors", []), f"schema_validation_failed: {exc}"],
        }

    if not validated.website.pages_crawled:
        # Nothing was ever successfully crawled — e.g. url_validator_node
        # rejected the seed (SSRF/DNS failure) or every page fetch failed.
        return {"status": "failed"}

    return {"status": "ready"}
