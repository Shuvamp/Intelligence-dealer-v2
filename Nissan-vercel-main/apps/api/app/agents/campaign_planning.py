"""Agent 1 — Campaign Planning: 5-node LangGraph pipeline.

Nodes: validate_input → detect_events → plan_themes → rotate_assets → build_calendar → END

plan_themes calls Claude (primary) with Grok fallback for AI-generated daily themes.
Occasions are gathered locally from INDIA_EVENTS and fed into the prompt.
"""
import logging
from datetime import date, timedelta
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END
from app.llm import llm_json, has_llm

logger = logging.getLogger(__name__)

# Static India calendar for event detection (MM-DD → name).
INDIA_EVENTS: dict[str, str] = {
    "01-01": "New Year",
    "01-14": "Pongal / Makar Sankranti",
    "01-26": "Republic Day",
    "03-25": "Holi",
    "04-14": "Tamil New Year",
    "05-11": "Mother's Day",
    "06-15": "Father's Day",
    "08-15": "Independence Day",
    "10-02": "Gandhi Jayanti",
    "10-12": "Navratri",
    "10-20": "Dussehra",
    "11-01": "Diwali",
    "11-14": "Children's Day",
    "12-25": "Christmas",
}

CAMPAIGN_PLANNER_SYSTEM = """You are the Campaign Planner Agent for a Nissan dealership in Tamil Nadu, India.

Generate creative, specific daily campaign themes. Each theme is 3-6 words.
- themes[0] = "Campaign Launch", themes[-1] = closing CTA
- Weave in occasions naturally (Navratri, Diwali, Father's Day, etc.)
- Match the campaign goal: Lead Gen=urgency, Brand Awareness=aspirational, Sales Promo=offer/urgency
- Return ONLY valid JSON. No explanation, no markdown."""


def _handle_get_campaign_occasions(start_date: str, end_date: str) -> str:
    try:
        start = date.fromisoformat(start_date)
        end   = date.fromisoformat(end_date)
    except ValueError:
        return "Error: invalid date format. Use YYYY-MM-DD."
    events: list[str] = []
    cur = start
    while cur <= end:
        key = cur.strftime("%m-%d")
        if key in INDIA_EVENTS:
            events.append(f"{cur.isoformat()}: {INDIA_EVENTS[key]}")
        cur += timedelta(days=1)
    return "\n".join(events) if events else f"No notable occasions between {start_date} and {end_date}."


class CampaignState(TypedDict):
    campaign_name: str
    campaign_type: str
    vehicles: list[str]
    goal: str
    start_date: str
    end_date: str
    posting_time: Optional[str]
    notes: Optional[str]
    selected_assets: list[dict]   # [{vehicle, asset_id, file_url?}]
    # internal
    detected_events: list[str]
    themes: list[str]
    result: Optional[list[dict]]


# ── Node 1: validate_input ────────────────────────────────────────────────────

def validate_input(state: CampaignState) -> CampaignState:
    start = date.fromisoformat(state["start_date"])
    end   = date.fromisoformat(state["end_date"])
    if end < start:
        state = {**state, "start_date": state["end_date"], "end_date": state["start_date"]}
    if not state.get("vehicles") and not state.get("selected_assets"):
        state = {**state, "vehicles": ["Magnite"]}
    return {**state, "detected_events": [], "themes": [], "result": None}


# ── Node 2: detect_events ─────────────────────────────────────────────────────

def detect_events(state: CampaignState) -> CampaignState:
    start = date.fromisoformat(state["start_date"])
    end   = date.fromisoformat(state["end_date"])
    events: list[str] = []
    cur = start
    while cur <= end:
        key = cur.strftime("%m-%d")
        if key in INDIA_EVENTS:
            events.append(f"{cur.isoformat()}: {INDIA_EVENTS[key]}")
        cur += timedelta(days=1)
    return {**state, "detected_events": events}


# ── Node 3: plan_themes (NVIDIA NIM — direct JSON, no tool-calling) ───────────

def plan_themes(state: CampaignState) -> CampaignState:
    start = date.fromisoformat(state["start_date"])
    end   = date.fromisoformat(state["end_date"])
    total_days = (end - start).days + 1

    def _fallback() -> CampaignState:
        goal = state.get("goal", "Campaign")
        return {**state, "themes": [f"Day {i + 1} — {goal}" for i in range(total_days)]}

    if not has_llm():
        logger.warning("[plan_themes] no LLM key configured — using fallback")
        return _fallback()

    # Gather occasions locally and feed them into the prompt
    occasions_str = _handle_get_campaign_occasions(state["start_date"], state["end_date"])

    vehicles_str = ", ".join(state["vehicles"]) if state["vehicles"] else (
        ", ".join({a["vehicle"] for a in state.get("selected_assets", [])}) or "Magnite"
    )
    day_list = "\n".join(
        f"Day {i + 1} | {(start + timedelta(days=i)).isoformat()}"
        for i in range(total_days)
    )

    user_prompt = (
        f'Plan a {total_days}-day Nissan dealer marketing campaign.\n'
        f'  Name: "{state["campaign_name"]}"\n'
        f'  Type: {state["campaign_type"]}\n'
        f'  Goal: {state["goal"]}\n'
        f'  Period: {state["start_date"]} to {state["end_date"]}\n'
        f'  Vehicles: {vehicles_str}\n'
    )
    if state.get("posting_time"):
        user_prompt += f'  Posting time: {state["posting_time"]}\n'
    if state.get("notes"):
        user_prompt += f'  Notes: {state["notes"]}\n'
    user_prompt += (
        f'\nOccasions in this period:\n{occasions_str}\n\n'
        f'Days:\n{day_list}\n\n'
        f'Return ONLY this JSON (no markdown, no extra text):\n'
        f'{{"themes": ["theme day 1", "theme day 2", ... all {total_days} themes]}}'
    )

    logger.info("[plan_themes] calling LLM days=%d", total_days)
    data = llm_json(user_prompt, system=CAMPAIGN_PLANNER_SYSTEM, temperature=0.7)
    themes = (data or {}).get("themes", [])

    if not isinstance(themes, list) or not themes:
        logger.warning("[plan_themes] LLM returned empty/invalid themes — fallback")
        return _fallback()

    logger.info("[plan_themes] LLM returned %d themes for %d days", len(themes), total_days)

    goal = state.get("goal", "Campaign")
    while len(themes) < total_days:
        themes.append(f"Day {len(themes) + 1} — {goal}")
    return {**state, "themes": themes[:total_days]}


# ── Node 4: rotate_assets ─────────────────────────────────────────────────────

def rotate_assets(state: CampaignState) -> CampaignState:
    selected = state.get("selected_assets") or []
    vehicles = state.get("vehicles") or ["Magnite"]
    rotation = selected if selected else [{"vehicle": v, "asset_id": ""} for v in vehicles]

    start = date.fromisoformat(state["start_date"])
    end   = date.fromisoformat(state["end_date"])
    total_days = (end - start).days + 1

    goal = state.get("goal", "Campaign")
    themes = state["themes"] or [f"Day {i + 1} — {goal}" for i in range(total_days)]

    days = []
    for i in range(total_days):
        slot = rotation[i % len(rotation)]
        days.append({
            "day_num": i + 1,
            "date":    (start + timedelta(days=i)).isoformat(),
            "theme":   themes[i] if i < len(themes) else f"Day {i + 1}",
            "vehicle": slot.get("vehicle", "Magnite"),
            "asset_id": slot.get("asset_id", ""),
            "file_url": slot.get("file_url"),
        })

    return {**state, "result": days}


# ── Node 5: build_calendar ────────────────────────────────────────────────────

def build_calendar(state: CampaignState) -> CampaignState:
    days = state.get("result") or []
    cleaned = [
        {
            "day_num":  d["day_num"],
            "date":     d["date"],
            "theme":    d["theme"],
            "vehicle":  d.get("vehicle"),
            "asset_id": d.get("asset_id"),
        }
        for d in days
    ]
    return {**state, "result": cleaned}


# ── Graph ─────────────────────────────────────────────────────────────────────

_g = StateGraph(CampaignState)
_g.add_node("validate_input", validate_input)
_g.add_node("detect_events",  detect_events)
_g.add_node("plan_themes",    plan_themes)
_g.add_node("rotate_assets",  rotate_assets)
_g.add_node("build_calendar", build_calendar)

_g.set_entry_point("validate_input")
_g.add_edge("validate_input", "detect_events")
_g.add_edge("detect_events",  "plan_themes")
_g.add_edge("plan_themes",    "rotate_assets")
_g.add_edge("rotate_assets",  "build_calendar")
_g.add_edge("build_calendar", END)

campaign_planning_agent = _g.compile()
