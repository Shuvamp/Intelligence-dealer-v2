from typing import Optional, TypedDict


class FollowupState(TypedDict):
    lead_id: str
    tenant_id: str
    execution_id: str
    trigger_source: str     # 'post_scoring' | 'monitor_dispatch' | 'manual'

    lead: dict
    events: list[dict]
    latest_score: Optional[dict]
    assignee: Optional[dict]

    days_idle: int
    last_event_type: Optional[str]
    activity_summary: str

    recommended_action_type: Optional[str]  # call|whatsapp|email|test_drive|manager|nurture|none
    action_rationale: Optional[str]
    drafted_message: Optional[str]
    message_channel: Optional[str]
    talking_points: list[str]  # Nissan advantages/notes for the rep (always populated)

    nba_event_id: Optional[str]
    assignee_notified: bool
    errors: list[str]
