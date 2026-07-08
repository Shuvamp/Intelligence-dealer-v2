"""Unit tests for the Recommendation Engine (Phase 6).

Covers the shared helpers (_common.py: severity derivation, category
completeness, estimated-time bucketing, sort ordering), the 7 pipeline
nodes (normalize/merge/group/build/validate), service.py's prerequisite
checks, and a full network-free graph run.
"""
import pytest

from agents.aeo_agent.graph import AEOAnalysisGraph
from agents.aeo_agent.schema import AGENT_NAMES
from agents.aeo_agent.service import _initial_state as aeo_initial_state
from agents.recommendation_engine import service
from agents.recommendation_engine._common import (
    CATEGORY_MAP,
    category_for,
    derive_severity,
    estimated_time_for,
    grade_for,
    sort_key,
)
from agents.recommendation_engine.graph import RecommendationEngineGraph
from agents.recommendation_engine.nodes import (
    build_summary_node,
    group_by_severity_node,
    load_reports_node,
    merge_and_sort_node,
    normalize_aeo_node,
    normalize_seo_node,
    validator_node,
)
from agents.recommendation_engine.service import ReportNotEligible, _initial_state
from agents.seo_agent.graph import SEOAnalysisGraph
from agents.seo_agent.schema import DIMENSION_NAMES
from agents.seo_agent.service import _initial_state as seo_initial_state

# A moderately-filled extraction: enough substance to make most checks PASS
# (some with a caveat rec even on PASS), while several SEO/AEO checks with
# no exploitable signal (Performance, Keyword Analysis, Citation Analysis,
# etc.) still return their honest always-WARNING/caveated results.
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
    "images": [
        {"url": "/hero.jpg", "alt": "Showroom", "source_page": "https://example.com/"},
        {"url": "/team.jpg", "alt": "Our team", "source_page": "https://example.com/about"},
    ],
    "videos": [{"url": "https://youtube.com/embed/x", "platform": "youtube"}],
    "blog": {"has_blog": True, "post_count": 5, "recent_posts": []},
    "faq": [
        {
            "question": "Do you offer test drives at your dealership?",
            "answer": "Yes, we offer complimentary test drives for all vehicles in our showroom every day.",
            "source": "schema",
        },
        {
            "question": "What are your showroom operating hours?",
            "answer": "Our showroom is open from 9 AM to 6 PM daily, including weekends and public holidays.",
            "source": "schema",
        },
        {
            "question": "Do you provide financing options for new cars?",
            "answer": "Yes, we provide flexible financing plans through multiple partner banks and lenders.",
            "source": "schema",
        },
    ],
    "technology": {"cms": "WordPress", "analytics": [], "frameworks": [], "raw_signals": []},
    "technical_seo": {
        "has_sitemap": True, "has_robots_txt": True, "robots_txt_respected": True, "sitemap_used": True,
        "meta_title": "ABC Nissan Official — Chennai Car Dealer", "meta_description": "A" * 80,
        "canonical_url": "https://example.com/", "og_tags": {"og:title": "ABC Nissan"},
        "schema_markup_types": ["Organization", "LocalBusiness", "Product", "FAQPage", "Article"],
    },
    "trust": {
        "has_ssl": True, "has_privacy_policy": True, "has_terms": True,
        "certifications": ["ISO 9001"], "testimonials_count": 5,
    },
}


async def _real_seo_and_aeo_reports() -> tuple[dict, dict]:
    seo_final = await SEOAnalysisGraph.ainvoke(seo_initial_state("s1", "t1", "c1", "e1", EXTRACTION))
    aeo_final = await AEOAnalysisGraph.ainvoke(aeo_initial_state("a1", "t1", "c1", "e1", EXTRACTION))
    return seo_final["analysis_data"], aeo_final["analysis_data"]


# ---- _common.py -----------------------------------------------------------

def test_derive_severity_matrix():
    assert derive_severity("FAIL", "high") == "Critical"
    assert derive_severity("FAIL", "medium") == "High"
    assert derive_severity("FAIL", "low") == "Medium"
    assert derive_severity("WARNING", "high") == "High"
    assert derive_severity("WARNING", "medium") == "Medium"
    assert derive_severity("WARNING", "low") == "Low"
    assert derive_severity("PASS", "high") == "Low"
    assert derive_severity("PASS", "low") == "Low"


def test_estimated_time_for_buckets():
    assert estimated_time_for("low") == "1-2 hours"
    assert estimated_time_for("medium") == "1-3 days"
    assert estimated_time_for("high") == "1-2 weeks"
    assert estimated_time_for("unknown") == "Unscoped — no difficulty signal available"
    assert estimated_time_for("bogus") == estimated_time_for("unknown")


def test_category_map_covers_every_seo_dimension_and_aeo_agent():
    assert set(CATEGORY_MAP) == set(DIMENSION_NAMES) | set(AGENT_NAMES)


def test_category_for_unifies_overlapping_seo_and_aeo_concepts():
    # SEO "Trust" and AEO "Trust Analysis" should land in the same bucket —
    # the whole point of the curated taxonomy over a pass-through.
    assert category_for("Trust") == category_for("Trust Analysis")
    assert category_for("Schema") == category_for("Schema Analysis")
    assert category_for("unknown-name") == "Other"


def test_grade_for_bands():
    assert grade_for(95) == "A"
    assert grade_for(80) == "B"
    assert grade_for(65) == "C"
    assert grade_for(45) == "D"
    assert grade_for(10) == "F"


def test_sort_key_orders_severity_then_priority_desc():
    items = [
        {"severity": "Low", "priority": "high"},
        {"severity": "Critical", "priority": "low"},
        {"severity": "High", "priority": "high"},
        {"severity": "High", "priority": "low"},
    ]
    ordered = sorted(items, key=sort_key)
    assert [i["severity"] for i in ordered] == ["Critical", "High", "High", "Low"]
    assert ordered[1]["priority"] == "high"  # High+high before High+low
    assert ordered[2]["priority"] == "low"


# ---- normalize_seo_node / normalize_aeo_node -------------------------------

@pytest.mark.asyncio
async def test_normalize_seo_preserves_pass_time_caveats_and_marks_aeo_not_applicable():
    seo_data, _ = await _real_seo_and_aeo_reports()
    out = normalize_seo_node({"seo_analysis_data": seo_data, "status": "queued"})
    items = out["seo_items"]
    assert items  # non-empty
    assert all(i["source"] == "seo" for i in items)
    assert all(i["expected_aeo_impact"] == "not_applicable" for i in items)
    # Security's PASS branch always carries one caveat recommendation.
    security_dim = next(d for d in seo_data["dimensions"] if d["dimension"] == "Security")
    assert security_dim["status"] == "PASS"
    assert security_dim["recommendations"]  # the caveat itself
    security_items = [i for i in items if i["category"] == category_for("Security")]
    assert security_items  # the PASS-time caveat was not dropped


@pytest.mark.asyncio
async def test_normalize_aeo_marks_seo_not_applicable_and_difficulty_unknown():
    _, aeo_data = await _real_seo_and_aeo_reports()
    out = normalize_aeo_node({"aeo_analysis_data": aeo_data, "status": "queued"})
    items = out["aeo_items"]
    assert items  # non-empty (Citation Analysis alone guarantees this)
    assert all(i["source"] == "aeo" for i in items)
    assert all(i["expected_seo_impact"] == "not_applicable" for i in items)
    assert all(i["difficulty"] == "unknown" for i in items)
    assert all(i["estimated_time"] == estimated_time_for("unknown") for i in items)
    citation_items = [i for i in items if i["category"] == category_for("Citation Analysis")]
    assert citation_items  # Citation Analysis is always WARNING with a recommendation


def test_normalize_nodes_skip_when_already_failed():
    assert normalize_seo_node({"status": "failed"}) == {}
    assert normalize_aeo_node({"status": "failed"}) == {}


# ---- merge_and_sort_node / group_by_severity_node --------------------------

def test_merge_and_sort_node_concatenates_and_sorts():
    state = {
        "status": "queued",
        "seo_items": [{"severity": "Low", "priority": "low", "source": "seo"}],
        "aeo_items": [{"severity": "Critical", "priority": "high", "source": "aeo"}],
    }
    out = merge_and_sort_node(state)
    merged = out["merged_items"]
    assert len(merged) == 2
    assert merged[0]["severity"] == "Critical"
    assert merged[1]["severity"] == "Low"


def test_group_by_severity_node_partitions_correctly():
    state = {
        "status": "queued",
        "merged_items": [
            {"severity": "Critical"}, {"severity": "High"}, {"severity": "High"},
            {"severity": "Medium"}, {"severity": "Low"}, {"severity": "Low"}, {"severity": "Low"},
        ],
    }
    out = group_by_severity_node(state)
    groups = out["severity_groups"]
    assert len(groups["critical"]) == 1
    assert len(groups["high"]) == 2
    assert len(groups["medium"]) == 1
    assert len(groups["low"]) == 3


def test_merge_and_group_skip_when_already_failed():
    assert merge_and_sort_node({"status": "failed"}) == {}
    assert group_by_severity_node({"status": "failed"}) == {}


# ---- build_summary_node / validator_node -----------------------------------

def test_build_summary_node_averages_scores_and_counts_reconcile():
    state = {
        "status": "queued",
        "merged_items": [{"a": 1}, {"a": 2}, {"a": 3}],
        "severity_groups": {"critical": [{"a": 1}], "high": [], "medium": [{"a": 2}], "low": [{"a": 3}]},
        "seo_overall_score": 80,
        "aeo_overall_score": 40,
        "website_json": {"company": {"name": "ABC Nissan"}},
    }
    out = build_summary_node(state)
    assert out["combined_score"] == 60
    summary = out["report_data"]["summary"]
    assert summary["combined_score"] == 60
    assert summary["combined_grade"] == grade_for(60)
    assert summary["total_count"] == 3
    assert summary["critical_count"] + summary["high_count"] + summary["medium_count"] + summary["low_count"] == 3
    assert out["report_data"]["company_name"] == "ABC Nissan"
    assert out["status"] == "ready"


def test_build_summary_node_skips_when_already_failed():
    assert build_summary_node({"status": "failed"}) == {}


def test_validator_node_passes_valid_data():
    state = {
        "report_data": {
            "recommendations": [],
            "groups": {"critical": [], "high": [], "medium": [], "low": []},
            "summary": {
                "total_count": 0, "critical_count": 0, "high_count": 0, "medium_count": 0, "low_count": 0,
                "seo_score": 50, "aeo_score": 50, "combined_score": 50, "combined_grade": "D",
            },
        },
        "errors": [],
    }
    assert validator_node(state) == {}


def test_validator_node_fails_on_schema_mismatch():
    state = {"report_data": {"recommendations": "not-a-list", "groups": {}, "summary": {}}, "errors": []}
    out = validator_node(state)
    assert out["status"] == "failed"
    assert any("schema_validation_failed" in e for e in out["errors"])


def test_load_reports_node_rejects_missing_reports():
    out = load_reports_node({"seo_analysis_data": {}, "aeo_analysis_data": {"agents": []}, "errors": []})
    assert out["status"] == "failed"


def test_load_reports_node_accepts_present_reports():
    assert load_reports_node({"seo_analysis_data": {"dimensions": []}, "aeo_analysis_data": {"agents": []}, "errors": []}) == {}


# ---- service.py prerequisites ----------------------------------------------

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
async def test_prepare_report_raises_when_no_ready_seo_analysis(monkeypatch):
    async def fake_get_extraction(extraction_id, tenant_id):
        return {"status": "ready", "context_id": "c1", "extraction_data": {}}

    async def fake_get_seo(extraction_id, tenant_id):
        return None

    monkeypatch.setattr(service._data, "get_extraction", fake_get_extraction)
    monkeypatch.setattr(service._data, "get_latest_ready_seo_analysis", fake_get_seo)
    with pytest.raises(ReportNotEligible):
        await service.prepare_report("t1", "e1")


@pytest.mark.asyncio
async def test_prepare_report_raises_when_no_ready_aeo_analysis(monkeypatch):
    async def fake_get_extraction(extraction_id, tenant_id):
        return {"status": "ready", "context_id": "c1", "extraction_data": {}}

    async def fake_get_seo(extraction_id, tenant_id):
        return {"id": "s1", "analysis_data": {"dimensions": []}, "overall_score": 50}

    async def fake_get_aeo(extraction_id, tenant_id):
        return None

    monkeypatch.setattr(service._data, "get_extraction", fake_get_extraction)
    monkeypatch.setattr(service._data, "get_latest_ready_seo_analysis", fake_get_seo)
    monkeypatch.setattr(service._data, "get_latest_ready_aeo_analysis", fake_get_aeo)
    with pytest.raises(ReportNotEligible):
        await service.prepare_report("t1", "e1")


# ---- full graph run (network-free, mirrors seo_agent/aeo_agent's approach) --

@pytest.mark.asyncio
async def test_full_graph_run_produces_consolidated_report():
    seo_data, aeo_data = await _real_seo_and_aeo_reports()
    initial = _initial_state(
        "r1", "t1", "c1", "e1", "s1", "a1",
        EXTRACTION, seo_data, aeo_data,
        seo_data["summary"]["overall_score"], aeo_data["summary"]["aeo_score"],
    )
    final = await RecommendationEngineGraph.ainvoke(initial)

    assert final["status"] == "ready"
    report = final["report_data"]
    assert report["company_name"] == "ABC Nissan"
    assert report["recommendations"]  # non-empty (several always-WARNING checks guarantee this)
    groups = report["groups"]
    assert (
        len(groups["critical"]) + len(groups["high"]) + len(groups["medium"]) + len(groups["low"])
        == len(report["recommendations"])
        == report["summary"]["total_count"]
    )
    assert report["summary"]["combined_score"] == round(
        (seo_data["summary"]["overall_score"] + aeo_data["summary"]["aeo_score"]) / 2
    )
    # every item has the full unified shape
    for item in report["recommendations"]:
        assert item["source"] in ("seo", "aeo")
        assert item["severity"] in ("Critical", "High", "Medium", "Low")
        assert item["category"] in set(CATEGORY_MAP.values())
