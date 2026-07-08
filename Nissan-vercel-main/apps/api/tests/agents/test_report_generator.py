"""Unit tests for the Report Generator (Phase 7).

Covers the deterministic narrative templates (the dev/fallback path), the
deterministic structured-section assembly, the Markdown renderer, the 6
pipeline nodes, service.py's prerequisite checks, the Groq shape validator,
and a full network-free graph run. Fixtures are built by running the REAL
Phase 4/5/6 graphs over a good extraction so the report is assembled from
authentic upstream JSON.
"""
import pytest

from agents.aeo_agent.graph import AEOAnalysisGraph
from agents.aeo_agent.service import _initial_state as aeo_initial_state
from agents.recommendation_engine.graph import RecommendationEngineGraph
from agents.recommendation_engine.service import _initial_state as rec_initial_state
from agents.report_generator import llm, service
from agents.report_generator._common import (
    SECTION_HEADINGS,
    assemble_strengths,
    assemble_technical_details,
    assemble_weaknesses,
    deterministic_narratives,
    extract_priority_fixes,
    grade_for,
    render_markdown,
)
from agents.report_generator.graph import ReportGraph
from agents.report_generator.nodes import (
    assemble_structured_node,
    build_report_node,
    generate_narratives_node,
    load_inputs_node,
    render_markdown_node,
    validator_node,
)
from agents.report_generator.service import ReportNotEligible
from agents.seo_agent.graph import SEOAnalysisGraph
from agents.seo_agent.service import _initial_state as seo_initial_state


@pytest.fixture(autouse=True)
def _force_deterministic_narratives(monkeypatch):
    """Keep every report-generator test hermetic/network-free regardless of
    whether a GROQ_API_KEY is configured in the environment (apps/api/.env).
    Without this, the full-graph tests would make a real Groq API call once a
    key is present, which is slow, flaky, and defeats the 'network-free graph
    run' intent. Tests that specifically exercise the Groq path monkeypatch
    llm.generate_narratives directly instead."""
    monkeypatch.setattr(llm, "GROK_API_KEY", "")


EXTRACTION = {
    "website": {
        "url": "https://example.com", "normalized_url": "https://example.com",
        "final_url": "https://example.com", "domain": "example.com",
        "pages_crawled": ["https://example.com/", "https://example.com/about", "https://example.com/contact"],
        "pages_discovered_count": 3,
    },
    "company": {
        "name": "ABC Nissan",
        "description": "ABC Nissan is a leading Nissan dealership in Chennai, offering sales, service, and financing.",
        "region": "Tamil Nadu", "industry": "Automotive",
    },
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
    "images": [{"url": "/hero.jpg", "alt": "Showroom", "source_page": "https://example.com/"}],
    "videos": [],
    "blog": {"has_blog": True, "post_count": 5, "recent_posts": []},
    "faq": [
        {"question": "Do you offer test drives?", "answer": "Yes, we offer complimentary test drives every day.", "source": "schema"},
        {"question": "What are your hours?", "answer": "Our showroom is open 9 AM to 6 PM daily.", "source": "schema"},
        {"question": "Do you finance?", "answer": "Yes, flexible financing plans through partner banks.", "source": "schema"},
    ],
    "technology": {"cms": "WordPress", "ecommerce_platform": None, "analytics": ["GA4"], "frameworks": ["React"], "raw_signals": []},
    "technical_seo": {
        "has_sitemap": True, "has_robots_txt": True, "robots_txt_respected": True, "sitemap_used": True,
        "meta_title": "ABC Nissan Official — Chennai Car Dealer", "meta_description": "A" * 80,
        "canonical_url": "https://example.com/", "og_tags": {"og:title": "ABC Nissan"},
        "schema_markup_types": ["Organization", "LocalBusiness", "Product", "FAQPage", "Article"],
    },
    "trust": {"has_ssl": True, "has_privacy_policy": True, "has_terms": True, "certifications": ["ISO 9001"], "testimonials_count": 5},
}


async def _upstream_fixtures() -> tuple[dict, dict, dict]:
    """Run the real Phase 4/5/6 graphs to produce authentic SEO/AEO/rec JSON."""
    seo = (await SEOAnalysisGraph.ainvoke(seo_initial_state("s1", "t1", "c1", "e1", EXTRACTION)))["analysis_data"]
    aeo = (await AEOAnalysisGraph.ainvoke(aeo_initial_state("a1", "t1", "c1", "e1", EXTRACTION)))["analysis_data"]
    rec_initial = rec_initial_state(
        "r1", "t1", "c1", "e1", "s1", "a1", EXTRACTION, seo, aeo,
        seo["summary"]["overall_score"], aeo["summary"]["aeo_score"],
    )
    rec = (await RecommendationEngineGraph.ainvoke(rec_initial))["report_data"]
    return seo, aeo, rec


def _prepared_from(seo: dict, aeo: dict, rec: dict, company_summary: dict | None = None) -> dict:
    return {
        "row": {
            "id": "rep1", "tenant_id": "t1", "context_id": "c1", "extraction_id": "e1",
            "recommendation_report_id": "r1", "seo_analysis_id": "s1", "aeo_analysis_id": "a1",
            "company_summary_id": company_summary["id"] if company_summary else None,
        },
        "website_json": EXTRACTION,
        "recommendation_report_data": rec,
        "seo_analysis_data": seo,
        "aeo_analysis_data": aeo,
        "company_summary": company_summary,
        "combined_score": rec["summary"]["combined_score"],
        "seo_score": rec["summary"]["seo_score"],
        "aeo_score": rec["summary"]["aeo_score"],
    }


# ---- _common: grade + deterministic narratives -----------------------------

def test_grade_for_bands():
    assert grade_for(95) == "A"
    assert grade_for(80) == "B"
    assert grade_for(65) == "C"
    assert grade_for(45) == "D"
    assert grade_for(10) == "F"


@pytest.mark.asyncio
async def test_deterministic_narratives_all_five_nonempty():
    seo, aeo, rec = await _upstream_fixtures()
    narr = deterministic_narratives(EXTRACTION, rec, seo, aeo, None)
    assert set(narr.keys()) == {
        "executive_summary", "company_overview", "website_summary", "seo_summary", "aeo_summary",
    }
    assert all(isinstance(v, str) and v.strip() for v in narr.values())
    assert "ABC Nissan" in narr["executive_summary"]
    assert "Automotive" in narr["company_overview"]


def test_deterministic_narratives_no_fabrication_on_empty():
    empty_rec = {"summary": {}, "groups": {}, "recommendations": []}
    narr = deterministic_narratives({}, empty_rec, {}, {}, None)
    # Company Overview must degrade to "Unknown", never invent facts.
    assert "Unknown" in narr["company_overview"]
    assert all(isinstance(v, str) and v.strip() for v in narr.values())


# ---- _common: structured assembly ------------------------------------------

@pytest.mark.asyncio
async def test_assemble_strengths_combines_aeo_and_seo_pass():
    seo, aeo, _ = await _upstream_fixtures()
    strengths = assemble_strengths(seo, aeo)
    aeo_count = len(aeo["strengths"])
    seo_pass = sum(1 for d in seo["dimensions"] if d["status"] == "PASS")
    assert len(strengths) == aeo_count + seo_pass
    assert all(s["source"] in ("seo", "aeo") for s in strengths)


@pytest.mark.asyncio
async def test_assemble_weaknesses_combines_aeo_and_seo_fail_warning():
    seo, aeo, _ = await _upstream_fixtures()
    weaknesses = assemble_weaknesses(seo, aeo)
    aeo_count = len(aeo["weaknesses"])
    seo_fw = sum(1 for d in seo["dimensions"] if d["status"] in ("FAIL", "WARNING"))
    assert len(weaknesses) == aeo_count + seo_fw


@pytest.mark.asyncio
async def test_extract_priority_fixes_equals_critical_plus_high():
    _, _, rec = await _upstream_fixtures()
    fixes = extract_priority_fixes(rec)
    assert len(fixes) == len(rec["groups"]["critical"]) + len(rec["groups"]["high"])


def test_assemble_technical_details_field_mapping():
    td = assemble_technical_details(EXTRACTION)
    assert td["has_ssl"] is True
    assert td["has_sitemap"] is True
    assert td["cms"] == "WordPress"
    assert td["frameworks"] == ["React"]
    assert td["analytics"] == ["GA4"]
    assert td["pages_crawled_count"] == 3
    assert "FAQPage" in td["schema_markup_types"]


# ---- _common: markdown ------------------------------------------------------

@pytest.mark.asyncio
async def test_render_markdown_contains_all_section_headings_and_score():
    seo, aeo, rec = await _upstream_fixtures()
    prepared = _prepared_from(seo, aeo, rec)
    final = await ReportGraph.ainvoke(service._initial_state(prepared))
    md = render_markdown(final["report_data"])
    for heading in SECTION_HEADINGS:
        assert f"## {heading}" in md
    assert "Combined Score:" in md
    assert "# SEO & AEO Report" in md


# ---- nodes ------------------------------------------------------------------

def test_load_inputs_node_rejects_missing_inputs():
    out = load_inputs_node({"recommendation_report_data": {}, "website_json": {}, "errors": []})
    assert out["status"] == "failed"


def test_load_inputs_node_accepts_present_inputs():
    assert load_inputs_node({"recommendation_report_data": {"a": 1}, "website_json": {"b": 2}, "errors": []}) == {}


@pytest.mark.asyncio
async def test_generate_narratives_node_uses_deterministic_without_key(monkeypatch):
    monkeypatch.setattr(llm, "GROK_API_KEY", "")
    seo, aeo, rec = await _upstream_fixtures()
    state = {
        "status": "queued", "website_json": EXTRACTION, "recommendation_report_data": rec,
        "seo_analysis_data": seo, "aeo_analysis_data": aeo, "company_summary": None,
    }
    out = generate_narratives_node(state)
    assert out["engine"] == "deterministic"
    assert set(out["narratives"].keys()) == {
        "executive_summary", "company_overview", "website_summary", "seo_summary", "aeo_summary",
    }


def test_nodes_skip_when_already_failed():
    assert generate_narratives_node({"status": "failed"}) == {}
    assert assemble_structured_node({"status": "failed"}) == {}
    assert build_report_node({"status": "failed"}) == {}
    assert render_markdown_node({"status": "failed"}) == {}


def test_validator_node_fails_on_schema_mismatch():
    out = validator_node({"report_data": {"executive_summary": 123}, "errors": []})
    assert out["status"] == "failed"
    assert any("schema_validation_failed" in e for e in out["errors"])


# ---- llm shape validation ---------------------------------------------------

def test_llm_valid_shape_accepts_exact_five_keys():
    good = {k: "prose" for k in
            ("executive_summary", "company_overview", "website_summary", "seo_summary", "aeo_summary")}
    assert llm._valid_shape(good) is True


def test_llm_valid_shape_rejects_partial_or_extra_keys():
    assert llm._valid_shape({"executive_summary": "x"}) is False  # missing keys
    extra = {k: "p" for k in ("executive_summary", "company_overview", "website_summary", "seo_summary", "aeo_summary")}
    extra["bogus"] = "y"
    assert llm._valid_shape(extra) is False
    empty_val = {k: "" for k in ("executive_summary", "company_overview", "website_summary", "seo_summary", "aeo_summary")}
    assert llm._valid_shape(empty_val) is False  # blank strings rejected


# ---- service.prepare_report eligibility ------------------------------------

@pytest.mark.asyncio
async def test_prepare_report_raises_when_extraction_missing(monkeypatch):
    async def fake_get_extraction(extraction_id, tenant_id):
        return None

    monkeypatch.setattr(service._data, "get_extraction", fake_get_extraction)
    with pytest.raises(ReportNotEligible):
        await service.prepare_report("t1", "e1")


@pytest.mark.asyncio
async def test_prepare_report_raises_when_extraction_not_ready(monkeypatch):
    async def fake_get_extraction(extraction_id, tenant_id):
        return {"status": "crawling", "context_id": "c1"}

    monkeypatch.setattr(service._data, "get_extraction", fake_get_extraction)
    with pytest.raises(ReportNotEligible):
        await service.prepare_report("t1", "e1")


@pytest.mark.asyncio
async def test_prepare_report_raises_when_no_ready_recommendation_report(monkeypatch):
    async def fake_get_extraction(extraction_id, tenant_id):
        return {"status": "ready", "context_id": "c1", "extraction_data": {}}

    async def fake_get_rec(extraction_id, tenant_id):
        return None

    monkeypatch.setattr(service._data, "get_extraction", fake_get_extraction)
    monkeypatch.setattr(service._data, "get_latest_ready_recommendation_report", fake_get_rec)
    with pytest.raises(ReportNotEligible):
        await service.prepare_report("t1", "e1")


# ---- full graph run ---------------------------------------------------------

@pytest.mark.asyncio
async def test_full_graph_run_produces_complete_report():
    seo, aeo, rec = await _upstream_fixtures()
    prepared = _prepared_from(seo, aeo, rec)
    initial = service._initial_state(prepared)
    final = await ReportGraph.ainvoke(initial)

    assert final["status"] == "ready"
    report = final["report_data"]
    # all 11 sections present
    for key in ("executive_summary", "company_overview", "website_summary", "seo_summary", "aeo_summary",
                "overall_score", "strengths", "weaknesses", "priority_fixes", "technical_details", "recommendations"):
        assert key in report
    assert report["meta"]["engine"] == "deterministic"
    assert report["meta"]["company_name"] == "ABC Nissan"
    assert final["overall_score"] == rec["summary"]["combined_score"]
    assert report["overall_score"]["combined_score"] == rec["summary"]["combined_score"]
    # recommendations pass through Phase 6 verbatim
    assert len(report["recommendations"]) == len(rec["recommendations"])
    # priority fixes = critical + high
    assert report["summary"]["priority_fix_count"] == len(rec["groups"]["critical"]) + len(rec["groups"]["high"])
    assert final["markdown_content"] and "## Executive Summary" in final["markdown_content"]
