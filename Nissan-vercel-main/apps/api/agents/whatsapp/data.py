"""Data access for the WhatsApp Agent over Supabase/PostgREST.

Mirrors apps/api/agents/workflow/data.py's pattern — each agent owns its own
thin REST client rather than sharing one.
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


class WhatsAppData:
    async def get_lead(self, lead_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/leads",
                params={
                    "id": f"eq.{lead_id}",
                    "select": "*,customer:customers(full_name,phone)",
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
        lead["phone"] = cust.get("phone") or lead.get("phone")
        return lead

    async def get_prior_draft(self, lead_id: str) -> str | None:
        """Return the most recent Follow-up Agent WhatsApp draft, if any."""
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/lead_messages",
                params={
                    "lead_id": f"eq.{lead_id}",
                    "channel": "eq.whatsapp",
                    "source": "eq.agent",
                    "direction": "eq.outbound",
                    "order": "created_at.desc",
                    "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0]["body"] if rows else None

    async def create_message(self, row: dict) -> str | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/lead_messages", json=row, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")

    async def update_message_status(self, wamid: str, status: str) -> bool:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.patch(
                "/rest/v1/lead_messages",
                params={"whatsapp_message_id": f"eq.{wamid}"},
                json={"status": status},
                headers=_headers(),
            )
            r.raise_for_status()
        return True

    async def get_message_by_wamid(self, wamid: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/lead_messages",
                params={"whatsapp_message_id": f"eq.{wamid}", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def get_lead_by_phone(self, phone: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/customers",
                params={"phone": f"eq.{phone}", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            customers = r.json()
        if not customers:
            return None
        customer_id = customers[0]["id"]
        tenant_id = customers[0]["tenant_id"]
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/leads",
                params={
                    "customer_id": f"eq.{customer_id}",
                    "order": "created_at.desc",
                    "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            leads = r.json()
        if not leads:
            return None
        leads[0]["tenant_id"] = tenant_id
        return leads[0]

    async def create_delivery_log(self, row: dict) -> str | None:
        payload = {**row, "webhook_payload": json.dumps(row.get("webhook_payload") or {})}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/message_delivery_logs", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")
