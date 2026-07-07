# Phase 3 - Workflow Agent

## Goal

Automatically determine next best action.

## Inputs

Lead Score

Lead Classification

Lead History

Call Sentiment

Communication History

## Outputs

CALL

WHATSAPP

EMAIL

TEST_DRIVE

MANAGER_ESCALATION

NURTURE

CLOSE

## Rules

HOT_PLUS

* Immediate call
* Manager notification

HOT

* Call
* WhatsApp

WARM

* Follow-up within 24 hours

COLD

* Nurture sequence

DEAD

* Close lead

## Persistence

workflow_actions

lead_tasks

timeline_events

## Acceptance Criteria

* Recommendations generated
* Actions persisted
* Timeline updated
