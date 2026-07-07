from typing import Optional, TypedDict


class WorkflowState(TypedDict):
    lead_id: str
    tenant_id: str
    execution_id: str
    trigger_source: str  # intake | manual | rescore | whatsapp_reply | call_intelligence

    # context (fetch_context)
    lead: dict
    events: list[dict]
    messages: list[dict]
    classification: Optional[str]  # hot | warm | cold | dead — leads.score
    score_value: Optional[int]
    test_drive_required: bool
    has_test_drive_event: bool
    # Not available until the Call Intelligence Agent exists (future phase) —
    # always None today; reading it never raises, it just has nothing to read.
    call_sentiment: Optional[str]

    # decision (decide_action)
    actions: list[str]  # subset of CALL|WHATSAPP|EMAIL|TEST_DRIVE|MANAGER_ESCALATION|NURTURE|CLOSE
    reasoning: Optional[str]
    rule_matched: Optional[str]  # hot | warm | cold | dead | test_drive_override
    escalated: bool

    # persistence (persist_action / notify_manager)
    workflow_action_id: Optional[str]
    task_ids: list[str]
    notified: bool
    errors: list[str]
