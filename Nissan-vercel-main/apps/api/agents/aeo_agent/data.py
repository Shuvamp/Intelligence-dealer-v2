"""Data access for the AEO Agent over Supabase/PostgREST.

Reads website_extractions read-only via its own duplicated query (mirrors
seo_agent/data.py's own read-only duplicate) rather than importing
agents.website_extraction — preserves the per-phase decoupling convention.
Owns full CRUD on aeo_analyses.
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


class AeoAgentData:
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

    async def insert_analysis(self, row: dict) -> dict | None:
        payload = {
            **row,
            "analysis_data": json.dumps(row.get("analysis_data")) if row.get("analysis_data") is not None else None,
            "errors": json.dumps(row.get("errors") or []),
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/aeo_analyses", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else rows) or None

    async def update_analysis(self, analysis_id: str, patch: dict) -> None:
        payload = dict(patch)
        if "analysis_data" in payload and payload["analysis_data"] is not None:
            payload["analysis_data"] = json.dumps(payload["analysis_data"])
        if "errors" in payload:
            payload["errors"] = json.dumps(payload["errors"] or [])
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.patch(
                "/rest/v1/aeo_analyses",
                params={"id": f"eq.{analysis_id}"},
                json=payload,
                headers=_headers(),
            )
            r.raise_for_status()

    async def get_analysis(self, analysis_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/aeo_analyses",
                params={"id": f"eq.{analysis_id}", "tenant_id": f"eq.{tenant_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def list_analyses(
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
            r = await c.get("/rest/v1/aeo_analyses", params=params, headers=_headers())
            r.raise_for_status()
            return r.json()
