"""Report Generator — the 6-node transformation pipeline: load the upstream
inputs, generate the 5 narrative prose sections (Groq or deterministic),
assemble the 6 structured sections deterministically, build the full report,
render the stored Markdown artifact, and validate.

Like recommendation_engine (Phase 6), this operates over already-computed
upstream reports — a short linear pipeline with a real sequential data
dependency, not an analyzer fan-out, so it's 6 sequential nodes in one file.
Every node no-ops if a prior node set status='failed'.
"""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import ValidationError

from . import llm
from ._common import (
    assemble_strengths,
    assemble_technical_details,
    assemble_weaknesses,
    company_name_of,
    deterministic_narratives,
    extract_priority_fixes,
    render_markdown,
    website_url_of,
)
from .schema import ReportResult


def load_inputs_node(state: dict) -> dict:
    """No DB I/O — service.prepare_report() already fetched everything once."""
    if not state.get("recommendation_report_data") or not state.get("website_json"):
        return {
            "status": "failed",
            "errors": [*state.get("errors", []), "recommendation_report_data or website_json missing or empty"],
        }
    return {}


def generate_narratives_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}

    website_json = state.get("website_json") or {}
    rec_data = state.get("recommendation_report_data") or {}
    seo_data = state.get("seo_analysis_data") or {}
    aeo_data = state.get("aeo_analysis_data") or {}
    company_summary = state.get("company_summary")

    narratives = None
    engine = "deterministic"
    if llm.has_groq():
        try:
            narratives = llm.generate_narratives(website_json, rec_data, seo_data, aeo_data, company_summary)
        except Exception:  # noqa: BLE001
            narratives = None
        if narratives:
            engine = "groq"

    if not narratives:
        narratives = deterministic_narratives(website_json, rec_data, seo_data, aeo_data, company_summary)
        engine = "deterministic"

    return {"narratives": narratives, "engine": engine}


def assemble_structured_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}

    website_json = state.get("website_json") or {}
    rec_data = state.get("recommendation_report_data") or {}
    seo_data = state.get("seo_analysis_data") or {}
    aeo_data = state.get("aeo_analysis_data") or {}

    rec_summary = rec_data.get("summary") or {}
    structured = {
        "overall_score": {
            "combined_score": rec_summary.get("combined_score", state.get("combined_score") or 0),
            "combined_grade": rec_summary.get("combined_grade", "F"),
            "seo_score": rec_summary.get("seo_score", state.get("seo_score") or 0),
            "aeo_score": rec_summary.get("aeo_score", state.get("aeo_score") or 0),
        },
        "strengths": assemble_strengths(seo_data, aeo_data),
        "weaknesses": assemble_weaknesses(seo_data, aeo_data),
        "priority_fixes": extract_priority_fixes(rec_data),
        "technical_details": assemble_technical_details(website_json),
        "recommendations": rec_data.get("recommendations") or [],
    }
    return {"structured": structured}


def build_report_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}

    narratives = state.get("narratives") or {}
    structured = state.get("structured") or {}
    website_json = state.get("website_json") or {}
    company_summary = state.get("company_summary")

    strengths = structured.get("strengths") or []
    weaknesses = structured.get("weaknesses") or []
    priority_fixes = structured.get("priority_fixes") or []
    recommendations = structured.get("recommendations") or []
    overall_score = structured.get("overall_score") or {}

    rec_summary = (state.get("recommendation_report_data") or {}).get("summary") or {}
    combined_score = overall_score.get("combined_score", 0)

    report_data = {
        "executive_summary": narratives.get("executive_summary", ""),
        "company_overview": narratives.get("company_overview", ""),
        "website_summary": narratives.get("website_summary", ""),
        "seo_summary": narratives.get("seo_summary", ""),
        "aeo_summary": narratives.get("aeo_summary", ""),
        "overall_score": overall_score,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "priority_fixes": priority_fixes,
        "technical_details": structured.get("technical_details") or {},
        "recommendations": recommendations,
        "summary": {
            "total_recommendations": len(recommendations),
            "critical_count": rec_summary.get("critical_count", 0),
            "high_count": rec_summary.get("high_count", 0),
            "medium_count": rec_summary.get("medium_count", 0),
            "low_count": rec_summary.get("low_count", 0),
            "priority_fix_count": len(priority_fixes),
            "strength_count": len(strengths),
            "weakness_count": len(weaknesses),
        },
        "meta": {
            "company_name": company_name_of(website_json, company_summary),
            "website": website_url_of(website_json),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "engine": state.get("engine", "deterministic"),
        },
    }
    return {"report_data": report_data, "overall_score": combined_score, "status": "ready"}


def render_markdown_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}
    report_data = state.get("report_data")
    if not report_data:
        return {}
    return {"markdown_content": render_markdown(report_data)}


def validator_node(state: dict) -> dict:
    data = state.get("report_data")
    if not data:
        return {}  # already failed upstream — nothing to validate
    try:
        ReportResult.model_validate(data)
    except ValidationError as exc:
        return {
            "status": "failed",
            "errors": [*state.get("errors", []), f"schema_validation_failed: {exc}"],
        }
    return {}
