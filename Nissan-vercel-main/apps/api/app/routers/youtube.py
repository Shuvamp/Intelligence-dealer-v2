"""
YouTube channel API — connect, callback, status, publish, disconnect.

Self-contained router (unlike Instagram/LinkedIn, whose OAuth login/callback
live in app/routers/auth.py while status/disconnect live in their own router)
because the user's spec names exact paths under /api/youtube/*: connect,
callback, publish, disconnect, status. One file still owns the whole channel,
matching the per-channel-router pattern every other integration follows.

Flow:
  1. Browser  → GET  /api/youtube/connect?tenant_id=<uuid>
  2. Backend  → 302  → https://accounts.google.com/o/oauth2/v2/auth
  3. User     → logs into Google, approves scopes
  4. Google   → 302  → GET /api/youtube/callback?code=XXX&state=XXX
  5. Backend  → exchanges code for tokens, fetches the YouTube channel
  6. Backend  → returns HTML that stores the result in localStorage then
                redirects the browser back to the frontend channels page
  7. Frontend → reads localStorage['youtube_connection'], shows Connected
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from app.config import FRONTEND_URL
from app.services import channel_store, youtube_video_store as video_store
from app.services.youtube import (
    YouTubePublishError,
    build_oauth_url,
    consume_oauth_state,
    create_oauth_state,
    exchange_code_for_token,
    get_channel_info,
    get_valid_credentials,
    revoke_token,
    upload_video,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_CHANNELS_PATH = "/channels"


def _front(suffix: str = "") -> str:
    return f"{FRONTEND_URL}{_CHANNELS_PATH}{suffix}"


def _js(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")


@router.get("/connect")
async def youtube_connect(tenant_id: str = Query(..., description="Tenant UUID")):
    """Step 1 — start Google OAuth flow."""
    state = create_oauth_state(tenant_id)
    oauth_url = build_oauth_url(state)
    logger.info("[youtube:connect] tenant=%s state_prefix=%s → redirecting to Google", tenant_id, state[:8])
    return RedirectResponse(url=oauth_url, status_code=302)


@router.get("/callback")
async def youtube_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    error_description: str = Query(None),
):
    """Step 2 — Google OAuth callback."""
    if error:
        logger.warning("[youtube:callback] error=%s desc=%s", error, error_description)
        return RedirectResponse(_front(f"?error=youtube_{error}"))

    if not code or not state:
        return RedirectResponse(_front("?error=missing_params"))

    tenant_id = consume_oauth_state(state)
    if not tenant_id:
        logger.warning("[youtube:callback] invalid/expired state=%s…", state[:8])
        return RedirectResponse(_front("?error=invalid_state"))

    logger.info("[youtube:callback] CSRF OK, tenant=%s — starting token exchange", tenant_id)

    try:
        credentials = await exchange_code_for_token(code, state)
        channel = await get_channel_info(credentials)
        expires_at = credentials.expiry.replace(tzinfo=timezone.utc).isoformat() if credentials.expiry else None
        connected_at = datetime.now(timezone.utc).isoformat()

        try:
            await channel_store.upsert(
                tenant_id, "youtube",
                handle=channel["title"] or None,
                youtube_channel_id=channel["id"],
                youtube_channel_name=channel["title"],
                access_token=credentials.token or "",
                refresh_token=credentials.refresh_token or "",
                token_expires_at=expires_at,
                token_type="oauth2",
                status="connected",
            )
        except Exception:
            logger.exception("[youtube:db] failed to save YouTube connection for tenant=%s", tenant_id)

        html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>YouTube Connected</title>
  <style>
    body {{ font-family: system-ui, sans-serif; display:flex; align-items:center;
           justify-content:center; height:100vh; margin:0; background:#fafafa; }}
    .card {{ text-align:center; padding:2rem; border-radius:16px;
             border:1px solid #e5e7eb; background:#fff; }}
    .check {{ font-size:3rem; }}
    p {{ color:#6b7280; font-size:.875rem; margin-top:.5rem; }}
  </style>
</head>
<body>
<div class="card">
  <div class="check">&#10003;</div>
  <h2>YouTube Connected</h2>
  <p>Channel {_js(channel["title"])} &mdash; redirecting&hellip;</p>
</div>
<script>
var result = {{
  connected: true,
  youtube_channel_id: '{_js(channel["id"])}',
  handle:      '{_js(channel["title"])}',
  connected_at: '{_js(connected_at)}'
}};
try {{ localStorage.setItem('youtube_connection', JSON.stringify(result)); }} catch(e) {{}}
if (window.opener && !window.opener.closed) {{
  try {{ window.opener.postMessage({{ type: 'YOUTUBE_CONNECTED', data: result }}, '{FRONTEND_URL}'); }} catch(e) {{}}
  window.close();
}} else {{
  window.location.href = '{_front()}?connected=youtube';
}}
</script>
</body>
</html>"""
        return HTMLResponse(content=html)

    except YouTubePublishError as exc:
        logger.error("[youtube:error] %s", exc)
        return RedirectResponse(_front("?error=youtube_no_channel"))
    except Exception:
        logger.exception("[youtube:error] unexpected error — tenant=%s", tenant_id)
        return RedirectResponse(_front("?error=youtube_callback_failed"))


@router.get("/status")
async def youtube_status(tenant_id: str = Query(...)):
    row = await channel_store.get(tenant_id, "youtube")
    if not row or row.get("status") != "connected":
        return {"connected": False, "handle": None, "last_sync": None, "channel_id": None, "channel_name": None}
    return {
        "connected": True,
        "handle": row.get("handle"),
        "last_sync": row.get("last_sync"),
        "channel_id": row.get("youtube_channel_id"),
        "channel_name": row.get("youtube_channel_name"),
    }


class DisconnectRequest(BaseModel):
    tenant_id: str


@router.post("/disconnect")
async def youtube_disconnect(req: DisconnectRequest):
    row = await channel_store.get(req.tenant_id, "youtube")
    if not row:
        raise HTTPException(status_code=404, detail="No YouTube connection found")
    await revoke_token(row.get("access_token") or row.get("refresh_token") or "")
    await channel_store.update(req.tenant_id, "youtube", status="disconnected", access_token="", refresh_token="")
    return {"status": "success", "message": "YouTube disconnected"}


@router.post("/publish")
async def youtube_publish(
    tenant_id: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    tags: str = Form(""),
    privacy_status: str = Form("private"),
    video: UploadFile = None,
):
    """Upload a video to the connected YouTube channel (YouTube Data API v3
    resumable upload). Accepts multipart form data: tenant_id, title,
    description, tags (comma-separated), privacy_status, video file."""
    if video is None:
        raise HTTPException(status_code=400, detail="video file is required")

    row = await channel_store.get(tenant_id, "youtube")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        raise HTTPException(status_code=400, detail="YouTube is not connected")

    try:
        credentials = await get_valid_credentials(tenant_id, row)
    except YouTubePublishError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    try:
        result = await upload_video(
            credentials,
            video.file,
            video.content_type or "video/*",
            title, description, tag_list, privacy_status,
        )
    except YouTubePublishError as exc:
        logger.error("[youtube:publish] tenant=%s err=%s", tenant_id, exc)
        return {"status": "error", "error": str(exc)}
    except Exception:
        logger.exception("[youtube:publish] unexpected tenant=%s", tenant_id)
        return {"status": "error", "error": "Unexpected YouTube upload error"}

    try:
        await video_store.insert_video(
            tenant_id, result["video_id"], result["video_url"], title, description, privacy_status,
        )
    except Exception:  # noqa: BLE001
        logger.warning("[youtube:publish] could not record video %s", result["video_id"])

    now = datetime.now(timezone.utc).isoformat()
    await channel_store.update(tenant_id, "youtube", last_sync=now)

    return {"status": "success", "video_id": result["video_id"], "video_url": result["video_url"]}
