"""Data access for LinkedIn post URNs + analytics snapshots.

Thin async REST client — same pattern as agents/rescoring/data.py and
agents/events/store.py: hits SUPABASE_URL (real Supabase) with
SUPABASE_SERVICE_KEY, since this is a background-job /
cross-tenant data path with no per-request caller JWT to scope with.

Tables: linkedin_posts, linkedin_post_metrics, linkedin_account_metrics
(supabase/migrations/0036_linkedin_analytics.sql; mirrored in
apps/local-api/server.js for local dev).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import httpx

from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

logger = logging.getLogger(__name__)

_KEY = SUPABASE_SERVICE_KEY


def _headers() -> dict:
    return {
        "apikey": _KEY,
        "Authorization": f"Bearer {_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def insert_post(
    tenant_id: str,
    urn: str,
    caption: str = "",
    title: str = "",
    org_urn: str | None = None,
    image_asset_urn: str | None = None,
) -> None:
    """Record a published LinkedIn post URN. Best-effort — never raises."""
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "urn": urn,
        "org_urn": org_urn,
        "caption": (caption or "")[:1000],
        "title": (title or "")[:200],
        "image_asset_urn": image_asset_urn,
        "published_at": _now(),
        "created_at": _now(),
    }
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.post("/rest/v1/linkedin_posts", json=row, headers=_headers())
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] linkedin_posts insert failed for urn=%s", urn)


async def get_posts_for_tenant(tenant_id: str, limit: int = 100) -> list[dict]:
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/linkedin_posts",
                params={"tenant_id": f"eq.{tenant_id}", "order": "published_at.desc", "limit": str(limit)},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] get_posts_for_tenant failed tenant=%s", tenant_id)
        return []


async def update_post_image(tenant_id: str, urn: str, image_url: str, expires_at_ms: int) -> None:
    expires_at = (
        datetime.fromtimestamp(expires_at_ms / 1000, tz=timezone.utc).isoformat()
        if expires_at_ms
        else None
    )
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.patch(
                "/rest/v1/linkedin_posts",
                params={"tenant_id": f"eq.{tenant_id}", "urn": f"eq.{urn}"},
                json={"image_url": image_url, "image_url_expires_at": expires_at},
                headers=_headers(),
            )
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] update_post_image failed urn=%s", urn)


async def insert_post_metrics(
    tenant_id: str,
    post_urn: str,
    status: str,
    likes: int | None = None,
    comments: int | None = None,
    shares: int | None = None,
    impressions: int | None = None,
    reach: int | None = None,
    clicks: int | None = None,
    engagement_rate: float | None = None,
    error_message: str | None = None,
) -> None:
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "post_urn": post_urn,
        "likes": likes,
        "comments": comments,
        "shares": shares,
        "impressions": impressions,
        "reach": reach,
        "clicks": clicks,
        "engagement_rate": engagement_rate,
        "status": status,
        "error_message": (error_message or "")[:500] or None,
        "captured_at": _now(),
    }
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.post("/rest/v1/linkedin_post_metrics", json=row, headers=_headers())
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] insert_post_metrics failed urn=%s", post_urn)


async def insert_account_metrics(
    tenant_id: str,
    org_urn: str | None,
    status: str,
    followers_growth: int | None = None,
    profile_views: int | None = None,
    error_message: str | None = None,
) -> None:
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "org_urn": org_urn,
        "followers_growth": followers_growth,
        "profile_views": profile_views,
        "status": status,
        "error_message": (error_message or "")[:500] or None,
        "captured_at": _now(),
    }
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.post("/rest/v1/linkedin_account_metrics", json=row, headers=_headers())
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] insert_account_metrics failed tenant=%s", tenant_id)


async def get_latest_post_metrics(tenant_id: str) -> dict[str, dict]:
    """Latest metrics snapshot per post_urn for a tenant, keyed by urn."""
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/linkedin_post_metrics",
                params={"tenant_id": f"eq.{tenant_id}", "order": "captured_at.desc", "limit": "500"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] get_latest_post_metrics failed tenant=%s", tenant_id)
        return {}
    latest: dict[str, dict] = {}
    for row in rows:
        urn = row.get("post_urn")
        if urn and urn not in latest:
            latest[urn] = row
    return latest


async def get_latest_account_metrics(tenant_id: str) -> dict | None:
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/linkedin_account_metrics",
                params={"tenant_id": f"eq.{tenant_id}", "order": "captured_at.desc", "limit": "1"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
        return rows[0] if rows else None
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] get_latest_account_metrics failed tenant=%s", tenant_id)
        return None
