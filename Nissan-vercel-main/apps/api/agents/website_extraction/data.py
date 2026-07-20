"""Data access for the Website Extraction Agent over Supabase/PostgREST.

Reads context_plans read-only (owned by agents/context_planner/ — never
written here) and owns full CRUD on website_extractions. Mirrors
agents/context_planner/data.py's pattern.
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


class WebsiteExtractionData:
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

    async def insert_extraction(self, row: dict) -> dict | None:
        payload = {
            **row,
            "extraction_data": json.dumps(row.get("extraction_data")) if row.get("extraction_data") is not None else None,
            "errors": json.dumps(row.get("errors") or []),
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/website_extractions", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else rows) or None

    async def update_extraction(self, extraction_id: str, patch: dict) -> None:
        payload = dict(patch)
        if "extraction_data" in payload and payload["extraction_data"] is not None:
            payload["extraction_data"] = json.dumps(payload["extraction_data"])
        if "errors" in payload:
            payload["errors"] = json.dumps(payload["errors"] or [])
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.patch(
                "/rest/v1/website_extractions",
                params={"id": f"eq.{extraction_id}"},
                json=payload,
                headers=_headers(),
            )
            r.raise_for_status()

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

    async def list_extractions(
        self, tenant_id: str, context_id: str | None = None, status: str | None = None, limit: int = 50,
    ) -> list[dict]:
        params = {
            "tenant_id": f"eq.{tenant_id}",
            "select": "*",
            "order": "created_at.desc",
            "limit": str(min(limit, 200)),
        }
        if context_id:
            params["context_id"] = f"eq.{context_id}"
        if status:
            params["status"] = f"eq.{status}"
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get("/rest/v1/website_extractions", params=params, headers=_headers())
            r.raise_for_status()
            return r.json()
