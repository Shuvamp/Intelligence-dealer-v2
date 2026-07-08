"""Unit tests for the Company Summary Agent (Phase 3).

Covers the pure/deterministic surface: shape validation, the deterministic
fallback (the "never hallucinate" path), and node behavior with the Groq
call mocked/absent. Actual Groq network calls and DB I/O are left
untested/mocked, matching this codebase's existing convention.
"""
import pytest

from agents.company_summary import llm, nodes
from agents.company_summary.nodes import generate_summary_node, load_extraction_node, store_summary_node

SAMPLE_EXTRACTION = {
    "website": {"url": "https://example.com", "final_url": "https://example.com/", "domain": "example.com"},
    "company": {"name": "ABC Nissan", "description": "Nissan dealer in Chennai.", "region": None, "industry": None},
    "contact": {"addresses": ["123 Main St, Chennai"]},
    "products": [{"name": "Magnite"}, {"name": "Kicks"}],
    "services": [{"name": "Financing"}],
    "pages": [{"title": "Home"}, {"title": "About Us"}],
}


# ---- llm._valid_shape --------------------------------------------------------

VALID_SHAPE = {
    "company_name": "ABC Nissan", "region": "Unknown", "industry": "Unknown",
    "products": ["Magnite"], "services": ["Financing"],
    "description": "A dealer.", "verdict": "A solid local dealer.",
}


def test_valid_shape_accepts_correct_dict():
    assert llm._valid_shape(VALID_SHAPE) is True


def test_valid_shape_rejects_missing_key():
    bad = {k: v for k, v in VALID_SHAPE.items() if k != "verdict"}
    assert llm._valid_shape(bad) is False


def test_valid_shape_rejects_extra_key():
    bad = {**VALID_SHAPE, "extra": "nope"}
    assert llm._valid_shape(bad) is False


def test_valid_shape_rejects_wrong_type_for_scalar_field():
    bad = {**VALID_SHAPE, "region": 123}
    assert llm._valid_shape(bad) is False


def test_valid_shape_rejects_non_string_list_items():
    bad = {**VALID_SHAPE, "products": [1, 2]}
    assert llm._valid_shape(bad) is False


def test_valid_shape_rejects_non_list_for_products():
    bad = {**VALID_SHAPE, "products": "Magnite"}
    assert llm._valid_shape(bad) is False


# ---- llm.deterministic_summary ------------------------------------------------

def test_deterministic_summary_pulls_present_fields():
    result = llm.deterministic_summary(SAMPLE_EXTRACTION)
    assert result["company_name"] == "ABC Nissan"
    assert result["description"] == "Nissan dealer in Chennai."
    assert result["products"] == ["Magnite", "Kicks"]
    assert result["services"] == ["Financing"]


def test_deterministic_summary_uses_unknown_for_missing_fields():
    result = llm.deterministic_summary(SAMPLE_EXTRACTION)
    assert result["region"] == "Unknown"
    assert result["industry"] == "Unknown"


def test_deterministic_summary_verdict_is_always_unknown():
    result = llm.deterministic_summary(SAMPLE_EXTRACTION)
    assert result["verdict"] == "Unknown"


def test_deterministic_summary_empty_extraction_is_all_unknown():
    result = llm.deterministic_summary({})
    assert result["company_name"] == "Unknown"
    assert result["region"] == "Unknown"
    assert result["industry"] == "Unknown"
    assert result["description"] == "Unknown"
    assert result["verdict"] == "Unknown"
    assert result["products"] == ["Unknown"]
    assert result["services"] == ["Unknown"]


def test_deterministic_summary_caps_products_and_services():
    big_extraction = {
        "company": {},
        "products": [{"name": f"p{i}"} for i in range(30)],
        "services": [{"name": f"s{i}"} for i in range(30)],
    }
    result = llm.deterministic_summary(big_extraction)
    assert len(result["products"]) == 20
    assert len(result["services"]) == 20


# ---- has_groq -----------------------------------------------------------------

def test_has_groq_false_when_no_key(monkeypatch):
    monkeypatch.setattr(llm, "GROK_API_KEY", "")
    assert llm.has_groq() is False


def test_has_groq_true_when_key_set(monkeypatch):
    monkeypatch.setattr(llm, "GROK_API_KEY", "fake-key")
    assert llm.has_groq() is True


def test_generate_summary_returns_none_without_key(monkeypatch):
    monkeypatch.setattr(llm, "GROK_API_KEY", "")
    assert llm.generate_summary(SAMPLE_EXTRACTION) is None


# ---- nodes.load_extraction_node -----------------------------------------------

def test_load_extraction_node_rejects_missing_data():
    result = load_extraction_node({"extraction_data": {}, "errors": []})
    assert result["status"] == "failed"
    assert any("extraction_data" in e for e in result["errors"])


def test_load_extraction_node_accepts_present_data():
    result = load_extraction_node({"extraction_data": SAMPLE_EXTRACTION, "errors": []})
    assert result == {}


# ---- nodes.generate_summary_node ----------------------------------------------

def test_generate_summary_node_uses_deterministic_when_groq_unavailable(monkeypatch):
    monkeypatch.setattr(nodes.llm, "generate_summary", lambda extraction: None)
    state = {"extraction_data": SAMPLE_EXTRACTION, "status": "pending", "errors": []}
    result = generate_summary_node(state)
    assert result["engine"] == "deterministic"
    assert result["status"] == "ready"
    assert result["company_name"] == "ABC Nissan"


def test_generate_summary_node_uses_groq_result_when_valid(monkeypatch):
    monkeypatch.setattr(nodes.llm, "generate_summary", lambda extraction: VALID_SHAPE)
    state = {"extraction_data": SAMPLE_EXTRACTION, "status": "pending", "errors": []}
    result = generate_summary_node(state)
    assert result["engine"] == "groq"
    assert result["verdict"] == "A solid local dealer."


def test_generate_summary_node_website_comes_from_extraction_never_llm(monkeypatch):
    """website is always taken directly from extraction_data — never asked
    of the LLM at all, eliminating hallucination risk for that one field."""
    monkeypatch.setattr(nodes.llm, "generate_summary", lambda extraction: VALID_SHAPE)
    state = {"extraction_data": SAMPLE_EXTRACTION, "status": "pending", "errors": []}
    result = generate_summary_node(state)
    assert result["website"] == "https://example.com/"


def test_generate_summary_node_skips_when_already_failed():
    state = {"extraction_data": {}, "status": "failed", "errors": ["extraction_data missing or empty"]}
    result = generate_summary_node(state)
    assert result == {}


# ---- nodes.store_summary_node (DB mocked) -------------------------------------

@pytest.mark.asyncio
async def test_store_summary_node_persists_ready_state(monkeypatch):
    captured = {}

    async def fake_update_summary(summary_id, patch):
        captured["summary_id"] = summary_id
        captured["patch"] = patch

    monkeypatch.setattr(nodes._data, "update_summary", fake_update_summary)
    state = {
        "summary_id": "sid-1", "status": "ready", "errors": [],
        "company_name": "ABC Nissan", "website": "https://example.com/",
        "region": "Unknown", "industry": "Unknown",
        "products": ["Magnite"], "services": ["Financing"],
        "description": "desc", "verdict": "verdict",
    }
    result = await store_summary_node(state)
    assert result == {}
    assert captured["summary_id"] == "sid-1"
    assert captured["patch"]["status"] == "ready"
    assert captured["patch"]["company_name"] == "ABC Nissan"


@pytest.mark.asyncio
async def test_store_summary_node_degrades_on_write_failure(monkeypatch):
    async def failing_update_summary(summary_id, patch):
        raise ConnectionError("db unreachable")

    monkeypatch.setattr(nodes._data, "update_summary", failing_update_summary)
    state = {
        "summary_id": "sid-2", "status": "ready", "errors": [],
        "company_name": "ABC Nissan", "website": "https://example.com/",
        "region": "Unknown", "industry": "Unknown",
        "products": ["Magnite"], "services": ["Financing"],
        "description": "desc", "verdict": "verdict",
    }
    result = await store_summary_node(state)
    assert result["status"] == "failed"
    assert any("store_failed" in e for e in result["errors"])
