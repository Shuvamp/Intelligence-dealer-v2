# Phase 1 - Validation Agent

## Goal

Replace current validate_node stub.

## Requirements

Validate:

* Phone number
* Email address
* Required fields
* Duplicate phone
* Duplicate email

## Duplicate Logic

If duplicate phone OR email exists:

Do not create new customer.

Update:

enquiry_count += 1

Create:

lead_interaction record

## Pipeline

Lead
→ Validation
→ Normalization
→ Scoring
→ Assignment

## Database Tables

customers

lead_interactions

validation_logs

## Acceptance Criteria

* Duplicate detection works
* enquiry_count updates
* Invalid leads rejected
* Validation persisted
* Unit tests pass

## Failure Handling

Validation failure:

* Reject lead
* Store reason
* Log audit event
