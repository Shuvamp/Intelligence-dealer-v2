"""Marketing Strategy Advisor — Groq-direct generation + deterministic fallback.

Mirrors report_generator/llm.py: Groq-direct via httpx (GROK_API_KEY/GROK_MODEL),
JSON response, all-or-nothing shape validation, never raises. Returns None when
unconfigured / call fails / shape is wrong, and the caller uses
deterministic_strategies() instead — so the feature works with no key.
"""
from __future__ import annotations

import json
import logging

import httpx

from app.config import GROK_API_KEY, GROK_MODEL

logger = logging.getLogger(__name__)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Priorities kept to a small closed set so the UI can style them.
_PRIORITIES = {"high", "medium", "low"}

# Categories the advisor is encouraged to draw from — a friendly menu, not a
# hard constraint (the model may add adjacent ones).
CATEGORIES = [
    "Events", "Influencer Collaborations", "Celebrity Partnerships", "Regional Influencers",
    "Content Marketing", "Social Media", "Paid Advertising", "Email Marketing",
    "Lead Generation", "Customer Retention", "Brand Awareness", "Seasonal & Festival Campaigns",
    "Dealer Events", "Test Drive Campaigns", "Sponsorships", "Partnerships",
    "Community Engagement", "Local Promotions",
]

SYSTEM_PROMPT = f"""You are a senior growth-marketing strategist advising a Nissan car dealership in India.
You are given a JSON object describing the dealership (business profile) and the findings of a recent
website SEO/AEO analysis (scores, weaknesses, priority fixes).

Your job: produce a prioritized, practical list of marketing & growth STRATEGIES the dealership can act on
to grow the business — not website fixes. Think like a real marketing consultant: local events, influencer
and celebrity/actor collaborations, regional/community influencers, seasonal and festival campaigns, test-drive
drives, dealer showroom events, sponsorships, partnerships, social media, paid ads, lead generation, customer
retention, brand awareness, and local promotions.

Draw from these categories where they fit (you may add adjacent ones): {", ".join(CATEGORIES)}.

Rules — follow these exactly:
1. Base ideas on the provided business profile and analysis. Use the region, products/services, and weaknesses
   to make suggestions specific (e.g. name the region, the vehicle models, the festivals).
2. Return 8 to 12 strategies, DIVERSE across categories — do not return 10 social-media ideas.
3. Each strategy is concrete and actionable — something the owner could brief a team on this week.
4. Keep language warm, plain, and encouraging. No website/technical-SEO fixes here (that lives elsewhere).
5. Output ONLY a single JSON object: {{"strategies": [ ... ]}}. Each item has EXACTLY these keys:
   "title" (short, punchy), "category" (one of the categories), "description" (2-3 sentences, what to do),
   "reason" (1-2 sentences, why it fits this business), "expected_impact" (1 sentence, the business outcome),
   "priority" (one of: high, medium, low).
   No markdown fences, no extra keys, no commentary."""


def has_groq() -> bool:
    return bool(GROK_API_KEY)


def build_input(context: dict | None, summary: dict | None, report: dict | None) -> dict:
    context = context or {}
    summary = summary or {}
    report_data = (report or {}).get("report_data") or {}
    overall = report_data.get("overall_score") or {}
    weaknesses = [
        {"title": w.get("title"), "detail": w.get("detail")}
        for w in (report_data.get("weaknesses") or [])
    ][:8]
    priority_fixes = [
        {"problem": p.get("problem"), "category": p.get("category")}
        for p in (report_data.get("priority_fixes") or [])
    ][:6]

    return {
        "business": {
            "company_name": summary.get("company_name") or context.get("company_name"),
            "industry": summary.get("industry") or context.get("industry") or "Automotive Dealership",
            "region": summary.get("region") or context.get("region"),
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
            "weaknesses": weaknesses,
            "priority_fixes": priority_fixes,
        },
    }


def _coerce_items(data) -> list[dict]:
    """Lenient extraction — the model's JSON varies run to run. Keep every item
    that has the core fields, filling soft fields with sensible defaults and
    dropping anything malformed, instead of rejecting the whole batch."""
    if not isinstance(data, dict):
        return []
    items = data.get("strategies")
    if not isinstance(items, list):
        return []

    def _s(v) -> str:
        return v.strip() if isinstance(v, str) else ""

    out: list[dict] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = _s(it.get("title"))
        description = _s(it.get("description"))
        if not title or not description:  # core fields required
            continue
        priority = _s(it.get("priority")).lower()
        if priority not in _PRIORITIES:
            priority = "medium"
        out.append({
            "title": title,
            "category": _s(it.get("category")) or "Marketing",
            "description": description,
            "reason": _s(it.get("reason")) or "Fits this dealership's current market position.",
            "expected_impact": _s(it.get("expected_impact")) or "Supports business growth.",
            "priority": priority,
        })
    return out


def generate_strategies(payload: dict) -> list[dict] | None:
    """Groq-direct. Returns a normalized strategy list, or None (never raises)
    if unconfigured / the call fails / the response shape is wrong."""
    if not GROK_API_KEY:
        return None
    try:
        resp = httpx.post(
            _GROQ_URL,
            json={
                "model": GROK_MODEL,
                "temperature": 0.45,
                "max_tokens": 2200,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(payload)},
                ],
                "response_format": {"type": "json_object"},
            },
            headers={"Authorization": f"Bearer {GROK_API_KEY}", "Content-Type": "application/json"},
            timeout=60.0,
        )
        if resp.status_code != 200:
            logger.warning("marketing_strategy.groq_non_200 status=%s body=%s", resp.status_code, resp.text[:200])
            return None
        data = json.loads(resp.json()["choices"][0]["message"]["content"])
    except Exception:  # noqa: BLE001
        logger.exception("marketing_strategy.groq_call_failed")
        return None

    items = _coerce_items(data)
    if len(items) < 3:  # too thin to be useful — fall back to the deterministic set
        logger.warning("marketing_strategy.groq_too_few_items count=%d", len(items))
        return None
    return items


def deterministic_strategies(payload: dict) -> list[dict]:
    """Context-aware fallback used when Groq is unavailable. Still references
    the real business (region, products) so it isn't generic boilerplate."""
    biz = payload.get("business") or {}
    company = biz.get("company_name") or "your dealership"
    region = biz.get("region") or "your city"
    products = [p for p in (biz.get("products") or []) if p and p != "Unknown"]
    hero = products[0] if products else "your top model"
    lineup = ", ".join(products[:3]) if products else "the current lineup"

    return [
        {
            "title": f"{hero} test-drive weekend",
            "category": "Test Drive Campaigns",
            "description": f"Run a two-day test-drive drive at the {company} showroom featuring {lineup}. Promote booked slots on WhatsApp and local pages, and give every attendee a small branded gift.",
            "reason": "Test drives are the single biggest converter for car buyers and turn online interest into showroom footfall.",
            "expected_impact": "More qualified walk-ins and booked test drives over the weekend.",
            "priority": "high",
        },
        {
            "title": f"Partner with {region} regional influencers",
            "category": "Regional Influencers",
            "description": f"Collaborate with 2-3 respected local YouTubers/Instagram creators in {region} for honest {hero} review and ownership-experience reels.",
            "reason": "Regional creators carry high trust with nearby buyers and are far cheaper than national campaigns.",
            "expected_impact": "Wider local reach and warmer leads from a trusted voice.",
            "priority": "high",
        },
        {
            "title": "Festival season offer campaign",
            "category": "Seasonal & Festival Campaigns",
            "description": f"Build a festival campaign (Pongal/Diwali) around {lineup} with limited-period benefits, festive showroom decor, and a themed social series.",
            "reason": "Indian car buying peaks around festivals; a timed offer captures that intent.",
            "expected_impact": "A seasonal spike in enquiries and bookings.",
            "priority": "high",
        },
        {
            "title": "Community sponsorship",
            "category": "Sponsorships",
            "description": f"Sponsor a popular {region} community event, marathon, or school/college fest with a {hero} on display and a photo booth.",
            "reason": "Puts the brand in front of families in a positive, high-footfall setting.",
            "expected_impact": "Local brand awareness and on-site lead capture.",
            "priority": "medium",
        },
        {
            "title": "Referral & loyalty program",
            "category": "Customer Retention",
            "description": "Reward existing customers who refer a buyer with free service credits, and keep owners engaged with service reminders and an owners' club.",
            "reason": "Referrals from happy owners are the highest-converting, lowest-cost leads.",
            "expected_impact": "A steady stream of warm referral leads and repeat service revenue.",
            "priority": "medium",
        },
        {
            "title": "Local celebrity showroom launch",
            "category": "Celebrity Partnerships",
            "description": f"Invite a regional film/sports personality to a {hero} unveiling at the showroom, streamed live on social channels.",
            "reason": "A familiar local face draws crowds and press coverage at a launch moment.",
            "expected_impact": "A buzz-worthy event that lifts awareness and footfall.",
            "priority": "medium",
        },
        {
            "title": "Always-on social content",
            "category": "Social Media",
            "description": f"Post a weekly mix of {lineup} feature reels, customer delivery moments, and service tips on Instagram and Facebook.",
            "reason": "Consistent, relatable content keeps the dealership top-of-mind between purchases.",
            "expected_impact": "Growing local following and steady inbound DMs.",
            "priority": "low",
        },
        {
            "title": "Targeted local lead-gen ads",
            "category": "Paid Advertising",
            "description": f"Run geo-targeted Meta/Google lead ads around {region} for {hero}, routing enquiries straight into the sales pipeline.",
            "reason": "Paid local ads reach in-market buyers your organic reach misses.",
            "expected_impact": "A measurable, scalable flow of fresh leads.",
            "priority": "low",
        },
    ]
