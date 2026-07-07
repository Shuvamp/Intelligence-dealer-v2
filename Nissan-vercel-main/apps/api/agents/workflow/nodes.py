"""Workflow Agent nodes (Phase 3).

fetch_context → decide_action → persist_action → [notify_manager] → END

decide_action's core logic (`decide()`) is a pure function — no I/O, no LLM
call. The phase doc gives a complete deterministic rule table; per the
project's "never implement future phases" rule, this agent doesn't add an
LLM call the spec didn't ask for. Every node follows the rest of the
codebase's "never break the platform" convention: a node never raises, a
partial failure degrades to a safe default and is recorded in `errors`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from .data import WorkflowData
from .state import WorkflowState

logger = logging.getLogger(__name__)
_data = WorkflowData()

# Human-readable task titles per action, used both for the lead_tasks row
# and the templated `reasoning` string (no LLM — see module docstring).
ACTION_TITLE = {
    "call": "Call the lead",
    "whatsapp": "Follow up via WhatsApp",
    "email": "Follow up via email",
    "test_drive": "Schedule a test drive",
    "manager_escalation": "Escalate to manager — hot lead",
    "nurture": "Add to nurture sequence",
    "close": "Close lead — no further action",
}

# due-date offset per action, in hours; None = no due date (e.g. CLOSE).
ACTION_DUE_HOURS = {
    "call": 0,
    "whatsapp": 24,
    "email": 24,
    "test_drive": 48,
    "manager_escalation": 0,
    "nurture": 24 * 7,
    "close": None,
}


def decide(
    classification: str | None,
    test_drive_required: bool,
    has_test_drive_event: bool,
) -> tuple[list[str], str, str]:
    """Pure rule table → (actions, reasoning, rule_matched). No I/O.

    `classification` is the lead's existing 4-way score bucket
    (hot|warm|cold|dead) — HOT+ and HOT are intentionally the same `hot`
    bucket here (per direction), so `hot`'s actions are the union of the
    phase doc's HOT_PLUS + HOT rules (call, whatsapp, manager escalation).
    """
    c = (classification or "").lower()

    if c == "hot":
        actions, reasoning, rule = (
            ["call", "whatsapp", "manager_escalation"],
            "Hot lead — immediate call, WhatsApp follow-up, and manager notified per workflow rules.",
            "hot",
        )
    elif c == "warm":
        actions, reasoning, rule = (
            ["whatsapp"],
            "Warm lead — follow up within 24 hours via WhatsApp per workflow rules.",
            "warm",
        )
    elif c == "cold":
        actions, reasoning, rule = (
            ["nurture"],
            "Cold lead — added to the nurture sequence per workflow rules.",
            "cold",
        )
    elif c == "dead":
        actions, reasoning, rule = (
            ["close"],
            "Dead lead — closed, no further action per workflow rules.",
            "dead",
        )
    else:
        # Unscored/unknown classification — safe default, never raises.
        actions, reasoning, rule = (
            ["nurture"],
            f"No recognised classification ('{classification}') — defaulted to nurture.",
            "unknown",
        )

    if test_drive_required and not has_test_drive_event and "test_drive" not in actions:
        actions = [*actions, "test_drive"]
        reasoning += " Test drive requested and not yet completed — added to the action list."
        rule = "test_drive_override" if rule == "unknown" else rule

    return actions, reasoning, rule


async def fetch_context_node(state: WorkflowState) -> dict:
    lead = await _data.get_lead(state["lead_id"])
    if not lead:
        return {"errors": [f"Lead {state['lead_id']} not found"], "lead": {}}

    events = await _data.get_events(state["lead_id"])
    messages = await _data.get_messages(state["lead_id"])
    has_test_drive_event = any(e.get("type") == "test_drive" for e in events)

    return {
        "lead": lead,
        "events": events,
        "messages": messages,
        "classification": lead.get("score"),
        "score_value": lead.get("score_value"),
        "test_drive_required": bool(lead.get("test_drive_required")),
        "has_test_drive_event": has_test_drive_event,
        "call_sentiment": None,  # Call Intelligence Agent doesn't exist yet.
        "errors": state.get("errors", []),
    }


async def decide_action_node(state: WorkflowState) -> dict:
    if not state.get("lead"):
        return {"actions": [], "reasoning": None, "rule_matched": None, "escalated": False}

    actions, reasoning, rule = decide(
        state.get("classification"),
        state.get("test_drive_required", False),
        state.get("has_test_drive_event", False),
    )
    return {
        "actions": actions,
        "reasoning": reasoning,
        "rule_matched": rule,
        "escalated": "manager_escalation" in actions,
    }


async def persist_action_node(state: WorkflowState) -> dict:
    if not state.get("lead") or not state.get("actions"):
        return {"workflow_action_id": None, "task_ids": []}

    tenant_id = state["tenant_id"]
    lead_id = state["lead_id"]
    actions = state["actions"]
    errors = list(state.get("errors", []))
    now = datetime.now(timezone.utc)

    workflow_action_id = None
    try:
        workflow_action_id = await _data.create_workflow_action(
            {
                "tenant_id": tenant_id,
                "lead_id": lead_id,
                "classification": state.get("classification"),
                "actions": actions,
                "reasoning": state.get("reasoning"),
                "rule_matched": state.get("rule_matched"),
                "trigger_source": state.get("trigger_source"),
                "escalated": state.get("escalated", False),
                "created_at": now.isoformat(),
            }
        )
    except Exception:  # noqa: BLE001
        logger.exception("workflow_actions insert failed")
        errors.append("persist_workflow_action_failed")

    task_ids: list[str] = []
    for action in actions:
        due_hours = ACTION_DUE_HOURS.get(action)
        due_at = (now + timedelta(hours=due_hours)).isoformat() if due_hours is not None else None
        try:
            task_id = await _data.create_task(
                tenant_id, lead_id, ACTION_TITLE.get(action, action), due_at
            )
            if task_id:
                task_ids.append(task_id)
        except Exception:  # noqa: BLE001
            logger.exception("lead_tasks insert failed for action %s", action)
            errors.append(f"persist_task_failed:{action}")

    try:
        await _data.add_event(
            tenant_id,
            lead_id,
            f"Workflow agent: {', '.join(a.replace('_', ' ') for a in actions)}.",
            {"actions": actions, "rule_matched": state.get("rule_matched"), "trigger_source": state.get("trigger_source")},
        )
    except Exception:  # noqa: BLE001
        logger.exception("lead_events insert failed")
        errors.append("persist_timeline_failed")

    return {"workflow_action_id": workflow_action_id, "task_ids": task_ids, "errors": errors}


async def notify_manager_node(state: WorkflowState) -> dict:
    if not state.get("escalated"):
        return {"notified": False}
    lead = state.get("lead") or {}
    try:
        await _data.create_notification(
            state["tenant_id"],
            "Hot lead needs attention",
            f"{lead.get('customer_name') or 'A lead'} is HOT and needs an immediate call.",
        )
        return {"notified": True}
    except Exception:  # noqa: BLE001
        logger.exception("manager notification failed")
        return {"notified": False, "errors": [*state.get("errors", []), "notify_manager_failed"]}
