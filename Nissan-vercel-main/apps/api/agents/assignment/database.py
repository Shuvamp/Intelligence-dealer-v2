"""Supabase-backed query wrapper for the assignment agent (KEERTHANA).

Preserves the old DuckDB-era `Database` interface (execute/fetch_one/fetch_all/
close, `?`-paramstyle) so agent.py and seeding.py need zero changes. Internals
translate the fixed, closed set of SQL statements those two files issue into
PostgREST calls against the real sales_executives/lead_assignments/
assignment_notifications tables (migration 0025) — a small translation shim,
not a general SQL engine. Same async-httpx pattern as
app/services/channel_store.py.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import httpx

from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

_KEY = SUPABASE_SERVICE_KEY or "local-dev-anon-key"
_WS = re.compile(r"\s+")


def _norm(sql: str) -> str:
    return _WS.sub(" ", sql).strip()


def _headers(prefer: str = "return=representation") -> dict:
    return {
        "apikey": _KEY,
        "Authorization": f"Bearer {_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


class Database:
    """PostgREST-backed stand-in for the old in-process DuckDB connection."""

    def __init__(self, database_url: str | None = None):
        pass  # kept for signature compatibility — nothing to open over HTTP

    async def execute(self, sql: str, params: tuple = ()) -> None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            await _execute(c, _norm(sql), params)

    async def fetch_one(self, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None

    async def fetch_all(self, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            return await _fetch(c, _norm(sql), params)

    async def close(self) -> None:
        pass


async def _fetch(c: httpx.AsyncClient, sql: str, p: tuple) -> List[Dict[str, Any]]:
    if sql.startswith("SELECT id, name, current_lead_count, max_lead_limit FROM sales_executives"):
        r = await c.get(
            "/rest/v1/sales_executives",
            headers=_headers(),
            params={
                "tenant_id": f"eq.{p[0]}",
                "status": "eq.active",
                "select": "id,name,current_lead_count,max_lead_limit",
                "order": "current_lead_count.asc",
            },
        )
        r.raise_for_status()
        return r.json()

    if sql.startswith("SELECT COUNT(*) AS count FROM sales_executives"):
        r = await c.get(
            "/rest/v1/sales_executives",
            headers={**_headers(), "Prefer": "count=exact"},
            params={"select": "id", "limit": "1"},
        )
        r.raise_for_status()
        total = int(r.headers.get("content-range", "0/0").split("/")[-1])
        return [{"count": total}]

    raise NotImplementedError(f"assignment Database: unrecognized query: {sql!r}")


async def _execute(c: httpx.AsyncClient, sql: str, p: tuple) -> None:
    if sql.startswith("CREATE TABLE IF NOT EXISTS"):
        return  # schema already exists in Supabase — migration 0025

    if sql.startswith("INSERT INTO lead_assignments VALUES"):
        body = {
            "assignment_id": p[0], "tenant_id": p[1], "lead_id": p[2],
            "executive_id": p[3], "score": p[4], "priority_rank": p[5],
            "assigned_at": p[6],
        }
        r = await c.post("/rest/v1/lead_assignments", headers=_headers("return=minimal"), json=body)
        r.raise_for_status()
        return

    if sql.startswith("UPDATE sales_executives SET current_lead_count = current_lead_count + 1"):
        exec_id = p[0]
        cur = await c.get(
            "/rest/v1/sales_executives",
            headers=_headers(),
            params={"id": f"eq.{exec_id}", "select": "current_lead_count"},
        )
        cur.raise_for_status()
        rows = cur.json()
        if not rows:
            return
        r = await c.patch(
            "/rest/v1/sales_executives",
            headers=_headers("return=minimal"),
            params={"id": f"eq.{exec_id}"},
            json={"current_lead_count": rows[0]["current_lead_count"] + 1},
        )
        r.raise_for_status()
        return

    if sql.startswith("UPDATE lead_assignments SET priority_rank ="):
        priority, assignment_id = p
        r = await c.patch(
            "/rest/v1/lead_assignments",
            headers=_headers("return=minimal"),
            params={"assignment_id": f"eq.{assignment_id}"},
            json={"priority_rank": priority},
        )
        r.raise_for_status()
        return

    if sql.startswith("INSERT INTO assignment_notifications VALUES"):
        body = {
            "notification_id": p[0], "tenant_id": p[1], "lead_id": p[2],
            "executive_id": p[3], "event_type": p[4], "message": p[5],
            "is_read": p[6], "created_at": p[7],
        }
        r = await c.post("/rest/v1/assignment_notifications", headers=_headers("return=minimal"), json=body)
        r.raise_for_status()
        return

    if sql.startswith("INSERT INTO sales_executives VALUES"):
        body = {
            "id": p[0], "tenant_id": p[1], "name": p[2], "status": p[3],
            "current_lead_count": p[4], "max_lead_limit": p[5],
        }
        r = await c.post(
            "/rest/v1/sales_executives",
            headers={**_headers("return=minimal"), "Prefer": "resolution=ignore-duplicates,return=minimal"},
            json=body,
        )
        r.raise_for_status()
        return

    raise NotImplementedError(f"assignment Database: unrecognized statement: {sql!r}")
