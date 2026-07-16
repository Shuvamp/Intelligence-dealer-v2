"""Read-only data access for the Marketing Budget Planner.

Reads context_plans, company_summaries, and generated_reports via its own
duplicated PostgREST queries (per-phase decoupling convention — never imports
another phase's package). Owns no tables of its own; the planner is stateless.
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
    }


def _maybe_json(value):
    """generated_reports.report_data / company_summaries list columns may come
    back as JSON strings (shim) or already-parsed objects (Supabase)."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:  # noqa: BLE001
            return None
    return value


class BudgetPlannerData:
    async def get_context(self, context_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/context_plans",
                params={"id": f"eq.{context_id}", "tenant_id": f"eq.{tenant_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def get_latest_summary(self, context_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/company_summaries",
                params={
                    "context_id": f"eq.{context_id}", "tenant_id": f"eq.{tenant_id}",
                    "status": "eq.ready", "select": "*", "order": "created_at.desc", "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        if not rows:
            return None
        row = rows[0]
        row["products"] = _maybe_json(row.get("products")) or []
        row["services"] = _maybe_json(row.get("services")) or []
        return row

    async def get_latest_report(self, context_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/generated_reports",
                params={
                    "context_id": f"eq.{context_id}", "tenant_id": f"eq.{tenant_id}",
                    "status": "eq.ready", "select": "*", "order": "created_at.desc", "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        if not rows:
            return None
        row = rows[0]
        row["report_data"] = _maybe_json(row.get("report_data")) or {}
        return row
