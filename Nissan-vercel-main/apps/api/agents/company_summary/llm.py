"""Company Summary — Groq-direct LLM call + deterministic fallback.

Phase 3's spec explicitly says "generated using Groq LLM" — unlike every
other agent in this codebase (Claude-primary/Groq-fallback via app/llm.py or
agents/*/llm.py), this agent calls Groq exclusively and never falls back to
Claude, so the engine actually used always matches what the spec names. If
GROQ_API_KEY isn't set, or the call/parse fails, or the response doesn't
match the exact expected shape, the whole response is discarded (never
merged field-by-field) in favor of deterministic_summary() — never raises.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import GROK_API_KEY, GROK_MODEL

logger = logging.getLogger(__name__)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# Deterministic-fallback caps (unchanged — deterministic_summary uses these).
_MAX_PRODUCTS = 20
_MAX_SERVICES = 20
# Wider caps for the LLM prompt only — the model is given more noisy candidates
# to filter down from than the deterministic path passes through verbatim.
_MAX_PROMPT_PRODUCTS = 30
_MAX_PROMPT_SERVICES = 30
_MAX_PAGE_TITLES = 20
_MAX_ADDRESSES = 5
_MAX_FAQ = 10
_MAX_DESC_CHARS = 200  # trim each candidate description so the prompt stays bounded

_EXPECTED_KEYS = {"company_name", "region", "industry", "products", "services", "description", "verdict"}

SYSTEM_PROMPT = """You are a company research assistant. You will be given structured data
auto-extracted from a company's website. Produce a concise, accurate company summary as a
single JSON object.

Rules — follow these exactly:
1. Base every field on the input. Never fabricate specific facts (product names, numbers,
   claims) that are not supported by the input.
2. "region" and "industry": INFER these from the strongest available signals — the company
   name, website domain, company_description, addresses, and page titles — when a reasonable
   reader could determine them (e.g. a name like "Vignesh Nissan" with a "Puducherry" address
   → industry "Automotive Dealership", region "Puducherry, India"; a "Nissan" dealer →
   industry "Automotive Dealership"). Output the literal string "Unknown" ONLY when there is
   genuinely no signal to infer from.
3. "products" and "services": the input's `product_candidates` and `service_candidates` lists
   are auto-extracted from page headings and are NOISY — they frequently contain navigation
   labels ("Discover More", "Tell us about your experience"), section titles ("Customers
   Review", "Related Dealers"), people's names (testimonial authors), accessory/category
   headings, or generic UI text. From these candidates, output ONLY the genuine products and
   services this company actually offers, using their real names (use each candidate's
   description to judge). DISCARD anything that is clearly navigation, a person's name, a
   review/testimonial, a related/partner/dealer listing, an accessory category, or UI text.
   Do not invent items that are not among the candidates. If, after filtering, no genuine
   products (or services) remain, output ["Unknown"] for that list.
4. "description" is 1-3 sentences summarizing what the company does, using only the input's
   own description, offerings, and page titles. Output "Unknown" if there is not enough input.
5. "verdict" is one short sentence (about 20 words) characterizing the company based on its
   genuine products/services/description and inferred industry — a sharp analyst note, no
   marketing fluff, no invented claims. Output "Unknown" only if there is nothing to
   characterize.
6. Output ONLY a single JSON object with exactly these keys: company_name, region, industry,
   products, services, description, verdict. "products" and "services" are arrays of plain
   name strings. No markdown fences, no extra keys, no commentary."""


def has_groq() -> bool:
    return bool(GROK_API_KEY)


def _candidate(item: dict[str, Any]) -> dict[str, Any]:
    """A noisy product/service candidate: name + a trimmed description, so the
    LLM can judge whether it's a genuine offering or heading noise."""
    desc = (item.get("description") or "").strip()
    return {"name": item.get("name"), "description": desc[:_MAX_DESC_CHARS] or None}


def _build_user_prompt(extraction: dict[str, Any]) -> str:
    website = extraction.get("website") or {}
    company = extraction.get("company") or {}
    contact = extraction.get("contact") or {}
    pages = extraction.get("pages") or []
    faq = extraction.get("faq") or []

    payload = {
        "website_url": website.get("final_url") or website.get("url"),
        "domain": website.get("domain"),
        "company_name": company.get("name"),
        "company_region": company.get("region"),
        "company_industry": company.get("industry"),
        "company_description": company.get("description"),
        # NOISY, auto-extracted candidate lists (see SYSTEM_PROMPT rule 3) — the
        # model must filter these down to genuine offerings, not reproduce them.
        "product_candidates": [_candidate(p) for p in extraction.get("products", []) if p.get("name")][:_MAX_PROMPT_PRODUCTS],
        "service_candidates": [_candidate(s) for s in extraction.get("services", []) if s.get("name")][:_MAX_PROMPT_SERVICES],
        "faq_questions": [f.get("question") for f in faq if f.get("question")][:_MAX_FAQ],
        "page_titles": [p.get("title") for p in pages if p.get("title")][:_MAX_PAGE_TITLES],
        "addresses": (contact.get("addresses") or [])[:_MAX_ADDRESSES],
    }
    return json.dumps(payload)


def _valid_shape(data: Any) -> bool:
    if not isinstance(data, dict) or set(data.keys()) != _EXPECTED_KEYS:
        return False
    if not all(isinstance(data[k], str) for k in ("company_name", "region", "industry", "description", "verdict")):
        return False
    if not all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in (data["products"], data["services"])):
        return False
    return True


def generate_summary(extraction: dict[str, Any]) -> dict[str, Any] | None:
    """Calls Groq directly. Returns None (never raises) if unconfigured, the
    call fails, or the response doesn't match the exact expected shape."""
    if not GROK_API_KEY:
        return None
    try:
        resp = httpx.post(
            _GROQ_URL,
            json={
                "model": GROK_MODEL,
                "temperature": 0.2,
                "max_tokens": 1024,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": _build_user_prompt(extraction)},
                ],
                "response_format": {"type": "json_object"},
            },
            headers={"Authorization": f"Bearer {GROK_API_KEY}", "Content-Type": "application/json"},
            timeout=30.0,
        )
        if resp.status_code != 200:
            logger.warning("company_summary.groq_non_200 status=%s", resp.status_code)
            return None
        content = resp.json()["choices"][0]["message"]["content"]
        data = json.loads(content)
    except Exception:  # noqa: BLE001
        logger.exception("company_summary.groq_call_failed")
        return None

    if not _valid_shape(data):
        logger.warning("company_summary.groq_shape_mismatch")
        return None
    return data


def deterministic_summary(extraction: dict[str, Any]) -> dict[str, Any]:
    """Zero-config fallback — never raises, never hallucinates. Pulls
    whatever Phase 2 already extracted verbatim; "Unknown" for anything
    missing. verdict has no non-LLM source, so it's always "Unknown" here,
    per the spec's own instruction."""
    company = extraction.get("company") or {}

    def _u(value: Any) -> str:
        return value.strip() if isinstance(value, str) and value.strip() else "Unknown"

    products = [p.get("name") for p in extraction.get("products", []) if p.get("name")][:_MAX_PRODUCTS]
    services = [s.get("name") for s in extraction.get("services", []) if s.get("name")][:_MAX_SERVICES]

    return {
        "company_name": _u(company.get("name")),
        "region": _u(company.get("region")),
        "industry": _u(company.get("industry")),
        "products": products or ["Unknown"],
        "services": services or ["Unknown"],
        "description": _u(company.get("description")),
        "verdict": "Unknown",
    }
