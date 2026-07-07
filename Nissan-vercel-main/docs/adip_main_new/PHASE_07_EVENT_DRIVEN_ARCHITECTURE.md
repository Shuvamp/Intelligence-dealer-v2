# Phase 7 - Event Driven Architecture

## Goal

Remove direct agent dependencies.

## Events

LEAD_CREATED

LEAD_VALIDATED

LEAD_SCORED

LEAD_ASSIGNED

MESSAGE_SENT

MESSAGE_READ

CALL_COMPLETED

SENTIMENT_UPDATED

LEAD_RESCORED

ACTION_RECOMMENDED

TEST_DRIVE_BOOKED

LEAD_CLOSED

## Rules

Agents communicate only through events.

No direct agent-to-agent calls.

## Benefits

Scalable

Observable

Recoverable

Extensible

## Acceptance Criteria

* Event bus implemented
* Agents consume events
* Retry mechanisms operational
