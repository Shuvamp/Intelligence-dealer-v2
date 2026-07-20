"""
WhatsApp Business channel — connect / disconnect (manual credentials).

Unlike Instagram/Facebook/LinkedIn, WhatsApp Cloud API has no OAuth "pick a Page"
flow. A dealer connects by pasting their Phone Number ID + a permanent Access
Token from Meta (WhatsApp → API Setup). We validate the pair against Graph, then
persist to the same channel_store every other channel uses.

phone_number_id is stored in the `page_id` column (mirrors facebook.py reusing
page_id) so the send path (agents/whatsapp/nodes.py) can build a per-tenant
MetaWhatsAppProvider from the stored connection.

Status is served by the shared GET /api/channels endpoint, so there's no /status
route here.
"""
import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import channel_store

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectRequest(BaseModel):
    tenant_id: str
    phone_number_id: str
    access_token: str
    display_name: str | None = None


class DisconnectRequest(BaseModel):
    tenant_id: str


@router.post("/connect")
async def whatsapp_connect(req: ConnectRequest):
    """Validate the creds against Graph, then persist the connection."""
    url = f"https://graph.facebook.com/v20.0/{req.phone_number_id}"
    params = {"fields": "display_phone_number,verified_name"}
    headers = {"Authorization": f"Bearer {req.access_token}"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, params=params, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("[whatsapp:connect] Graph unreachable for tenant=%s: %s", req.tenant_id, exc)
        raise HTTPException(status_code=502, detail="Could not reach WhatsApp API. Try again.") from exc

    if not r.is_success:
        # Meta returns { "error": { "message": "..." } } for bad token / wrong phone id.
        detail = "Invalid Phone Number ID or Access Token."
        try:
            detail = r.json().get("error", {}).get("message") or detail
        except Exception:  # noqa: BLE001
            pass
        logger.info("[whatsapp:connect] Graph rejected tenant=%s (%s): %s", req.tenant_id, r.status_code, detail)
        raise HTTPException(status_code=400, detail=detail)

    data = r.json()
    display_phone = data.get("display_phone_number")
    verified_name = req.display_name or data.get("verified_name")

    channel_store.upsert(
        req.tenant_id, "whatsapp",
        handle=display_phone,
        page_id=req.phone_number_id,
        page_name=verified_name,
        access_token=req.access_token,
        token_type="long_lived",
        status="connected",
    )
    logger.info(
        "[whatsapp:connect] connected tenant=%s phone=%s name=%s",
        req.tenant_id, display_phone, verified_name,
    )
    return {
        "status": "success",
        "handle": display_phone,
        "phone_number_id": req.phone_number_id,
        "verified_name": verified_name,
    }


@router.post("/disconnect")
async def whatsapp_disconnect(req: DisconnectRequest):
    """Deactivate the connection — clears the token and marks it disconnected."""
    row = channel_store.get(req.tenant_id, "whatsapp")
    if not row:
        raise HTTPException(status_code=404, detail="No WhatsApp connection found")
    channel_store.update(req.tenant_id, "whatsapp", status="disconnected", access_token="")
    logger.info("[whatsapp:disconnect] tenant=%s", req.tenant_id)
    return {"status": "success", "message": "WhatsApp disconnected"}
