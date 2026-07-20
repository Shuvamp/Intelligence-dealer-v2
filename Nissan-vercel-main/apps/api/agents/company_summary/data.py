"""Data access for the Company Summary Agent over Supabase/PostgREST.

Reads website_extractions read-only via its own duplicated query (mirrors
agents/website_extraction/data.py's own read-only duplicate of context_plans)
rather than importing agents.website_extraction — preserves the per-phase
decoupling convention. Owns full CRUD on company_summaries.
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


class CompanySummaryData:
    async def get_extraction(self, extraction_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/website_extractions",
                params={"id": f"eq.{extraction_id}", "tenant_id": f"eq.{tenant_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def insert_summary(self, row: dict) -> dict | None:
        payload = {
            **row,
            "products": json.dumps(row.get("products") or []),
            "services": json.dumps(row.get("services") or []),
            "errors": json.dumps(row.get("errors") or []),
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/company_summaries", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else rows) or None

    async def update_summary(self, summary_id: str, patch: dict) -> None:
        payload = dict(patch)
        if "products" in payload:
            payload["products"] = json.dumps(payload["products"] or [])
        if "services" in payload:
            payload["services"] = json.dumps(payload["services"] or [])
        if "errors" in payload:
            payload["errors"] = json.dumps(payload["errors"] or [])
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.patch(
                "/rest/v1/company_summaries",
                params={"id": f"eq.{summary_id}"},
                json=payload,
                headers=_headers(),
            )
            r.raise_for_status()

    async def get_summary(self, summary_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/company_summaries",
                params={"id": f"eq.{summary_id}", "tenant_id": f"eq.{tenant_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def list_summaries(
        self, tenant_id: str, extraction_id: str | None = None, context_id: str | None = None,
        status: str | None = None, limit: int = 50,
    ) -> list[dict]:
        params = {
            "tenant_id": f"eq.{tenant_id}",
            "select": "*",
            "order": "created_at.desc",
            "limit": str(min(limit, 200)),
        }
        if extraction_id:
            params["extraction_id"] = f"eq.{extraction_id}"
        if context_id:
            params["context_id"] = f"eq.{context_id}"
        if status:
            params["status"] = f"eq.{status}"
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get("/rest/v1/company_summaries", params=params, headers=_headers())
            r.raise_for_status()
            return r.json()
