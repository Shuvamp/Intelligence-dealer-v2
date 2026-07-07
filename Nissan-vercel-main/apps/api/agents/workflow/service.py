"""Integration surface for the Workflow Agent (Phase 3).

`run_workflow_agent(...)` mirrors `agents/followup/graph.py`'s
`run_followup_agent` signature exactly, so callers (FastAPI's
POST /workflow/{lead_id}, and later any auto-trigger) look the same as the
already-wired Follow-up Agent. `trigger_source` is the extension point for
the two "Future ..." inputs in the phase doc — "whatsapp_reply" and
"call_intelligence" are accepted values today even though nothing fires
them yet (those agents don't exist), so this graph won't need to change
shape when they do.
"""
from .graph import workflow_agent
from .state import WorkflowState


def _initial_state(lead_id: str, tenant_id: str, execution_id: str, trigger_source: str) -> WorkflowState:
    return {
        "lead_id": lead_id,
        "tenant_id": tenant_id,
        "execution_id": execution_id,
        "trigger_source": trigger_source,
        "lead": {},
        "events": [],
        "messages": [],
        "classification": None,
        "score_value": None,
        "test_drive_required": False,
        "has_test_drive_event": False,
        "call_sentiment": None,
        "actions": [],
        "reasoning": None,
        "rule_matched": None,
        "escalated": False,
        "workflow_action_id": None,
        "task_ids": [],
        "notified": False,
        "errors": [],
    }


async def run_workflow_agent(
    lead_id: str,
    tenant_id: str,
    execution_id: str,
    trigger_source: str = "manual",
) -> WorkflowState:
    initial = _initial_state(lead_id, tenant_id, execution_id, trigger_source)
    return await workflow_agent.ainvoke(initial)
