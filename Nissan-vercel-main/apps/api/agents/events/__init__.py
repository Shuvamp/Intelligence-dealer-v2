"""Event-Driven Architecture (Phase 7).

A lightweight in-process async event bus that decouples the agents: producers
`publish()` domain events, subscribers react. No agent calls another agent
directly anymore — they communicate through events (ARCHITECTURE_RULES #4).

Public surface:
    from agents.events import bus, EventType, DomainEvent
    await bus.publish(DomainEvent(type=EventType.CALL_COMPLETED, lead_id=..., ...))
    bus.subscribe(EventType.CALL_COMPLETED, handler)

The bus persists every event to `domain_events` (observable + recoverable) and
retries failing handlers (rules #6/#7/#13/#14). A real broker (Redis/NATS) can
later replace the transport without touching producers or handlers.
"""
from .types import DomainEvent, EventType
from .bus import bus

__all__ = ["bus", "DomainEvent", "EventType"]
