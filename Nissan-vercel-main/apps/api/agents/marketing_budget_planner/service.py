"""Integration surface for the Marketing Budget Planner.

Synchronous, stateless: fetch the context's latest analysis (company summary +
generated report), derive a recommended budget, compute the full deterministic
plan, then optionally let Groq refine the prose. Never raises for the normal
"no analysis yet" case — the caller surfaces that as a friendly message.
"""
from __future__ import annotations

from . import budget, llm
from .data import BudgetPlannerData

_data = BudgetPlannerData()


class ContextNotFound(ValueError):
    """Raised when the context doesn't exist or isn't the tenant's."""


def _empty(context_id: str, user_budget: int) -> dict:
    return {
        "context_id": context_id,
        "status": "no_analysis",
        "engine": None,
        "currency": "INR",
        "recommended_budget": 0,
        "user_budget": user_budget,
        "budget_summary": None,
        "recommended_budget_breakdown": [],
        "optimized_budget_breakdown": [],
        "comparison_table": [],
        "execution_plan": [],
        "recommendations": [],
        "errors": ["No analysis found for this context yet. Run the Context Planner analysis first."],
    }


def _merge_prose(plan: dict, prose: dict) -> None:
    """Fold Groq's prose into the deterministic plan in place. Numbers untouched."""
    summary = plan.get("budget_summary") or {}
    if prose.get("explanation"):
        summary["explanation"] = prose["explanation"]
    if prose.get("optimization_note"):
        summary["optimization_note"] = prose["optimization_note"]

    rationales = prose.get("rationales") or {}
    for line in plan.get("recommended_budget_breakdown", []):
        if line["activity"] in rationales:
            line["rationale"] = rationales[line["activity"]]

    impacts = prose.get("impacts") or {}
    for task in plan.get("execution_plan", []):
        if task["task_name"] in impacts:
            task["expected_impact"] = impacts[task["task_name"]]

    # recommendations are NOT merged here — they're categorized deterministically
    # (best_channel/optimization/growth/risk/tip) by budget.py._recommendations()
    # so the dashboard can always render exactly one card per category; Groq
    # freeform text would lose that structure.


async def plan_budget(
    tenant_id: str,
    context_id: str,
    user_budget: int,
    objective: str | None = None,
    campaign_duration_days: int | None = None,
    target_audience: str | None = None,
    vehicle_category: str | None = None,
    preferred_channels: list[str] | None = None,
    region: str | None = None,
    skip_llm: bool = False,
) -> dict:
    context = await _data.get_context(context_id, tenant_id)
    if not context:
        raise ContextNotFound(f"context {context_id} not found")

    summary = await _data.get_latest_summary(context_id, tenant_id)
    report = await _data.get_latest_report(context_id, tenant_id)

    # The planner works off the recent analysis. If none exists yet, tell the
    # caller so the UI can nudge the user to run the analysis first.
    if not summary and not report:
        return _empty(context_id, user_budget)

    report_data = (report or {}).get("report_data") or {}
    overall = report_data.get("overall_score") or {}
    seo = overall.get("seo_score")
    aeo = overall.get("aeo_score")
    category = (summary or {}).get("industry") or context.get("industry")

    recommended = budget.derive_recommended(seo, aeo, category)
    payload = llm.build_input(
        context, summary, report, recommended, user_budget,
        objective=objective,
        campaign_duration_days=campaign_duration_days,
        target_audience=target_audience,
        vehicle_category=vehicle_category,
        preferred_channels=preferred_channels,
        region_override=region,
    )

    plan = budget.build_plan(payload)  # deterministic — owns every number

    engine = "deterministic"
    # skip_llm: used by What-If scenario comparisons — several budget amounts
    # compared side by side need only the numbers, not fresh prose each time.
    if llm.has_groq() and not skip_llm:
        try:
            prose = llm.generate_prose(payload, plan)
        except Exception:  # noqa: BLE001
            prose = None
        if prose:
            _merge_prose(plan, prose)
            engine = "groq"

    return {
        "context_id": context_id,
        "status": "ready",
        "engine": engine,
        "currency": "INR",
        "recommended_budget": plan.pop("_recommended_budget", recommended),
        "user_budget": plan.pop("_user_budget", user_budget),
        "budget_summary": plan["budget_summary"],
        "recommended_budget_breakdown": plan["recommended_budget_breakdown"],
        "optimized_budget_breakdown": plan["optimized_budget_breakdown"],
        "comparison_table": plan["comparison_table"],
        "execution_plan": plan["execution_plan"],
        "recommendations": plan["recommendations"],
        "business_impact": plan["business_impact"],
        "errors": [],
    }
