"""Unit tests for the AEO Agent (Phase 5).

Covers all 11 pure analyzer functions (each agent's PASS/WARNING/FAIL
branches), the shared helpers (_common.py), the aggregate scoring formula,
the strengths/weaknesses partition, and build_node's exception-catching
behavior. Every analyzer is a pure function over a plain dict — no I/O, no
mocking needed.
"""
import pytest

from agents.aeo_agent._common import agent_result_key, build_node, rec, result, worst
from agents.aeo_agent.nodes import (
    aggregate_and_build_node,
    analyze_ai_readability,
    analyze_answer_quality,
    analyze_brand_context,
    analyze_citation_analysis,
    analyze_content_chunking,
    analyze_entity_detection,
    analyze_faq_analysis,
    analyze_llm_readability,
    analyze_question_detection,
    analyze_schema_analysis,
    analyze_trust_analysis,
    llm_semantic_analysis_node,
    load_extraction_node,
    validator_node,
)
from agents.aeo_agent.schema import AGENT_NAMES

GOOD_EXTRACTION = {
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
    "contact": {"emails": ["sales@abcnissan.in"], "phones": ["+911234567890"], "addresses": ["123 Main St"], "social_links": {}},
    "products": [{"name": "Magnite", "description": "A compact SUV built for the city streets."}],
    "services": [{"name": "Financing", "description": "Flexible financing options for every budget."}],
    "pages": [
        {"url": "https://example.com/", "title": "ABC Nissan", "type": "home"},
        {"url": "https://example.com/about", "title": "About Us", "type": "about"},
        {"url": "https://example.com/contact", "title": "Contact", "type": "contact"},
    ],
    "images": [],
    "videos": [],
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

EMPTY_EXTRACTION: dict = {}


# ---- shared helpers -----------------------------------------------------------

def test_worst_status_ranking():
    assert worst(["PASS", "WARNING", "FAIL"]) == "FAIL"
    assert worst(["PASS", "WARNING"]) == "WARNING"
    assert worst(["PASS", "PASS"]) == "PASS"
    assert worst([]) == "PASS"


def test_agent_result_key_derivation():
    assert agent_result_key("Entity Detection") == "entity_detection_result"
    assert agent_result_key("LLM Readability") == "llm_readability_result"
    assert agent_result_key("FAQ Analysis") == "faq_analysis_result"


def test_build_node_catches_analyzer_exception():
    def _boom(extraction):
        raise RuntimeError("kaboom")

    node = build_node("Entity Detection", "entity_detection_result", _boom)
    output = node({"extraction_data": {}})
    agent_result = output["entity_detection_result"]
    assert agent_result["status"] == "FAIL"
    assert "kaboom" in agent_result["recommendations"][0]["why_ai_may_fail"]


def test_build_node_passes_extraction_through():
    def _identity(extraction):
        return result("X", "PASS")

    node = build_node("X", "x_result", _identity)
    output = node({"extraction_data": GOOD_EXTRACTION})
    assert output["x_result"]["status"] == "PASS"


# ---- Entity Detection -----------------------------------------------------------

def test_entity_detection_fails_without_name_or_offerings():
    assert analyze_entity_detection({"company": {}, "products": [], "services": []})["status"] == "FAIL"


def test_entity_detection_warns_on_partial():
    assert analyze_entity_detection({"company": {"name": "ABC"}, "products": [], "services": []})["status"] == "WARNING"


def test_entity_detection_passes_on_full():
    assert analyze_entity_detection(GOOD_EXTRACTION)["status"] == "PASS"


# ---- Question Detection -----------------------------------------------------------

def test_question_detection_fails_on_empty_faq():
    assert analyze_question_detection({"faq": []})["status"] == "FAIL"


def test_question_detection_warns_on_thin_faq():
    faq = [{"question": "Do you finance?", "answer": "Yes."}]
    assert analyze_question_detection({"faq": faq})["status"] == "WARNING"


def test_question_detection_passes_on_good_data():
    assert analyze_question_detection(GOOD_EXTRACTION)["status"] == "PASS"


# ---- Answer Quality -----------------------------------------------------------

def test_answer_quality_fails_on_no_faq():
    assert analyze_answer_quality({"faq": []})["status"] == "FAIL"


def test_answer_quality_fails_when_none_substantial():
    faq = [{"question": "Q?", "answer": "Yes."}, {"question": "Q2?", "answer": "No."}]
    assert analyze_answer_quality({"faq": faq})["status"] == "FAIL"


def test_answer_quality_warns_on_partial():
    faq = [
        {"question": "Q?", "answer": "Yes."},
        {"question": "Q2?", "answer": "This is a much longer, substantive answer that clearly exceeds forty characters."},
    ]
    assert analyze_answer_quality({"faq": faq})["status"] == "WARNING"


def test_answer_quality_passes_with_caveat():
    r = analyze_answer_quality(GOOD_EXTRACTION)
    assert r["status"] == "PASS"
    assert len(r["recommendations"]) == 1  # caveat present even on PASS


def test_answer_quality_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"Answer Quality": {"agent": "Answer Quality", "status": "FAIL", "recommendations": []}}}
    assert analyze_answer_quality(extraction)["status"] == "FAIL"


# ---- llm_semantic_analysis_node: no-op without a configured LLM key ---------------

def test_llm_semantic_node_noop_without_llm_key(monkeypatch):
    monkeypatch.setattr("agents.aeo_agent.nodes.has_llm", lambda: False)
    assert llm_semantic_analysis_node({"extraction_data": GOOD_EXTRACTION}) == {}


def test_llm_semantic_node_noop_without_extraction_data():
    assert llm_semantic_analysis_node({"extraction_data": None}) == {}


def test_llm_semantic_node_falls_back_on_malformed_llm_response(monkeypatch):
    monkeypatch.setattr("agents.aeo_agent.nodes._llm_cache", {})  # content-hash cache is process-lifetime — isolate per test
    monkeypatch.setattr("agents.aeo_agent.nodes.has_llm", lambda: True)
    monkeypatch.setattr("agents.aeo_agent.nodes.llm_json", lambda *a, **k: {"not": "the expected shape"})
    assert llm_semantic_analysis_node({"extraction_data": GOOD_EXTRACTION}) == {}


def test_llm_semantic_node_merges_valid_response(monkeypatch):
    monkeypatch.setattr("agents.aeo_agent.nodes._llm_cache", {})  # content-hash cache is process-lifetime — isolate per test
    monkeypatch.setattr("agents.aeo_agent.nodes.has_llm", lambda: True)
    monkeypatch.setattr("agents.aeo_agent.nodes.llm_json", lambda *a, **k: {
        "Citation Analysis": {"status": "PASS", "recommendations": [
            {"why_ai_may_fail": "x", "how_to_improve": "y", "expected_impact": "low"}
        ]},
    })
    out = llm_semantic_analysis_node({"extraction_data": GOOD_EXTRACTION})
    assert out["extraction_data"]["_llm_semantic"]["Citation Analysis"]["status"] == "PASS"


# ---- FAQ Analysis -----------------------------------------------------------

def test_faq_analysis_warns_when_empty():
    assert analyze_faq_analysis({"faq": []})["status"] == "WARNING"


def test_faq_analysis_warns_when_thin_or_unstructured():
    faq = [{"question": "Q?", "answer": "A", "source": "heading_fallback"}]
    assert analyze_faq_analysis({"faq": faq})["status"] == "WARNING"


def test_faq_analysis_passes_on_good_data():
    assert analyze_faq_analysis(GOOD_EXTRACTION)["status"] == "PASS"


# ---- Citation Analysis -----------------------------------------------------------

def test_citation_analysis_always_warning():
    r = analyze_citation_analysis(GOOD_EXTRACTION)
    assert r["status"] == "WARNING"
    assert "cite" in r["recommendations"][0]["why_ai_may_fail"].lower()


def test_citation_analysis_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"Citation Analysis": {"agent": "Citation Analysis", "status": "PASS", "recommendations": []}}}
    assert analyze_citation_analysis(extraction)["status"] == "PASS"


# ---- Schema Analysis -----------------------------------------------------------

def test_schema_analysis_fails_when_no_types():
    assert analyze_schema_analysis({"technical_seo": {}, "products": [], "faq": [], "blog": {}})["status"] == "FAIL"


def test_schema_analysis_warns_on_partial_coverage():
    extraction = {**GOOD_EXTRACTION, "technical_seo": {**GOOD_EXTRACTION["technical_seo"], "schema_markup_types": ["Organization"]}}
    assert analyze_schema_analysis(extraction)["status"] == "WARNING"


def test_schema_analysis_passes_on_full_coverage():
    assert analyze_schema_analysis(GOOD_EXTRACTION)["status"] == "PASS"


# ---- AI Readability -----------------------------------------------------------

def test_ai_readability_fails_without_meta_signals():
    assert analyze_ai_readability({"technical_seo": {}, "pages": []})["status"] == "FAIL"


def test_ai_readability_warns_on_partial():
    extraction = {"technical_seo": {"meta_title": "Title"}, "pages": []}
    assert analyze_ai_readability(extraction)["status"] == "WARNING"


def test_ai_readability_passes_with_caveat():
    r = analyze_ai_readability(GOOD_EXTRACTION)
    assert r["status"] == "PASS"
    assert len(r["recommendations"]) == 1  # caveat present even on PASS


def test_ai_readability_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"AI Readability": {"agent": "AI Readability", "status": "FAIL", "recommendations": []}}}
    assert analyze_ai_readability(extraction)["status"] == "FAIL"


# ---- Content Chunking -----------------------------------------------------------

def test_content_chunking_fails_on_single_unit():
    assert analyze_content_chunking({"pages": [], "faq": [], "blog": {}})["status"] == "FAIL"


def test_content_chunking_warns_on_few_units():
    extraction = {"pages": [{"type": "home"}], "faq": [{"question": "Q?"}], "blog": {}}
    assert analyze_content_chunking(extraction)["status"] == "WARNING"


def test_content_chunking_passes_with_caveat():
    r = analyze_content_chunking(GOOD_EXTRACTION)
    assert r["status"] == "PASS"
    assert len(r["recommendations"]) == 1  # caveat present even on PASS


# ---- Trust Analysis -----------------------------------------------------------

def test_trust_analysis_fails_without_ssl_or_legal_pages():
    assert analyze_trust_analysis({"trust": {"has_ssl": False}})["status"] == "FAIL"


def test_trust_analysis_passes_on_full_signals():
    assert analyze_trust_analysis(GOOD_EXTRACTION)["status"] == "PASS"


# ---- LLM Readability -----------------------------------------------------------

def test_llm_readability_fails_on_no_free_text():
    assert analyze_llm_readability({"faq": [], "company": {}})["status"] == "FAIL"


def test_llm_readability_warns_on_low_in_band_fraction():
    extraction = {
        "faq": [{"answer": "Yes."}, {"answer": "A" * 400}],
        "company": {},
    }
    assert analyze_llm_readability(extraction)["status"] == "WARNING"


def test_llm_readability_passes_with_caveat():
    r = analyze_llm_readability(GOOD_EXTRACTION)
    assert r["status"] == "PASS"
    assert len(r["recommendations"]) == 1  # caveat present even on PASS


def test_llm_readability_prefers_llm_semantic_when_present():
    extraction = {**GOOD_EXTRACTION, "_llm_semantic": {"LLM Readability": {"agent": "LLM Readability", "status": "WARNING", "recommendations": []}}}
    assert analyze_llm_readability(extraction)["status"] == "WARNING"


# ---- Brand Context -----------------------------------------------------------

def test_brand_context_fails_without_name():
    assert analyze_brand_context({"company": {}})["status"] == "FAIL"


def test_brand_context_warns_without_description():
    assert analyze_brand_context({"company": {"name": "ABC"}})["status"] == "WARNING"


def test_brand_context_warns_on_partial_profile():
    assert analyze_brand_context({"company": {"name": "ABC", "description": "A dealer."}})["status"] == "WARNING"


def test_brand_context_passes_on_full():
    assert analyze_brand_context(GOOD_EXTRACTION)["status"] == "PASS"


# ---- load_extraction / aggregate / validator ------------------------------

def test_load_extraction_node_rejects_missing_data():
    out = load_extraction_node({"extraction_data": {}, "errors": []})
    assert out["status"] == "failed"


def test_load_extraction_node_accepts_present_data():
    assert load_extraction_node({"extraction_data": GOOD_EXTRACTION, "errors": []}) == {}


def _all_status_state(status: str) -> dict:
    state = {"status": "queued", "errors": []}
    for name in AGENT_NAMES:
        recs = [] if status == "PASS" else [rec("why", "how", "medium")]
        state[agent_result_key(name)] = result(name, status, recs)
    return state


def test_aggregate_scores_all_pass_as_100():
    out = aggregate_and_build_node(_all_status_state("PASS"))
    assert out["overall_score"] == 100
    assert out["analysis_data"]["summary"]["aeo_score"] == 100
    assert out["analysis_data"]["summary"]["pass_count"] == len(AGENT_NAMES)
    assert len(out["analysis_data"]["agents"]) == len(AGENT_NAMES)
    assert len(out["analysis_data"]["strengths"]) == len(AGENT_NAMES)
    assert out["analysis_data"]["weaknesses"] == []


def test_aggregate_scores_all_fail_as_zero():
    out = aggregate_and_build_node(_all_status_state("FAIL"))
    assert out["overall_score"] == 0
    assert out["analysis_data"]["summary"]["fail_count"] == len(AGENT_NAMES)
    assert out["analysis_data"]["strengths"] == []
    assert len(out["analysis_data"]["weaknesses"]) == len(AGENT_NAMES)


def test_aggregate_partitions_strengths_and_weaknesses():
    state = {"status": "queued", "errors": []}
    for i, name in enumerate(AGENT_NAMES):
        status = "PASS" if i % 2 == 0 else "WARNING"
        recs = [] if status == "PASS" else [rec("why", "how", "medium")]
        state[agent_result_key(name)] = result(name, status, recs)
    out = aggregate_and_build_node(state)
    summary = out["analysis_data"]["summary"]
    assert summary["pass_count"] + summary["warning_count"] == len(AGENT_NAMES)
    assert len(out["analysis_data"]["strengths"]) == summary["pass_count"]
    assert len(out["analysis_data"]["weaknesses"]) == summary["warning_count"]
    for weakness in out["analysis_data"]["weaknesses"]:
        assert weakness["recommendations"]


def test_aggregate_skips_when_already_failed():
    assert aggregate_and_build_node({"status": "failed", "errors": []}) == {}


def test_validator_passes_valid_data():
    state = _all_status_state("PASS")
    state.update(aggregate_and_build_node(state))
    out = validator_node(state)
    assert out == {}


def test_validator_fails_on_schema_mismatch():
    state = {"analysis_data": {"agents": "not-a-list", "strengths": [], "weaknesses": [], "summary": {}}, "errors": []}
    out = validator_node(state)
    assert out["status"] == "failed"
    assert any("schema_validation_failed" in e for e in out["errors"])


# ---- full graph run (network-free, mirrors seo_agent's approach) -----------

@pytest.mark.asyncio
async def test_full_graph_run_produces_11_agents(monkeypatch):
    from agents.aeo_agent.graph import AEOAnalysisGraph
    from agents.aeo_agent.service import _initial_state

    # Network-free regardless of local .env contents — this is also the
    # "all keys unset" env-var-matrix check: output must be identical to
    # pre-hybrid-change behavior when no LLM is configured.
    monkeypatch.setattr("agents.aeo_agent.nodes.has_llm", lambda: False)

    initial = _initial_state("a1", "t1", "c1", "e1", GOOD_EXTRACTION)
    final = await AEOAnalysisGraph.ainvoke(initial)
    assert final["status"] == "ready"
    assert len(final["analysis_data"]["agents"]) == len(AGENT_NAMES) == 11
    agent_names_in_output = {a["agent"] for a in final["analysis_data"]["agents"]}
    assert agent_names_in_output == set(AGENT_NAMES)
    assert len(final["analysis_data"]["strengths"]) + len(final["analysis_data"]["weaknesses"]) == 11
