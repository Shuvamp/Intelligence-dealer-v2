"""Unit tests for the SEO Agent (Phase 4).

Covers all 24 pure analyzer functions (each dimension's PASS/WARNING/FAIL
branches), the shared helpers (_common.py), the aggregate scoring formula,
and build_node's exception-catching behavior. Every analyzer is a pure
function over a plain dict — no I/O, no mocking needed.
"""
import pytest

from agents.seo_agent.nodes._common import build_node, dimension_result_key, rec, result, worst
from agents.seo_agent.nodes.authority_trust import (
    analyze_brand_authority,
    analyze_conversion_optimization,
    analyze_local_seo,
    analyze_trust,
)
from agents.seo_agent.nodes.build import aggregate_and_build_node, load_extraction_node, validator_node
from agents.seo_agent.nodes.business_info import (
    analyze_company_information,
    analyze_contact_information,
    analyze_products,
    analyze_services,
    analyze_website_information,
)
from agents.seo_agent.nodes.content_seo import (
    analyze_accessibility,
    analyze_blog,
    analyze_content_analysis,
    analyze_faq,
    analyze_keyword_analysis,
    analyze_page_analysis,
)
from agents.seo_agent.nodes.links_media import (
    analyze_external_links,
    analyze_images,
    analyze_internal_links,
    analyze_videos,
)
from agents.seo_agent.nodes.technical import (
    analyze_core_web_vitals,
    analyze_performance,
    analyze_schema,
    analyze_security,
    analyze_technical_seo,
)
from agents.seo_agent.schema import DIMENSION_NAMES

GOOD_EXTRACTION = {
    "website": {
        "url": "https://example.com", "normalized_url": "https://example.com",
        "final_url": "https://example.com", "domain": "example.com",
        "pages_crawled": ["https://example.com/", "https://example.com/about", "https://example.com/contact"],
        "pages_discovered_count": 3,
    },
    "company": {"name": "ABC Nissan", "description": "Nissan dealer in Chennai.", "region": "Tamil Nadu", "industry": "Automotive"},
    "contact": {
        "emails": ["sales@abcnissan.in"], "phones": ["+911234567890"], "addresses": ["123 Main St, Chennai"],
        "social_links": {"facebook": "https://facebook.com/abcnissan"},
    },
    "products": [{"name": "Magnite", "description": "A compact SUV built for the city streets."}],
    "services": [{"name": "Financing", "description": "Flexible financing options for every budget."}],
    "pages": [
        {"url": "https://example.com/", "title": "ABC Nissan", "type": "home"},
        {"url": "https://example.com/about", "title": "About Us", "type": "about"},
        {"url": "https://example.com/contact", "title": "Contact", "type": "contact"},
    ],
    "images": [
        {"url": "/hero.jpg", "alt": "Showroom", "source_page": "https://example.com/"},
        {"url": "/team.jpg", "alt": "Our team", "source_page": "https://example.com/about"},
        {"url": "/map.jpg", "alt": "Location map", "source_page": "https://example.com/contact"},
    ],
    "videos": [{"url": "https://youtube.com/embed/x", "platform": "youtube"}],
    "blog": {"has_blog": True, "post_count": 5, "recent_posts": []},
    "faq": [
        {"question": "Do you offer test drives?", "answer": "Yes.", "source": "schema"},
        {"question": "What are your hours?", "answer": "9-6 daily.", "source": "schema"},
        {"question": "Do you finance?", "answer": "Yes.", "source": "schema"},
    ],
    "technology": {"cms": "WordPress", "analytics": [], "frameworks": [], "raw_signals": []},
    "technical_seo": {
        "has_sitemap": True, "has_robots_txt": True, "robots_txt_respected": True, "sitemap_used": True,
        "meta_title": "ABC Nissan Official — Chennai Car Dealer", "meta_description": "A" * 80,
        "canonical_url": "https://example.com/", "og_tags": {"og:title": "ABC Nissan"},
        "schema_markup_types": ["Organization", "LocalBusiness", "Product", "FAQPage"],
    },
    "trust": {
        "has_ssl": True, "has_privacy_policy": True, "has_terms": True,
        "certifications": ["ISO 9001"], "testimonials_count": 5,
    },
    "links": {
        "internal_count": 12, "external_count": 2,
        "internal": [
            {"href": "https://example.com/about", "text": "About ABC Nissan", "source_page": "https://example.com/"},
            {"href": "https://example.com/contact", "text": "Contact us", "source_page": "https://example.com/"},
        ],
        "external": [{"href": "https://nissan.com", "text": "Nissan Global", "source_page": "https://example.com/"}],
    },
}

EMPTY_EXTRACTION: dict = {}


# ---- shared helpers -----------------------------------------------------------

def test_worst_status_ranking():
    assert worst(["PASS", "WARNING", "FAIL"]) == "FAIL"
    assert worst(["PASS", "WARNING"]) == "WARNING"
    assert worst(["PASS", "PASS"]) == "PASS"
    assert worst([]) == "PASS"


def test_dimension_result_key_derivation():
    assert dimension_result_key("Technical SEO") == "technical_seo_result"
    assert dimension_result_key("Core Web Vitals") == "core_web_vitals_result"
    assert dimension_result_key("FAQ") == "faq_result"


def test_build_node_catches_analyzer_exception():
    def _boom(extraction):
        raise RuntimeError("kaboom")

    node = build_node("Website Information", "website_information_result", _boom)
    output = node({"extraction_data": {}})
    dim_result = output["website_information_result"]
    assert dim_result["status"] == "FAIL"
    assert "kaboom" in dim_result["recommendations"][0]["reason"]


def test_build_node_passes_extraction_through():
    def _identity(extraction):
        return result("X", "PASS")

    node = build_node("X", "x_result", _identity)
    output = node({"extraction_data": GOOD_EXTRACTION})
    assert output["x_result"]["status"] == "PASS"


# ---- business_info --------------------------------------------------------------

def test_website_information_fails_on_empty():
    assert analyze_website_information(EMPTY_EXTRACTION)["status"] == "FAIL"


def test_website_information_warns_on_shallow_crawl():
    extraction = {**GOOD_EXTRACTION, "website": {**GOOD_EXTRACTION["website"], "pages_crawled": ["https://example.com/"]}}
    assert analyze_website_information(extraction)["status"] == "WARNING"


def test_website_information_passes_on_good_data():
    assert analyze_website_information(GOOD_EXTRACTION)["status"] == "PASS"


def test_company_information_fails_without_name():
    assert analyze_company_information({"company": {}})["status"] == "FAIL"


def test_company_information_warns_on_partial():
    assert analyze_company_information({"company": {"name": "ABC"}})["status"] == "WARNING"


def test_company_information_passes_on_full():
    assert analyze_company_information(GOOD_EXTRACTION)["status"] == "PASS"


def test_contact_information_fails_without_email_or_phone():
    assert analyze_contact_information({"contact": {}})["status"] == "FAIL"


def test_contact_information_passes_on_full():
    assert analyze_contact_information(GOOD_EXTRACTION)["status"] == "PASS"


def test_products_fails_when_no_products_or_services():
    assert analyze_products({"products": [], "services": []})["status"] == "FAIL"


def test_products_warns_when_only_services():
    assert analyze_products({"products": [], "services": [{"name": "X"}]})["status"] == "WARNING"


def test_products_passes_with_described_item():
    assert analyze_products(GOOD_EXTRACTION)["status"] == "PASS"


def test_services_symmetric_to_products():
    assert analyze_services({"products": [], "services": []})["status"] == "FAIL"
    assert analyze_services({"products": [{"name": "X"}], "services": []})["status"] == "WARNING"
    assert analyze_services(GOOD_EXTRACTION)["status"] == "PASS"


# ---- technical ------------------------------------------------------------------

def test_technical_seo_fails_without_meta_description_or_title():
    assert analyze_technical_seo({"technical_seo": {}})["status"] == "FAIL"


def test_technical_seo_passes_on_good_data():
    assert analyze_technical_seo(GOOD_EXTRACTION)["status"] == "PASS"


def test_schema_fails_when_no_types():
    assert analyze_schema({"technical_seo": {}, "products": [], "faq": []})["status"] == "FAIL"


def test_schema_passes_on_full_coverage():
    assert analyze_schema(GOOD_EXTRACTION)["status"] == "PASS"


def test_performance_always_warning():
    r = analyze_performance(GOOD_EXTRACTION)
    assert r["status"] == "WARNING"
    assert "static" in r["recommendations"][0]["reason"].lower()


def test_core_web_vitals_always_warning():
    assert analyze_core_web_vitals(GOOD_EXTRACTION)["status"] == "WARNING"


def test_performance_uses_pagespeed_when_present():
    extraction = {**GOOD_EXTRACTION, "_pagespeed": {"performance_score": 95, "source": "lab"}}
    r = analyze_performance(extraction)
    assert r["status"] == "PASS"


def test_performance_fails_on_low_score():
    extraction = {**GOOD_EXTRACTION, "_pagespeed": {"performance_score": 30, "source": "field"}}
    assert analyze_performance(extraction)["status"] == "FAIL"


def test_core_web_vitals_uses_pagespeed_when_present():
    extraction = {**GOOD_EXTRACTION, "_pagespeed": {"lcp_s": 1.5, "cls": 0.05, "inp_ms": 100, "source": "field"}}
    assert analyze_core_web_vitals(extraction)["status"] == "PASS"


def test_core_web_vitals_fails_on_poor_metrics():
    extraction = {**GOOD_EXTRACTION, "_pagespeed": {"lcp_s": 5.0, "cls": 0.3, "inp_ms": 600, "source": "field"}}
    assert analyze_core_web_vitals(extraction)["status"] == "FAIL"


def test_security_fails_without_ssl():
    assert analyze_security({"trust": {"has_ssl": False}})["status"] == "FAIL"


def test_security_passes_with_ssl_but_carries_caveat():
    r = analyze_security(GOOD_EXTRACTION)
    assert r["status"] == "PASS"
    assert len(r["recommendations"]) == 1  # caveat present even on PASS


# ---- content_seo ------------------------------------------------------------------

def test_page_analysis_fails_on_no_pages():
    assert analyze_page_analysis({"pages": []})["status"] == "FAIL"


def test_page_analysis_passes_on_good_data():
    assert analyze_page_analysis(GOOD_EXTRACTION)["status"] == "PASS"


def test_content_analysis_fails_when_nothing_present():
    assert analyze_content_analysis({"products": [], "services": [], "blog": {}, "faq": []})["status"] == "FAIL"


def test_content_analysis_passes_with_signal():
    assert analyze_content_analysis(GOOD_EXTRACTION)["status"] == "PASS"


def test_content_analysis_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"Content Analysis": {"dimension": "Content Analysis", "status": "FAIL", "recommendations": []}}}
    assert analyze_content_analysis(extraction)["status"] == "FAIL"


def test_keyword_analysis_always_warning():
    assert analyze_keyword_analysis(GOOD_EXTRACTION)["status"] == "WARNING"


def test_keyword_analysis_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"Keyword Analysis": {"dimension": "Keyword Analysis", "status": "PASS", "recommendations": []}}}
    assert analyze_keyword_analysis(extraction)["status"] == "PASS"


def test_blog_warns_when_absent():
    assert analyze_blog({"blog": {"has_blog": False}})["status"] == "WARNING"


def test_blog_passes_when_active():
    assert analyze_blog(GOOD_EXTRACTION)["status"] == "PASS"


def test_faq_warns_when_empty():
    assert analyze_faq({"faq": []})["status"] == "WARNING"


def test_faq_passes_with_schema_sourced_entries():
    assert analyze_faq(GOOD_EXTRACTION)["status"] == "PASS"


def test_accessibility_warns_on_no_images():
    assert analyze_accessibility({"images": []})["status"] == "WARNING"


def test_accessibility_fails_on_low_alt_coverage():
    extraction = {"images": [{"url": "a", "alt": None}, {"url": "b", "alt": None}, {"url": "c", "alt": "ok"}]}
    assert analyze_accessibility(extraction)["status"] == "FAIL"


def test_accessibility_passes_on_good_coverage():
    assert analyze_accessibility(GOOD_EXTRACTION)["status"] == "PASS"


# ---- links_media ------------------------------------------------------------------

def test_internal_links_fails_on_zero():
    r = analyze_internal_links({"links": {"internal_count": 0}, "website": {}})
    assert r["status"] == "FAIL"


def test_internal_links_warns_on_low_density():
    extraction = {
        "links": {"internal_count": 1, "internal": []},
        "website": {"pages_crawled": ["a", "b", "c"]},
    }
    assert analyze_internal_links(extraction)["status"] == "WARNING"


def test_internal_links_warns_on_generic_anchor_text():
    extraction = {
        "links": {
            "internal_count": 10,
            "internal": [{"href": f"https://example.com/{i}", "text": "click here"} for i in range(5)],
        },
        "website": {"pages_crawled": ["a"]},
    }
    assert analyze_internal_links(extraction)["status"] == "WARNING"


def test_internal_links_passes_on_good_data():
    assert analyze_internal_links(GOOD_EXTRACTION)["status"] == "PASS"


def test_external_links_warns_on_zero():
    r = analyze_external_links({"links": {"internal_count": 5, "external_count": 0}})
    assert r["status"] == "WARNING"


def test_external_links_warns_on_external_heavy_profile():
    extraction = {"links": {"internal_count": 2, "external_count": 10}}
    assert analyze_external_links(extraction)["status"] == "WARNING"


def test_external_links_passes_on_balanced_profile():
    assert analyze_external_links(GOOD_EXTRACTION)["status"] == "PASS"


def test_images_fails_on_none():
    assert analyze_images({"images": [], "website": {}})["status"] == "FAIL"


def test_images_passes_on_good_coverage():
    assert analyze_images(GOOD_EXTRACTION)["status"] == "PASS"


def test_videos_warns_when_absent():
    assert analyze_videos({"videos": []})["status"] == "WARNING"


def test_videos_passes_when_present():
    assert analyze_videos(GOOD_EXTRACTION)["status"] == "PASS"


# ---- authority_trust ------------------------------------------------------------------

def test_trust_fails_without_ssl_or_legal_pages():
    assert analyze_trust({"trust": {"has_ssl": False}})["status"] == "FAIL"


def test_trust_passes_on_full_signals():
    assert analyze_trust(GOOD_EXTRACTION)["status"] == "PASS"


def test_local_seo_fails_without_location_signal():
    assert analyze_local_seo({"contact": {}, "company": {}, "technical_seo": {}})["status"] == "FAIL"


def test_local_seo_passes_with_full_nap_and_schema():
    assert analyze_local_seo(GOOD_EXTRACTION)["status"] == "PASS"


def test_brand_authority_always_warning():
    assert analyze_brand_authority(GOOD_EXTRACTION)["status"] == "WARNING"


def test_brand_authority_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"Brand Authority": {"dimension": "Brand Authority", "status": "PASS", "recommendations": []}}}
    assert analyze_brand_authority(extraction)["status"] == "PASS"


def test_conversion_optimization_always_warning():
    assert analyze_conversion_optimization(GOOD_EXTRACTION)["status"] == "WARNING"


def test_conversion_optimization_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"Conversion Optimization": {"dimension": "Conversion Optimization", "status": "FAIL", "recommendations": []}}}
    assert analyze_conversion_optimization(extraction)["status"] == "FAIL"


# ---- build.py: load_extraction / aggregate / validator ------------------------------

def test_load_extraction_node_rejects_missing_data():
    out = load_extraction_node({"extraction_data": {}, "errors": []})
    assert out["status"] == "failed"


def test_load_extraction_node_accepts_present_data():
    assert load_extraction_node({"extraction_data": GOOD_EXTRACTION, "errors": []}) == {}


def _all_pass_state() -> dict:
    state = {"status": "queued", "errors": []}
    for name in DIMENSION_NAMES:
        state[dimension_result_key(name)] = result(name, "PASS")
    return state


def test_aggregate_scores_all_pass_as_100():
    out = aggregate_and_build_node(_all_pass_state())
    assert out["overall_score"] == 100
    assert out["analysis_data"]["summary"]["grade"] == "A"
    assert out["analysis_data"]["summary"]["pass_count"] == len(DIMENSION_NAMES)
    assert len(out["analysis_data"]["dimensions"]) == len(DIMENSION_NAMES)


def test_aggregate_scores_all_fail_as_zero():
    state = {"status": "queued", "errors": []}
    for name in DIMENSION_NAMES:
        state[dimension_result_key(name)] = result(name, "FAIL")
    out = aggregate_and_build_node(state)
    assert out["overall_score"] == 0
    assert out["analysis_data"]["summary"]["grade"] == "F"


def test_aggregate_skips_when_already_failed():
    assert aggregate_and_build_node({"status": "failed", "errors": []}) == {}


def test_validator_passes_valid_data():
    state = _all_pass_state()
    state.update(aggregate_and_build_node(state))
    out = validator_node(state)
    assert out == {}


def test_validator_fails_on_schema_mismatch():
    state = {"analysis_data": {"dimensions": "not-a-list", "summary": {}}, "errors": []}
    out = validator_node(state)
    assert out["status"] == "failed"
    assert any("schema_validation_failed" in e for e in out["errors"])


# ---- full graph run (network-free, mirrors website_extraction's approach) -----------

@pytest.mark.asyncio
async def test_full_graph_run_produces_24_dimensions(monkeypatch):
    from agents.seo_agent.graph import SEOAnalysisGraph
    from agents.seo_agent.service import _initial_state

    # Network-free regardless of local .env contents — this is also the
    # "all keys unset" env-var-matrix check: output must be identical to
    # pre-hybrid-change behavior when no LLM is configured.
    monkeypatch.setattr("agents.seo_agent.nodes.llm_semantic.has_llm", lambda: False)

    initial = _initial_state("a1", "t1", "c1", "e1", GOOD_EXTRACTION)
    final = await SEOAnalysisGraph.ainvoke(initial)
    assert final["status"] == "ready"
    assert len(final["analysis_data"]["dimensions"]) == len(DIMENSION_NAMES) == 24
    dimension_names_in_output = {d["dimension"] for d in final["analysis_data"]["dimensions"]}
    assert dimension_names_in_output == set(DIMENSION_NAMES)
