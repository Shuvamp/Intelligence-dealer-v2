# Phase 8 - Docker and Production Readiness

## Goal

Containerized deployment.

## Containers

frontend

api

langgraph-workers

duckdb

redis

nginx

future-supabase

## Health Endpoints

/api/health

/agents/health

/db/health

## Monitoring

Structured Logging

Metrics

Tracing

Audit Logs

Error Tracking

## Failure Recovery

Validation Failure

* Reject lead
* Log reason

Scoring Failure

* Fallback heuristic

Assignment Failure

* Assign to UNASSIGNED_POOL

Workflow Failure

* Create manual task

WhatsApp Failure

* Retry 3 times

Call Analysis Failure

* Queue for retry

Database Failure

* Retry persistence

## Acceptance Criteria

* docker compose up works
* Health checks operational
* Monitoring operational
* Recovery mechanisms tested
