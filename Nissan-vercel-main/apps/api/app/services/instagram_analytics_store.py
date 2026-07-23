"""Data access for Instagram media IDs + analytics snapshots.

Thin async REST client — same pattern as linkedin_analytics_store.py: hits
SUPABASE_URL (real Supabase) with SUPABASE_SERVICE_KEY, since this is a
background-job / cross-tenant data path
with no per-request caller JWT to scope with.

Tables: instagram_posts, instagram_post_metrics
(supabase/migrations/0038_instagram_analytics.sql; mirrored in
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
    media_id: str,
    caption: str = "",
    media_type: str = "",
    media_url: str | None = None,
    thumbnail_url: str | None = None,
    permalink: str | None = None,
    published_at: str | None = None,
) -> None:
    """Record a tracked Instagram media item — either from a fresh publish
    (app/routers/publish.py) or from the poller's backfill pass for media
    published outside this app. Best-effort — never raises."""
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "media_id": media_id,
        "caption": (caption or "")[:1000],
        "media_type": media_type,
        "media_url": media_url,
        "thumbnail_url": thumbnail_url,
        "permalink": permalink,
        "published_at": published_at or _now(),
        "created_at": _now(),
    }
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.post("/rest/v1/instagram_posts", json=row, headers=_headers())
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] instagram_posts insert failed for media_id=%s", media_id)


async def get_media_ids_for_tenant(tenant_id: str) -> set[str]:
    """Already-tracked media IDs — the poller's backfill pass dedupes against
    this before inserting organically-published media."""
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/instagram_posts",
                params={"tenant_id": f"eq.{tenant_id}", "select": "media_id"},
                headers=_headers(),
            )
            r.raise_for_status()
            return {row["media_id"] for row in r.json() if row.get("media_id")}
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_media_ids_for_tenant failed tenant=%s", tenant_id)
        return set()


async def get_posts_for_tenant(tenant_id: str, limit: int = 100) -> list[dict]:
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/instagram_posts",
                params={"tenant_id": f"eq.{tenant_id}", "order": "published_at.desc", "limit": str(limit)},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_posts_for_tenant failed tenant=%s", tenant_id)
        return []


async def insert_post_metrics(
    tenant_id: str,
    media_id: str,
    status: str,
    likes: int | None = None,
    comments: int | None = None,
    error_message: str | None = None,
    reach: int | None = None,
    impressions: int | None = None,
    saved: int | None = None,
    shares: int | None = None,
) -> None:
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "media_id": media_id,
        "likes": likes,
        "comments": comments,
        "reach": reach,
        "impressions": impressions,
        "saved": saved,
        "shares": shares,
        "status": status,
        "error_message": (error_message or "")[:500] or None,
        "captured_at": _now(),
    }
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.post("/rest/v1/instagram_post_metrics", json=row, headers=_headers())
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] insert_post_metrics failed media_id=%s", media_id)


async def insert_account_metrics(
    tenant_id: str,
    status: str,
    ig_user_id: str | None = None,
    followers: int | None = None,
    error_message: str | None = None,
) -> None:
    """Snapshot the account's current follower total. Best-effort — never raises."""
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "ig_user_id": ig_user_id,
        "followers": followers,
        "status": status,
        "error_message": (error_message or "")[:500] or None,
        "captured_at": _now(),
    }
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.post("/rest/v1/instagram_account_metrics", json=row, headers=_headers())
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] insert_account_metrics failed tenant=%s", tenant_id)


async def get_account_metrics(tenant_id: str, limit: int = 1000) -> list[dict]:
    """Follower snapshots for a tenant, oldest first (chart order)."""
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/instagram_account_metrics",
                params={
                    "tenant_id": f"eq.{tenant_id}",
                    "status": "eq.ok",
                    "order": "captured_at.asc",
                    "limit": str(limit),
                },
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_account_metrics failed tenant=%s", tenant_id)
        return []


async def get_campaigns_for_tenant(tenant_id: str) -> list[dict]:
    """Campaign id/name/date-range, for attributing a post to a campaign by
    publish-date window — same rule as the SQL in
    refresh_campaign_insights_from_instagram (0053/0055_campaign_insights_*.sql),
    reused here so the Post Performance table can show it per-post without a
    media_id/campaign_id FK (organic posts never carry one)."""
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/campaigns",
                params={"tenant_id": f"eq.{tenant_id}", "start_date": "not.is.null",
                        "select": "id,name,start_date,end_date"},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_campaigns_for_tenant failed tenant=%s", tenant_id)
        return []


async def refresh_campaign_insights(tenant_id: str) -> int:
    """Roll this tenant's Instagram engagement into public.campaign_insights.

    All the work is in the SQL function (supabase/migrations/0053_...): posts are
    attributed to campaigns by publish-date window and only `engagement` is
    written, since instagram_basic can't observe reach/impressions/spend.
    Best-effort — never raises. Returns rows written (0 on failure)."""
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=30) as c:
            r = await c.post(
                "/rest/v1/rpc/refresh_campaign_insights_from_instagram",
                json={"p_tenant": tenant_id}, headers=_headers(),
            )
            r.raise_for_status()
            return int(r.json() or 0)
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] refresh_campaign_insights failed tenant=%s", tenant_id)
        return 0


async def get_latest_post_metrics(tenant_id: str) -> dict[str, dict]:
    """Latest metrics snapshot per media_id for a tenant, keyed by media_id."""
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/instagram_post_metrics",
                params={"tenant_id": f"eq.{tenant_id}", "order": "captured_at.desc", "limit": "500"},
                headers=_headers(),
            )
            r.raise_for_status()
            rows = r.json()
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_latest_post_metrics failed tenant=%s", tenant_id)
        return {}
    latest: dict[str, dict] = {}
    for row in rows:
        media_id = row.get("media_id")
        if media_id and media_id not in latest:
            latest[media_id] = row
    return latest
