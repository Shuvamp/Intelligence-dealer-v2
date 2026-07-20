"""Assignment write actions — port of the old Node dev-shim's 4 endpoints
(apps/local-api/agents/assignmentAgent.js + assignmentAgentGraph.js) onto
FastAPI-over-Supabase. Called by apps/web/src/lib/assignments.ts, which sends
only a Bearer token (no tenant_id in the body) — tenant_id is resolved
server-side from the token here, mirroring assignments.ts's own tenantId()
helper (Supabase auth user -> public.users.tenant_id, else the demo tenant).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY
from agents.assignment.agent import AssignmentAgent
from agents.assignment.database import Database

logger = logging.getLogger(__name__)
router = APIRouter()

_KEY = SUPABASE_SERVICE_KEY
DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111"


def _headers(prefer: str = "return=representation") -> dict:
    return {
        "apikey": _KEY,
        "Authorization": f"Bearer {_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _resolve_tenant_id(authorization: str | None) -> str:
    if not authorization:
        return DEMO_TENANT_ID
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        try:
            u = await c.get("/auth/v1/user", headers={"apikey": _KEY, "Authorization": authorization})
            u.raise_for_status()
            user_id = u.json().get("id")
            if not user_id:
                return DEMO_TENANT_ID
            r = await c.get(
                "/rest/v1/users",
                headers=_headers(),
                params={"id": f"eq.{user_id}", "select": "tenant_id"},
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0]["tenant_id"] if rows else DEMO_TENANT_ID
        except Exception:
            return DEMO_TENANT_ID


class AssignLeadRequest(BaseModel):
    lead_id: str
    score: str


class CompleteLeadRequest(BaseModel):
    lead_id: str
    executive_id: str


class DeactivateExecutiveRequest(BaseModel):
    executive_id: str


@router.post("/assign-lead")
async def assign_lead(req: AssignLeadRequest, authorization: str | None = Header(None)):
    tenant_id = await _resolve_tenant_id(authorization)
    agent = AssignmentAgent(Database())
    try:
        return await agent.assign_lead_with_graph(tenant_id, {"lead_id": req.lead_id, "score": req.score})
    except Exception as err:  # noqa: BLE001
        logger.exception("[assign-lead] failed")
        return {"success": False, "message": f"Assignment failed: {err}"}


@router.post("/complete-lead")
async def complete_lead(req: CompleteLeadRequest, authorization: str | None = Header(None)):
    tenant_id = await _resolve_tenant_id(authorization)
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        try:
            await c.post(
                "/rest/v1/lead_completions",
                headers=_headers("return=minimal"),
                json={
                    "completion_id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "lead_id": req.lead_id,
                    "executive_id": req.executive_id,
                    "completed_at": _now(),
                },
            )

            cur = await c.get(
                "/rest/v1/sales_executives",
                headers=_headers(),
                params={"id": f"eq.{req.executive_id}", "select": "name,current_lead_count"},
            )
            cur.raise_for_status()
            rows = cur.json()
            exec_row = rows[0] if rows else {"name": "Unknown", "current_lead_count": 0}

            await c.patch(
                "/rest/v1/sales_executives",
                headers=_headers("return=minimal"),
                params={"id": f"eq.{req.executive_id}"},
                json={"current_lead_count": max(0, exec_row["current_lead_count"] - 1)},
            )

            await c.post(
                "/rest/v1/assignment_notifications",
                headers=_headers("return=minimal"),
                json={
                    "notification_id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "lead_id": req.lead_id,
                    "executive_id": req.executive_id,
                    "event_type": "lead_completed",
                    "message": f"{exec_row['name']} completed lead {req.lead_id}",
                    "is_read": False,
                    "created_at": _now(),
                },
            )
            return {"success": True, "message": "Lead completed. Executive load updated."}
        except Exception as err:  # noqa: BLE001
            logger.exception("[complete-lead] failed")
            return {"success": False, "message": f"Completion failed: {err}"}


@router.post("/deactivate-executive")
async def deactivate_executive(req: DeactivateExecutiveRequest, authorization: str | None = Header(None)):
    tenant_id = await _resolve_tenant_id(authorization)
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        try:
            await c.patch(
                "/rest/v1/sales_executives",
                headers=_headers("return=minimal"),
                params={"id": f"eq.{req.executive_id}"},
                json={"status": "inactive"},
            )

            name_r = await c.get(
                "/rest/v1/sales_executives",
                headers=_headers(),
                params={"id": f"eq.{req.executive_id}", "select": "name"},
            )
            name_r.raise_for_status()
            name_rows = name_r.json()
            exec_name = name_rows[0]["name"] if name_rows else "Unknown"

            assigned_r = await c.get(
                "/rest/v1/lead_assignments",
                headers=_headers(),
                params={
                    "tenant_id": f"eq.{tenant_id}",
                    "executive_id": f"eq.{req.executive_id}",
                    "select": "lead_id,score",
                },
            )
            assigned_r.raise_for_status()
            completed_r = await c.get(
                "/rest/v1/lead_completions",
                headers=_headers(),
                params={"tenant_id": f"eq.{tenant_id}", "select": "lead_id"},
            )
            completed_r.raise_for_status()
            completed_ids = {row["lead_id"] for row in completed_r.json()}
            unfinished = [row for row in assigned_r.json() if row["lead_id"] not in completed_ids]

            await c.patch(
                "/rest/v1/sales_executives",
                headers=_headers("return=minimal"),
                params={"id": f"eq.{req.executive_id}"},
                json={"current_lead_count": 0},
            )

            agent = AssignmentAgent(Database())
            reassigned_leads = [
                await agent.assign_lead_with_graph(tenant_id, {"lead_id": ul["lead_id"], "score": ul["score"]})
                for ul in unfinished
            ]

            # assignment_notifications.lead_id is NOT NULL — this event is
            # per-executive, not per-lead, so best-effort attach it to one of
            # the reassigned leads (or skip if there were none) rather than
            # failing the whole deactivation over a notification row.
            if unfinished:
                try:
                    await c.post(
                        "/rest/v1/assignment_notifications",
                        headers=_headers("return=minimal"),
                        json={
                            "notification_id": str(uuid4()),
                            "tenant_id": tenant_id,
                            "lead_id": unfinished[0]["lead_id"],
                            "executive_id": req.executive_id,
                            "event_type": "executive_deactivated",
                            "message": f"{exec_name} deactivated; {len(unfinished)} lead(s) reassigned",
                            "is_read": False,
                            "created_at": _now(),
                        },
                    )
                except Exception:  # noqa: BLE001
                    logger.warning("[deactivate-executive] notification insert failed")
            return {"success": True, "message": "Executive deactivated", "reassigned_leads": reassigned_leads}
        except Exception as err:  # noqa: BLE001
            logger.exception("[deactivate-executive] failed")
            return {"success": False, "message": f"Deactivation failed: {err}"}


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str):
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        try:
            r = await c.patch(
                "/rest/v1/notifications",
                headers=_headers("return=minimal"),
                params={"id": f"eq.{notification_id}"},
                json={"status": "read"},
            )
            r.raise_for_status()
            return {"success": True}
        except Exception as err:  # noqa: BLE001
            logger.exception("[notifications/read] failed")
            return {"success": False}
