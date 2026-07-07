"""Data access for the Dynamic Re-Scoring Agent (Phase 6).

Thin async REST client — same pattern as agents/workflow/data.py.
Each agent owns its own client rather than sharing one.
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


class RescoringData:
    """Thin async REST client scoped to what the re-scoring nodes need."""

    async def get_lead(self, lead_id: str) -> dict | None:
        """Load lead row joined with customer (for phone/email used in scoring)."""
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
        cust = lead.pop("customer", None) or {}
        lead["customer_name"] = cust.get("full_name")
        lead["phone"] = lead.get("phone") or cust.get("phone")
        lead["email"] = lead.get("email") or cust.get("email")
        return lead

    async def get_events(self, lead_id: str, limit: int = 30) -> list[dict]:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/lead_events",
                params={"lead_id": f"eq.{lead_id}", "order": "created_at.asc", "limit": str(limit)},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()

    async def get_messages(self, lead_id: str, limit: int = 30) -> list[dict]:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/lead_messages",
                params={"lead_id": f"eq.{lead_id}", "order": "created_at.asc", "limit": str(limit)},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()

    async def update_lead_score(
        self,
        lead_id: str,
        score: str,
        score_value: int,
        score_reasons: list[str],
        scored_by: str | None,
        now: str,
    ) -> bool:
        payload = {
            "score": score,
            "score_value": score_value,
            # Send the raw list, not json.dumps: leads.score_reasons is jsonb on
            # Supabase (a stringified array would be stored as a scalar string,
            # breaking the "AI reasoning" panel). The DuckDB shim stringifies
            # arrays on write (serializeJson), so a raw list works there too.
            "score_reasons": score_reasons,
            "scored_by": scored_by,
            "last_activity_at": now,
            "updated_at": now,
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.patch(
                "/rest/v1/leads",
                params={"id": f"eq.{lead_id}"},
                json=payload,
                headers=_headers(),
            )
            r.raise_for_status()
        return True

    async def create_score_history(self, row: dict) -> str | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/lead_score_history", json=row, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")

    async def create_score_event(self, row: dict) -> str | None:
        payload = {**row, "metadata": json.dumps(row.get("metadata") or {})}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/score_events", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id")

    async def get_call_analysis(self, call_id: str) -> dict | None:
        """Fetch the call_analysis row written by Phase 5 for a given call_id."""
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/call_analysis",
                params={"call_id": f"eq.{call_id}", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        if not rows:
            return None
        row = rows[0]
        for field in ("customer_summary", "competitors", "reasoning"):
            if isinstance(row.get(field), str):
                try:
                    import json as _json
                    row[field] = _json.loads(row[field])
                except Exception:
                    pass
        return row

    async def add_event(self, tenant_id: str, lead_id: str, summary: str, metadata: dict) -> None:
        payload = {
            "tenant_id": tenant_id,
            "lead_id": lead_id,
            "type": "agent",
            "summary": summary,
            "metadata": json.dumps(metadata or {}),
            "created_by": None,
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/lead_events", json=payload, headers=_headers())
            r.raise_for_status()
