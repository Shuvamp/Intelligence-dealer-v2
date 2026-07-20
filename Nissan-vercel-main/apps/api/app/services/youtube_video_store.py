"""Data access for published YouTube videos.

Thin async REST client — same pattern as linkedin_analytics_store.py /
agents/rescoring/data.py: hits SUPABASE_URL (real Supabase) with
SUPABASE_SERVICE_KEY.

Table: youtube_videos (supabase/migrations/0037_youtube_channel.sql; mirrored
in apps/local-api/server.js for local dev).
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


async def insert_video(
    tenant_id: str,
    video_id: str,
    video_url: str,
    title: str = "",
    description: str = "",
    privacy_status: str = "private",
) -> None:
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "video_id": video_id,
        "video_url": video_url,
        "title": (title or "")[:200],
        "description": (description or "")[:2000],
        "privacy_status": privacy_status,
        "published_at": _now(),
        "created_at": _now(),
    }
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=10) as c:
            r = await c.post("/rest/v1/youtube_videos", json=row, headers=_headers())
            r.raise_for_status()
    except Exception:  # noqa: BLE001
        logger.exception("[youtube] youtube_videos insert failed for video_id=%s", video_id)


async def list_videos_for_tenant(tenant_id: str, limit: int = 100) -> list[dict]:
    try:
        async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
            r = await c.get(
                "/rest/v1/youtube_videos",
                params={"tenant_id": f"eq.{tenant_id}", "order": "published_at.desc", "limit": str(limit)},
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()
    except Exception:  # noqa: BLE001
        logger.exception("[youtube] list_videos_for_tenant failed tenant=%s", tenant_id)
        return []
