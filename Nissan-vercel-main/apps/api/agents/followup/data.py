"""Data access for the Follow-up Agent over Supabase/PostgREST.

Hits SUPABASE_URL (real Supabase). Replaces the asyncpg pool + repositories
the original code used.
"""
from __future__ import annotations

import json
import os

import httpx

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")


def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


class FollowupData:
    """Thin async REST client scoped to what the follow-up nodes need."""

    async def get_lead_with_customer(self, lead_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/leads",
                params={
                    "id": f"eq.{lead_id}",
                    "select": "*,customer:customers(full_name,phone,email)",
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
        # Flatten the embedded customer into the flat keys the nodes expect.
        lead["customer_name"] = cust.get("full_name")
        lead["customer_phone"] = cust.get("phone")
        lead["customer_email"] = cust.get("email")
        return lead

    async def get_events(self, lead_id: str, limit: int = 20) -> list[dict]:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/lead_events",
                params={
                    "lead_id": f"eq.{lead_id}",
                    "order": "created_at.desc",
                    "limit": str(limit),
                },
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()

    async def get_user(self, user_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/users",
                params={"id": f"eq.{user_id}", "select": "id,full_name", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def add_event(
        self, tenant_id: str, lead_id: str, event_type: str, summary: str, metadata: dict
    ) -> str | None:
        # The shim stores metadata as a JSON string and re-parses it on read.
        payload = {
            "tenant_id": tenant_id,
            "lead_id": lead_id,
            "type": event_type,
            "summary": summary,
            "metadata": json.dumps(metadata or {}),
            "created_by": None,
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/lead_events", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")

    async def create_notification(self, tenant_id: str, user_id: str, title: str, message: str) -> bool:
        # notifications.user_id is NOT NULL (supabase/migrations/0004_notifications_audit.sql)
        # — the recipient must always be supplied by the caller.
        payload = {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "title": title,
            "message": message,
            "status": "unread",
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/notifications", json=payload, headers=_headers())
            r.raise_for_status()
        return True
