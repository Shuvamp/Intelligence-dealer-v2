"""Domain event types + envelope (Phase 7)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone


class EventType:
    """The 12 domain events from PHASE_07_EVENT_DRIVEN_ARCHITECTURE.md.

    Values are lowercase snake_case so they line up with the existing trigger
    vocabulary (e.g. the re-scoring `trigger` strings) and read cleanly in the
    `domain_events.event_type` column.
    """
    LEAD_CREATED = "lead_created"
    LEAD_VALIDATED = "lead_validated"
    LEAD_SCORED = "lead_scored"
    LEAD_ASSIGNED = "lead_assigned"
    MESSAGE_SENT = "message_sent"
    MESSAGE_READ = "message_read"
    CALL_COMPLETED = "call_completed"
    SENTIMENT_UPDATED = "sentiment_updated"
    LEAD_RESCORED = "lead_rescored"
    ACTION_RECOMMENDED = "action_recommended"
    TEST_DRIVE_BOOKED = "test_drive_booked"
    LEAD_CLOSED = "lead_closed"

    ALL = (
        LEAD_CREATED, LEAD_VALIDATED, LEAD_SCORED, LEAD_ASSIGNED,
        MESSAGE_SENT, MESSAGE_READ, CALL_COMPLETED, SENTIMENT_UPDATED,
        LEAD_RESCORED, ACTION_RECOMMENDED, TEST_DRIVE_BOOKED, LEAD_CLOSED,
    )


@dataclass
class DomainEvent:
    """An immutable fact that something happened. Carries everything a
    subscriber needs so handlers never have to call back to the producer."""
    type: str
    tenant_id: str
    lead_id: str | None = None
    payload: dict = field(default_factory=dict)
    source: str = "system"          # which producer emitted it (e.g. "call_intelligence")
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_row(self) -> dict:
        """Shape for the domain_events table."""
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "lead_id": self.lead_id,
            "event_type": self.type,
            "payload": self.payload,
            "source": self.source,
            "status": "pending",
            "attempts": 0,
            "created_at": self.created_at,
        }

    @classmethod
    def from_row(cls, row: dict) -> "DomainEvent":
        payload = row.get("payload")
        if isinstance(payload, str):
            import json
            try:
                payload = json.loads(payload)
            except (ValueError, TypeError):
                payload = {}
        return cls(
            type=row.get("event_type"),
            tenant_id=row.get("tenant_id"),
            lead_id=row.get("lead_id"),
            payload=payload or {},
            source=row.get("source") or "system",
            id=row.get("id"),
            created_at=row.get("created_at"),
        )
