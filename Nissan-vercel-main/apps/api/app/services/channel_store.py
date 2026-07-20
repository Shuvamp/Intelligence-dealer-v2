"""
Supabase-backed store for social channel connections.

Thin async REST client over PostgREST — same pattern as
app/services/linkedin_analytics_store.py. Table shape matches
supabase/migrations/0015 + 0016 + 0036 + 0037 + 0043:
  tenant_id, channel, handle, instagram_id, linkedin_id, page_id, page_name,
  email, picture, profile_url, access_token, token_type, status, last_sync,
  created_at, updated_at, linkedin_org_urn, linkedin_org_name,
  youtube_channel_id, youtube_channel_name, refresh_token, token_expires_at
Unique key: (tenant_id, channel)

Published LinkedIn post URNs and their metrics are NOT stored here — see
app/services/linkedin_analytics_store.py.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

_TABLE = "/rest/v1/social_channel_connections"

_COLUMNS = [
    "tenant_id", "channel", "handle", "instagram_id", "linkedin_id",
    "page_id", "page_name", "email", "picture", "profile_url", "access_token",
    "token_type", "status", "last_sync", "created_at", "updated_at",
    "linkedin_org_urn", "linkedin_org_name",
    "youtube_channel_id", "youtube_channel_name", "refresh_token", "token_expires_at",
]

_KEY = SUPABASE_SERVICE_KEY or "local-dev-anon-key"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _headers(prefer: str = "return=representation") -> dict:
    return {
        "apikey": _KEY,
        "Authorization": f"Bearer {_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


async def upsert(tenant_id: str, channel: str, **fields) -> None:
    """Insert or replace a connection row, preserving created_at on update."""
    now = _now()
    existing = await get(tenant_id, channel)
    created_at = existing["created_at"] if existing else now

    row = {c: None for c in _COLUMNS}
    row.update({
        "tenant_id": tenant_id,
        "channel": channel,
        "access_token": "",
        "token_type": "long_lived",
        "status": "connected",
        "last_sync": now,
        "created_at": created_at,
        "updated_at": now,
    })
    row.update({k: v for k, v in fields.items() if k in _COLUMNS})

    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.post(
            _TABLE,
            params={"on_conflict": "tenant_id,channel"},
            json=row,
            headers=_headers("resolution=merge-duplicates,return=minimal"),
        )
        r.raise_for_status()


async def get(tenant_id: str, channel: str) -> dict | None:
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.get(
            _TABLE,
            params={"tenant_id": f"eq.{tenant_id}", "channel": f"eq.{channel}", "limit": "1"},
            headers=_headers(),
        )
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


async def list_for_tenant(tenant_id: str) -> list[dict]:
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.get(_TABLE, params={"tenant_id": f"eq.{tenant_id}"}, headers=_headers())
        r.raise_for_status()
        return r.json()


async def list_connected(channel: str) -> list[dict]:
    """All tenants with a currently-connected row for one channel — used by
    background jobs (e.g. the LinkedIn analytics poller) that scan across
    tenants rather than operating within a single request's tenant scope."""
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.get(
            _TABLE,
            params={"channel": f"eq.{channel}", "status": "eq.connected", "access_token": "neq."},
            headers=_headers(),
        )
        r.raise_for_status()
        return r.json()


async def update(tenant_id: str, channel: str, **fields) -> bool:
    """Update specific fields. Returns False if the row does not exist."""
    allowed = {k: v for k, v in fields.items() if k in _COLUMNS}
    allowed["updated_at"] = _now()
    if not await get(tenant_id, channel):
        return False
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.patch(
            _TABLE,
            params={"tenant_id": f"eq.{tenant_id}", "channel": f"eq.{channel}"},
            json=allowed,
            headers=_headers("return=minimal"),
        )
        r.raise_for_status()
        return True
