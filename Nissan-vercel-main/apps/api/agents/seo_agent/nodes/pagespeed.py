"""SEO Agent — Google PageSpeed Insights integration.

Replaces the Performance / Core Web Vitals `always_warning` stubs (technical.py)
with real telemetry where available. Mirrors _fetch_calendarific's
(app/routers/marketing.py) "no key / any failure -> None, never raise" shape —
this is the only real-data source in seo_agent, everything else here is pure
in-memory extraction.
"""
from __future__ import annotations

import logging
import time

import httpx

from app.config import PAGESPEED_API_KEY

logger = logging.getLogger(__name__)

_PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
_TIMEOUT = 25.0
_CACHE_TTL_S = 24 * 60 * 60  # protects PSI's free-tier daily quota; repeat analyses stay fast
_cache: dict[str, tuple[float, dict | None]] = {}  # url -> (fetched_at, result)

# Google's published Core Web Vitals thresholds (good / needs-improvement / poor).
_LCP_GOOD_S, _LCP_POOR_S = 2.5, 4.0
_CLS_GOOD, _CLS_POOR = 0.1, 0.25
_INP_GOOD_MS, _INP_POOR_MS = 200, 500

_STATUS_RANK = {"FAIL": 2, "WARNING": 1, "PASS": 0}


def _field_percentile(metric: dict | None, divisor: float = 1.0) -> float | None:
    if not metric or "percentile" not in metric:
        return None
    try:
        return metric["percentile"] / divisor
    except (TypeError, ZeroDivisionError):
        return None


def _audit_numeric(audit: dict | None) -> float | None:
    if not audit or audit.get("numericValue") is None:
        return None
    try:
        return float(audit["numericValue"])
    except (TypeError, ValueError):
        return None


async def fetch_pagespeed(url: str) -> dict | None:
    """Calls PSI v5 (mobile, performance category). Returns
    {"performance_score": 0-100|None, "lcp_s": float|None, "cls": float|None,
    "inp_ms": float|None, "source": "field"|"lab"}, or None on missing key,
    non-200, timeout, or a malformed response — never raises."""
    if not PAGESPEED_API_KEY or not url:
        return None

    params = {"url": url, "key": PAGESPEED_API_KEY, "category": "performance", "strategy": "mobile"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_PSI_URL, params=params)
        if resp.status_code != 200:
            logger.warning("[pagespeed] HTTP %s for %s: %s", resp.status_code, url, resp.text[:300])
            return None
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.exception("[pagespeed] request failed for %s", url)
        return None

    try:
        lighthouse = data.get("lighthouseResult") or {}
        perf_score_raw = ((lighthouse.get("categories") or {}).get("performance") or {}).get("score")
        performance_score = round(perf_score_raw * 100) if isinstance(perf_score_raw, (int, float)) else None

        field_metrics = (data.get("loadingExperience") or {}).get("metrics") or {}
        lcp_s = _field_percentile(field_metrics.get("LARGEST_CONTENTFUL_PAINT_MS"), divisor=1000)
        cls = _field_percentile(field_metrics.get("CUMULATIVE_LAYOUT_SHIFT_SCORE"), divisor=100)
        inp_ms = _field_percentile(field_metrics.get("INTERACTION_TO_NEXT_PAINT"))
        source = "field"

        if lcp_s is None and cls is None and inp_ms is None:
            # Dealer sites are typically low-traffic — CrUX field data (needs a
            # minimum real-user sample) is often absent. Fall back to lab audits.
            source = "lab"
            audits = lighthouse.get("audits") or {}
            lcp_ms = _audit_numeric(audits.get("largest-contentful-paint"))
            lcp_s = (lcp_ms / 1000) if lcp_ms is not None else None
            cls = _audit_numeric(audits.get("cumulative-layout-shift"))
            inp_ms = _audit_numeric(audits.get("total-blocking-time"))  # closest lab proxy for INP

        return {"performance_score": performance_score, "lcp_s": lcp_s, "cls": cls, "inp_ms": inp_ms, "source": source}
    except Exception:  # noqa: BLE001
        logger.exception("[pagespeed] malformed response for %s", url)
        return None


def cwv_status(lcp_s: float | None, cls: float | None, inp_ms: float | None) -> str | None:
    """Worst-of-3 status against Google's published good/needs-improvement/poor
    bands. None if none of the three metrics are available."""
    statuses: list[str] = []
    if lcp_s is not None:
        statuses.append("PASS" if lcp_s <= _LCP_GOOD_S else "FAIL" if lcp_s > _LCP_POOR_S else "WARNING")
    if cls is not None:
        statuses.append("PASS" if cls <= _CLS_GOOD else "FAIL" if cls > _CLS_POOR else "WARNING")
    if inp_ms is not None:
        statuses.append("PASS" if inp_ms <= _INP_GOOD_MS else "FAIL" if inp_ms > _INP_POOR_MS else "WARNING")
    if not statuses:
        return None
    return max(statuses, key=lambda s: _STATUS_RANK[s])


async def fetch_pagespeed_node(state: dict) -> dict:
    """Upstream node (not one of the 24 dimension analyzers) — injects
    `_pagespeed` into extraction_data for analyze_performance/
    analyze_core_web_vitals to pick up. No-op (returns {}) on missing key,
    missing URL, or any failure — analyzers then fall back to their existing
    always_warning() behavior, unchanged."""
    extraction = state.get("extraction_data")
    if not extraction:
        return {}
    website = extraction.get("website") or {}
    url = website.get("final_url") or website.get("url")
    if not url:
        return {}

    try:
        cached = _cache.get(url)
        if cached is not None and (time.time() - cached[0]) < _CACHE_TTL_S:
            pagespeed = cached[1]
        else:
            pagespeed = await fetch_pagespeed(url)
            _cache[url] = (time.time(), pagespeed)
    except Exception:  # noqa: BLE001
        logger.exception("seo_agent.pagespeed_node_failed url=%s", url)
        return {}

    if not pagespeed:
        return {}
    return {"extraction_data": {**extraction, "_pagespeed": pagespeed}}
