"""SEO Agent — authority_trust analyzers: Trust, Local SEO, Brand Authority,
Conversion Optimization.

Brand Authority and Conversion Optimization always return WARNING (no
backlink/social-following/funnel data exists anywhere in the extraction).
Local SEO uses weak-but-real NAP (name/address/phone) signal and always
attaches a caveat, even on a PASS.
"""
from __future__ import annotations

from ._common import always_warning, rec, result


def analyze_trust(extraction: dict) -> dict:
    trust = extraction.get("trust") or {}
    has_ssl = trust.get("has_ssl", False)
    has_privacy = trust.get("has_privacy_policy", False)
    has_terms = trust.get("has_terms", False)
    certifications = trust.get("certifications") or []
    testimonials_count = trust.get("testimonials_count", 0)

    if not has_ssl or (not has_privacy and not has_terms):
        missing = []
        if not has_ssl:
            missing.append("SSL/HTTPS")
        if not has_privacy and not has_terms:
            missing.append("privacy policy and terms of service")
        return result("Trust", "FAIL", [rec(
            f"Missing critical trust signals: {', '.join(missing)}",
            "These are baseline trust requirements for any commercial website.",
            "Add the missing items: an SSL certificate and privacy policy / terms of service pages.",
            "high", "high", "low",
        )])

    recommendations = []
    status = "PASS"

    if not (has_privacy and has_terms):
        missing_page = "terms of service" if not has_terms else "privacy policy"
        recommendations.append(rec(
            f"Missing {missing_page}", "Only one of the two standard legal pages was found.",
            f"Add a {missing_page} page.", "medium", "medium", "low",
        ))
        status = "WARNING"

    if not certifications and testimonials_count == 0:
        recommendations.append(rec(
            "No social proof found", "No certifications and no testimonials/reviews were detected.",
            "Add customer testimonials, reviews, or relevant certifications to build trust.",
            "medium", "medium", "medium",
        ))
        status = "WARNING"

    return result("Trust", status, recommendations)


def analyze_local_seo(extraction: dict) -> dict:
    contact = extraction.get("contact") or {}
    company = extraction.get("company") or {}
    seo = extraction.get("technical_seo") or {}
    addresses = contact.get("addresses") or []
    phones = contact.get("phones") or []
    region = company.get("region")
    types = set(seo.get("schema_markup_types") or [])

    if not addresses and not region:
        return result("Local SEO", "FAIL", [rec(
            "No location signal found", "Neither a physical address nor a region was detected.",
            "Add a physical address and specify the service region on the site.", "high", "high", "low",
        )])

    present = sum([bool(addresses), bool(phones), bool(region)])
    caveat = rec(
        "Only basic NAP presence was checked",
        "This assesses Name/Address/Phone presence only; full Local SEO (Google Business Profile, "
        "citations, review volume, map-pack ranking) requires external local-search data.",
        "Claim and optimize a Google Business Profile and build local citations.", "low", "low", "medium",
    )

    if present < 3:
        return result("Local SEO", "WARNING", [rec(
            "Incomplete local business information",
            f"{present}/3 of address, phone, and region are present.",
            "Ensure the site has a complete address, phone number, and region.", "medium", "medium", "low",
        ), caveat])

    if not (types & {"LocalBusiness"}):
        return result("Local SEO", "WARNING", [rec(
            "No LocalBusiness schema markup",
            "Address and phone are present but not marked up with LocalBusiness structured data.",
            "Add LocalBusiness schema markup to help local search visibility.", "medium", "medium", "medium",
        ), caveat])

    return result("Local SEO", "PASS", [caveat])


def analyze_brand_authority(extraction: dict) -> dict:
    return always_warning(
        "Brand Authority",
        "Brand authority cannot be assessed",
        "This requires a backlink profile (referring domains, Domain Authority/Rating), social following, "
        "and press-mention data — none of which is captured by static website extraction.",
        "Use a tool like Ahrefs or Moz to measure backlink profile and domain authority.",
    )


def analyze_conversion_optimization(extraction: dict) -> dict:
    return always_warning(
        "Conversion Optimization",
        "Conversion optimization cannot be assessed",
        "This requires CTA-placement analysis, form-friction data, and conversion-funnel/analytics data "
        "(e.g. GA4 goal completions) — none of which is captured by static website extraction.",
        "Set up conversion tracking (e.g. Google Analytics 4 goals) and review CTA placement and form design.",
    )
