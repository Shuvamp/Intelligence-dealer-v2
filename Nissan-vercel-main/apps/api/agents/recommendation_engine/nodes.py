"""Recommendation Engine — the 7-node transformation pipeline: load the two
already-computed reports, normalize each into the unified 10-field
`RecommendationItem` shape, merge+sort, group by severity, build the final
JSON, and validate it.

Unlike seo_agent/aeo_agent (N independent per-check analyzer nodes fanning
out over the raw Website Extraction JSON), this phase operates over TWO
already-computed reports — a short linear transformation pipeline, not an
analyzer fan-out, so it's modeled as 7 sequential nodes in one file rather
than N per-check nodes in a `nodes/` package.
"""
from __future__ import annotations

from pydantic import ValidationError

from ._common import category_for, derive_severity, estimated_time_for, grade_for, sort_key
from .schema import RecommendationReportResult


def load_reports_node(state: dict) -> dict:
    """No DB I/O — service.prepare_report() already fetched both reports and
    the extraction once, mirroring every prior phase's load_extraction_node."""
    if not state.get("seo_analysis_data") or not state.get("aeo_analysis_data"):
        return {
            "status": "failed",
            "errors": [*state.get("errors", []), "seo_analysis_data or aeo_analysis_data missing or empty"],
        }
    return {}


def normalize_seo_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}

    seo_data = state.get("seo_analysis_data") or {}
    items: list[dict] = []
    for dim in seo_data.get("dimensions") or []:
        dimension_name = dim.get("dimension", "")
        status = dim.get("status", "FAIL")
        for rec in dim.get("recommendations") or []:
            level = rec.get("priority", "medium")
            difficulty = rec.get("difficulty", "unknown")
            items.append({
                "severity": derive_severity(status, level),
                "priority": level,
                "problem": rec.get("problem", ""),
                "reason": rec.get("reason", ""),
                "fix": rec.get("recommendation", ""),
                "estimated_time": estimated_time_for(difficulty),
                "expected_seo_impact": rec.get("estimated_impact", "medium"),
                "expected_aeo_impact": "not_applicable",
                "difficulty": difficulty,
                "category": category_for(dimension_name),
                "source": "seo",
            })
    return {"seo_items": items}


def normalize_aeo_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}

    aeo_data = state.get("aeo_analysis_data") or {}
    items: list[dict] = []
    for agent_result in aeo_data.get("agents") or []:
        agent_name = agent_result.get("agent", "")
        status = agent_result.get("status", "FAIL")
        for rec in agent_result.get("recommendations") or []:
            level = rec.get("expected_impact", "medium")
            items.append({
                "severity": derive_severity(status, level),
                # AEO's closest analogous existing signal — reused as priority,
                # not fabricated (AEO recommendations carry no separate priority field).
                "priority": level,
                "problem": rec.get("why_ai_may_fail", ""),
                # AEO has only one explanatory field; duplicating it into both
                # problem and reason is honest (real signal), not invented text.
                "reason": rec.get("why_ai_may_fail", ""),
                "fix": rec.get("how_to_improve", ""),
                # AEO carries no difficulty signal at all — always the honest
                # "unknown" bucket, never guessed.
                "estimated_time": estimated_time_for("unknown"),
                "expected_seo_impact": "not_applicable",
                "expected_aeo_impact": level,
                "difficulty": "unknown",
                "category": category_for(agent_name),
                "source": "aeo",
            })
    return {"aeo_items": items}


def merge_and_sort_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}
    merged = [*(state.get("seo_items") or []), *(state.get("aeo_items") or [])]
    merged.sort(key=sort_key)
    return {"merged_items": merged}


def group_by_severity_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}
    groups: dict[str, list[dict]] = {"critical": [], "high": [], "medium": [], "low": []}
    for item in state.get("merged_items") or []:
        key = (item.get("severity") or "Low").lower()
        groups.setdefault(key, []).append(item)
    return {"severity_groups": groups}


def build_summary_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}

    merged = state.get("merged_items") or []
    groups = state.get("severity_groups") or {"critical": [], "high": [], "medium": [], "low": []}
    seo_score = state.get("seo_overall_score") or 0
    aeo_score = state.get("aeo_overall_score") or 0
    combined_score = round((seo_score + aeo_score) / 2)

    website_json = state.get("website_json") or {}
    company_name = (website_json.get("company") or {}).get("name")

    report_data = {
        "company_name": company_name,
        "recommendations": merged,
        "groups": groups,
        "summary": {
            "total_count": len(merged),
            "critical_count": len(groups.get("critical", [])),
            "high_count": len(groups.get("high", [])),
            "medium_count": len(groups.get("medium", [])),
            "low_count": len(groups.get("low", [])),
            "seo_score": seo_score,
            "aeo_score": aeo_score,
            "combined_score": combined_score,
            "combined_grade": grade_for(combined_score),
        },
    }
    return {"report_data": report_data, "combined_score": combined_score, "status": "ready"}


def validator_node(state: dict) -> dict:
    data = state.get("report_data")
    if not data:
        return {}  # already failed upstream — nothing to validate
    try:
        RecommendationReportResult.model_validate(data)
    except ValidationError as exc:
        return {
            "status": "failed",
            "errors": [*state.get("errors", []), f"schema_validation_failed: {exc}"],
        }
    return {}
