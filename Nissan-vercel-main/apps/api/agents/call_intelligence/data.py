"""Data access for the Call Intelligence Agent over Supabase/PostgREST.

Mirrors agents/whatsapp/data.py — each agent owns a thin REST client. Points at
SUPABASE_URL (the DuckDB shim in local dev). JSON columns (customer_summary,
competitors, reasoning, raw_analysis) are sent as native values and parsed
defensively on read (the shim returns them as strings, Supabase as objects).
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "http://localhost:54321")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "local-dev-anon-key")

_JSON_FIELDS = ("customer_summary", "competitors", "reasoning", "raw_analysis")


def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_json_fields(row: dict) -> dict:
    """The shim returns jsonb columns as strings; parse them back to lists/dicts."""
    for f in _JSON_FIELDS:
        v = row.get(f)
        if isinstance(v, str):
            try:
                row[f] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                pass
    return row


class CallData:
    async def get_lead(self, lead_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/leads",
                params={"id": f"eq.{lead_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    # ── call_recordings ──────────────────────────────────────────────────────
    async def create_recording(self, row: dict) -> str | None:
        payload = {"id": str(uuid.uuid4()), "status": "uploaded", "created_at": _now(), **row}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/call_recordings", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id") or payload["id"]

    async def get_recording(self, call_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/call_recordings",
                params={"id": f"eq.{call_id}", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def update_recording(self, call_id: str, fields: dict) -> None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.patch(
                "/rest/v1/call_recordings",
                params={"id": f"eq.{call_id}"},
                json=fields,
                headers=_headers(),
            )
            r.raise_for_status()

    async def list_recordings(self, lead_id: str) -> list[dict]:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/call_recordings",
                params={"lead_id": f"eq.{lead_id}", "order": "created_at.desc"},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()

    # ── call_transcripts / call_sentiment ────────────────────────────────────
    async def create_transcript(self, row: dict) -> None:
        payload = {"id": str(uuid.uuid4()), "created_at": _now(), **row}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/call_transcripts", json=payload, headers=_headers())
            r.raise_for_status()

    async def get_transcript(self, call_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/call_transcripts",
                params={"call_id": f"eq.{call_id}", "order": "created_at.desc", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def create_sentiment(self, row: dict) -> None:
        payload = {"id": str(uuid.uuid4()), "created_at": _now(), **row}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/call_sentiment", json=payload, headers=_headers())
            r.raise_for_status()

    async def get_sentiment(self, call_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/call_sentiment",
                params={"call_id": f"eq.{call_id}", "order": "created_at.desc", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    # ── call_analysis (idempotent: update in place when call_id already analysed) ─
    async def upsert_analysis(self, call_id: str, row: dict) -> str | None:
        existing = await self.get_analysis(call_id)
        if existing:
            async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
                r = await c.patch(
                    "/rest/v1/call_analysis",
                    params={"call_id": f"eq.{call_id}"},
                    json=row,
                    headers=_headers(),
                )
                r.raise_for_status()
            return existing.get("id")
        payload = {"id": str(uuid.uuid4()), "call_id": call_id, "created_at": _now(), **row}
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/call_analysis", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else {}).get("id") or payload["id"]

    async def get_analysis(self, call_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/call_analysis",
                params={"call_id": f"eq.{call_id}", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return _parse_json_fields(rows[0]) if rows else None

    # ── timeline audit ───────────────────────────────────────────────────────
    async def add_event(self, tenant_id: str, lead_id: str, summary: str, metadata: dict) -> None:
        payload = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "lead_id": lead_id,
            "type": "call",
            "summary": summary,
            "metadata": metadata,
            "created_by": None,
            "created_at": _now(),
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/lead_events", json=payload, headers=_headers())
            r.raise_for_status()
