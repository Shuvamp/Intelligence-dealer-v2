"""Report Generator — Groq-direct LLM call for the 5 prose narrative
sections + deterministic fallback.

Mirrors company_summary/llm.py's exact pattern: Groq-direct via httpx
(GROK_API_KEY/GROK_MODEL from app/config.py, response_format json_object),
all-or-nothing shape validation (a mismatched/partial response is discarded
entirely, never merged section-by-section), never raises. If GROQ_API_KEY
isn't set (as in dev), generate_narratives() returns None and the caller
uses _common.deterministic_narratives() instead — so the feature is fully
functional with no key.

Only the 5 NARRATIVE sections are LLM-generated. The 6 structured sections
(Overall Score, Strengths, Weaknesses, Priority Fixes, Technical Details,
Recommendations) are always assembled deterministically from the upstream
JSON in _common.py — the LLM never sees or invents scores/recommendations.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import GROK_API_KEY, GROK_MODEL

from ._common import (
    assemble_strengths,
    assemble_weaknesses,
    company_name_of,
    website_url_of,
)

logger = logging.getLogger(__name__)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

_NARRATIVE_KEYS = {
    "executive_summary",
    "company_overview",
    "website_summary",
    "seo_summary",
    "aeo_summary",
}

SYSTEM_PROMPT = """You are an SEO/AEO analyst writing the narrative sections of a website audit report.
You will be given a JSON object of already-computed facts (scores, counts, issue lists, company data).
Produce ONLY the five prose narrative sections as a single JSON object.

Rules — follow these exactly:
1. Use ONLY facts present in the input. Never invent scores, numbers, company details, or issues.
2. Write in clear, professional prose. Each section is 2-5 sentences, no markdown, no bullet points.
3. Do NOT restate raw JSON; synthesize the facts into readable narrative.
4. If a fact is missing or "Unknown", do not speculate — omit it or say it is not available.
5. Output ONLY a single JSON object with exactly these keys: executive_summary, company_overview,
   website_summary, seo_summary, aeo_summary. No markdown fences, no extra keys, no commentary."""


def has_groq() -> bool:
    return bool(GROK_API_KEY)


def _build_user_prompt(
    website_json: dict,
    recommendation_report_data: dict,
    seo_analysis_data: dict,
    aeo_analysis_data: dict,
    company_summary: dict | None,
) -> str:
    rec_summary = recommendation_report_data.get("summary") or {}
    groups = recommendation_report_data.get("groups") or {}
    top_issues = [
        {"problem": r.get("problem"), "severity": r.get("severity"), "category": r.get("category")}
        for r in ([*(groups.get("critical") or []), *(groups.get("high") or [])])[:5]
    ]
    seo_summary = seo_analysis_data.get("summary") or {}
    aeo_summary = aeo_analysis_data.get("summary") or {}
    website = website_json.get("website") or {}
    blog = website_json.get("blog") or {}

    payload = {
        "company_name": company_name_of(website_json, company_summary),
        "website_url": website_url_of(website_json),
        "company_profile": {
            "industry": (company_summary or {}).get("industry") or (website_json.get("company") or {}).get("industry"),
            "region": (company_summary or {}).get("region") or (website_json.get("company") or {}).get("region"),
            "description": (company_summary or {}).get("description") or (website_json.get("company") or {}).get("description"),
            "verdict": (company_summary or {}).get("verdict"),
            "products": [p.get("name") for p in (website_json.get("products") or []) if p.get("name")][:15],
            "services": [s.get("name") for s in (website_json.get("services") or []) if s.get("name")][:15],
        },
        "website_facts": {
            "pages_crawled": len(website.get("pages_crawled") or []),
            "product_count": len(website_json.get("products") or []),
            "service_count": len(website_json.get("services") or []),
            "has_blog": bool(blog.get("has_blog")),
            "blog_post_count": blog.get("post_count", 0),
            "faq_count": len(website_json.get("faq") or []),
        },
        "combined_score": rec_summary.get("combined_score"),
        "combined_grade": rec_summary.get("combined_grade"),
        "total_issues": rec_summary.get("total_count"),
        "critical_count": rec_summary.get("critical_count"),
        "high_count": rec_summary.get("high_count"),
        "top_issues": top_issues,
        "seo": {
            "score": seo_summary.get("overall_score"),
            "grade": seo_summary.get("grade"),
            "pass": seo_summary.get("pass_count"),
            "warning": seo_summary.get("warning_count"),
            "fail": seo_summary.get("fail_count"),
            "failing_dimensions": [
                d.get("dimension") for d in (seo_analysis_data.get("dimensions") or [])
                if d.get("status") == "FAIL"
            ],
        },
        "aeo": {
            "score": aeo_summary.get("aeo_score"),
            "pass": aeo_summary.get("pass_count"),
            "warning": aeo_summary.get("warning_count"),
            "fail": aeo_summary.get("fail_count"),
            "strength_count": len(assemble_strengths(seo_analysis_data, aeo_analysis_data)),
            "weakness_count": len(assemble_weaknesses(seo_analysis_data, aeo_analysis_data)),
            "weak_agents": [w.get("agent") for w in (aeo_analysis_data.get("weaknesses") or [])],
        },
    }
    return json.dumps(payload)


def _valid_shape(data: Any) -> bool:
    if not isinstance(data, dict) or set(data.keys()) != _NARRATIVE_KEYS:
        return False
    return all(isinstance(data[k], str) and data[k].strip() for k in _NARRATIVE_KEYS)


def generate_narratives(
    website_json: dict,
    recommendation_report_data: dict,
    seo_analysis_data: dict,
    aeo_analysis_data: dict,
    company_summary: dict | None,
) -> dict[str, str] | None:
    """Calls Groq directly. Returns None (never raises) if unconfigured, the
    call fails, or the response doesn't match the exact 5-key shape."""
    if not GROK_API_KEY:
        return None
    try:
        resp = httpx.post(
            _GROQ_URL,
            json={
                "model": GROK_MODEL,
                "temperature": 0.3,
                "max_tokens": 1500,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": _build_user_prompt(
                        website_json, recommendation_report_data,
                        seo_analysis_data, aeo_analysis_data, company_summary,
                    )},
                ],
                "response_format": {"type": "json_object"},
            },
            headers={"Authorization": f"Bearer {GROK_API_KEY}", "Content-Type": "application/json"},
            timeout=45.0,
        )
        if resp.status_code != 200:
            logger.warning("report_generator.groq_non_200 status=%s", resp.status_code)
            return None
        content = resp.json()["choices"][0]["message"]["content"]
        data = json.loads(content)
    except Exception:  # noqa: BLE001
        logger.exception("report_generator.groq_call_failed")
        return None

    if not _valid_shape(data):
        logger.warning("report_generator.groq_shape_mismatch")
        return None
    return data
