"""
Supabase-backed persistence layer for ADIP marketing/campaign data.

Thin async REST client over PostgREST — same pattern as
app/services/linkedin_analytics_store.py. Replaces the former DuckDB
file-store; every function name/signature/return-shape below is preserved
so callers (routers/db.py, auto_publisher.py, publishing_tools.py) needed
no changes beyond `await`.

Tables: public.campaigns (extended, 0039), campaign_days (0040),
marketing_assets (0041), opportunities (0042).

This module's `campaign_id` maps 1:1 onto the spine public.campaigns.id
column — apps/web always generates it via randomUUID() (see marketing.ts
createCampaign/createCampaignFromPlan), so it's a valid uuid. PostgREST
select/insert aliasing (`campaign_id:id`) keeps that translation invisible
to every caller, which still only ever sees `campaign_id`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

logger = logging.getLogger(__name__)

# Scheduled posts are authored in dealer-local wall-clock time (India / Tamil
# Nadu). scheduled_at is stored as a naive "YYYY-MM-DDTHH:MM" string in this
# zone, so "is it due?" must compare against the current time in the SAME zone.
# IST has no DST -> a fixed UTC+5:30 offset (no tzdata/zoneinfo dependency, which
# Windows lacks by default) is correct and portable.
PUBLISH_TZ = timezone(timedelta(hours=5, minutes=30))


def now_iso() -> str:
    """Current IST wall-clock as 'YYYY-MM-DDTHH:MM' — matches scheduled_at format."""
    return datetime.now(PUBLISH_TZ).strftime("%Y-%m-%dT%H:%M")


def _sync_now() -> str:
    return datetime.now(timezone.utc).isoformat()


_KEY = SUPABASE_SERVICE_KEY


def _headers(prefer: str = "return=representation") -> dict:
    return {
        "apikey": _KEY,
        "Authorization": f"Bearer {_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


async def _get(path: str, params: Any) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.get(path, params=params, headers=_headers())
        r.raise_for_status()
        return r.json()


async def _post(path: str, params: Any, body: Any, prefer: str) -> None:
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.post(path, params=params, json=body, headers=_headers(prefer))
        r.raise_for_status()


async def _patch(path: str, params: Any, body: dict) -> None:
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.patch(path, params=params, json=body, headers=_headers())
        r.raise_for_status()


async def _delete(path: str, params: Any) -> None:
    async with httpx.AsyncClient(base_url=SUPABASE_URL, timeout=15) as c:
        r = await c.delete(path, params=params, headers=_headers())
        r.raise_for_status()


# ── Campaigns ─────────────────────────────────────────────────────────────────

_CAMPAIGN_SELECT = (
    "campaign_id:id,tenant_id,name,objective,status,start_date,end_date,"
    "post_count,published_count,channels,theme,campaign_color,campaign_hashtags,"
    "posting_time,vehicle,goal,selected_assets,selected_logo,synced_at"
)


async def upsert_campaign(row: dict[str, Any]) -> None:
    body = {
        "id": row.get("campaign_id"),
        "tenant_id": row.get("tenant_id"),
        "name": row.get("name"),
        "objective": row.get("objective") or "awareness",
        "status": row.get("status") or "draft",
        "start_date": row.get("start_date"),
        "end_date": row.get("end_date"),
        "post_count": int(row.get("post_count") or 0),
        "published_count": int(row.get("published_count") or 0),
        "channels": row.get("channels") or [],
        "theme": row.get("theme"),
        "campaign_color": row.get("campaign_color"),
        "campaign_hashtags": row.get("campaign_hashtags") or [],
        "posting_time": row.get("posting_time"),
        "vehicle": row.get("vehicle"),
        "goal": row.get("goal"),
        "selected_assets": row.get("selected_assets"),
        "selected_logo": row.get("selected_logo"),
        "synced_at": _sync_now(),
    }
    await _post(
        "/rest/v1/campaigns", {"on_conflict": "id"}, body,
        "resolution=merge-duplicates,return=minimal",
    )
    logger.debug("[db] upsert_campaign %s", row.get("campaign_id"))


async def upsert_campaigns(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        await upsert_campaign(row)


async def delete_campaign(campaign_id: str, tenant_id: str) -> None:
    params = [("id", f"eq.{campaign_id}"), ("tenant_id", f"eq.{tenant_id}")]
    await _delete("/rest/v1/campaigns", params)
    params = [("campaign_id", f"eq.{campaign_id}"), ("tenant_id", f"eq.{tenant_id}")]
    await _delete("/rest/v1/campaign_days", params)


async def list_campaigns(tenant_id: str) -> list[dict[str, Any]]:
    params = [("tenant_id", f"eq.{tenant_id}"), ("select", _CAMPAIGN_SELECT), ("order", "synced_at.desc")]
    return await _get("/rest/v1/campaigns", params)


# ── Campaign Days ─────────────────────────────────────────────────────────────

async def upsert_campaign_days(rows: list[dict[str, Any]]) -> None:
    """Upsert structural day fields (theme/vehicle). Preserves any existing
    generated content columns on conflict (content is written by
    update_day_content, not here — only the 6 columns below are ever sent,
    so PostgREST's merge-duplicates leaves every other column untouched)."""
    for row in rows:
        body = {
            "campaign_id": row.get("campaign_id"),
            "tenant_id": row.get("tenant_id"),
            "day_date": row.get("day_date"),
            "day_num": int(row.get("day_num") or 0),
            "theme": row.get("theme") or "",
            "vehicle": row.get("vehicle"),
        }
        await _post(
            "/rest/v1/campaign_days", {"on_conflict": "campaign_id,tenant_id,day_date"}, body,
            "resolution=merge-duplicates,return=minimal",
        )


async def update_day_content(
    campaign_id: str, tenant_id: str, day_date: str, fields: dict[str, Any]
) -> None:
    """Partial update of a day's generated content columns."""
    allowed = ("headline", "subheadline", "caption", "hashtags", "cta", "offer", "content_status", "poster_url", "video_url")
    body = {k: fields[k] for k in allowed if k in fields}
    if not body:
        return
    params = [
        ("campaign_id", f"eq.{campaign_id}"),
        ("tenant_id", f"eq.{tenant_id}"),
        ("day_date", f"eq.{day_date}"),
    ]
    await _patch("/rest/v1/campaign_days", params, body)


async def list_all_campaign_days(tenant_id: str) -> list[dict[str, Any]]:
    params = [
        ("tenant_id", f"eq.{tenant_id}"),
        ("select", "campaign_id,tenant_id,day_date,day_num,theme,vehicle,headline,subheadline,"
                   "caption,hashtags,cta,offer,poster_url,video_url,content_status"),
        ("order", "campaign_id,day_num"),
    ]
    return await _get("/rest/v1/campaign_days", params)


# ── Opportunities ─────────────────────────────────────────────────────────────

async def upsert_opportunities(rows: list[dict[str, Any]]) -> None:
    """Upsert opportunity metadata. Preserves any existing generated content
    columns on conflict (content is written by update_opportunity_content)."""
    for row in rows:
        body = {
            "id": row.get("id"),
            "tenant_id": row.get("tenant_id"),
            "month": int(row.get("month") or 0),
            "year": int(row.get("year") or 0),
            "date": row.get("date"),
            "name": row.get("name") or "",
            "kind": row.get("kind"),
            "theme": row.get("theme"),
            "suggestion": row.get("suggestion"),
            "synced_at": _sync_now(),
        }
        await _post(
            "/rest/v1/opportunities", {"on_conflict": "id"}, body,
            "resolution=merge-duplicates,return=minimal",
        )


async def update_opportunity_content(opp_id: str, tenant_id: str, fields: dict[str, Any]) -> None:
    """Partial update of an opportunity's generated content columns."""
    allowed = ("headline", "subheadline", "caption", "hashtags", "cta", "offer", "content_status", "poster_url", "video_url")
    body = {k: fields[k] for k in allowed if k in fields}
    if not body:
        return
    params = [("id", f"eq.{opp_id}"), ("tenant_id", f"eq.{tenant_id}")]
    await _patch("/rest/v1/opportunities", params, body)


async def list_opportunities(tenant_id: str, month: int, year: int) -> list[dict[str, Any]]:
    params = [
        ("tenant_id", f"eq.{tenant_id}"), ("month", f"eq.{month}"), ("year", f"eq.{year}"),
        ("select", "id,tenant_id,month,year,date,name,kind,theme,suggestion,"
                   "headline,subheadline,caption,hashtags,cta,offer,poster_url,video_url,content_status"),
        ("order", "date"),
    ]
    return await _get("/rest/v1/opportunities", params)


# ── Publishing pipeline ─────────────────────────────────────────────────────

async def approve_campaign(campaign_id: str, tenant_id: str, post_time: str) -> None:
    """Approve every day of a campaign and queue it at day_date + post_time."""
    params = [
        ("campaign_id", f"eq.{campaign_id}"), ("tenant_id", f"eq.{tenant_id}"),
        ("select", "id,day_date"),
    ]
    rows = await _get("/rest/v1/campaign_days", params)
    for r in rows:
        await _patch(
            "/rest/v1/campaign_days", [("id", f"eq.{r['id']}")],
            {
                "content_status": "approved",
                "publish_status": "queued",
                "scheduled_at": f"{r['day_date']}T{post_time}",
            },
        )
    logger.info(
        "[auto-publish] queued campaign=%s tenant=%s at %s (job created)",
        campaign_id, tenant_id, post_time,
    )


async def approve_opportunity(opp_id: str, tenant_id: str, post_time: str) -> None:
    params = [("id", f"eq.{opp_id}"), ("tenant_id", f"eq.{tenant_id}"), ("select", "date")]
    rows = await _get("/rest/v1/opportunities", params)
    for _ in rows:
        await _patch(
            "/rest/v1/opportunities", [("id", f"eq.{opp_id}"), ("tenant_id", f"eq.{tenant_id}")],
            {
                "content_status": "approved",
                "publish_status": "queued",
                "scheduled_at": f"{rows[0]['date']}T{post_time}",
            },
        )
    logger.info(
        "[auto-publish] queued event=%s tenant=%s at %s (job created)",
        opp_id, tenant_id, post_time,
    )


async def reject_campaign(campaign_id: str, tenant_id: str) -> None:
    params = [("campaign_id", f"eq.{campaign_id}"), ("tenant_id", f"eq.{tenant_id}")]
    await _patch("/rest/v1/campaign_days", params, {"publish_status": "rejected"})


async def reject_opportunity(opp_id: str, tenant_id: str) -> None:
    params = [("id", f"eq.{opp_id}"), ("tenant_id", f"eq.{tenant_id}")]
    await _patch("/rest/v1/opportunities", params, {"publish_status": "rejected"})


async def publish_campaign(campaign_id: str, tenant_id: str, now_iso: str) -> None:
    """Publish only items whose scheduled time has arrived (or has no schedule)."""
    params = [
        ("campaign_id", f"eq.{campaign_id}"), ("tenant_id", f"eq.{tenant_id}"),
        ("publish_status", "eq.queued"),
        ("or", f"(scheduled_at.is.null,scheduled_at.lte.{now_iso})"),
    ]
    await _patch("/rest/v1/campaign_days", params, {"publish_status": "published", "published_at": now_iso})


async def publish_opportunity(opp_id: str, tenant_id: str, now_iso: str) -> None:
    """Publish only if scheduled time has arrived (or has no schedule)."""
    params = [
        ("id", f"eq.{opp_id}"), ("tenant_id", f"eq.{tenant_id}"),
        ("publish_status", "eq.queued"),
        ("or", f"(scheduled_at.is.null,scheduled_at.lte.{now_iso})"),
    ]
    await _patch("/rest/v1/opportunities", params, {"publish_status": "published", "published_at": now_iso})


async def process_due(tenant_id: str, now_iso: str) -> None:
    """Auto-flip queued items whose scheduled time has passed to published."""
    for path, id_col, extra in (
        ("/rest/v1/campaign_days", "id", [("campaign_id", "not.is.null")]),
        ("/rest/v1/opportunities", "id", []),
    ):
        params = [
            ("tenant_id", f"eq.{tenant_id}"), ("publish_status", "eq.queued"),
            ("scheduled_at", "not.is.null"), ("scheduled_at", f"lte.{now_iso}"),
            ("select", f"{id_col},scheduled_at"),
        ]
        rows = await _get(path, params)
        for r in rows:
            await _patch(path, [(id_col, f"eq.{r[id_col]}")],
                          {"publish_status": "published", "published_at": r["scheduled_at"]})


async def list_due_posts(now_iso_str: str) -> list[dict[str, Any]]:
    """Every queued campaign-day + event whose scheduled time has passed, across
    ALL tenants — the work-list the background auto-publisher drains each tick.

    Campaign days carry their campaign's linked `channels`; events target every
    connected channel (channels = None)."""
    day_params = [
        ("publish_status", "eq.queued"),
        ("scheduled_at", "not.is.null"), ("scheduled_at", f"lte.{now_iso_str}"),
        ("select", "tenant_id,group_id:campaign_id,day_date,day_num,headline,subheadline,"
                   "caption,hashtags,cta,theme,poster_url,video_url,scheduled_at,campaigns(name,channels)"),
        ("order", "scheduled_at,day_num"),
    ]
    days = await _get("/rest/v1/campaign_days", day_params)
    for d in days:
        camp = d.pop("campaigns", None) or {}
        d["title"] = camp.get("name")
        d["channels"] = camp.get("channels")
        d["kind"] = "campaign"

    opp_params = [
        ("publish_status", "eq.queued"),
        ("scheduled_at", "not.is.null"), ("scheduled_at", f"lte.{now_iso_str}"),
        ("select", "tenant_id,group_id:id,day_date:date,headline,subheadline,caption,hashtags,"
                   "cta,theme,poster_url,video_url,scheduled_at,title:name"),
        ("order", "scheduled_at"),
    ]
    opps = await _get("/rest/v1/opportunities", opp_params)
    for o in opps:
        o["kind"] = "event"
        o["channels"] = None
    return days + opps


async def set_publish_status(
    kind: str,
    group_id: str,
    tenant_id: str,
    status: str,
    day_date: str | None = None,
    published_at: str | None = None,
    channel_status: str | None = None,
) -> None:
    """Transition a single post's publish_status (queued -> publishing -> published/failed).
    `published_at` is only written when non-NULL (kept across transient states).
    `channel_status` (JSON-encoded per-platform outcome) is likewise only written
    when non-NULL, so the Publishing queue can show why a scheduled post
    succeeded/failed/skipped per channel."""
    body: dict[str, Any] = {"publish_status": status}
    if published_at is not None:
        body["published_at"] = published_at
    if channel_status is not None:
        body["channel_status"] = channel_status
    if kind == "campaign":
        params = [("campaign_id", f"eq.{group_id}"), ("tenant_id", f"eq.{tenant_id}")]
        if day_date is not None:
            params.append(("day_date", f"eq.{day_date}"))
        await _patch("/rest/v1/campaign_days", params, body)
    else:
        params = [("id", f"eq.{group_id}"), ("tenant_id", f"eq.{tenant_id}")]
        await _patch("/rest/v1/opportunities", params, body)


async def list_publishing(tenant_id: str) -> list[dict[str, Any]]:
    """Unified queue/published/rejected list — campaign days + events."""
    day_params = [
        ("tenant_id", f"eq.{tenant_id}"), ("publish_status", "neq.draft"),
        ("select", "group_id:campaign_id,day_num,date:day_date,theme,vehicle,headline,"
                   "subheadline,caption,hashtags,cta,poster_url,video_url,scheduled_at,"
                   "publish_status,published_at,channel_status,campaigns(name)"),
        ("order", "scheduled_at,day_num"),
    ]
    days = await _get("/rest/v1/campaign_days", day_params)
    for d in days:
        camp = d.pop("campaigns", None) or {}
        d["title"] = camp.get("name")
        d["kind"] = "campaign"

    opp_params = [
        ("tenant_id", f"eq.{tenant_id}"), ("publish_status", "neq.draft"),
        ("select", "group_id:id,title:name,date,theme,headline,subheadline,caption,hashtags,"
                   "cta,poster_url,video_url,scheduled_at,publish_status,published_at,"
                   "channel_status,event_kind:kind"),
        ("order", "scheduled_at"),
    ]
    opps = await _get("/rest/v1/opportunities", opp_params)
    for o in opps:
        o["kind"] = "event"
    return days + opps


# ── Analytics ─────────────────────────────────────────────────────────────────

async def query_objective_breakdown(tenant_id: str) -> list[dict[str, Any]]:
    params = [("tenant_id", f"eq.{tenant_id}"), ("select", "objective,post_count")]
    rows = await _get("/rest/v1/campaigns", params)
    agg: dict[str, dict[str, Any]] = {}
    for r in rows:
        objective = r.get("objective") or "awareness"
        bucket = agg.setdefault(objective, {"objective": objective, "total": 0, "posts": 0})
        bucket["total"] += 1
        bucket["posts"] += r.get("post_count") or 0
    return sorted(agg.values(), key=lambda b: b["total"], reverse=True)


# ── Marketing Assets ──────────────────────────────────────────────────────────

async def upsert_asset(row: dict[str, Any]) -> None:
    body = {
        "id": row.get("id"),
        "tenant_id": row.get("tenant_id"),
        "name": row.get("name"),
        "asset_type": row.get("asset_type"),
        "vehicle": row.get("vehicle"),
        "sub_category": row.get("sub_category"),
        "file_url": row.get("file_url"),
        "file_size": row.get("file_size"),
        "metadata": row.get("metadata"),
        "created_at": row.get("created_at") or _sync_now(),
    }
    await _post(
        "/rest/v1/marketing_assets", {"on_conflict": "id"}, body,
        "resolution=merge-duplicates,return=minimal",
    )


async def list_assets(
    tenant_id: str,
    asset_type: str | None = None,
    vehicle: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    params: list[tuple[str, str]] = [("tenant_id", f"eq.{tenant_id}"), ("order", "created_at.desc")]
    if asset_type:
        params.append(("asset_type", f"eq.{asset_type}"))
    if vehicle:
        params.append(("vehicle", f"eq.{vehicle}"))
    if search:
        params.append(("name", f"ilike.*{search}*"))
    return await _get("/rest/v1/marketing_assets", params)


async def delete_asset(asset_id: str, tenant_id: str) -> None:
    params = [("id", f"eq.{asset_id}"), ("tenant_id", f"eq.{tenant_id}")]
    await _delete("/rest/v1/marketing_assets", params)
