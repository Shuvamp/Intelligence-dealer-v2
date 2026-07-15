"""Marketing Budget Planner — Groq-direct narrative refinement + no-key fallback.

Mirrors marketing_strategy/llm.py: Groq-direct via httpx (GROK_API_KEY/GROK_MODEL),
JSON response, never raises. The BUDGET MATHS is owned by budget.py and is always
deterministic — Groq only rewrites the prose (the summary text, per-activity
rationales, per-task impacts, and strategic recommendations) so the two hard rules
(allocation sums to the recommended budget; optimized total ≤ user budget) can never
be broken by the model. Returns None when unconfigured / the call fails / the shape
is wrong, and the caller keeps the deterministic prose.
"""
from __future__ import annotations

import json
import logging

import httpx

from app.config import GROK_API_KEY, GROK_MODEL

logger = logging.getLogger(__name__)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = """You are an expert Digital Marketing Strategist and Performance Marketing Consultant
advising a car dealership in India. All money is in INR (₹).

You are given a JSON object with: the business profile, the results of a website SEO/AEO analysis
(scores, strengths, weaknesses, recommendations — ALREADY COMPUTED), and a marketing budget plan whose
NUMBERS ARE FINAL AND FIXED (recommended budget, per-activity allocation, the optimized allocation that
fits the user's budget, and a task list).

Your ONLY job is to write clear, persuasive NARRATIVE that explains the fixed plan. You MUST NOT change,
recompute, or contradict any number, and you MUST NOT perform or re-run any SEO/AEO analysis or re-score
anything. Keep language warm, plain, practical and ROI-focused. If the input includes a "campaign" block
with an objective, target_audience, or vehicle_category, weave those into the explanation and rationales
(e.g. "for lead generation among first-time buyers") — but only when present; never invent them.

Return ONLY a single JSON object with EXACTLY these keys:
{
  "explanation": "2-4 sentences on WHY the recommended monthly budget is appropriate, referencing the scores and category.",
  "optimization_note": "2-3 sentences on how the plan was optimized to fit the user's budget (what was prioritized, deferred, excluded).",
  "rationales": { "<activity name>": "1 sentence on why this activity earns its allocation", ... },
  "impacts": { "<task name>": "1 short sentence on the expected business impact of this task", ... }
}
Do NOT include a "recommendations" key — those are generated separately and categorized; freeform
recommendations here would be dropped. Use the EXACT activity names and task names from the input.
No markdown fences, no extra keys, no commentary."""


def has_groq() -> bool:
    return bool(GROK_API_KEY)


def build_input(
    context: dict | None,
    summary: dict | None,
    report: dict | None,
    recommended_budget: int,
    user_budget: int,
    objective: str | None = None,
    campaign_duration_days: int | None = None,
    target_audience: str | None = None,
    vehicle_category: str | None = None,
    preferred_channels: list[str] | None = None,
    region_override: str | None = None,
) -> dict:
    context = context or {}
    summary = summary or {}
    report_data = (report or {}).get("report_data") or {}
    overall = report_data.get("overall_score") or {}

    strengths = [
        {"title": s.get("title"), "detail": s.get("detail")}
        for s in (report_data.get("strengths") or [])
    ][:8]
    weaknesses = [
        {"title": w.get("title"), "detail": w.get("detail")}
        for w in (report_data.get("weaknesses") or [])
    ][:8]
    recommendations = [
        {"problem": r.get("problem"), "fix": r.get("fix"), "category": r.get("category"), "priority": r.get("priority")}
        for r in ((report_data.get("priority_fixes") or []) + (report_data.get("recommendations") or []))
    ][:10]

    return {
        "business": {
            "company_name": summary.get("company_name") or context.get("company_name"),
            "industry": summary.get("industry") or context.get("industry") or "Automotive Dealership",
            "region": region_override or summary.get("region") or context.get("region"),
            "website": summary.get("website") or context.get("website") or context.get("url"),
            "description": summary.get("description") or context.get("description"),
            "products": summary.get("products") or [],
            "services": summary.get("services") or [],
        },
        "analysis": {
            "combined_score": overall.get("combined_score"),
            "seo_score": overall.get("seo_score"),
            "aeo_score": overall.get("aeo_score"),
            "executive_summary": report_data.get("executive_summary"),
            "strengths": strengths,
            "weaknesses": weaknesses,
            "recommendations": recommendations,
        },
        "recommended_budget": recommended_budget,
        "user_budget": user_budget,
        "campaign": {
            "objective": objective,
            "campaign_duration_days": campaign_duration_days,
            "target_audience": target_audience,
            "vehicle_category": vehicle_category,
            "preferred_channels": preferred_channels,
        },
    }


def _s(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def generate_prose(payload: dict, base_plan: dict) -> dict | None:
    """Groq-direct. Returns a dict of prose fields to merge into the deterministic
    plan, or None (never raises) if unconfigured / the call fails / shape is wrong.

    We hand the model both the analysis payload and the already-computed plan so it
    can describe (never recompute) the fixed numbers."""
    if not GROK_API_KEY:
        return None

    user_content = json.dumps({
        "input": payload,
        "computed_plan": {
            "budget_summary": base_plan.get("budget_summary"),
            "recommended_budget_breakdown": base_plan.get("recommended_budget_breakdown"),
            "optimized_budget_breakdown": base_plan.get("optimized_budget_breakdown"),
            "execution_plan": [
                {"task_name": t["task_name"], "category": t["category"]}
                for t in base_plan.get("execution_plan", [])
            ],
        },
    })

    try:
        resp = httpx.post(
            _GROQ_URL,
            json={
                "model": GROK_MODEL,
                "temperature": 0.4,
                "max_tokens": 2200,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                "response_format": {"type": "json_object"},
            },
            headers={"Authorization": f"Bearer {GROK_API_KEY}", "Content-Type": "application/json"},
            timeout=60.0,
        )
        if resp.status_code != 200:
            logger.warning("budget_planner.groq_non_200 status=%s body=%s", resp.status_code, resp.text[:200])
            return None
        data = json.loads(resp.json()["choices"][0]["message"]["content"])
    except Exception:  # noqa: BLE001
        logger.exception("budget_planner.groq_call_failed")
        return None

    if not isinstance(data, dict):
        return None

    out: dict = {}
    if _s(data.get("explanation")):
        out["explanation"] = _s(data["explanation"])
    if _s(data.get("optimization_note")):
        out["optimization_note"] = _s(data["optimization_note"])
    if isinstance(data.get("rationales"), dict):
        out["rationales"] = {str(k): _s(v) for k, v in data["rationales"].items() if _s(v)}
    if isinstance(data.get("impacts"), dict):
        out["impacts"] = {str(k): _s(v) for k, v in data["impacts"].items() if _s(v)}

    # Nothing usable came back → treat as failure so the caller keeps deterministic prose.
    return out or None
