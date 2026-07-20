"""Data access for the Context Planner Agent over Supabase/PostgREST.

Hits SUPABASE_URL (real Supabase). Mirrors apps/api/agents/workflow/data.py's
pattern — each agent owns its own thin REST client rather than sharing one.
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


class ContextPlannerData:
    """Thin async REST client scoped to the context_plans table."""

    async def insert_context(self, row: dict) -> dict | None:
        payload = {**row, "errors": json.dumps(row.get("errors") or [])}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/context_plans", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else rows) or None

    async def get_context(self, context_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/context_plans",
                params={
                    "id": f"eq.{context_id}",
                    "tenant_id": f"eq.{tenant_id}",
                    "select": "*",
                    "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def list_contexts(self, tenant_id: str, status: str | None = None, limit: int = 50) -> list[dict]:
        params = {
            "tenant_id": f"eq.{tenant_id}",
            "select": "*",
            "order": "created_at.desc",
            "limit": str(min(limit, 200)),
        }
        if status:
            params["status"] = f"eq.{status}"
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get("/rest/v1/context_plans", params=params, headers=_headers())
            r.raise_for_status()
            return r.json()
