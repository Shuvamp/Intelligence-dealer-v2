"""Data access for the Report Generator over Supabase/PostgREST.

Reads website_extractions, recommendation_reports, seo_analyses,
aeo_analyses, and company_summaries read-only via its own duplicated queries
(mirrors recommendation_engine/data.py's own read-only duplicates) rather
than importing any upstream phase's package — preserves the per-phase
decoupling convention. Owns full CRUD on generated_reports.
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


class ReportGeneratorData:
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

    async def get_latest_ready_recommendation_report(self, extraction_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/recommendation_reports",
                params={
                    "extraction_id": f"eq.{extraction_id}", "tenant_id": f"eq.{tenant_id}",
                    "status": "eq.ready", "select": "*", "order": "created_at.desc", "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def get_seo_analysis(self, analysis_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/seo_analyses",
                params={"id": f"eq.{analysis_id}", "tenant_id": f"eq.{tenant_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def get_aeo_analysis(self, analysis_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/aeo_analyses",
                params={"id": f"eq.{analysis_id}", "tenant_id": f"eq.{tenant_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def get_latest_ready_company_summary(self, extraction_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/company_summaries",
                params={
                    "extraction_id": f"eq.{extraction_id}", "tenant_id": f"eq.{tenant_id}",
                    "status": "eq.ready", "select": "*", "order": "created_at.desc", "limit": "1",
                },
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def insert_report(self, row: dict) -> dict | None:
        payload = {
            **row,
            "report_data": json.dumps(row.get("report_data")) if row.get("report_data") is not None else None,
            "errors": json.dumps(row.get("errors") or []),
        }
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.post("/rest/v1/generated_reports", json=payload, headers=_headers())
            r.raise_for_status()
            rows = r.json()
        return (rows[0] if isinstance(rows, list) and rows else rows) or None

    async def update_report(self, report_id: str, patch: dict) -> None:
        payload = dict(patch)
        if "report_data" in payload and payload["report_data"] is not None:
            payload["report_data"] = json.dumps(payload["report_data"])
        if "errors" in payload:
            payload["errors"] = json.dumps(payload["errors"] or [])
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.patch(
                "/rest/v1/generated_reports",
                params={"id": f"eq.{report_id}"},
                json=payload,
                headers=_headers(),
            )
            r.raise_for_status()

    async def get_report(self, report_id: str, tenant_id: str) -> dict | None:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/generated_reports",
                params={"id": f"eq.{report_id}", "tenant_id": f"eq.{tenant_id}", "select": "*", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None

    async def list_reports(
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
            r = await c.get("/rest/v1/generated_reports", params=params, headers=_headers())
            r.raise_for_status()
            return r.json()
