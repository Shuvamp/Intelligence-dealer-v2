"""Persistence for the event bus (Phase 7).

One row per published event in `domain_events` — the observable, recoverable
log. Mirrors agents/rescoring/data.py's thin PostgREST client pattern. Points at
SUPABASE_URL (real Supabase). Never raises out of the bus path
on a store failure — persistence is best-effort so a logging hiccup can't stop
event delivery (rule #13).
"""
from __future__ import annotations

import logging
import os

import httpx

from .types import DomainEvent

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")


def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


class EventStore:
    async def save(self, event: DomainEvent) -> None:
        try:
            async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
                r = await c.post("/rest/v1/domain_events", json=event.to_row(), headers=_headers())
                r.raise_for_status()
        except Exception:  # noqa: BLE001
            logger.exception("domain_events insert failed for %s (%s)", event.id, event.type)

    async def mark(self, event_id: str, status: str, attempts: int | None = None, error: str | None = None) -> None:
        fields: dict = {"status": status}
        if attempts is not None:
            fields["attempts"] = attempts
        if error is not None:
            fields["error"] = error[:500]
        if status in ("done", "failed"):
            from datetime import datetime, timezone
            fields["processed_at"] = datetime.now(timezone.utc).isoformat()
        try:
            async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
                r = await c.patch(
                    "/rest/v1/domain_events",
                    params={"id": f"eq.{event_id}"},
                    json=fields,
                    headers=_headers(),
                )
                r.raise_for_status()
        except Exception:  # noqa: BLE001
            logger.exception("domain_events mark(%s) failed for %s", status, event_id)

    async def list_unprocessed(self, limit: int = 100) -> list[DomainEvent]:
        """Events not yet `done` — used by replay (recoverability)."""
        try:
            async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
                r = await c.get(
                    "/rest/v1/domain_events",
                    params={"status": "neq.done", "order": "created_at.asc", "limit": str(limit)},
                    headers={**_headers(), "Prefer": "return=representation"},
                )
                r.raise_for_status()
                rows = r.json()
            return [DomainEvent.from_row(row) for row in rows]
        except Exception:  # noqa: BLE001
            logger.exception("domain_events list_unprocessed failed")
            return []
