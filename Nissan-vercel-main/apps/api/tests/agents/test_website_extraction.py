"""Unit tests for the Website Extraction Agent (Phase 2).

Covers the pure/deterministic surface only — SSRF/scope guards, the page-type
classifier, HTML parsing, the heuristic extractors/detectors, and JSON
building/validation. Actual network I/O (DNS resolution, HTTP fetches) is
left untested here, matching this codebase's existing convention (see
test_call_intelligence.py) of testing pure logic and leaving I/O untested/mocked.
"""
import ipaddress

import pytest

from agents.website_extraction.nodes.build import json_builder_node, validator_node
from agents.website_extraction.nodes.detect import (
    blog_detector_node,
    faq_detector_node,
    media_detector_node,
    technology_detector_node,
    trust_detector_node,
)
from agents.website_extraction.nodes.extract import (
    contact_extractor_node,
    product_extractor_node,
    service_extractor_node,
)
from agents.website_extraction.nodes.fetch import _is_disallowed_ip, _same_scope
from agents.website_extraction.nodes.parse import _parse_one, classify_page


# ---- SSRF / scope guards (fetch.py) -----------------------------------------

def test_disallowed_ip_rejects_private_loopback_and_link_local():
    assert _is_disallowed_ip(ipaddress.ip_address("10.0.0.1")) is True
    assert _is_disallowed_ip(ipaddress.ip_address("127.0.0.1")) is True
    assert _is_disallowed_ip(ipaddress.ip_address("169.254.169.254")) is True  # cloud metadata
    assert _is_disallowed_ip(ipaddress.ip_address("192.168.1.1")) is True


def test_disallowed_ip_allows_public_address():
    assert _is_disallowed_ip(ipaddress.ip_address("8.8.8.8")) is False


def test_same_scope_matches_exact_host_and_subdomain():
    assert _same_scope("example.com", "example.com") is True
    assert _same_scope("www.example.com", "example.com") is True
    assert _same_scope("shop.example.com", "example.com") is True


def test_same_scope_rejects_different_host():
    assert _same_scope("evil.com", "example.com") is False
    assert _same_scope("notexample.com", "example.com") is False


# ---- classify_page (parse.py) -----------------------------------------------

def test_classify_page_home():
    assert classify_page("https://example.com/") == "home"
    assert classify_page("https://example.com") == "home"


def test_classify_page_by_path():
    assert classify_page("https://example.com/about-us") == "about"
    assert classify_page("https://example.com/contact") == "contact"
    assert classify_page("https://example.com/models") == "products"
    assert classify_page("https://example.com/service-and-finance") == "services"
    assert classify_page("https://example.com/blog") == "blog"
    assert classify_page("https://example.com/faq") == "faq"


def test_classify_page_by_link_text_fallback():
    assert classify_page("https://example.com/xyz", link_text="Contact Us") == "contact"


def test_classify_page_other():
    assert classify_page("https://example.com/random-page") == "other"


# ---- _parse_one (parse.py) --------------------------------------------------

SAMPLE_HTML = """
<html>
<head>
  <title>ABC Nissan</title>
  <meta name="description" content="Nissan dealer in Chennai">
  <meta property="og:site_name" content="ABC Nissan Official">
  <link rel="canonical" href="/">
  <script type="application/ld+json">{"@type": "FAQPage", "mainEntity": [
    {"@type": "Question", "name": "Do you offer test drives?",
     "acceptedAnswer": {"@type": "Answer", "text": "Yes, book online."}}
  ]}</script>
</head>
<body>
  <h1>Welcome</h1>
  <h2>Magnite</h2>
  <p>A compact SUV built for the city.</p>
  <h2>Kicks</h2>
  <p>A bold crossover SUV.</p>
  <a href="/contact">Contact</a>
  <a href="mailto:sales@abcnissan.in">Email us</a>
  <a href="tel:+911234567890">Call us</a>
  <a href="https://facebook.com/abcnissan">Facebook</a>
</body>
</html>
"""


def test_parse_one_extracts_title_meta_and_canonical():
    page = _parse_one("https://example.com/", SAMPLE_HTML)
    assert page["title"] == "ABC Nissan"
    assert page["meta"]["description"] == "Nissan dealer in Chennai"
    assert page["meta"]["og:site_name"] == "ABC Nissan Official"
    assert page["canonical"] == "https://example.com/"


def test_parse_one_extracts_headings_and_links():
    page = _parse_one("https://example.com/", SAMPLE_HTML)
    assert "Magnite" in page["headings"]
    hrefs = {link["href"] for link in page["links"]}
    assert "https://example.com/contact" in hrefs
    assert "mailto:sales@abcnissan.in" in hrefs


def test_parse_one_extracts_json_ld():
    page = _parse_one("https://example.com/", SAMPLE_HTML)
    assert len(page["json_ld"]) == 1
    assert page["json_ld"][0]["@type"] == "FAQPage"


def test_parse_one_heading_blocks_pair_heading_with_following_text():
    page = _parse_one("https://example.com/", SAMPLE_HTML)
    blocks = {b["heading"]: b["text"] for b in page["heading_blocks"]}
    assert blocks["Magnite"] == "A compact SUV built for the city."
    assert blocks["Kicks"] == "A bold crossover SUV."


# ---- product / service extractors (extract.py) -----------------------------

def _state_with_page(url: str, page_type: str, parsed_page: dict) -> dict:
    return {
        "pages": [{"url": url, "title": parsed_page["title"], "type": page_type}],
        "parsed_pages": {url: parsed_page},
    }


def test_product_extractor_pulls_heading_blocks_from_products_page():
    page = _parse_one("https://example.com/models", SAMPLE_HTML)
    state = _state_with_page("https://example.com/models", "products", page)
    result = product_extractor_node(state)
    names = {p["name"] for p in result["products"]}
    assert "Magnite" in names
    assert "Kicks" in names
    assert all(p["source_url"] == "https://example.com/models" for p in result["products"])


def test_service_extractor_returns_empty_when_no_services_page():
    page = _parse_one("https://example.com/", SAMPLE_HTML)
    state = _state_with_page("https://example.com/", "home", page)
    result = service_extractor_node(state)
    assert result["services"] == []


# ---- contact extractor -------------------------------------------------------

def test_contact_extractor_finds_email_phone_and_social():
    page = _parse_one("https://example.com/contact", SAMPLE_HTML)
    state = {"parsed_pages": {"https://example.com/contact": page}}
    result = contact_extractor_node(state)
    contact = result["contact"]
    assert "sales@abcnissan.in" in contact["emails"]
    assert "+911234567890" in contact["phones"]
    assert contact["social_links"]["facebook"] == "https://facebook.com/abcnissan"


# ---- technology detector -----------------------------------------------------

def test_technology_detector_matches_known_signatures():
    raw_html = {
        "https://example.com/": (
            "<html><body>wp-content wp-includes "
            "<script src='https://www.googletagmanager.com/gtag/js'></script>"
            "<script>__NEXT_DATA__ = {}</script></body></html>"
        )
    }
    result = technology_detector_node({"raw_html": raw_html})
    tech = result["technology"]
    assert tech["cms"] == "WordPress"
    assert "Google Tag Manager" in tech["analytics"]
    assert "Next.js" in tech["frameworks"]


def test_technology_detector_empty_when_no_html():
    assert technology_detector_node({"raw_html": {}}) == {}


# ---- blog detector ------------------------------------------------------------

def test_blog_detector_no_blog_page():
    result = blog_detector_node({"pages": []})
    assert result["blog"] == {"has_blog": False, "post_count": 0, "recent_posts": []}


def test_blog_detector_finds_posts_under_blog_prefix():
    blog_html = (
        '<html><body>'
        '<a href="/blog/post-one">First Post</a>'
        '<a href="/blog/post-two">Second Post</a>'
        '<a href="/about">About</a>'
        '</body></html>'
    )
    page = _parse_one("https://example.com/blog", blog_html)
    state = {
        "pages": [{"url": "https://example.com/blog", "title": None, "type": "blog"}],
        "parsed_pages": {"https://example.com/blog": page},
    }
    result = blog_detector_node(state)
    assert result["blog"]["has_blog"] is True
    titles = {p["title"] for p in result["blog"]["recent_posts"]}
    assert "First Post" in titles
    assert "Second Post" in titles
    assert "About" not in titles


# ---- faq detector ---------------------------------------------------------

def test_faq_detector_prefers_schema_over_heading_fallback():
    page = _parse_one("https://example.com/faq", SAMPLE_HTML)
    result = faq_detector_node({"parsed_pages": {"https://example.com/faq": page}})
    assert len(result["faq"]) == 1
    assert result["faq"][0]["source"] == "schema"
    assert result["faq"][0]["question"] == "Do you offer test drives?"


def test_faq_detector_heading_fallback_when_no_schema():
    html = "<html><body><h2>What is your warranty?</h2><p>3 years, unlimited km.</p></body></html>"
    page = _parse_one("https://example.com/faq", html)
    result = faq_detector_node({"parsed_pages": {"https://example.com/faq": page}})
    assert len(result["faq"]) == 1
    assert result["faq"][0]["source"] == "heading_fallback"
    assert result["faq"][0]["answer"] == "3 years, unlimited km."


# ---- media detector ---------------------------------------------------------

def test_media_detector_finds_images_and_youtube_video():
    html = (
        '<html><body>'
        '<img src="/hero.jpg" alt="Showroom">'
        '<iframe src="https://www.youtube.com/embed/abc123"></iframe>'
        '</body></html>'
    )
    result = media_detector_node({"raw_html": {"https://example.com/": html}})
    assert result["images"] == [{"url": "/hero.jpg", "alt": "Showroom", "source_page": "https://example.com/"}]
    assert result["videos"][0]["platform"] == "youtube"


# ---- trust detector -----------------------------------------------------------

def test_trust_detector_flags_ssl_privacy_and_terms():
    html = '<html><body><a href="/privacy-policy">Privacy</a><a href="/terms">Terms</a></body></html>'
    page = _parse_one("https://example.com/", html)
    state = {"final_url": "https://example.com/", "parsed_pages": {"https://example.com/": page}}
    result = trust_detector_node(state)
    trust = result["trust"]
    assert trust["has_ssl"] is True
    assert trust["has_privacy_policy"] is True
    assert trust["has_terms"] is True


# ---- json builder + validator -------------------------------------------------

def _minimal_state(**overrides) -> dict:
    state = {
        "seed_url": "https://example.com/", "final_url": "https://example.com/",
        "seed_host": "example.com", "pages_crawled": ["https://example.com/"],
        "pages_discovered_count": 1, "crawl_started_at": None, "crawl_completed_at": None,
        "crawl_duration_ms": None, "company": {}, "contact": {}, "products": [],
        "services": [], "pages": [], "images": [], "videos": [], "blog": {},
        "faq": [], "technology": {}, "technical_seo": {}, "trust": {}, "errors": [],
    }
    state.update(overrides)
    return state


def test_json_builder_assembles_all_sections():
    state = _minimal_state()
    result = json_builder_node(state)
    data = result["extraction_data"]
    assert data["website"]["url"] == "https://example.com/"
    assert data["website"]["pages_crawled"] == ["https://example.com/"]
    assert data["blog"] == {"has_blog": False, "post_count": 0, "recent_posts": []}


def test_json_builder_merges_crawler_flags_into_technical_seo():
    """Regression test: crawler_node writes has_sitemap/has_robots_txt/
    robots_txt_respected/sitemap_used as top-level state fields (separate
    from metadata_parser_node's nested technical_seo dict) — both halves
    must land in the same output section."""
    state = _minimal_state(
        has_sitemap=True, has_robots_txt=True, robots_txt_respected=True, sitemap_used=True,
        technical_seo={"meta_title": "ABC Nissan", "meta_description": "desc"},
    )
    data = json_builder_node(state)["extraction_data"]
    seo = data["technical_seo"]
    assert seo["has_sitemap"] is True
    assert seo["has_robots_txt"] is True
    assert seo["sitemap_used"] is True
    assert seo["meta_title"] == "ABC Nissan"
    assert seo["meta_description"] == "desc"


def test_json_builder_collects_schema_markup_types_from_json_ld():
    page = _parse_one("https://example.com/faq", SAMPLE_HTML)
    state = _minimal_state(parsed_pages={"https://example.com/faq": page})
    data = json_builder_node(state)["extraction_data"]
    assert data["technical_seo"]["schema_markup_types"] == ["FAQPage"]


def test_validator_ready_when_pages_crawled_present():
    state = _minimal_state()
    state.update(json_builder_node(state))
    result = validator_node(state)
    assert result["status"] == "ready"


def test_validator_failed_when_no_pages_crawled():
    state = _minimal_state(pages_crawled=[])
    state.update(json_builder_node(state))
    result = validator_node(state)
    assert result["status"] == "failed"


def test_validator_failed_on_schema_mismatch():
    state = _minimal_state()
    state["extraction_data"] = {"website": {"url": 12345}}  # url must be a string
    result = validator_node(state)
    assert result["status"] == "failed"
    assert any("schema_validation_failed" in e for e in result["errors"])


# ---- full graph run via _run_and_track (service.py) -------------------------
# Regression test for a real bug found during manual E2E verification:
# LangGraph's astream(stream_mode="updates") represents a node's empty-dict
# no-op return as None (not {}) in the update event — dict.update(None)
# raised TypeError, surfacing as a spurious "pipeline_crashed" error on top
# of the real (and correctly handled) SSRF rejection. Uses the reserved
# .invalid TLD (RFC 2606) for a deterministic, network-independent DNS
# failure — no real network access required, no flakiness risk.

@pytest.mark.asyncio
async def test_run_and_track_handles_every_node_no_op_without_crashing():
    from agents.website_extraction.service import _initial_state, _run_and_track

    initial = _initial_state("ext-test", "tenant-test", "ctx-test", "https://this-domain-does-not-exist.invalid")
    final_state = initial
    async for _node_name, merged in _run_and_track(initial, "ext-test"):
        final_state = merged

    assert final_state["status"] == "failed"
    # Only the real DNS-resolution error should be present — no
    # "pipeline_crashed" noise from the None-update bug.
    assert not any("pipeline_crashed" in e for e in final_state["errors"])
    assert any("dns_resolution_failed" in e for e in final_state["errors"])
