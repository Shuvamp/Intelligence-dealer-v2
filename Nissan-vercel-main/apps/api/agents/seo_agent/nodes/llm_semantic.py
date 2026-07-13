"""SEO Agent — LLM semantic-check node.

Upstream out-of-band node (not one of the 24 dimension analyzers): one
batched LLM call judging the 4 dimensions that need genuine content
judgment rather than a structural/binary check — Keyword Analysis, Content
Analysis, Brand Authority, Conversion Optimization. Mirrors
agents/scoring/nodes.py's holistic single-prompt pattern (one call scores
several dimensions at once) but built on the shared app/llm.py::llm_json()
client (Claude -> Groq, returns None on any failure) instead of a bespoke
provider ladder.

Every one of these 4 dimensions previously had zero real signal
(always_warning stub) or only a shallow length/presence proxy
(analyze_content_analysis) — the LLM result is still an honest content-based
proxy, not the "real" external data (search-volume, backlink profile,
analytics), and the prompt requires the model to say so via a caveat
recommendation rather than fabricate certainty.

Injects results into extraction_data["_llm_semantic"][<Dimension Name>] —
analyzers in content_seo.py / authority_trust.py read this first and fall
back to their existing rule/stub logic unchanged when it's absent (no
has_llm(), cache miss + call failure, or a malformed response for that
specific dimension).
"""
from __future__ import annotations

import hashlib
import json
import logging

from app.llm import has_llm, llm_json

logger = logging.getLogger(__name__)

TARGET_DIMENSIONS = ["Keyword Analysis", "Content Analysis", "Brand Authority", "Conversion Optimization"]

_VALID_STATUSES = {"PASS", "WARNING", "FAIL"}
_VALID_LEVELS = {"high", "medium", "low"}
_MAX_PAGES_IN_PROMPT = 5
_PAGE_PRIORITY = {"home": 0, "about": 1, "products": 2, "services": 2, "faq": 3, "blog": 4, "contact": 5, "other": 6}

_SYSTEM_PROMPT = """You are an SEO analyst judging a dealership website from scraped content only.

Judge only from the content provided below. You do NOT have access to search-volume data, \
backlink/domain-authority data, or GA4/analytics data. If a dimension genuinely can't be judged \
confidently from what's provided, say so honestly inside a recommendation rather than fabricating \
a confident verdict.

Return ONLY a JSON object (no prose, no markdown fences) with exactly these 4 top-level keys: \
"Keyword Analysis", "Content Analysis", "Brand Authority", "Conversion Optimization". \
Each value must be an object: {"status": "PASS"|"WARNING"|"FAIL", "recommendations": [...]}. \
Each recommendation object must have exactly these string fields: "problem", "reason", \
"recommendation", "estimated_impact" ("high"|"medium"|"low"), "priority" ("high"|"medium"|"low"), \
"difficulty" ("high"|"medium"|"low"). Include 1-3 recommendations per dimension.

What each dimension means here (a content-based proxy, not the full picture):
- Keyword Analysis: does the on-page copy show a clear, consistent topical focus matching the \
stated products/services/industry? (NOT search-volume or ranking data — say so if relevant.)
- Content Analysis: actual writing quality, depth, and uniqueness of the page text — not just \
presence/length.
- Brand Authority: on-page authority signals only — credentials, awards, media mentions, \
about-page substance, years in business. (NOT a backlink profile — say so if relevant.)
- Conversion Optimization: CTA clarity/placement and value-proposition clarity as visible in the \
scraped text/links. (NOT GA4 funnel data — say so if relevant.)"""

_cache: dict[str, dict] = {}


def _select_pages(pages: list[dict]) -> list[dict]:
    with_text = [p for p in pages if p.get("text_excerpt")]
    with_text.sort(key=lambda p: _PAGE_PRIORITY.get(p.get("type"), 6))
    return with_text[:_MAX_PAGES_IN_PROMPT]


def _build_prompt(extraction: dict) -> str:
    company = extraction.get("company") or {}
    seo = extraction.get("technical_seo") or {}
    products = extraction.get("products") or []
    services = extraction.get("services") or []
    faq = extraction.get("faq") or []
    blog = extraction.get("blog") or {}
    trust = extraction.get("trust") or {}
    pages = _select_pages(extraction.get("pages") or [])

    payload = {
        "company": {
            "name": company.get("name"), "description": company.get("description"),
            "region": company.get("region"), "industry": company.get("industry"),
        },
        "meta": {
            "title": seo.get("meta_title"), "description": seo.get("meta_description"),
            "schema_types": seo.get("schema_markup_types"),
        },
        "products": [{"name": p.get("name"), "description": p.get("description")} for p in products[:20]],
        "services": [{"name": s.get("name"), "description": s.get("description")} for s in services[:20]],
        "faq": [{"question": f.get("question"), "answer": f.get("answer")} for f in faq[:15]],
        "blog": {"has_blog": blog.get("has_blog"), "post_count": blog.get("post_count")},
        "trust": {
            "certifications": trust.get("certifications"), "testimonials_count": trust.get("testimonials_count"),
        },
        "pages": [
            {"type": p.get("type"), "title": p.get("title"), "headings": p.get("headings"), "text": p.get("text_excerpt")}
            for p in pages
        ],
    }
    return "Website content to judge:\n\n" + json.dumps(payload, ensure_ascii=False, default=str)


def _content_hash(extraction: dict) -> str:
    prompt = _build_prompt(extraction)
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def _validate_recommendations(raw: object) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        problem, reason, recommendation = item.get("problem"), item.get("reason"), item.get("recommendation")
        if not (isinstance(problem, str) and problem and isinstance(reason, str) and reason
                and isinstance(recommendation, str) and recommendation):
            continue
        out.append({
            "problem": problem,
            "reason": reason,
            "recommendation": recommendation,
            "estimated_impact": item.get("estimated_impact") if item.get("estimated_impact") in _VALID_LEVELS else "medium",
            "priority": item.get("priority") if item.get("priority") in _VALID_LEVELS else "medium",
            "difficulty": item.get("difficulty") if item.get("difficulty") in _VALID_LEVELS else "medium",
        })
    return out or None


def _validate_response(raw: dict) -> dict[str, dict]:
    """Validates each target dimension independently — a malformed or missing
    dimension is dropped so it falls back to its rule-based logic, rather than
    discarding the whole response over one bad field."""
    validated: dict[str, dict] = {}
    for dimension in TARGET_DIMENSIONS:
        entry = raw.get(dimension)
        if not isinstance(entry, dict):
            continue
        status = entry.get("status")
        if status not in _VALID_STATUSES:
            continue
        recommendations = _validate_recommendations(entry.get("recommendations"))
        if recommendations is None:
            continue
        validated[dimension] = {"dimension": dimension, "status": status, "recommendations": recommendations}
    return validated


def llm_semantic_analysis_node(state: dict) -> dict:
    extraction = state.get("extraction_data")
    if not extraction or not has_llm():
        return {}

    try:
        cache_key = _content_hash(extraction)
        cached = _cache.get(cache_key)
        if cached is not None:
            validated = cached
        else:
            prompt = _build_prompt(extraction)
            raw = llm_json(prompt, system=_SYSTEM_PROMPT, temperature=0.3, max_tokens=1800)
            validated = _validate_response(raw) if raw else {}
            _cache[cache_key] = validated
    except Exception:  # noqa: BLE001
        logger.exception("seo_agent.llm_semantic_analysis_failed")
        return {}

    if not validated:
        return {}
    return {"extraction_data": {**extraction, "_llm_semantic": {**(extraction.get("_llm_semantic") or {}), **validated}}}
