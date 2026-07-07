"""Agent 3 — Content Generation: caption, hashtags, CTA via Claude (primary) / Grok (fallback)."""
import logging
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END
from app.llm import llm_json, has_llm

logger = logging.getLogger(__name__)

CONTENT_SYSTEM = (
    "You are a marketing copywriter for a Nissan dealership in India. "
    "Respond with valid JSON only, no markdown."
)


class ContentState(TypedDict):
    vehicle: str
    channel: str
    offer: Optional[str]
    objective: Optional[str]
    theme: str
    result: Optional[dict]


def _generate(state: ContentState) -> ContentState:
    if not has_llm():
        logger.warning("[content_gen] no LLM key configured — using fallback")
        return {**state, "result": _fallback(state)}

    v = state["vehicle"]
    ch = state["channel"]
    t = state["theme"]

    prompt = (
        f'Generate social media content for a Nissan {v} marketing campaign.\n'
        f'Channel: {ch}\nTheme: {t}\n'
        + (f'Offer: {state["offer"]}\n' if state.get("offer") else "")
        + (f'Objective: {state["objective"]}\n' if state.get("objective") else "")
        + '\nReturn ONLY valid JSON (no markdown):\n'
        '{"headline":"short punchy headline","subheadline":"supporting line",'
        '"caption":"full social media caption with emojis",'
        '"hashtags":["#Tag1","#Tag2","#Tag3"],"cta":"call-to-action text"}'
    )

    logger.info("[content_gen] calling LLM for vehicle=%s channel=%s", v, ch)
    result = llm_json(prompt, system=CONTENT_SYSTEM, temperature=0.7, max_tokens=512)
    if not isinstance(result, dict) or not result.get("caption"):
        logger.warning("[content_gen] LLM empty/failed — using fallback")
        return {**state, "result": _fallback(state)}

    logger.info("[content_gen] LLM response OK")
    return {**state, "result": result}


def _fallback(state: ContentState) -> dict:
    v = state["vehicle"]
    t = state["theme"]
    o = state.get("offer") or ""
    obj = state.get("objective") or ""
    cta = (
        "Book a Test Drive" if obj == "lead_gen"
        else "Claim This Offer" if obj == "offer"
        else "Enquire Now"
    )
    return {
        "headline": f"Drive the Nissan {v}",
        "subheadline": f"Experience {t} today",
        "caption": f"🚗 The Nissan {v} is here.{' ' + o + '.' if o else ''} {t} — book your test drive today.",
        "hashtags": ["#Nissan", f"#Nissan{v.replace(' ', '')}", "#TestDrive", "#DriveNissan"],
        "cta": cta,
    }


_g = StateGraph(ContentState)
_g.add_node("generate", _generate)
_g.set_entry_point("generate")
_g.add_edge("generate", END)
content_agent = _g.compile()


# ── Batch generation — one LLM call for many days/events ────────────────────────

def _template_item(item: dict, goal: str = "") -> dict:
    v = item.get("vehicle") or "Nissan"
    t = item.get("theme") or "New Arrival"
    o = item.get("offer") or ""
    cta = "Book a Test Drive" if "lead" in goal.lower() else "Enquire Now"
    return {
        "headline": t if len(t) <= 40 else f"Drive the {v}",
        "subheadline": f"Experience {t} with the {v}",
        "caption": f"🚗 {t} — the {v} is waiting.{' ' + o + '.' if o else ''} Visit your nearest Nissan dealership today!",
        "hashtags": ["#Nissan", f"#Nissan{v.replace(' ', '')}", "#NissanIndia", "#TestDrive"],
        "cta": cta,
        "ai": False,
    }


def generate_batch(brief: dict, items: list[dict]) -> list[dict]:
    """Generate post content for many items in ONE LLM call.

    brief: {campaign_name, goal, vehicles[], channels[]}
    items: [{idx, date, theme, vehicle, offer?}]  (idx = 0-based position)
    Returns a list aligned to `items`: each {headline, subheadline, caption,
    hashtags[], cta, ai}. Falls back to a per-item template on failure/quota.
    """
    goal = brief.get("goal") or ""
    if not has_llm() or not items:
        logger.warning("[content/batch] no LLM key or empty items — template fallback")
        return [_template_item(it, goal) for it in items]

    channels = ", ".join(brief.get("channels") or ["Instagram", "Facebook", "X"])
    lines = "\n".join(
        f'  {it.get("idx", i)}. date={it.get("date","")} theme="{it.get("theme","")}" '
        f'vehicle="{it.get("vehicle") or (brief.get("vehicles") or ["Nissan"])[0]}"'
        + (f' offer="{it.get("offer")}"' if it.get("offer") else "")
        for i, it in enumerate(items)
    )
    prompt = (
        f'Campaign: "{brief.get("campaign_name","Nissan campaign")}" · Goal: {goal or "Awareness"}.\n'
        f'Write social media post content (cross-channel: {channels}) for EACH item below.\n'
        f'Items:\n{lines}\n\n'
        f'For each item return: headline (3-6 words), subheadline (one line), '
        f'caption (1-3 sentences, 1-2 emojis, India/Nissan voice, ₹ for prices), '
        f'hashtags (5, include #Nissan + a vehicle tag), cta (2-4 words).\n'
        f'Return ONLY this JSON (echo each idx, no markdown):\n'
        f'{{"items":[{{"idx":0,"headline":"...","subheadline":"...","caption":"...",'
        f'"hashtags":["#..."],"cta":"..."}}]}}'
    )

    logger.info("[content/batch] %d items via LLM", len(items))
    data = llm_json(prompt, system=CONTENT_SYSTEM, temperature=0.7, max_tokens=6000)
    by_idx: dict[int, dict] = {}
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        for entry in data["items"]:
            if isinstance(entry, dict) and entry.get("caption"):
                try:
                    by_idx[int(entry.get("idx"))] = entry
                except (TypeError, ValueError):
                    pass

    out: list[dict] = []
    missing = 0
    for i, it in enumerate(items):
        idx = it.get("idx", i)
        entry = by_idx.get(idx)
        if entry:
            hashtags = entry.get("hashtags")
            out.append({
                "headline": entry.get("headline") or "",
                "subheadline": entry.get("subheadline") or "",
                "caption": entry.get("caption") or "",
                "hashtags": hashtags if isinstance(hashtags, list) else [],
                "cta": entry.get("cta") or "Enquire Now",
                "ai": True,
            })
        else:
            missing += 1
            out.append(_template_item(it, goal))
    if missing:
        logger.warning("[content/batch] %d/%d items missing from LLM — templated", missing, len(items))
    return out


def suggest_field(field: str, context: dict) -> object:
    """Regenerate a single content field. Returns str (or list for hashtags)."""
    v = context.get("vehicle") or "Nissan"
    theme = context.get("theme") or ""
    channel = context.get("channel") or "social media"
    campaign = context.get("campaign_name") or ""
    current = context.get("current") or ""

    specs = {
        "headline": 'a punchy 3-6 word headline. Return JSON {"value":"..."}',
        "subheadline": 'a one-line supporting subheadline. Return JSON {"value":"..."}',
        "caption": 'a 1-3 sentence caption with 1-2 emojis (India/Nissan voice). Return JSON {"value":"..."}',
        "cta": 'a 2-4 word call-to-action. Return JSON {"value":"..."}',
        "hashtags": '5 hashtags incl #Nissan + a vehicle tag. Return JSON {"value":["#..."]}',
    }
    spec = specs.get(field, specs["caption"])
    prompt = (
        f'For a Nissan {v} post on {channel}'
        + (f' (campaign "{campaign}")' if campaign else "")
        + (f', theme "{theme}"' if theme else "")
        + (f'. Current version: "{current}". Improve/vary it' if current else "")
        + f'. Generate {spec}'
    )
    data = llm_json(prompt, system=CONTENT_SYSTEM, temperature=0.85, max_tokens=400)
    val = (data or {}).get("value") if isinstance(data, dict) else None
    if field == "hashtags":
        return val if isinstance(val, list) else []
    return val if isinstance(val, str) else ""
