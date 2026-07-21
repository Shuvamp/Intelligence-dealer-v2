"""Follow-up Agent: fetch lead -> decide action -> draft message -> notify assignee.

LangGraph pipeline (team standard). Data access is over Supabase/PostgREST;
the LLM is Groq with a deterministic fallback so it runs with zero config.
"""
import logging
import re
from datetime import datetime, timezone

from langgraph.graph import END, StateGraph

from .data import FollowupData
from .llm import GroqCallError, get_groq_client
from .state import FollowupState
from .prompts import (
    ACTION_DECISION_SYSTEM, ACTION_DECISION_USER,
    MESSAGE_DRAFT_SYSTEM, MESSAGE_DRAFT_USER,
    NISSAN_ADVANTAGES, fallback_talking_points,
)

log = logging.getLogger(__name__)
_data = FollowupData()

# Maps competitor_details string (e.g. "HIGH - Kia Sonet...") to brand key
_COMP_RE = re.compile(
    r"\b(kia|hyundai|tata|mahindra|honda|toyota|mg|maruti)\b", re.IGNORECASE
)


def _extract_competitor_brand(competitor_details: str | None) -> str | None:
    """Return the lower-case brand name from a competitor_details string, or None."""
    if not competitor_details:
        return None
    m = _COMP_RE.search(competitor_details)
    return m.group(1).lower() if m else None


async def node_fetch_detail(state: FollowupState) -> dict:
    lead = await _data.get_lead_with_customer(state["lead_id"])
    if not lead:
        return {"errors": [f"Lead {state['lead_id']} not found"], "lead": {}, "events": []}

    events = await _data.get_events(state["lead_id"], limit=20)

    # No separate scores table on this branch — the lead row carries the score.
    latest_score: dict | None = None

    # Fetch assignee name for personalised message.
    assignee: dict | None = None
    assigned_to = lead.get("assigned_to")
    if assigned_to:
        assignee = await _data.get_user(str(assigned_to))

    last_activity = lead.get("last_activity_at", "")
    try:
        ts = datetime.fromisoformat(str(last_activity).replace("Z", "+00:00"))
        days_idle = (datetime.now(timezone.utc) - ts).days
    except (ValueError, AttributeError):
        days_idle = 0

    last_event = events[0] if events else {}
    activity_summary = (
        f"{len(events)} events. Last: {last_event.get('type', 'none')} - "
        f"{last_event.get('summary', '')[:100]}"
    )

    return {
        "lead": lead,
        "events": events,
        "latest_score": latest_score,
        "assignee": assignee,
        "days_idle": days_idle,
        "last_event_type": last_event.get("type"),
        "activity_summary": activity_summary,
        "errors": state.get("errors", []),
    }


async def node_decide_action(state: FollowupState) -> dict:
    """LLM node - decide next best action type."""
    lead = state["lead"]
    if not lead:
        return {"recommended_action_type": "none", "action_rationale": "Lead not found."}

    if lead.get("score") == "dead" or lead.get("contact_invalid"):
        return {
            "recommended_action_type": "none",
            "action_rationale": "Lead is dead or has invalid contact.",
            "message_channel": None,
        }

    score = state.get("latest_score") or {}
    groq = get_groq_client()
    test_drive_done = any(e.get("type") == "test_drive" for e in state["events"])

    user_prompt = ACTION_DECISION_USER.format(
        category=score.get("category") or lead.get("score", "cold").upper(),
        score_value=lead.get("score_value", 0),
        stage=lead.get("stage", "new"),
        days_idle=state["days_idle"],
        has_phone=bool(lead.get("customer_phone")),
        has_email=bool(lead.get("customer_email")),
        vehicle_interest=lead.get("vehicle_interest") or "unspecified",
        test_drive_done=test_drive_done,
        competitor_alert=(
            score.get("competitor_details") or "No"
            if score.get("competitor_alert") else "No"
        ),
        has_assignee=bool(lead.get("assigned_to")),
        last_event_type=state.get("last_event_type") or "none",
        last_event_summary=state["activity_summary"],
        scoring_recommended_action=score.get("recommended_action") or "Follow up.",
    )
    try:
        result, _ = await groq.complete_json(
            node="decide_action",
            system_prompt=ACTION_DECISION_SYSTEM,
            user_prompt=user_prompt,
        )
        return {
            "recommended_action_type": result.get("action_type", "whatsapp"),
            "action_rationale": result.get("rationale", ""),
            "message_channel": result.get("channel", "whatsapp"),
        }
    except GroqCallError as exc:
        log.warning("followup.decide_action_fallback error=%s", exc)
        score_band = lead.get("score", "cold")
        action = {"hot": "call", "warm": "whatsapp", "cold": "nurture", "dead": "none"}.get(
            score_band, "whatsapp"
        )
        # Respect the "no call without phone" rule even in the fallback.
        if action == "call" and not lead.get("customer_phone"):
            action = "whatsapp"
        return {
            "recommended_action_type": action,
            "action_rationale": f"Rule-based: {score_band} lead, {state['days_idle']}d idle.",
            "message_channel": "call" if action == "call" else "whatsapp",
            "errors": state["errors"] + [f"decide_action_llm_failed: {exc}"],
        }


async def node_draft_message(state: FollowupState) -> dict:
    """LLM node - draft the outreach message, including competitor comparison when applicable."""
    action = state.get("recommended_action_type", "none")
    if action == "none":
        return {"drafted_message": None, "talking_points": []}

    lead = state["lead"]
    channel = state.get("message_channel") or "whatsapp"
    score = state.get("latest_score") or {}
    groq = get_groq_client()

    customer_name = (lead.get("customer_name") or "").split()[0] if lead.get("customer_name") else "there"
    exec_name = (state.get("assignee") or {}).get("full_name") or "our team"

    # Competitor comparison: only when customer explicitly mentioned a competitor.
    competitor_brand = _extract_competitor_brand(score.get("competitor_details"))
    if not score.get("competitor_alert") or not competitor_brand:
        competitor_brand = ""

    advantages_text = ""
    if competitor_brand:
        adv_list = NISSAN_ADVANTAGES.get(competitor_brand, [])
        advantages_text = "; ".join(adv_list[:3])  # top 3, LLM uses 1-2

    user_prompt = MESSAGE_DRAFT_USER.format(
        channel=channel,
        customer_name=customer_name,
        vehicle_interest=lead.get("vehicle_interest") or "the Nissan you were interested in",
        action_rationale=state.get("action_rationale") or "follow up",
        days_idle=state["days_idle"],
        category=score.get("category") or lead.get("score", "cold").upper(),
        exec_name=exec_name,
        competitor_brand=competitor_brand or "none",
        advantages=advantages_text or "none",
    )
    vehicle = lead.get("vehicle_interest")
    try:
        result, _ = await groq.complete_json(
            node="draft_message",
            system_prompt=MESSAGE_DRAFT_SYSTEM,
            user_prompt=user_prompt,
            temperature=0.4,
        )
        tp = result.get("talking_points")
        if not isinstance(tp, list) or not tp:
            tp = fallback_talking_points(vehicle)
        # Keep them short + capped at 3.
        tp = [str(p).strip() for p in tp if str(p).strip()][:3]
        return {"drafted_message": result.get("message", ""), "talking_points": tp}
    except GroqCallError as exc:
        log.warning("followup.draft_message_fallback error=%s", exc)
        return {
            "drafted_message": (
                f"Hi {customer_name}, following up on your Nissan enquiry. "
                "Would love to help you find the perfect car!"
            ),
            "talking_points": fallback_talking_points(vehicle),
            "errors": state["errors"] + [f"draft_message_llm_failed: {exc}"],
        }


async def node_write_nba(state: FollowupState) -> dict:
    """Write Next Best Action as a lead event and notify the assigned exec."""
    lead_id = state["lead_id"]
    lead = state["lead"]
    if not lead or not lead_id:
        return {"nba_event_id": None, "assignee_notified": False}

    action = state.get("recommended_action_type") or "none"
    message = state.get("drafted_message") or ""
    summary_parts = [f"NBA: {action.upper()}."]
    if state.get("action_rationale"):
        summary_parts.append(state["action_rationale"])
    if message:
        summary_parts.append(f"Draft: {message[:200]}")

    nba_id = await _data.add_event(
        tenant_id=state["tenant_id"],
        lead_id=lead_id,
        event_type="nba",
        summary=" ".join(summary_parts),
        metadata={
            "action_type": action,
            "channel": state.get("message_channel"),
            "drafted_message": message,
            "talking_points": state.get("talking_points") or [],
            "trigger_source": state["trigger_source"],
            "days_idle": state["days_idle"],
        },
    )

    assignee_id = lead.get("assigned_to")
    notified = False
    if assignee_id:
        exec_name = (state.get("assignee") or {}).get("full_name") or "You"
        vehicle = lead.get("vehicle_interest") or "Lead"
        try:
            await _data.create_notification(
                tenant_id=state["tenant_id"],
                user_id=assignee_id,
                title=f"Action needed: {vehicle}",
                message=(
                    f"{exec_name}, {action.upper()}: "
                    f"{state.get('action_rationale', '')[:200]}"
                    + (f"\nDraft: {message[:150]}" if message else "")
                ),
            )
            notified = True
        except Exception as exc:  # noqa: BLE001
            log.warning("followup.notify_failed error=%s", exc)

    return {"nba_event_id": nba_id, "assignee_notified": notified}


def build_followup_graph() -> StateGraph:
    g = StateGraph(FollowupState)
    g.add_node("fetch_detail", node_fetch_detail)
    g.add_node("decide_action", node_decide_action)
    g.add_node("draft_message", node_draft_message)
    g.add_node("write_nba", node_write_nba)

    g.set_entry_point("fetch_detail")
    g.add_edge("fetch_detail", "decide_action")
    g.add_edge("decide_action", "draft_message")
    g.add_edge("draft_message", "write_nba")
    g.add_edge("write_nba", END)
    return g


_followup_graph = build_followup_graph().compile()


def _initial_state(
    lead_id: str, tenant_id: str, execution_id: str, trigger_source: str
) -> FollowupState:
    return {
        "lead_id": lead_id,
        "tenant_id": tenant_id,
        "execution_id": execution_id,
        "trigger_source": trigger_source,
        "lead": {},
        "events": [],
        "latest_score": None,
        "assignee": None,
        "days_idle": 0,
        "last_event_type": None,
        "activity_summary": "",
        "recommended_action_type": None,
        "action_rationale": None,
        "drafted_message": None,
        "message_channel": None,
        "talking_points": [],
        "nba_event_id": None,
        "assignee_notified": False,
        "errors": [],
    }


async def run_followup_agent(
    lead_id: str,
    tenant_id: str,
    execution_id: str,
    trigger_source: str = "manual",
) -> FollowupState:
    initial = _initial_state(lead_id, tenant_id, execution_id, trigger_source)
    return await _followup_graph.ainvoke(initial)


# Order of nodes as wired in build_followup_graph — used to label stream progress.
FOLLOWUP_NODE_ORDER = ["fetch_detail", "decide_action", "draft_message", "write_nba"]


async def stream_followup_agent(
    lead_id: str,
    tenant_id: str,
    execution_id: str,
    trigger_source: str = "manual",
):
    """Run the graph, yielding ('node', node_name, merged_state) after each node
    completes, then ('done', None, final_state). Lets the UI show real progress."""
    initial = _initial_state(lead_id, tenant_id, execution_id, trigger_source)
    state: dict = dict(initial)
    async for update in _followup_graph.astream(initial, stream_mode="updates"):
        # `update` is {node_name: {partial state returned by that node}}
        for node_name, partial in update.items():
            if isinstance(partial, dict):
                state.update(partial)
            yield ("node", node_name, dict(state))
    yield ("done", None, state)
