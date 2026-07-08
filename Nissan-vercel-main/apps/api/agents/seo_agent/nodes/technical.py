"""SEO Agent — technical analyzers: Technical SEO, Schema, Performance,
Core Web Vitals, Security.

Performance and Core Web Vitals always return WARNING — Phase 2's static
HTML extraction captures no runtime timing/rendering data at all, so a
confident PASS/FAIL here would be fabricated. Security has only one weak
signal (has_ssl) — a PASS still carries a caveat about what wasn't checked.
"""
from __future__ import annotations

from ._common import always_warning, rec, result, worst


def analyze_technical_seo(extraction: dict) -> dict:
    seo = extraction.get("technical_seo") or {}
    meta_title = seo.get("meta_title")
    meta_description = seo.get("meta_description")
    canonical_url = seo.get("canonical_url")
    has_sitemap = seo.get("has_sitemap")
    has_robots_txt = seo.get("has_robots_txt")
    robots_txt_respected = seo.get("robots_txt_respected", True)
    og_tags = seo.get("og_tags") or {}

    recommendations = []
    statuses = []

    if not meta_description:
        recommendations.append(rec(
            "Missing meta description", "No meta description tag was found on the page.",
            "Add a concise meta description between 50 and 160 characters.", "high", "high", "low",
        ))
        statuses.append("FAIL")
    elif not (50 <= len(meta_description) <= 160):
        recommendations.append(rec(
            "Meta description length is suboptimal",
            f"Meta description is {len(meta_description)} characters; the recommended range is 50-160.",
            "Rewrite the meta description to fall within 50-160 characters.", "medium", "medium", "low",
        ))
        statuses.append("WARNING")
    else:
        statuses.append("PASS")

    if not meta_title:
        recommendations.append(rec(
            "Missing meta title", "No page title was found.",
            "Add a descriptive <title> tag between 30 and 60 characters.", "high", "high", "low",
        ))
        statuses.append("FAIL")
    elif not (30 <= len(meta_title) <= 60):
        recommendations.append(rec(
            "Meta title length is suboptimal",
            f"Meta title is {len(meta_title)} characters; the recommended range is 30-60.",
            "Rewrite the title tag to fall within 30-60 characters.", "medium", "medium", "low",
        ))
        statuses.append("WARNING")
    else:
        statuses.append("PASS")

    if not canonical_url:
        recommendations.append(rec(
            "Missing canonical URL", "No canonical link tag was found.",
            'Add a <link rel="canonical"> tag to prevent duplicate-content issues.', "medium", "medium", "low",
        ))
        statuses.append("WARNING")
    else:
        statuses.append("PASS")

    if not has_sitemap:
        recommendations.append(rec(
            "No sitemap.xml detected",
            "A sitemap helps search engines discover and index pages efficiently.",
            "Publish a sitemap.xml and reference it in robots.txt.", "medium", "medium", "low",
        ))
        statuses.append("WARNING")
    else:
        statuses.append("PASS")

    if not has_robots_txt or not robots_txt_respected:
        recommendations.append(rec(
            "robots.txt missing or not respected",
            "No robots.txt was found, or the crawl could not confirm it was respected.",
            "Publish a robots.txt file that clearly allows search engine crawling of public pages.",
            "low", "low", "low",
        ))
        statuses.append("WARNING")
    else:
        statuses.append("PASS")

    if not og_tags:
        recommendations.append(rec(
            "No Open Graph tags found",
            "Open Graph tags control how the page appears when shared on social media.",
            "Add og:title, og:description, and og:image meta tags.", "low", "low", "low",
        ))
        statuses.append("WARNING")
    else:
        statuses.append("PASS")

    return result("Technical SEO", worst(statuses), recommendations)


def analyze_schema(extraction: dict) -> dict:
    seo = extraction.get("technical_seo") or {}
    types = set(seo.get("schema_markup_types") or [])
    products = extraction.get("products") or []
    faq = extraction.get("faq") or []

    if not types:
        return result("Schema", "FAIL", [rec(
            "No structured data (schema.org) found",
            "No JSON-LD or microdata markup was detected on any crawled page.",
            "Add Organization or LocalBusiness schema markup to the homepage.", "high", "medium", "medium",
        )])

    missing = []
    if not (types & {"Organization", "LocalBusiness"}):
        missing.append("Organization or LocalBusiness")
    if products and not (types & {"Product"}):
        missing.append("Product")
    if faq and not (types & {"FAQPage"}):
        missing.append("FAQPage")

    if missing:
        return result("Schema", "WARNING", [rec(
            f"Missing expected schema types: {', '.join(missing)}",
            "Structured data was found but doesn't cover all content types present on the site.",
            f"Add {', '.join(missing)} schema markup where relevant.", "medium", "medium", "medium",
        )])

    return result("Schema", "PASS")


def analyze_performance(extraction: dict) -> dict:
    return always_warning(
        "Performance",
        "Page-load performance cannot be assessed",
        "This analysis is based on static HTML extraction; website.crawl_duration_ms reflects crawl "
        "time, not real browser render/load time.",
        "Run a Lighthouse or WebPageTest audit to measure actual page-load performance.",
    )


def analyze_core_web_vitals(extraction: dict) -> dict:
    return always_warning(
        "Core Web Vitals",
        "Core Web Vitals cannot be assessed",
        "LCP, INP, and CLS require real-browser or Chrome UX Report (CrUX) field data, which is not "
        "captured by static HTML extraction.",
        "Use Google PageSpeed Insights or the CrUX dashboard to measure Core Web Vitals.",
    )


def analyze_security(extraction: dict) -> dict:
    trust = extraction.get("trust") or {}
    has_ssl = trust.get("has_ssl", False)

    if not has_ssl:
        return result("Security", "FAIL", [rec(
            "Site is not served over HTTPS",
            "No valid SSL/TLS certificate was detected.",
            "Install an SSL certificate and enforce HTTPS for all pages.", "high", "high", "low",
        )])

    return result("Security", "PASS", [rec(
        "Only certificate presence was verified",
        "This check confirms HTTPS is in use but does not scan for security headers (CSP, HSTS, "
        "X-Frame-Options), known vulnerabilities, or outdated dependencies.",
        "Run a dedicated security scan (e.g. Mozilla Observatory, securityheaders.com) for a fuller assessment.",
        "low", "low", "low",
    )])
