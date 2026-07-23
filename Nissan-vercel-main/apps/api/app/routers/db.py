"""
REST endpoints for Supabase-backed campaign/marketing read/write operations.
Called server-to-server by TanStack Start server functions.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException, Query

from app.db import duckdb as db

router = APIRouter(prefix="/db", tags=["db"])


def _now_iso() -> str:
    # IST wall-clock — scheduled_at is authored in this zone (see duckdb.now_iso).
    return db.now_iso()


async def _ok_or_500(fn, *args, **kwargs) -> Any:
    try:
        return await fn(*args, **kwargs)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Campaigns ─────────────────────────────────────────────────────────────────

@router.get("/campaigns")
async def get_campaigns(tenant_id: str = Query(...)) -> list[dict]:
    return await _ok_or_500(db.list_campaigns, tenant_id)


@router.post("/campaigns/upsert")
async def post_upsert_campaign(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.upsert_campaign, payload)
    return {"ok": True}


@router.post("/campaigns/upsert-batch")
async def post_upsert_campaigns(payload: list = Body(...)) -> dict:
    await _ok_or_500(db.upsert_campaigns, payload)
    return {"ok": True}


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, tenant_id: str = Query(...)) -> dict:
    await _ok_or_500(db.delete_campaign, campaign_id, tenant_id)
    return {"ok": True}


# ── Campaign Days ─────────────────────────────────────────────────────────────

@router.get("/campaign-days")
async def get_campaign_days(tenant_id: str = Query(...)) -> list[dict]:
    return await _ok_or_500(db.list_all_campaign_days, tenant_id)


@router.post("/campaign-days/upsert")
async def post_upsert_campaign_days(payload: list = Body(...)) -> dict:
    await _ok_or_500(db.upsert_campaign_days, payload)
    return {"ok": True}


@router.post("/campaign-days/update-content")
async def post_update_day_content(payload: dict = Body(...)) -> dict:
    fields = {k: payload[k] for k in
              ("headline", "subheadline", "caption", "hashtags", "cta", "offer", "content_status", "poster_url", "video_url")
              if k in payload}
    await _ok_or_500(
        db.update_day_content,
        payload["campaign_id"], payload["tenant_id"], payload["day_date"], fields,
    )
    return {"ok": True}


# ── Opportunities ─────────────────────────────────────────────────────────────

@router.get("/opportunities")
async def get_opportunities(
    tenant_id: str = Query(...),
    month: int = Query(...),
    year: int = Query(...),
) -> list[dict]:
    return await _ok_or_500(db.list_opportunities, tenant_id, month, year)


@router.post("/opportunities/upsert")
async def post_upsert_opportunities(payload: list = Body(...)) -> dict:
    await _ok_or_500(db.upsert_opportunities, payload)
    return {"ok": True}


@router.post("/opportunities/update-content")
async def post_update_opportunity_content(payload: dict = Body(...)) -> dict:
    fields = {k: payload[k] for k in
              ("headline", "subheadline", "caption", "hashtags", "cta", "offer", "content_status", "poster_url", "video_url")
              if k in payload}
    await _ok_or_500(db.update_opportunity_content, payload["id"], payload["tenant_id"], fields)
    return {"ok": True}


# ── Publishing pipeline ───────────────────────────────────────────────────────

@router.post("/publishing/approve-campaign")
async def pub_approve_campaign(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.approve_campaign, payload["campaign_id"], payload["tenant_id"], payload.get("post_time", "10:00"))
    return {"ok": True}


@router.post("/publishing/reject-campaign")
async def pub_reject_campaign(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.reject_campaign, payload["campaign_id"], payload["tenant_id"])
    return {"ok": True}


@router.post("/publishing/publish-campaign")
async def pub_publish_campaign(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.publish_campaign, payload["campaign_id"], payload["tenant_id"], _now_iso(),
                     payload.get("channel_status"))
    return {"ok": True}


@router.post("/publishing/approve-event")
async def pub_approve_event(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.approve_opportunity, payload["id"], payload["tenant_id"], payload.get("post_time", "10:00"))
    return {"ok": True}


@router.post("/publishing/reject-event")
async def pub_reject_event(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.reject_opportunity, payload["id"], payload["tenant_id"])
    return {"ok": True}


@router.post("/publishing/publish-event")
async def pub_publish_event(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.publish_opportunity, payload["id"], payload["tenant_id"], _now_iso(),
                     payload.get("channel_status"))
    return {"ok": True}


@router.get("/publishing")
async def pub_list(tenant_id: str = Query(...)) -> list[dict]:
    # Auto-publish is owned by the background scheduler (app.services.auto_publisher),
    # which also pushes to channels — so this read no longer flips statuses itself.
    return await _ok_or_500(db.list_publishing, tenant_id)


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics/objectives")
async def get_objective_breakdown(tenant_id: str = Query(...)) -> list[dict]:
    return await _ok_or_500(db.query_objective_breakdown, tenant_id)


# ── Marketing Assets ──────────────────────────────────────────────────────────

@router.get("/assets")
async def get_assets(
    tenant_id: str = Query(...),
    asset_type: Optional[str] = Query(None),
    vehicle: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
) -> list[dict]:
    return await _ok_or_500(db.list_assets, tenant_id, asset_type, vehicle, search)


@router.post("/assets/upsert")
async def post_upsert_asset(payload: dict = Body(...)) -> dict:
    await _ok_or_500(db.upsert_asset, payload)
    return {"ok": True}


@router.delete("/assets/{asset_id}")
async def delete_asset_endpoint(asset_id: str, tenant_id: str = Query(...)) -> dict:
    await _ok_or_500(db.delete_asset, asset_id, tenant_id)
    return {"ok": True}
