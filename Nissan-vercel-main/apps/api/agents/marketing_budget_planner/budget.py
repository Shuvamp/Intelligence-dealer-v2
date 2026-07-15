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
    "Video Content": "Model walkarounds and delivery moments — published as YouTube Ads and organic video — that build trust and social reach.",
    "Marketing Tools": "CRM, analytics and automation licences that make every other activity measurable.",
}

# ── Objective + preferred-channel tilts ─────────────────────────────────────
# Multiplicative weight bumps applied on top of the seo/aeo gap tilts in
# allocate(). Keys match ACTIVITIES names exactly — no new activities added.
OBJECTIVE_TILTS: dict[str, dict[str, float]] = {
    "lead_generation":     {"Google Ads": 1.3, "Meta Ads": 1.3, "Landing Page Optimization": 1.2},
    "vehicle_sales":       {"Google Ads": 1.25, "Meta Ads": 1.15, "Video Content": 1.3, "Landing Page Optimization": 1.2},
    "brand_awareness":     {"Social Media": 1.4, "Video Content": 1.3, "Meta Ads": 1.15},
    "website_traffic":     {"SEO Content": 1.35, "Google Ads": 1.2, "AI Search Optimization": 1.2},
    "customer_engagement": {"Email Marketing": 1.5, "Social Media": 1.2},
}

# User-facing channel labels (spec examples: "Google Search Ads", "YouTube Ads", ...)
# normalized to the internal ACTIVITIES names above. Unknown labels are ignored.
CHANNEL_ALIASES: dict[str, str] = {
    "google search ads": "Google Ads", "google ads": "Google Ads",
    "meta ads": "Meta Ads", "facebook ads": "Meta Ads", "instagram ads": "Meta Ads",
    "seo": "SEO Content", "seo content": "SEO Content",
    "youtube ads": "Video Content", "youtube": "Video Content", "video content": "Video Content", "video": "Video Content",
    "email marketing": "Email Marketing", "email": "Email Marketing",
    "social media": "Social Media",
    "landing page": "Landing Page Optimization", "landing page optimization": "Landing Page Optimization",
    "ai search optimization": "AI Search Optimization", "aeo": "AI Search Optimization", "answer engine optimization": "AI Search Optimization",
    "marketing tools": "Marketing Tools",
}


def _normalize_channels(channels: list[str] | None) -> set[str]:
    if not channels:
        return set()
    out: set[str] = set()
    for c in channels:
        key = CHANNEL_ALIASES.get((c or "").strip().lower())
        if key:
            out.add(key)
    return out


# Objective-tailored strategic tip, shown first in recommendations when the
# user picked an objective. Kept separate from _recommendations()'s always-on
# advice below.
_OBJECTIVE_TIPS: dict[str, tuple[str, str]] = {
    "lead_generation": (
        "Prioritize high-intent lead capture",
        "Push more of the funded budget into Google Ads and the landing page so every visitor converts into a tracked lead.",
    ),
    "vehicle_sales": (
        "Tighten the funnel from ad to test drive",
        "Pair paid ads with landing-page and video content that showcases the specific model line you're pushing this cycle.",
    ),
    "brand_awareness": (
        "Lean into always-on social + video",
        "Awareness compounds slower than ads — keep Social Media and Video Content funded even if paid spend gets trimmed.",
    ),
    "website_traffic": (
        "Compound organic traffic before cutting ads",
        "SEO Content and AI Search Optimization take longer to pay off, so protect their funding even under a tight budget.",
    ),
    "customer_engagement": (
        "Nurture the existing customer base",
        "Email Marketing has the lowest marginal cost here — use it to re-engage past customers for service and trade-in campaigns.",
    ),
}

# Baseline monthly cost-per-lead by business category (INR). Matched by substring,
# same convention as _CATEGORY_BASE. Drives predict_impact()'s lead volume estimate.
_CPL_BASE: list[tuple[str, int]] = [
    ("automotive dealership", 350),
    ("dealership", 350),
    ("automotive", 350),
    ("ecommerce", 250),
    ("e-commerce", 250),
    ("retail", 300),
    ("real estate", 500),
    ("hospitality", 450),
    ("healthcare", 400),
    ("education", 300),
    ("services", 350),
]
_DEFAULT_CPL = 400

# Illustrative average contribution margin per closed sale (INR) — used only to
# turn a sales estimate into an estimated ROI %. Automotive-oriented, matching
# this platform's primary use case (Nissan dealerships).
_AVG_MARGIN_PER_SALE = 45_000

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


def _cpl_for_category(category: str | None) -> int:
    cat = (category or "").lower()
    for key, cpl in _CPL_BASE:
        if key in cat:
            return cpl
    return _DEFAULT_CPL


def _num(n: float) -> str:
    """Indian-grouped plain number string (no currency symbol), e.g. 205000 -> '2,05,000'."""
    s = str(int(round(n)))
    if len(s) <= 3:
        return s
    last3 = s[-3:]
    rest = re.sub(r"(?<=\d)(?=(\d\d)+$)", ",", s[:-3])
    return rest + "," + last3


# ── core steps ────────────────────────────────────────────────────────────────
def derive_recommended(seo: float | int | None, aeo: float | int | None, category: str | None) -> int:
    """A weaker web presence needs more spend to close the gap. Scale the
    category baseline by the average score gap and round to a clean ₹5,000."""
    avg_gap = (_gap(seo) + _gap(aeo)) / 2.0
    base = _base_for_category(category)
    recommended = base * (1.0 + 0.8 * avg_gap)
    return _round(recommended, 5_000)


def allocate(
    recommended: int,
    seo: float | int | None,
    aeo: float | int | None,
    objective: str | None = None,
    preferred_channels: list[str] | None = None,
) -> list[dict]:
    """Split `recommended` across the activity catalogue, tilting spend toward the
    weak areas, the chosen marketing objective, and any explicitly preferred
    channels. Guaranteed to sum EXACTLY to `recommended`."""
    seo_gap, aeo_gap = _gap(seo), _gap(aeo)
    obj_tilts = OBJECTIVE_TILTS.get(objective or "", {})
    preferred = _normalize_channels(preferred_channels)

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
        w *= obj_tilts.get(name, 1.0)
        if name in preferred:
            w *= 1.25
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


def predict_impact(
    budget_amount: int,
    seo: float | int | None,
    aeo: float | int | None,
    category: str | None,
    duration_days: int | None = 30,
) -> dict:
    """Deterministic, illustrative business-impact prediction for a monthly
    `budget_amount` spent over `duration_days`. Every figure is derived from
    the category's baseline cost-per-lead — same "estimate, never guarantee"
    spirit as comparison()'s % deltas, but as absolute counts for the
    dashboard. Never raises; missing inputs fall back to neutral defaults."""
    months = max(int(duration_days or 30), 1) / 30.0
    cpl = _cpl_for_category(category)
    campaign_budget = budget_amount * months

    expected_leads = campaign_budget / cpl if cpl else 0.0
    website_traffic = expected_leads * 18.0        # ~1 lead per 18 site visits
    test_drive_bookings = expected_leads * 0.22     # ~22% of leads book a test drive
    customer_enquiries = expected_leads * 1.4       # broader than qualified leads
    vehicle_sales = test_drive_bookings * 0.35      # ~35% test-drive-to-sale close rate
    reach = website_traffic * 12.0
    impressions = reach * 3.5

    revenue = vehicle_sales * _AVG_MARGIN_PER_SALE
    roi_pct = int(round(((revenue - campaign_budget) / campaign_budget) * 100)) if campaign_budget > 0 else 0

    return {
        "expected_leads": int(round(expected_leads)),
        "expected_leads_display": _num(expected_leads),
        "website_traffic": int(round(website_traffic)),
        "website_traffic_display": _num(website_traffic),
        "test_drive_bookings": int(round(test_drive_bookings)),
        "test_drive_bookings_display": _num(test_drive_bookings),
        "customer_enquiries": int(round(customer_enquiries)),
        "customer_enquiries_display": _num(customer_enquiries),
        "vehicle_sales": int(round(vehicle_sales)),
        "vehicle_sales_display": _num(vehicle_sales),
        "estimated_roi_pct": roi_pct,
        "estimated_roi_display": f"{'+' if roi_pct >= 0 else ''}{roi_pct}%",
        "reach": int(round(reach)),
        "reach_display": _num(reach),
        "impressions": int(round(impressions)),
        "impressions_display": _num(impressions),
    }


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


_RANK_BY_ACTIVITY: dict[str, int] = {a["activity"]: a["rank"] for a in ACTIVITIES}


def _recommendations(
    payload: dict, recommended: int, opt: dict, seo_gap: float, aeo_gap: float, objective: str | None = None,
) -> list[dict]:
    """Always returns exactly 5 insights, one per fixed category, in fixed
    order — so the dashboard can render 5 AI Business Insight cards
    (best_channel, optimization, growth, risk, tip) regardless of which
    specific condition triggered each one's text."""
    biz = payload.get("business") or {}
    region = biz.get("region") or "your city"
    recs: list[dict] = []

    # 1. best_channel — the funded activity with the top ROI rank.
    included = [line for line in opt["lines"] if line["status"] == "included"]
    if included:
        best = min(included, key=lambda line: _RANK_BY_ACTIVITY.get(line["activity"], 99))
        recs.append({
            "category": "best_channel",
            "title": f"Best-performing channel: {best['activity']}",
            "detail": f"{best['activity']} carries this plan's highest ROI priority and is fully funded at {best['amount_display']} — expect it to move fastest this cycle.",
        })
    else:
        recs.append({
            "category": "best_channel",
            "title": "No channel is funded yet",
            "detail": "Raise the budget so at least the top-priority activity can be funded — nothing is included at this amount.",
        })

    # 2. optimization — objective-tailored when an objective was picked, else geo-targeting.
    if objective in _OBJECTIVE_TIPS:
        title, detail = _OBJECTIVE_TIPS[objective]
        recs.append({"category": "optimization", "title": title, "detail": detail})
    else:
        recs.append({
            "category": "optimization",
            "title": f"Keep paid ads geo-targeted to {region}",
            "detail": "Concentrate Google and Meta spend on the local catchment to maximize qualified walk-ins per rupee.",
        })

    # 3. growth — long-term compounding channels.
    if seo_gap >= 0.3 or aeo_gap >= 0.3:
        recs.append({
            "category": "growth",
            "title": "Compound organic growth with SEO + AEO",
            "detail": "Front-load blog content, landing-page fixes and answer-ready structured data — these take longer to pay off but lower paid-ad dependence over time.",
        })
    else:
        recs.append({
            "category": "growth",
            "title": "Protect long-term channels even when cutting spend",
            "detail": "SEO Content and AI Search Optimization compound slowly — keep them funded at some level even if paid channels get trimmed first.",
        })

    # 4. risk
    if opt["removed_count"] > 0:
        recs.append({
            "category": "risk",
            "title": "Under-funding risk on deferred activities",
            "detail": f"{opt['removed_count']} activity(ies) are deferred or excluded at this budget — results will be slower and less complete until they're funded.",
        })
    else:
        recs.append({
            "category": "risk",
            "title": "Watch for seasonal cost spikes",
            "detail": "Ad auction prices rise during festival and model-launch periods — keep a 10–15% buffer so paid reach doesn't drop when demand peaks.",
        })

    # 5. tip
    recs.append({
        "category": "tip",
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
    campaign = payload.get("campaign") or {}
    objective = campaign.get("objective")
    duration_days = campaign.get("campaign_duration_days") or 30
    preferred_channels = campaign.get("preferred_channels")

    recommended = int(payload.get("recommended_budget") or derive_recommended(seo, aeo, category))
    user_budget = int(payload.get("user_budget") or 0)

    rec_breakdown = allocate(recommended, seo, aeo, objective=objective, preferred_channels=preferred_channels)
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
        "recommendations": _recommendations(payload, recommended, opt, seo_gap, aeo_gap, objective),
        "business_impact": {
            "recommended": predict_impact(recommended, seo, aeo, category, duration_days),
            "optimized": predict_impact(opt["total"], seo, aeo, category, duration_days),
        },
        "_recommended_budget": recommended,
        "_user_budget": user_budget,
    }
