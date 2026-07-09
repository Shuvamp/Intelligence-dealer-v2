"""Deterministic budget maths for the Marketing Budget Planner.

Pure functions, no LLM, no I/O. This module OWNS the numbers, so two hard rules
from the spec hold by construction regardless of the LLM:
  - the allocation always sums EXACTLY to the recommended budget, and
  - the optimized plan NEVER exceeds the user's budget.

All figures are INR (integer rupees). Groq (see llm.py) only rewrites the prose
built here; it never touches these amounts.
"""
from __future__ import annotations

import re

# ── Activity catalogue ──────────────────────────────────────────────────────
# Kept in the spec's example order for the recommended breakdown. `weight` is the
# baseline % split (sums to 100). `rank` is ROI priority for optimization (1 = fund
# first). `priority` is the displayed tag.
ACTIVITIES: list[dict] = [
    {"activity": "SEO Content",               "weight": 18, "rank": 2, "priority": "high"},
    {"activity": "Social Media",              "weight": 14, "rank": 6, "priority": "medium"},
    {"activity": "Google Ads",                "weight": 18, "rank": 3, "priority": "high"},
    {"activity": "Meta Ads",                  "weight": 14, "rank": 5, "priority": "medium"},
    {"activity": "AI Search Optimization",    "weight": 10, "rank": 4, "priority": "medium"},
    {"activity": "Email Marketing",           "weight": 8,  "rank": 7, "priority": "medium"},
    {"activity": "Landing Page Optimization", "weight": 8,  "rank": 1, "priority": "high"},
    {"activity": "Video Content",             "weight": 6,  "rank": 9, "priority": "low"},
    {"activity": "Marketing Tools",           "weight": 4,  "rank": 8, "priority": "low"},
]

_RATIONALE: dict[str, str] = {
    "SEO Content": "Blog articles and on-page copy that lift organic ranking and win high-intent search traffic.",
    "Social Media": "Always-on Instagram/Facebook presence to stay top-of-mind and capture inbound enquiries.",
    "Google Ads": "Search ads that reach in-market buyers your organic reach misses today.",
    "Meta Ads": "Geo-targeted Facebook/Instagram lead ads routed straight into the sales pipeline.",
    "AI Search Optimization": "Structured data and answer-ready content so AI assistants and answer engines cite the dealership.",
    "Email Marketing": "Nurture and re-engagement sequences that convert existing contacts at near-zero marginal cost.",
    "Landing Page Optimization": "Faster, clearer landing pages that convert the traffic you already pay for.",
    "Video Content": "Model walkarounds and delivery moments that build trust and social reach.",
    "Marketing Tools": "CRM, analytics and automation licences that make every other activity measurable.",
}

_TASK_MAP: dict[str, list[str]] = {
    "SEO Content": ["Generate Blog Articles", "Create Content Calendar"],
    "Social Media": ["Create Social Media Campaign", "Generate Instagram Posts"],
    "Google Ads": ["Generate Google Ads"],
    "Meta Ads": ["Generate Facebook Ads"],
    "AI Search Optimization": ["Optimize Google Business Profile"],
    "Email Marketing": ["Generate Email Campaign"],
    "Landing Page Optimization": ["Create Landing Page"],
    "Video Content": ["Generate Video Content"],
    "Marketing Tools": ["Set Up Marketing Tools"],
}

_TASK_IMPACT: dict[str, str] = {
    "Generate Blog Articles": "Grows organic traffic and long-tail keyword coverage.",
    "Create Content Calendar": "Keeps publishing consistent so ranking compounds month over month.",
    "Create Social Media Campaign": "Lifts local awareness and inbound DMs.",
    "Generate Instagram Posts": "Steady reach and engagement with nearby buyers.",
    "Generate Google Ads": "Immediate flow of high-intent search leads.",
    "Generate Facebook Ads": "Scalable, measurable lead volume from targeted audiences.",
    "Optimize Google Business Profile": "More map/answer-engine visibility and call/direction actions.",
    "Generate Email Campaign": "Converts existing contacts at very low cost per lead.",
    "Create Landing Page": "Higher conversion on the traffic you already have.",
    "Generate Video Content": "Builds trust and extends organic social reach.",
    "Set Up Marketing Tools": "Makes every campaign trackable so spend can be optimized.",
}

# Baseline monthly spend by business category (INR). Matched by substring.
_CATEGORY_BASE: list[tuple[str, int]] = [
    ("automotive dealership", 150_000),
    ("dealership", 150_000),
    ("automotive", 150_000),
    ("ecommerce", 120_000),
    ("e-commerce", 120_000),
    ("retail", 100_000),
    ("real estate", 130_000),
    ("hospitality", 90_000),
    ("healthcare", 110_000),
    ("education", 80_000),
    ("services", 80_000),
]
_DEFAULT_BASE = 120_000


# ── helpers ──────────────────────────────────────────────────────────────────
def _round(n: float, step: int) -> int:
    return int(round(n / step)) * step


def _gap(score: float | int | None) -> float:
    """0..1 improvement headroom. Missing score → neutral 0.5."""
    if score is None:
        return 0.5
    try:
        s = float(score)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, (100.0 - s) / 100.0))


def inr(n: int) -> str:
    """Indian-grouped rupee string, e.g. 205000 -> '₹2,05,000'."""
    s = str(int(round(n)))
    if len(s) <= 3:
        return "₹" + s
    last3 = s[-3:]
    rest = re.sub(r"(?<=\d)(?=(\d\d)+$)", ",", s[:-3])
    return "₹" + rest + "," + last3


def _base_for_category(category: str | None) -> int:
    cat = (category or "").lower()
    for key, base in _CATEGORY_BASE:
        if key in cat:
            return base
    return _DEFAULT_BASE


# ── core steps ────────────────────────────────────────────────────────────────
def derive_recommended(seo: float | int | None, aeo: float | int | None, category: str | None) -> int:
    """A weaker web presence needs more spend to close the gap. Scale the
    category baseline by the average score gap and round to a clean ₹5,000."""
    avg_gap = (_gap(seo) + _gap(aeo)) / 2.0
    base = _base_for_category(category)
    recommended = base * (1.0 + 0.8 * avg_gap)
    return _round(recommended, 5_000)


def allocate(recommended: int, seo: float | int | None, aeo: float | int | None) -> list[dict]:
    """Split `recommended` across the activity catalogue, tilting spend toward the
    weak areas. Guaranteed to sum EXACTLY to `recommended`."""
    seo_gap, aeo_gap = _gap(seo), _gap(aeo)

    adj: list[float] = []
    for a in ACTIVITIES:
        w = float(a["weight"])
        name = a["activity"]
        if name == "SEO Content":
            w *= 1.0 + 0.6 * seo_gap
        elif name == "Landing Page Optimization":
            w *= 1.0 + 0.5 * seo_gap
        elif name == "Google Ads":
            w *= 1.0 + 0.3 * seo_gap
        elif name == "AI Search Optimization":
            w *= 1.0 + 0.9 * aeo_gap
        adj.append(w)

    total_w = sum(adj) or 1.0
    amounts = [_round(recommended * w / total_w, 1_000) for w in adj]

    # Fix rounding drift so the split sums to exactly `recommended`.
    drift = recommended - sum(amounts)
    if amounts:
        biggest = max(range(len(amounts)), key=lambda i: amounts[i])
        amounts[biggest] += drift

    out: list[dict] = []
    for a, amount in zip(ACTIVITIES, amounts):
        priority = a["priority"]
        name = a["activity"]
        if name == "AI Search Optimization" and aeo_gap >= 0.4:
            priority = "high"
        out.append({
            "activity": name,
            "amount": int(amount),
            "amount_display": inr(amount),
            "share_pct": round(amount / recommended * 100, 1) if recommended else 0.0,
            "priority": priority,
            "rank": a["rank"],
            "rationale": _RATIONALE.get(name, ""),
        })
    return out


def optimize(allocation: list[dict], user_budget: int) -> dict:
    """Greedily fund activities in ROI (rank) order within `user_budget`.
    Included / Deferred / Excluded. Funded total NEVER exceeds `user_budget`."""
    remaining = int(user_budget)
    optimized: list[dict] = []

    for a in sorted(allocation, key=lambda x: x["rank"]):
        want = a["amount"]
        if want <= 0:
            continue
        if remaining >= want:
            funded, status, note = want, "included", "Fully funded"
            remaining -= want
        elif remaining > 0:
            funded, status, note = remaining, "included", "Partially funded within budget"
            remaining = 0
        elif a["priority"] == "low":
            funded, status, note = 0, "excluded", "Excluded — low ROI at this budget"
        else:
            funded, status, note = 0, "deferred", "Deferred to the next budget cycle"

        optimized.append({
            "activity": a["activity"],
            "amount": int(funded if status == "included" else want),
            "amount_display": inr(funded if status == "included" else want),
            "funded_amount": int(funded),
            "priority": a["priority"],
            "status": status,
            "note": note,
        })

    total = sum(x["funded_amount"] for x in optimized)
    included = [x for x in optimized if x["status"] == "included"]
    removed = [x for x in optimized if x["status"] != "included"]
    return {
        "lines": optimized,
        "total": int(total),
        "included_count": len(included),
        "removed_count": len(removed),
    }


def _pct(n: float) -> str:
    return f"+{int(round(n))}%"


def comparison(recommended: int, opt: dict, seo: float | int | None, aeo: float | int | None) -> list[dict]:
    """Recommended-vs-optimized deltas. Improvements scale with the funded ratio."""
    seo_gap, aeo_gap = _gap(seo), _gap(aeo)
    opt_total = opt["total"]
    ratio = (opt_total / recommended) if recommended else 0.0
    total_activities = len([a for a in ACTIVITIES])

    seo_full = seo_gap * 40.0          # up to +40 pts of headroom at full spend
    aeo_full = aeo_gap * 40.0
    lead_full = 30.0 + ((seo_gap + aeo_gap) / 2.0) * 40.0
    sales_full = 15.0 + ((seo_gap + aeo_gap) / 2.0) * 25.0

    if ratio >= 0.9:
        opt_timeline = "3–6 months"
    elif ratio >= 0.6:
        opt_timeline = "5–8 months"
    else:
        opt_timeline = "8–12 months"

    return [
        {"metric": "Monthly Budget", "recommended": inr(recommended), "optimized": inr(opt_total)},
        {"metric": "Activities Included", "recommended": str(total_activities), "optimized": str(opt["included_count"])},
        {"metric": "Activities Removed", "recommended": "0", "optimized": str(opt["removed_count"])},
        {"metric": "Expected Timeline", "recommended": "3–6 months", "optimized": opt_timeline},
        {"metric": "Estimated SEO Improvement", "recommended": _pct(seo_full), "optimized": _pct(seo_full * ratio)},
        {"metric": "Estimated AEO Improvement", "recommended": _pct(aeo_full), "optimized": _pct(aeo_full * ratio)},
        {"metric": "Expected Lead Growth", "recommended": _pct(lead_full), "optimized": _pct(lead_full * ratio)},
        {"metric": "Expected Sales Growth", "recommended": _pct(sales_full), "optimized": _pct(sales_full * ratio)},
    ]


def execution_plan(opt: dict) -> list[dict]:
    """Platform-executable tasks for the INCLUDED activities only. The activity's
    funded amount is split evenly across its tasks."""
    tasks: list[dict] = []
    for line in opt["lines"]:
        if line["status"] != "included":
            continue
        names = _TASK_MAP.get(line["activity"], [])
        if not names:
            continue
        per = line["funded_amount"] // len(names)
        remainder = line["funded_amount"] - per * len(names)
        for i, task_name in enumerate(names):
            cost = per + (remainder if i == 0 else 0)
            tasks.append({
                "task_name": task_name,
                "category": line["activity"],
                "priority": line["priority"],
                "estimated_cost": int(cost),
                "estimated_cost_display": inr(cost),
                "expected_impact": _TASK_IMPACT.get(task_name, "Supports business growth."),
            })
    # Highest priority first for the UI.
    order = {"high": 0, "medium": 1, "low": 2}
    tasks.sort(key=lambda t: order.get(t["priority"], 1))
    return tasks


def _recommendations(payload: dict, recommended: int, opt: dict, seo_gap: float, aeo_gap: float) -> list[dict]:
    biz = payload.get("business") or {}
    region = biz.get("region") or "your city"
    recs: list[dict] = []

    if seo_gap >= 0.3:
        recs.append({
            "title": "Lead with SEO content and landing-page fixes",
            "detail": "The SEO score has the most headroom, so front-load blog content and landing-page conversion work — it compounds and lowers paid-ad dependence over time.",
        })
    if aeo_gap >= 0.3:
        recs.append({
            "title": "Invest in AI Search Optimization early",
            "detail": "Answer-engine visibility is weak. Add structured data and answer-ready pages so AI assistants surface the dealership when buyers ask.",
        })
    recs.append({
        "title": f"Keep paid ads geo-targeted to {region}",
        "detail": "Concentrate Google and Meta spend on the local catchment to maximize qualified walk-ins per rupee.",
    })
    if opt["removed_count"] > 0:
        recs.append({
            "title": "Revisit deferred activities next cycle",
            "detail": "Once early wins free up budget, fund the deferred activities in ROI order rather than adding low-priority spend now.",
        })
    recs.append({
        "title": "Track cost-per-lead from day one",
        "detail": "Route every campaign into the CRM so spend can be shifted toward the channels that actually book test drives.",
    })
    return recs


def build_plan(payload: dict) -> dict:
    """Assemble the full deterministic budget plan from `payload` (built by
    llm.build_input). Reads scores + budgets from the payload; owns every number."""
    analysis = payload.get("analysis") or {}
    seo = analysis.get("seo_score")
    aeo = analysis.get("aeo_score")
    combined = analysis.get("combined_score")
    business = payload.get("business") or {}
    category = business.get("industry")

    recommended = int(payload.get("recommended_budget") or derive_recommended(seo, aeo, category))
    user_budget = int(payload.get("user_budget") or 0)

    rec_breakdown = allocate(recommended, seo, aeo)
    opt = optimize(rec_breakdown, user_budget)
    seo_gap, aeo_gap = _gap(seo), _gap(aeo)

    fits = user_budget >= recommended
    company = business.get("company_name") or "the dealership"
    explanation = (
        f"Based on {company}'s current analysis (combined {combined if combined is not None else '—'}, "
        f"SEO {seo if seo is not None else '—'}, AEO {aeo if aeo is not None else '—'}) and its "
        f"{category or 'automotive dealership'} category, a monthly budget of {inr(recommended)} is "
        f"appropriate: it is sized to the {category or 'category'} baseline and scaled up in proportion "
        f"to the score gap, so there is enough to close the weak areas without over-spending."
    )
    if fits:
        optimization_note = (
            f"Your budget of {inr(user_budget)} meets the recommended {inr(recommended)}, so the full "
            f"plan is funded across all {len(ACTIVITIES)} activities."
        )
    else:
        optimization_note = (
            f"Your budget of {inr(user_budget)} is below the recommended {inr(recommended)}, so spend is "
            f"concentrated on the highest-ROI activities first; lower-priority ones are deferred or excluded "
            f"and stay within your budget ({inr(opt['total'])} allocated)."
        )

    return {
        "budget_summary": {
            "currency": "INR",
            "recommended_budget": recommended,
            "user_budget": user_budget,
            "recommended_budget_display": inr(recommended),
            "user_budget_display": inr(user_budget),
            "optimized_total": opt["total"],
            "optimized_total_display": inr(opt["total"]),
            "fits_recommended": fits,
            "explanation": explanation,
            "optimization_note": optimization_note,
        },
        "recommended_budget_breakdown": [
            {k: v for k, v in line.items() if k != "rank"} for line in rec_breakdown
        ],
        "optimized_budget_breakdown": [
            {k: v for k, v in line.items() if k != "funded_amount"} for line in opt["lines"]
        ],
        "comparison_table": comparison(recommended, opt, seo, aeo),
        "execution_plan": execution_plan(opt),
        "recommendations": _recommendations(payload, recommended, opt, seo_gap, aeo_gap),
        "_recommended_budget": recommended,
        "_user_budget": user_budget,
    }
