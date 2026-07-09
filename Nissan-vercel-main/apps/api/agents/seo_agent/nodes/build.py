"""SEO Agent — bookkeeping nodes: load_extraction, aggregate_and_build,
validator.

load_extraction_node does no DB I/O — service.prepare_analysis() already
fetched extraction_data once, mirroring company_summary's load_extraction_node.
aggregate_and_build_node assembles the 24 analyzer results (computed by the
time this node runs, since it's last in the linear chain) into the final
SEOAnalysisResult and computes the overall score. validator_node
Pydantic-validates it, mirroring website_extraction's validator_node.
"""
from __future__ import annotations

from pydantic import ValidationError

from ..schema import DIMENSION_NAMES, SEOAnalysisResult
from ._common import dimension_result_key

_SCORE_POINTS = {"PASS": 2, "WARNING": 1, "FAIL": 0}
_MAX_POINTS_PER_DIMENSION = 2


def load_extraction_node(state: dict) -> dict:
    if not state.get("extraction_data"):
        return {"status": "failed", "errors": [*state.get("errors", []), "extraction_data missing or empty"]}
    return {}


def _grade_for(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 40:
        return "D"
    return "F"


def aggregate_and_build_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}  # load_extraction_node already rejected this run

    dimensions = []
    pass_count = warning_count = fail_count = 0
    points = 0

    for name in DIMENSION_NAMES:
        key = dimension_result_key(name)
        dim_result = state.get(key) or {"dimension": name, "status": "FAIL", "recommendations": []}
        dimensions.append(dim_result)
        status = dim_result.get("status", "FAIL")
        points += _SCORE_POINTS.get(status, 0)
        if status == "PASS":
            pass_count += 1
        elif status == "WARNING":
            warning_count += 1
        else:
            fail_count += 1

    overall_score = round(100 * points / (_MAX_POINTS_PER_DIMENSION * len(DIMENSION_NAMES)))

    analysis_data = {
        "dimensions": dimensions,
        "summary": {
            "pass_count": pass_count,
            "warning_count": warning_count,
            "fail_count": fail_count,
            "overall_score": overall_score,
            "grade": _grade_for(overall_score),
        },
    }
    return {"analysis_data": analysis_data, "overall_score": overall_score, "status": "ready"}


def validator_node(state: dict) -> dict:
    data = state.get("analysis_data")
    if not data:
        return {}  # already failed upstream — nothing to validate
    try:
        SEOAnalysisResult.model_validate(data)
    except ValidationError as exc:
        return {
            "status": "failed",
            "errors": [*state.get("errors", []), f"schema_validation_failed: {exc}"],
        }
    return {}
