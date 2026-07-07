"""Data access for the Workflow Agent over Supabase/PostgREST.

Locally this points at the DuckDB shim (SUPABASE_URL); on hosted it points at
real Supabase. Mirrors apps/api/agents/followup/data.py's pattern — each
agent owns its own thin REST client rather than sharing one, consistent
with how lead_validator/followup/assignment already do this independently.
"""
from __future__ import annotations

import json
import os

import httpx

SUPABASE_URL = os.getenv("SUPABASE_URL", "http://localhost:54321")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "local-dev-anon-key")


def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


class WorkflowData:
    """Thin async REST client scoped to what the workflow nodes need."""

    async def get_lead(self, lead_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/leads",
                params={
                    "id": f"eq.{lead_id}",
                    "select": "*,customer:customers(full_name)",
                    "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        if not rows:
            return None
        lead = rows[0]
        cust = lead.get("customer") or {}
        lead["customer_name"] = cust.get("full_name")
        return lead

    async def get_events(self, lead_id: str, limit: int = 20) -> list[dict]:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/lead_events",
                params={"lead_id": f"eq.{lead_id}", "order": "created_at.desc", "limit": str(limit)},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()

    async def get_messages(self, lead_id: str, limit: int = 20) -> list[dict]:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/lead_messages",
                params={"lead_id": f"eq.{lead_id}", "order": "created_at.desc", "limit": str(limit)},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()

    async def create_workflow_action(self, row: dict) -> str | None:
        payload = {**row, "actions": json.dumps(row.get("actions") or [])}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/workflow_actions", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")

    async def create_task(self, tenant_id: str, lead_id: str, title: str, due_at: str | None) -> str | None:
        payload = {"tenant_id": tenant_id, "lead_id": lead_id, "title": title, "due_at": due_at}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/lead_tasks", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")

    async def add_event(self, tenant_id: str, lead_id: str, summary: str, metadata: dict) -> str | None:
        payload = {
            "tenant_id": tenant_id,
            "lead_id": lead_id,
            "type": "workflow",
            "summary": summary,
            "metadata": json.dumps(metadata or {}),
            "created_by": None,
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/lead_events", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")

    async def create_notification(self, tenant_id: str, title: str, message: str) -> bool:
        # Note: the local shim's notifications table has no user_id column —
        # same caveat as the Follow-up Agent's create_notification.
        payload = {"tenant_id": tenant_id, "title": title, "message": message, "status": "unread"}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/notifications", json=payload, headers=_headers())
            r.raise_for_status()
        return True
