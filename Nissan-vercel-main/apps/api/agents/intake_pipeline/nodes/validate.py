"""
NODE 1 — VALIDATE    OWNER: AMIRTHA
Position: Source → [VALIDATE] → normalize → score → assign → DB
Reads   : state["raw_lead"], state["source"]
Writes  : { "errors": list[str] }  — [] = pass, non-empty = reject (HTTP 400)

Delegates to the real Lead Validator agent (apps/api/agents/lead_validator) —
phone/email format checks, duplicate-phone-or-email detection, and
persistence (creates the customer + lead row itself, writes a
lead_interactions record on duplicates, and a validation_logs row on every
outcome). See docs/adip_main_new/PHASE_01_VALIDATION_AGENT.md.

Also returns lead_id / customer_id / is_duplicate / enquiry_count merged onto
state. These aren't part of PipelineState's declared shape — contracts.py is
read-only/owned by Partha — but main.py's /intake/leads handler reads them
off the plain dict (TypedDict isn't enforced at runtime) so it can PATCH the
row lead_validator already persisted instead of inserting a duplicate one.
"""
import asyncio

from ..contracts import PipelineState, NodeDeps
from agents.lead_validator.graph import lead_validator
from agents.lead_validator.state import LeadInput


async def validate_node(state: PipelineState, deps: NodeDeps) -> dict:
    raw = state["raw_lead"]
    tenant_id = deps.get("tenant_id") if isinstance(deps, dict) else None

    lead_input: LeadInput = {
        "tenant_id": tenant_id,
        "source": state["source"],
        "full_name": raw.get("name"),
        "phone": raw.get("phone"),
        "email": raw.get("email"),
        "vehicle_interest": raw.get("vehicle"),
        "city": raw.get("city"),
        "test_drive_requested": raw.get("test_drive"),
        # Categorical form fields (budget_range/purchase_timeframe/etc.) come
        # from the "book test drive" form's dropdowns, which /intake/leads
        # doesn't carry (it has numeric budget/buy_timeline_days instead —
        # those are written separately by score/assign's own DB columns).
        # lead_validator only warns, never rejects, on these being absent.
        "budget_range": None,
        "purchase_timeframe": None,
        "preferred_call_time": None,
        "preferred_channel": None,
    }
    initial_state = {
        "lead": lead_input,
        "errors": [],
        "warnings": [],
        "is_duplicate": False,
        "lead_id": None,
        "customer_id": None,
        "enquiry_count": None,
        "normalized_phone": None,
        "status": "pending",
    }

    # lead_validator.invoke is sync (blocking httpx calls) — off-load so it
    # doesn't block the event loop, same pattern main.py uses for
    # POST /validate-lead.
    result = await asyncio.get_event_loop().run_in_executor(
        None, lead_validator.invoke, initial_state
    )

    return {
        "errors": [e["message"] for e in result.get("errors", [])],
        "lead_id": result.get("lead_id"),
        "customer_id": result.get("customer_id"),
        "is_duplicate": result.get("is_duplicate", False),
        "enquiry_count": result.get("enquiry_count"),
    }
