"""Unit tests for the Workflow Agent (Phase 3).

Covers the PHASE_03_WORKFLOW_AGENT.md acceptance criteria: recommendations
generated (the pure `decide()` rule table), actions persisted, timeline
updated, escalation, and that a repeat run creates a new record rather than
mutating the previous one.
"""
import pytest

from agents.workflow.nodes import decide
from agents.workflow.graph import workflow_agent
import agents.workflow.nodes as workflow_nodes


# ---- decide() — pure, no I/O ------------------------------------------------

def test_hot_gets_call_whatsapp_and_escalation():
    actions, reasoning, rule = decide("hot", test_drive_required=False, has_test_drive_event=False)
    assert actions == ["call", "whatsapp", "manager_escalation"]
    assert rule == "hot"
    assert reasoning


def test_warm_gets_whatsapp_only():
    actions, _, rule = decide("warm", test_drive_required=False, has_test_drive_event=False)
    assert actions == ["whatsapp"]
    assert rule == "warm"


def test_cold_gets_nurture():
    actions, _, rule = decide("cold", test_drive_required=False, has_test_drive_event=False)
    assert actions == ["nurture"]
    assert rule == "cold"


def test_dead_gets_close():
    actions, _, rule = decide("dead", test_drive_required=False, has_test_drive_event=False)
    assert actions == ["close"]
    assert rule == "dead"


def test_unknown_classification_defaults_safely():
    actions, reasoning, rule = decide(None, test_drive_required=False, has_test_drive_event=False)
    assert actions == ["nurture"]
    assert rule == "unknown"
    assert "No recognised classification" in reasoning


def test_test_drive_override_adds_action_when_not_already_done():
    actions, reasoning, _ = decide("warm", test_drive_required=True, has_test_drive_event=False)
    assert actions == ["whatsapp", "test_drive"]
    assert "Test drive" in reasoning


def test_test_drive_override_skipped_when_already_done():
    actions, _, _ = decide("warm", test_drive_required=True, has_test_drive_event=True)
    assert actions == ["whatsapp"]


def test_test_drive_override_not_duplicated_if_already_present():
    # Defensive: if a future rule ever already includes test_drive, the
    # override must not add a second copy.
    actions, _, _ = decide("hot", test_drive_required=True, has_test_drive_event=False)
    assert actions.count("test_drive") <= 1


# ---- Full graph — mocked data layer, no real DB/shim needed ---------------

class _FakeWorkflowData:
    def __init__(self, lead: dict, events: list, messages: list):
        self._lead = lead
        self._events = events
        self._messages = messages
        self.workflow_actions: list[dict] = []
        self.tasks: list[dict] = []
        self.timeline: list[dict] = []
        self.notifications: list[dict] = []

    async def get_lead(self, lead_id):
        return self._lead

    async def get_events(self, lead_id, limit=20):
        return self._events

    async def get_messages(self, lead_id, limit=20):
        return self._messages

    async def create_workflow_action(self, row):
        self.workflow_actions.append(row)
        return f"wa-{len(self.workflow_actions)}"

    async def create_task(self, tenant_id, lead_id, title, due_at):
        self.tasks.append({"title": title, "due_at": due_at})
        return f"task-{len(self.tasks)}"

    async def add_event(self, tenant_id, lead_id, summary, metadata):
        self.timeline.append({"summary": summary, "metadata": metadata})
        return f"evt-{len(self.timeline)}"

    async def create_notification(self, tenant_id, title, message):
        self.notifications.append({"title": title, "message": message})
        return True


def _initial_state(lead_id="lead-1", trigger_source="manual"):
    return {
        "lead_id": lead_id,
        "tenant_id": "tenant-1",
        "execution_id": "exec-1",
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


@pytest.fixture
def fake_data(monkeypatch):
    fake = _FakeWorkflowData(
        lead={"id": "lead-1", "score": "hot", "score_value": 92, "test_drive_required": False, "customer_name": "Test User"},
        events=[],
        messages=[],
    )
    monkeypatch.setattr(workflow_nodes, "_data", fake)
    return fake


@pytest.mark.asyncio
async def test_hot_lead_persists_action_tasks_timeline_and_notifies(fake_data):
    result = await workflow_agent.ainvoke(_initial_state())

    assert result["classification"] == "hot"
    assert result["actions"] == ["call", "whatsapp", "manager_escalation"]
    assert result["escalated"] is True
    assert len(fake_data.workflow_actions) == 1
    assert len(fake_data.tasks) == 3  # one per action
    assert len(fake_data.timeline) == 1
    assert len(fake_data.notifications) == 1  # manager notified


@pytest.mark.asyncio
async def test_cold_lead_does_not_escalate_or_notify(fake_data):
    fake_data._lead["score"] = "cold"
    result = await workflow_agent.ainvoke(_initial_state())

    assert result["actions"] == ["nurture"]
    assert result["escalated"] is False
    assert len(fake_data.notifications) == 0


@pytest.mark.asyncio
async def test_rerun_creates_a_new_record_not_a_mutation(fake_data):
    await workflow_agent.ainvoke(_initial_state(trigger_source="intake"))
    await workflow_agent.ainvoke(_initial_state(trigger_source="rescore"))

    assert len(fake_data.workflow_actions) == 2
    assert len(fake_data.timeline) == 2
    assert fake_data.workflow_actions[0]["trigger_source"] == "intake"
    assert fake_data.workflow_actions[1]["trigger_source"] == "rescore"


@pytest.mark.asyncio
async def test_missing_lead_does_not_raise(fake_data):
    fake_data._lead = None
    result = await workflow_agent.ainvoke(_initial_state(lead_id="missing"))

    assert result["errors"]
    assert result["actions"] == []
    assert len(fake_data.workflow_actions) == 0
