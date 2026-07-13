import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from agents.lead_validator.graph import lead_validator
from agents.lead_validator.state import LeadInput
from agents.intake_pipeline.contracts import empty_state, NodeDeps
from agents.scoring.graph import lead_scorer
from agents.scoring_bridge import (
    normalized_to_scoring_input,
    validated_lead_to_scoring_input,
)
from agents.followup.graph import (
    run_followup_agent,
    stream_followup_agent,
    FOLLOWUP_NODE_ORDER,
)
from agents.workflow.service import run_workflow_agent
from agents.rescoring.service import rescore_lead
from agents.whatsapp.service import run_whatsapp_agent
from agents.whatsapp.data import WhatsAppData
from agents.whatsapp.meta_provider import MetaWhatsAppProvider
from agents.call_intelligence.service import (
    process_call,
    get_call_detail,
    list_lead_calls,
)
from agents.call_intelligence.data import CallData
from agents.events import bus, DomainEvent, EventType  # Phase 7 — event bus

from app.routers import marketing, instagram, auth, linkedin, youtube, facebook, channels, publish, context_planner, website_extraction, company_summary, seo_agent, aeo_agent, recommendation_engine, report_generator, marketing_strategy, marketing_budget_planner
from app.routers import db as db_router

# GROQ_API_KEY (and the rest of apps/api/.env) is read ONCE here at startup.
# uvicorn --reload only watches .py files, so after editing .env you must
# restart the agent service (or touch a .py file) for a new key to take effect.
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

POSTERS_DIR = Path(__file__).resolve().parent / "generated" / "posters"
POSTERS_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR = Path(__file__).resolve().parent / "generated" / "videos"
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="ADIP API", version="0.1.0")

# Allow the web app (and the DuckDB shim) to call the agent API directly from the
# browser — needed for the EventSource follow-up stream (GET /followup/{id}/stream).
app.add_middleware(
    CORSMiddleware,
    # Allow all origins in development — FastAPI is only reachable from localhost
    # anyway. This unblocks call uploads (browser → :8000) from any dev port.
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Marketing module routers
app.include_router(marketing.router, prefix="/marketing", tags=["marketing"])
app.include_router(db_router.router)
app.include_router(instagram.router, prefix="/api/instagram", tags=["instagram"])
app.include_router(linkedin.router, prefix="/api/linkedin", tags=["linkedin"])
app.include_router(youtube.router, prefix="/api/youtube", tags=["youtube"])
app.include_router(facebook.router, prefix="/api/facebook", tags=["facebook"])
app.include_router(channels.router, prefix="/api/channels", tags=["channels"])
app.include_router(publish.router, prefix="/api/publish", tags=["publish"])
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(context_planner.router, prefix="/context-planner", tags=["context-planner"])
app.include_router(website_extraction.router, prefix="/website-extraction", tags=["website-extraction"])
app.include_router(company_summary.router, prefix="/company-summary", tags=["company-summary"])
app.include_router(seo_agent.router, prefix="/seo-agent", tags=["seo-agent"])
app.include_router(aeo_agent.router, prefix="/aeo-agent", tags=["aeo-agent"])
app.include_router(recommendation_engine.router, prefix="/recommendation-engine", tags=["recommendation-engine"])
app.include_router(report_generator.router, prefix="/report-generator", tags=["report-generator"])
app.include_router(marketing_strategy.router, prefix="/marketing-strategy", tags=["marketing-strategy"])
app.include_router(marketing_budget_planner.router, prefix="/marketing-budget-planner", tags=["marketing-budget-planner"])

app.mount("/posters", StaticFiles(directory=str(POSTERS_DIR)), name="posters")
app.mount("/videos", StaticFiles(directory=str(VIDEOS_DIR)), name="videos")

# ---------------------------------------------------------------------------
# Supabase / tenant constants
# ---------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "http://localhost:54321")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "local-dev-anon-key")
ABC_TENANT_ID = "11111111-1111-1111-1111-111111111111"
LOC_VEL_ID = "aaaaaaaa-0000-0000-0000-000000000001"


def _sb_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


# Stages that still count as an executive's open workload (won/lost are closed).
_OPEN_STAGES = "(new,contacted,qualified,test_drive,quotation,negotiation)"


async def _resolve_assignee(client, tenant_id: str, assignment: dict) -> dict:
    """Map the assignment agent's pick to a real public.users row.

    leads.assigned_to is a uuid FK to public.users. The assignment agent runs in
    its own executive namespace (ids like "exec-abc-priya"), which are NOT valid
    users — writing one makes Postgres reject the whole lead PATCH, silently
    dropping the score too. So resolve to a real sales_executive user: honour the
    agent's choice by first-name match when possible, else pick the least-loaded.
    Returns {"id": <uuid|None>, "name": <full_name|None>}.
    """
    try:
        r = await client.get(
            f"/rest/v1/users?tenant_id=eq.{tenant_id}&role=eq.sales_executive"
            "&select=id,full_name",
            headers=_sb_headers(),
        )
        execs = r.json() if r.status_code == 200 else []
        if not isinstance(execs, list) or not execs:
            return {"id": None, "name": None}

        # Try to honour the agent's chosen executive by first-name match.
        pick = (assignment.get("assignee_name") or "").strip().lower()
        if pick:
            for e in execs:
                fn = (e.get("full_name") or "").strip().lower()
                if fn and (fn == pick or pick in fn.split()):
                    return {"id": e["id"], "name": e.get("full_name")}

        # Fall back to the least-loaded sales_executive by open-lead count.
        ids = [e["id"] for e in execs]
        by_id = {e["id"]: e.get("full_name") for e in execs}
        lr = await client.get(
            f"/rest/v1/leads?tenant_id=eq.{tenant_id}&stage=in.{_OPEN_STAGES}"
            "&select=assigned_to",
            headers=_sb_headers(),
        )
        rows = lr.json() if lr.status_code == 200 else []
        counts = {i: 0 for i in ids}
        for row in rows if isinstance(rows, list) else []:
            a = row.get("assigned_to")
            if a in counts:
                counts[a] += 1
        chosen = min(ids, key=lambda i: counts[i])
        return {"id": chosen, "name": by_id.get(chosen)}
    except Exception:
        logger.exception("assignee resolution failed; leaving lead unassigned")
        return {"id": None, "name": None}


# ---------------------------------------------------------------------------
# SSE broadcast helpers
# ---------------------------------------------------------------------------
_sse_clients: set[asyncio.Queue] = set()


def _broadcast_lead(lead_data: dict) -> None:
    msg = f"event: new_lead\ndata: {json.dumps(lead_data)}\n\n"
    dead: set[asyncio.Queue] = set()
    for q in _sse_clients:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.add(q)
    _sse_clients.difference_update(dead)


# Lead Board UI (Phase 2) — mirrors _broadcast_lead's pattern for stage moves.
# Today the web app's EventSource connects to the shim (apps/local-api),
# which has its own equivalent POST /events/stage-change — this FastAPI
# endpoint exists for parity/consistency, not because anything calls it yet
# in the current local-dev wiring.
def _broadcast_stage_change(data: dict) -> None:
    msg = f"event: stage_change\ndata: {json.dumps(data)}\n\n"
    dead: set[asyncio.Queue] = set()
    for q in _sse_clients:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.add(q)
    _sse_clients.difference_update(dead)


# Workflow Agent (Phase 3) — same pattern as _broadcast_stage_change. The
# decision is made AND persisted inside this same request (unlike
# stage_change, whose write happens in apps/web), so no separate
# broadcast-only endpoint is needed — POST /workflow/{lead_id} below calls
# this directly after running the agent.
def _broadcast_workflow_action(data: dict) -> None:
    msg = f"event: workflow_action\ndata: {json.dumps(data)}\n\n"
    dead: set[asyncio.Queue] = set()
    for q in _sse_clients:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.add(q)
    _sse_clients.difference_update(dead)


async def _auto_trigger_workflow(
    lead_id: str,
    customer_name: str | None,
    *,
    tenant_id: str = ABC_TENANT_ID,
    trigger_source: str = "intake",
) -> None:
    """Run the Workflow Agent and broadcast its decision. Phase 7: this is now
    the body of the LEAD_ASSIGNED / LEAD_RESCORED event handlers (not called
    directly from intake anymore). Still never raises — a Workflow Agent failure
    must not break the platform (rule #13). `tenant_id`/`trigger_source` are
    parameterized so the same path serves both the intake and re-score chains."""
    try:
        result = await run_workflow_agent(
            lead_id=lead_id,
            tenant_id=tenant_id,
            execution_id=str(uuid.uuid4()),
            trigger_source=trigger_source,
        )
        _broadcast_workflow_action(
            {
                "lead_id": lead_id,
                "classification": result.get("classification"),
                "actions": result.get("actions", []),
                "escalated": result.get("escalated", False),
                "customer_name": customer_name,
            }
        )
        # Phase 7: emit ACTION_RECOMMENDED for observability (no subscriber today;
        # a future Notification/Comms agent can consume it). Emitted from the
        # handler so agents/workflow/nodes.py stays untouched.
        await bus.publish(DomainEvent(
            type=EventType.ACTION_RECOMMENDED,
            tenant_id=tenant_id,
            lead_id=lead_id,
            payload={
                "actions": result.get("actions", []),
                "classification": result.get("classification"),
                "escalated": result.get("escalated", False),
            },
            source="workflow",
        ))
    except Exception:  # noqa: BLE001
        logger.exception("workflow agent failed for lead %s", lead_id)


# ---------------------------------------------------------------------------
# Event-Driven Architecture (Phase 7) — subscribers + startup wiring
# ---------------------------------------------------------------------------
# Agents no longer call each other directly; they react to domain events. Each
# handler is a thin wrapper over an EXISTING agent service (extend, not replace),
# so the agents themselves are unchanged. The bus isolates + retries + persists.
async def _on_lead_assigned(event: DomainEvent) -> None:
    await _auto_trigger_workflow(
        event.lead_id, (event.payload or {}).get("customer_name"),
        tenant_id=event.tenant_id, trigger_source="intake",
    )


async def _on_call_completed(event: DomainEvent) -> None:
    await rescore_lead(
        lead_id=event.lead_id, tenant_id=event.tenant_id,
        trigger="call_completed", call_sentiment=(event.payload or {}).get("call_sentiment"),
    )


async def _on_message_read(event: DomainEvent) -> None:
    await rescore_lead(lead_id=event.lead_id, tenant_id=event.tenant_id, trigger="whatsapp_replied")


async def _on_test_drive_booked(event: DomainEvent) -> None:
    await rescore_lead(lead_id=event.lead_id, tenant_id=event.tenant_id, trigger="test_drive_booked")


async def _on_lead_rescored(event: DomainEvent) -> None:
    # Re-score → Workflow chain: only re-run the Workflow Agent when the score
    # actually changed (idempotent; avoids no-op workflow re-runs).
    if (event.payload or {}).get("score_changed"):
        await _auto_trigger_workflow(
            event.lead_id, (event.payload or {}).get("customer_name"),
            tenant_id=event.tenant_id, trigger_source="rescore",
        )


def _register_event_handlers() -> None:
    bus.subscribe(EventType.LEAD_ASSIGNED, _on_lead_assigned)
    bus.subscribe(EventType.CALL_COMPLETED, _on_call_completed)
    bus.subscribe(EventType.MESSAGE_READ, _on_message_read)
    bus.subscribe(EventType.TEST_DRIVE_BOOKED, _on_test_drive_booked)
    bus.subscribe(EventType.LEAD_RESCORED, _on_lead_rescored)


_publisher_task: asyncio.Task | None = None
_publisher_stop: asyncio.Event | None = None


@app.on_event("startup")
async def _start_auto_publisher() -> None:
    global _publisher_task, _publisher_stop
    from app.services.auto_publisher import run_loop
    _publisher_stop = asyncio.Event()
    _publisher_task = asyncio.create_task(run_loop(_publisher_stop), name="auto-publisher")


@app.on_event("shutdown")
async def _stop_auto_publisher() -> None:
    if _publisher_stop:
        _publisher_stop.set()
    if _publisher_task:
        _publisher_task.cancel()
        try:
            await _publisher_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    from app.db import duckdb as _duckdb
    _duckdb.close_all()


_linkedin_analytics_task: asyncio.Task | None = None
_linkedin_analytics_stop: asyncio.Event | None = None


@app.on_event("startup")
async def _start_linkedin_analytics_poller() -> None:
    global _linkedin_analytics_task, _linkedin_analytics_stop
    from app.services.linkedin_analytics_poller import run_loop
    _linkedin_analytics_stop = asyncio.Event()
    _linkedin_analytics_task = asyncio.create_task(
        run_loop(_linkedin_analytics_stop), name="linkedin-analytics-poller"
    )


@app.on_event("shutdown")
async def _stop_linkedin_analytics_poller() -> None:
    if _linkedin_analytics_stop:
        _linkedin_analytics_stop.set()
    if _linkedin_analytics_task:
        _linkedin_analytics_task.cancel()
        try:
            await _linkedin_analytics_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


@app.on_event("startup")
async def _phase7_startup() -> None:
    _register_event_handlers()
    try:
        await bus.replay()  # recoverability: re-dispatch any unprocessed events
    except Exception:  # noqa: BLE001
        logger.exception("event replay on startup failed")


# ---------------------------------------------------------------------------
# Sequential pipeline runner (deps injected directly — no LangGraph complexity)
# ---------------------------------------------------------------------------
async def _run_pipeline(raw_lead: dict, source: str, deps: NodeDeps) -> dict:
    from agents.intake_pipeline.nodes.validate import validate_node
    from agents.intake_pipeline.nodes.normalize import normalize_node
    from agents.intake_pipeline.nodes.score import score_node
    from agents.intake_pipeline.nodes.assign import assign_node

    state = empty_state(raw_lead, source)
    state.update(await validate_node(state, deps))
    if state["errors"]:
        return state
    state.update(await normalize_node(state, deps))
    state.update(await score_node(state, deps))
    state.update(await assign_node(state, deps))
    return state


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class NormalizedLeadRequest(BaseModel):
    """Pipeline NormalizedLead shape sent by score.node.js / the /score endpoint."""
    lead_id: str | None = None
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    vehicle: str | None = None
    city: str | None = None
    test_drive_required: bool | None = None
    budget: float | None = None
    buy_timeline_days: int | None = None
    callback_days: int | None = None
    contact_medium: str | None = None
    # Enquiry-form signal fields (feed scoring_bridge → scoring dimensions).
    financing: str | None = None            # cash | pre_approved | loan_needed | unsure
    nissan_relationship: str | None = None  # current_owner | past_owner | referred | new
    brand_consideration: str | None = None  # only_nissan | comparing
    comparing_brands: str | None = None     # free text when brand_consideration == comparing
    purchase_reason: str | None = None      # replacement | occasion | business | first_car | researching
    source: str | None = None


class ValidateLeadRequest(BaseModel):
    tenant_id: str
    source: str
    full_name: str | None = None
    phone: str | None = None
    email: str | None = None
    vehicle_interest: str | None = None
    city: str | None = None
    test_drive_requested: bool | None = None
    budget_range: str | None = None
    purchase_timeframe: str | None = None
    preferred_call_time: str | None = None
    preferred_channel: str | None = None


class IntakeLeadRequest(BaseModel):
    source: str = "website"
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    vehicle: str | None = None
    city: str | None = None
    test_drive: bool | None = None
    budget: float | None = None
    buy_timeline_days: int | None = None
    callback_days: int | None = None
    contact_medium: str | None = None
    # Enquiry-form signal fields (carried through to scoring).
    financing: str | None = None
    nissan_relationship: str | None = None
    brand_consideration: str | None = None
    comparing_brands: str | None = None
    purchase_reason: str | None = None


class WorkflowRequest(BaseModel):
    trigger_source: str = "manual"


class RescoreRequest(BaseModel):
    trigger: str = "manual"
    # Phase 5 passes call_id when trigger="call_completed" so the re-scorer
    # can read the call_analysis row and enrich the scoring input.
    call_id: str | None = None
    # Phase 5 Call Intelligence also sends a one-word sentiment summary.
    call_sentiment: str | None = None
    # Legacy field name used by shim's triggerRescore() / Phase 5 handoff —
    # maps to trigger ("call_intelligence" → "call_completed").
    trigger_source: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/followup/{lead_id}")
async def followup(lead_id: str):
    """Run the Follow-up Agent for a lead: decide the next best action, draft an
    outreach message, log an NBA event on the lead, and notify the assignee.
    Used by the Leads UI 'Generate follow-up' button."""
    execution_id = str(uuid.uuid4())
    try:
        result = await run_followup_agent(
            lead_id=lead_id,
            tenant_id=ABC_TENANT_ID,
            execution_id=execution_id,
            trigger_source="manual",
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("followup agent failed")
        return JSONResponse(status_code=500, content={"error": str(e)})

    if result.get("errors") and not result.get("lead"):
        raise HTTPException(status_code=404, detail={"errors": result["errors"]})

    return _followup_response(lead_id, result)


def _followup_response(lead_id: str, result: dict) -> dict:
    """Shape the agent's final state into the JSON the UI consumes."""
    return {
        "success": True,
        "lead_id": lead_id,
        "action_type": result.get("recommended_action_type"),
        "channel": result.get("message_channel"),
        "rationale": result.get("action_rationale"),
        "message": result.get("drafted_message"),
        "nba_event_id": result.get("nba_event_id"),
        "assignee_notified": result.get("assignee_notified"),
        "days_idle": result.get("days_idle"),
        "talking_points": result.get("talking_points", []),
        "errors": result.get("errors", []),
        "steps": _followup_steps(result),
    }


@app.post("/workflow/{lead_id}")
async def workflow(lead_id: str, body: WorkflowRequest = WorkflowRequest()):
    """Run the Workflow Agent for a lead: decide the next action(s) from its
    score/classification/history, persist a workflow_actions record + a
    lead_tasks row per action + a timeline entry, and escalate to a manager
    if hot. Auto-triggered after intake (see apps/local-api/server.js's
    triggerWorkflowAgent); also callable on demand."""
    execution_id = str(uuid.uuid4())
    try:
        result = await run_workflow_agent(
            lead_id=lead_id,
            tenant_id=ABC_TENANT_ID,
            execution_id=execution_id,
            trigger_source=body.trigger_source,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("workflow agent failed")
        return JSONResponse(status_code=500, content={"error": str(e)})

    if result.get("errors") and not result.get("lead"):
        raise HTTPException(status_code=404, detail={"errors": result["errors"]})

    response = {
        "success": True,
        "lead_id": lead_id,
        "classification": result.get("classification"),
        "actions": result.get("actions", []),
        "reasoning": result.get("reasoning"),
        "rule_matched": result.get("rule_matched"),
        "escalated": result.get("escalated", False),
        "workflow_action_id": result.get("workflow_action_id"),
        "task_ids": result.get("task_ids", []),
        "errors": result.get("errors", []),
    }
    _broadcast_workflow_action(
        {
            "lead_id": lead_id,
            "classification": response["classification"],
            "actions": response["actions"],
            "escalated": response["escalated"],
            "customer_name": (result.get("lead") or {}).get("customer_name"),
        }
    )
    return response


@app.get("/followup/{lead_id}/stream")
async def followup_stream(lead_id: str):
    """SSE variant of POST /followup: emits a `node` event as each LangGraph node
    finishes (real backend timing), then a final `result` event with the full
    payload. Consumed by the Leads UI 'Generate follow-up' button via EventSource."""
    execution_id = str(uuid.uuid4())

    async def gen() -> AsyncIterator[str]:
        yield "event: connected\ndata: {}\n\n"
        final: dict = {}
        try:
            async for kind, node_name, state in stream_followup_agent(
                lead_id=lead_id,
                tenant_id=ABC_TENANT_ID,
                execution_id=execution_id,
                trigger_source="manual",
            ):
                if kind == "node":
                    n = FOLLOWUP_NODE_ORDER.index(node_name) + 1 if node_name in FOLLOWUP_NODE_ORDER else 0
                    payload = {"n": n, "node": node_name, "steps": _followup_steps(state)}
                    yield f"event: node\ndata: {json.dumps(payload)}\n\n"
                else:  # done
                    final = state
        except Exception as e:  # noqa: BLE001
            logger.exception("followup stream failed")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
            return
        if final.get("errors") and not final.get("lead"):
            yield f"event: error\ndata: {json.dumps({'errors': final.get('errors', [])})}\n\n"
            return
        yield f"event: result\ndata: {json.dumps(_followup_response(lead_id, final))}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _followup_steps(s: dict) -> list[dict]:
    """A human-readable trace of what each LangGraph node did, for the UI."""
    errs = s.get("errors", [])
    decide_fb = any(str(e).startswith("decide_action_llm_failed") for e in errs)
    draft_fb = any(str(e).startswith("draft_message_llm_failed") for e in errs)
    action = s.get("recommended_action_type") or "none"
    assignee = (s.get("assignee") or {}).get("full_name")
    msg = s.get("drafted_message") or ""

    return [
        {
            "n": 1, "label": "Fetch detail", "engine": "data",
            "status": "done",
            "detail": f"Loaded lead + {len(s.get('events', []))} events · idle "
                      f"{s.get('days_idle', 0)}d · assignee {assignee or '—'}",
        },
        {
            "n": 2, "label": "Decide action", "engine": "rule" if decide_fb else "groq",
            "status": "fallback" if decide_fb else "done",
            "detail": f"{action.upper()} — {s.get('action_rationale') or '—'}",
        },
        {
            "n": 3, "label": "Draft message", "engine": "rule" if draft_fb else "groq",
            "status": "skipped" if action == "none" else ("fallback" if draft_fb else "done"),
            "detail": (f"Drafted {s.get('message_channel') or 'whatsapp'} message "
                       f"({len(msg)} chars)") if msg else "Skipped — no outreach for this lead",
        },
        {
            "n": 4, "label": "Write NBA", "engine": "data",
            "status": "done" if s.get("nba_event_id") else "skipped",
            "detail": ("Logged NBA event · "
                       + ("assignee notified" if s.get("assignee_notified") else "no assignee to notify"))
            if s.get("nba_event_id") else "Nothing written",
        },
    ]


@app.post("/score")
async def score(body: NormalizedLeadRequest):
    """
    Run the full Python LangGraph scoring agent on a pipeline normalized lead.
    Called by apps/local-api score.node.js. Returns the agent's complete
    final_output (all dimensions, reasoning, flags) — nothing dropped.
    """
    scoring_input = normalized_to_scoring_input(body.model_dump())

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lead_scorer.invoke, scoring_input)
    except Exception as e:
        logger.exception("lead_scorer failed")
        return JSONResponse(status_code=500, content={"error": str(e)})

    return result.get("final_output", {})


@app.post("/validate-lead")
async def validate_lead(body: ValidateLeadRequest):
    initial_state = {
        "lead": LeadInput(**body.model_dump()),
        "errors": [],
        "warnings": [],
        "is_duplicate": False,
        "lead_id": None,
        "customer_id": None,
        "enquiry_count": None,
        "normalized_phone": None,
        "status": "pending",
    }

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lead_validator.invoke, initial_state)
    except Exception as e:
        logger.exception("lead_validator failed")
        return JSONResponse(status_code=500, content={"error": str(e)})

    return {
        "status": result["status"],
        "lead_id": result["lead_id"],
        "customer_id": result["customer_id"],
        "enquiry_count": result["enquiry_count"],
        "normalized_phone": result["normalized_phone"],
        "source": result["lead"].get("source"),
        "warnings": result["warnings"],
        "errors": result["errors"],
        "is_duplicate": result["is_duplicate"],
    }


@app.post("/validate-and-score")
async def validate_and_score(body: ValidateLeadRequest):
    """
    Full pipeline: lead_validator → scoring agent.

    1. Runs the lead_validator LangGraph agent (validate + dedup + persist).
    2. If the lead is invalid, stops and returns the validation errors (HTTP 400) —
       an unscorable lead never reaches the scorer.
    3. Otherwise feeds the validated/persisted lead into the scoring agent and
       returns the validation summary plus the full scoring final_output.
    """
    initial_state = {
        "lead": LeadInput(**body.model_dump()),
        "errors": [],
        "warnings": [],
        "is_duplicate": False,
        "lead_id": None,
        "customer_id": None,
        "enquiry_count": None,
        "normalized_phone": None,
        "status": "pending",
    }

    try:
        loop = asyncio.get_event_loop()
        validation = await loop.run_in_executor(None, lead_validator.invoke, initial_state)
    except Exception as e:
        logger.exception("lead_validator failed")
        return JSONResponse(status_code=500, content={"error": str(e)})

    validation_summary = {
        "status": validation["status"],
        "lead_id": validation["lead_id"],
        "customer_id": validation["customer_id"],
        "enquiry_count": validation["enquiry_count"],
        "normalized_phone": validation["normalized_phone"],
        "warnings": validation["warnings"],
        "errors": validation["errors"],
        "is_duplicate": validation["is_duplicate"],
    }

    if validation["status"] == "invalid":
        return JSONResponse(
            status_code=400,
            content={"validation": validation_summary, "scoring": None},
        )

    scoring_input = validated_lead_to_scoring_input(body.model_dump(), validation)

    try:
        scoring = await loop.run_in_executor(None, lead_scorer.invoke, scoring_input)
    except Exception as e:
        logger.exception("lead_scorer failed")
        return JSONResponse(
            status_code=500,
            content={"validation": validation_summary, "error": str(e)},
        )

    return {
        "validation": validation_summary,
        "scoring": scoring.get("final_output", {}),
    }


@app.post("/intake/leads")
async def intake_lead(body: IntakeLeadRequest):
    raw_lead = body.model_dump()
    deps = NodeDeps(
        supabase_url=SUPABASE_URL,
        tenant_id=ABC_TENANT_ID,
        anthropic_key=os.getenv("ANTHROPIC_API_KEY"),
    )

    result = await _run_pipeline(raw_lead, body.source, deps)

    if result["errors"]:
        raise HTTPException(
            status_code=400,
            detail={"error": "Lead validation failed", "errors": result["errors"]},
        )

    normalized = result["normalized"]
    scoring = result["scoring"]
    assignment = result["assignment"]
    # scored_by lives inside the full agent output (scoring["detail"]); the
    # human-readable note is surfaced first-class on scoring["score_notice"].
    scored_by = (scoring.get("detail") or {}).get("scored_by")
    score_notice = scoring.get("score_notice")
    now = datetime.now(timezone.utc).isoformat()

    # validate_node (lead_validator) already created — or, for a repeat
    # enquiry, found and incremented enquiry_count on — the customer + lead
    # row, plus a lead_interactions/validation_logs record. Re-inserting here
    # would create a second row on every request, so we PATCH the row it
    # already persisted instead of inserting a fresh one.
    lead_id = result["lead_id"]
    is_duplicate = result.get("is_duplicate", False)

    # assigned_to must be a real public.users id (FK); resolve the agent's pick.
    assigned_user_id = None
    assignee_name = assignment.get("assignee_name")
    async with httpx.AsyncClient(base_url=SUPABASE_URL) as client:
        if not is_duplicate:
            # Per PHASE_01_VALIDATION_AGENT.md, a duplicate only gets
            # enquiry_count incremented + a lead_interactions record (both
            # already done by lead_validator) — its existing score/assignment
            # are left as-is, not overwritten by this submission's results.
            resolved = await _resolve_assignee(client, ABC_TENANT_ID, assignment)
            assigned_user_id = resolved["id"]
            if resolved["name"]:
                assignee_name = resolved["name"]
            await client.patch(
                f"/rest/v1/leads?id=eq.{lead_id}",
                json={
                    "location_id": LOC_VEL_ID,
                    "score": scoring["score"],
                    "score_value": scoring["score_value"],
                    "score_reasons": scoring.get("reasons") or [],
                    "scored_by": scored_by,
                    "score_notice": score_notice,
                    "assigned_to": assigned_user_id,
                    "vehicle_interest": normalized.get("vehicle"),
                    "budget": normalized.get("budget"),
                    "test_drive_required": normalized.get("test_drive_required", False),
                    "purchase_timeline_days": normalized.get("buy_timeline_days"),
                    "callback_within_days": normalized.get("callback_days"),
                    "contact_medium": normalized.get("contact_medium"),
                    "updated_at": now,
                    "last_activity_at": now,
                },
                headers=_sb_headers(),
            )

    # broadcast SSE event to connected dashboard clients
    _broadcast_lead(
        {
            "id": lead_id,
            "customer_name": normalized["name"],
            "source": body.source,
            "score": scoring["score"],
            "score_value": scoring["score_value"],
            "scored_by": scored_by,
            "score_notice": score_notice,
            "assignee_name": assignee_name,
            "vehicle_interest": normalized.get("vehicle"),
            "contact_medium": normalized.get("contact_medium"),
            "test_drive_required": normalized.get("test_drive_required"),
            "created_at": now,
        }
    )

    # Phase 7: intake no longer calls the Workflow Agent directly — it publishes
    # LEAD_ASSIGNED, which the workflow subscriber (_on_lead_assigned) consumes.
    # publish() returns immediately (dispatch is backgrounded), so the intake
    # response is never blocked — same non-blocking guarantee as the old
    # fire-and-forget create_task.
    await bus.publish(DomainEvent(
        type=EventType.LEAD_ASSIGNED,
        tenant_id=ABC_TENANT_ID,
        lead_id=lead_id,
        payload={"customer_name": normalized["name"]},
        source="intake",
    ))

    return {
        "success": True,
        "lead": {
            "id": lead_id,
            "customer_name": normalized["name"],
            "source": body.source,
            "stage": "new",
            "score": scoring["score"],
            "score_value": scoring["score_value"],
            "scored_by": scored_by,
            "score_notice": score_notice,
            "assignee_name": assignee_name,
            "vehicle_interest": normalized.get("vehicle"),
            "contact_medium": normalized.get("contact_medium"),
            "test_drive_required": normalized.get("test_drive_required"),
            "is_duplicate": is_duplicate,
            "enquiry_count": result.get("enquiry_count"),
            "created_at": now,
        },
        "scoring": scoring,
        "assignment": assignment,
    }


@app.get("/intake/stream")
async def intake_stream():
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _sse_clients.add(q)

    async def event_generator() -> AsyncIterator[str]:
        yield "event: connected\ndata: {}\n\n"
        try:
            while True:
                msg = await asyncio.wait_for(q.get(), timeout=30)
                yield msg
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass
        finally:
            _sse_clients.discard(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class StageChangeEvent(BaseModel):
    lead_id: str
    from_stage: str | None = None
    to_stage: str
    customer_name: str | None = None
    vehicle_interest: str | None = None


@app.post("/events/stage-change")
async def stage_change_event(body: StageChangeEvent):
    """Broadcast-only — see _broadcast_stage_change. The DB write itself
    happens elsewhere (apps/web's updateLeadStage, direct to Supabase)."""
    _broadcast_stage_change({**body.model_dump(), "changed_at": datetime.now(timezone.utc).isoformat()})
    return {"ok": True}


# ---------------------------------------------------------------------------
# WhatsApp Agent (Phase 4)
# ---------------------------------------------------------------------------

# SSE broadcast for delivery status updates.
# Unlike workflow_action (which is made+broadcast in the same request), delivery
# status arrives via Meta's webhook — a separate HTTP call. The browser's
# EventSource points at the shim (port 54321), not here, so after persisting
# the status update we forward it to the shim's /events/whatsapp-status
# endpoint which then broadcasts to connected SSE clients (Phase 2 pattern).
def _broadcast_whatsapp_status(data: dict) -> None:
    msg = f"event: whatsapp_status\ndata: {json.dumps(data)}\n\n"
    dead: set[asyncio.Queue] = set()
    for q in _sse_clients:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.add(q)
    _sse_clients.difference_update(dead)


_whatsapp_data = WhatsAppData()

WHATSAPP_WEBHOOK_VERIFY_TOKEN = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "")

# ── Call Intelligence (Phase 5) ──────────────────────────────────────────────
_call_data = CallData()
# Recordings live on local disk in dev; prod would use a Supabase Storage bucket.
CALL_UPLOAD_DIR = os.getenv("CALL_UPLOAD_DIR", os.path.join(os.path.dirname(__file__), ".uploads"))
# Audio + common video containers (mp4/mov/webm) — faster-whisper decodes the
# audio track of a video via ffmpeg, so a phone-recorded mp4 works fine.
_ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".aac", ".mp4", ".mov", ".webm"}
_MAX_AUDIO_BYTES = int(os.getenv("CALL_MAX_AUDIO_MB", "25")) * 1024 * 1024


class WhatsAppSendRequest(BaseModel):
    message: str
    attachment_id: str | None = None
    media_url: str | None = None       # public URL for image / video / document
    media_type: str | None = None      # "image" | "video" | "document"


@app.post("/whatsapp/send/{lead_id}")
async def whatsapp_send(lead_id: str, body: WhatsAppSendRequest):
    """Run the WhatsApp Agent for a lead: validate the rep's message, call the
    provider (Meta or Mock), persist to lead_messages + message_delivery_logs,
    and return the wamid and provider used. Called by the 'Send via WhatsApp'
    button on the lead detail drawer."""
    result = await run_whatsapp_agent(
        lead_id=lead_id,
        tenant_id=ABC_TENANT_ID,
        message_text=body.message,
        attachment_id=body.attachment_id,
        media_url=body.media_url,
        media_type=body.media_type,
    )

    if result.get("errors") and not result.get("lead"):
        raise HTTPException(status_code=404, detail={"errors": result["errors"]})

    wamid = result.get("wamid")
    not_configured = any("send_failed" in str(e) for e in result.get("errors", []))

    return {
        "success": bool(wamid),
        "lead_id": lead_id,
        "wamid": wamid,
        "status": "sent" if wamid else None,
        "provider": result.get("provider_used"),
        "message_id": result.get("message_id"),
        "message": body.message,
        "reason": "whatsapp_not_configured" if not_configured and not wamid else None,
        "errors": result.get("errors", []),
    }


@app.get("/whatsapp/webhook")
async def whatsapp_webhook_verify(
    hub_mode: str | None = None,
    hub_verify_token: str | None = None,
    hub_challenge: str | None = None,
):
    """Meta hub.challenge verification handshake."""
    # FastAPI maps query param names with dots to underscores automatically,
    # but Meta sends hub.mode / hub.verify_token / hub.challenge — handle both.
    if hub_mode == "subscribe" and hub_verify_token == WHATSAPP_WEBHOOK_VERIFY_TOKEN:
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(status_code=403, detail="Webhook verification failed")


@app.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    """Receive delivery status updates and inbound customer messages from Meta.

    Security: HMAC-SHA256 verified via X-Hub-Signature-256. Gracefully skipped
    when WHATSAPP_APP_SECRET is unset (local dev without real Meta credentials).
    """
    body = await request.body()

    # Signature verification (skipped gracefully in mock/local dev)
    sig = request.headers.get("X-Hub-Signature-256", "")
    if not MetaWhatsAppProvider.verify_signature(body, sig):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    from agents.whatsapp.mock_provider import _parse_meta_payload
    events = _parse_meta_payload(payload)
    now = datetime.now(timezone.utc).isoformat()

    for event in events:
        if event["event_type"] == "status":
            await _handle_delivery_status(event, now)
        elif event["event_type"] == "inbound":
            asyncio.create_task(_handle_inbound_message(event, now))

    return {"ok": True}


async def _handle_delivery_status(event: dict, now: str) -> None:
    wamid = event.get("wamid")
    status = event.get("status")
    if not wamid or not status:
        return

    msg = await _whatsapp_data.get_message_by_wamid(wamid)
    if not msg:
        logger.warning("Webhook status update for unknown wamid: %s", wamid)
        return

    try:
        await _whatsapp_data.update_message_status(wamid, status)
        await _whatsapp_data.create_delivery_log({
            "tenant_id": msg["tenant_id"],
            "message_id": msg["id"],
            "status": status,
            "meta_timestamp": event.get("meta_timestamp"),
            "webhook_payload": event,
            "created_at": now,
        })
    except Exception:
        logger.exception("Failed to persist delivery status for wamid=%s", wamid)
        return

    # Broadcast to shim SSE (the browser connects to the shim, not to :8000)
    status_payload = {
        "lead_id": msg.get("lead_id"),
        "wamid": wamid,
        "status": status,
        "updated_at": now,
    }
    _broadcast_whatsapp_status(status_payload)
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=5) as c:
            await c.post("/events/whatsapp-status", json=status_payload, headers=_sb_headers())
    except Exception:
        logger.warning("Failed to forward whatsapp-status to shim SSE")


async def _handle_inbound_message(event: dict, now: str) -> None:
    from_phone = event.get("from_phone", "")
    body_text = event.get("body", "")

    lead = await _whatsapp_data.get_lead_by_phone(from_phone)
    if not lead:
        logger.info("Inbound WhatsApp from unknown phone %s — ignored", from_phone)
        return

    try:
        await _whatsapp_data.create_message({
            "tenant_id": lead["tenant_id"],
            "lead_id": lead["id"],
            "channel": "whatsapp",
            "direction": "inbound",
            "body": body_text,
            "source": "whatsapp_inbound",
            "whatsapp_message_id": event.get("wamid"),
            "status": "read",
            "created_at": now,
        })
    except Exception:
        logger.exception("Failed to persist inbound WhatsApp message")
        return

    # Phase 7: publish MESSAGE_READ instead of calling agents directly. The
    # subscriber (_on_message_read) re-scores the lead (trigger=whatsapp_replied);
    # if the reply changes the score, the resulting LEAD_RESCORED event re-runs
    # the Workflow Agent — so the inbound reply still drives a workflow decision,
    # now through the event chain rather than a direct call.
    await bus.publish(DomainEvent(
        type=EventType.MESSAGE_READ,
        tenant_id=lead["tenant_id"],
        lead_id=lead["id"],
        payload={"channel": "whatsapp", "direction": "inbound", "customer_name": lead.get("customer_name")},
        source="whatsapp",
    ))

    # Notify the browser in real time — rep sees a pop-up and the Outreach Log reloads.
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=5) as c:
            await c.post("/events/whatsapp-inbound", json={
                "type": "whatsapp_inbound",
                "lead_id": lead["id"],
                "customer_name": lead.get("customer_name", "Customer"),
                "body_preview": body_text[:120],
            }, headers=_sb_headers())
    except Exception:
        logger.warning("Failed to broadcast whatsapp-inbound event to shim")


# ---------------------------------------------------------------------------
# Call Intelligence Agent (Phase 5) — upload → transcribe → analyse → hand off
# ---------------------------------------------------------------------------
@app.post("/calls/upload")
async def calls_upload(lead_id: str = Form(...), audio_file: UploadFile = File(...)):
    """Accept a call recording (mp3/wav/m4a), store it on disk, create a
    call_recordings row, and kick off async processing. Returns immediately —
    transcription/analysis run in the background (status polled via GET)."""
    ext = os.path.splitext(audio_file.filename or "")[1].lower()
    if ext not in _ALLOWED_AUDIO_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported audio format '{ext}'. Allowed: {sorted(_ALLOWED_AUDIO_EXT)}")

    contents = await audio_file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > _MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_AUDIO_BYTES // (1024 * 1024)} MB limit")

    lead = await _call_data.get_lead(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail=f"Lead {lead_id} not found")
    tenant_id = lead.get("tenant_id") or ABC_TENANT_ID

    call_id = str(uuid.uuid4())
    dest_dir = os.path.join(CALL_UPLOAD_DIR, tenant_id, lead_id)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, f"{call_id}{ext}")
    with open(dest_path, "wb") as fh:
        fh.write(contents)

    await _call_data.create_recording({
        "id": call_id,
        "tenant_id": tenant_id,
        "lead_id": lead_id,
        "file_name": audio_file.filename,
        "recording_url": dest_path,
        "status": "uploaded",
    })

    # Fire-and-forget: never block the upload on transcription/LLM.
    asyncio.create_task(process_call(call_id))
    return {"call_id": call_id, "status": "uploaded"}


@app.post("/calls/{call_id}/analyze")
async def calls_analyze(call_id: str):
    """Manual retry — re-run transcribe → extract → persist for a recording
    (idempotent: call_analysis is keyed by call_id, so it updates in place)."""
    recording = await _call_data.get_recording(call_id)
    if not recording:
        raise HTTPException(status_code=404, detail=f"Call {call_id} not found")
    asyncio.create_task(process_call(call_id))
    return {"call_id": call_id, "status": "processing"}


@app.get("/calls/{call_id}")
async def calls_get(call_id: str):
    detail = await get_call_detail(call_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Call {call_id} not found")
    return detail


@app.get("/calls/{call_id}/audio")
async def calls_audio(call_id: str):
    recording = await _call_data.get_recording(call_id)
    path = (recording or {}).get("recording_url")
    if not recording or not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(path, filename=recording.get("file_name") or os.path.basename(path))


@app.get("/leads/{lead_id}/calls")
async def lead_calls(lead_id: str):
    return {"calls": await list_lead_calls(lead_id)}


# ---------------------------------------------------------------------------
# Dynamic Re-Scoring Agent (Phase 6) — re-run scoring from live lead context
# ---------------------------------------------------------------------------
# RescoreRequest is defined once near WorkflowRequest above (it carries trigger,
# call_id, call_sentiment, and the legacy trigger_source field).
@app.post("/rescore/{lead_id}")
async def rescore(lead_id: str, body: RescoreRequest = RescoreRequest()):
    """Dynamic Re-Scoring (Phase 6): re-run the existing scoring agent from the
    lead's current DB context (events/messages — which now include Call
    Intelligence's persisted analysis), persist lead_score_history, and re-trigger
    the Workflow Agent if the score changed. Reachable by:
    - The 'Re-score this lead' button (trigger=manual)
    - Shim's triggerRescore() on stage drag (trigger=stage_change)
    - Phase 5 Call Intelligence handoff (trigger_source=call_intelligence, +call_id)
    - WhatsApp inbound webhook (trigger=whatsapp_replied)
    Never raises — errors are captured and returned in the response body."""
    # Normalize the trigger across callers (Phase 5 sends trigger_source).
    trigger = body.trigger
    if body.trigger_source == "call_intelligence":
        trigger = "call_completed"
    elif body.trigger_source:
        trigger = body.trigger_source
    try:
        result = await rescore_lead(
            lead_id=lead_id,
            tenant_id=ABC_TENANT_ID,
            trigger=trigger,
            call_sentiment=body.call_sentiment,
            call_id=body.call_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("rescore endpoint failed for lead %s", lead_id)
        return JSONResponse(status_code=500, content={"error": str(e)})

    if "lead_not_found" in result.get("errors", []):
        raise HTTPException(status_code=404, detail={"errors": result["errors"]})

    return {"lead_id": lead_id, "trigger": trigger, **result}


# ---------------------------------------------------------------------------
# Event-Driven Architecture (Phase 7) — observability + recovery endpoints
# ---------------------------------------------------------------------------
@app.get("/events")
async def list_events(lead_id: str | None = None, limit: int = 50):
    """Observability: list recent domain events (optionally for one lead).
    Reads the `domain_events` log the bus persists."""
    params = {"select": "*", "order": "created_at.desc", "limit": str(min(limit, 200))}
    if lead_id:
        params["lead_id"] = f"eq.{lead_id}"
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
        r = await c.get("/rest/v1/domain_events", params=params, headers=_sb_headers())
        r.raise_for_status()
        return {"events": r.json()}


@app.post("/events/replay")
async def replay_events():
    """Recoverability: re-dispatch any persisted events not yet `done`
    (pending/failed). Idempotent — handlers are safe to re-run."""
    count = await bus.replay()
    return {"replayed": count}
