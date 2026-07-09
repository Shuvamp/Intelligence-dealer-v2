"""Instagram OAuth router — connect, callback, status, sync, disconnect."""
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.config import FRONTEND_URL
from app.services import channel_store
from app.services.instagram import (
    build_oauth_url,
    consume_oauth_state,
    create_oauth_state,
    exchange_code_for_token,
    get_facebook_pages,
    get_instagram_account_id,
    get_instagram_username,
    get_long_lived_token,
    get_token_debug_info,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Short-lived token cache: tenant_id → long_lived_token
# Populated after step 2 of the callback so /debug can use it without DB.
# TTL matches long-lived token (~60 days) but in-memory so clears on restart.
_last_token: dict[str, str] = {}

_CHANNELS_PATH = "/connected-channels"

# ── Why Facebook login, not Instagram login? ──────────────────────────────────
# Instagram removed its own OAuth in 2020. The only way to get an Instagram
# Business/Creator account token is via the Meta (Facebook) Graph API:
#   1. User logs in with Facebook.
#   2. We request the Facebook Page they manage.
#   3. Every Facebook Page can have a linked Instagram Business account.
#   4. We use the page-scoped token to call the Instagram Graph API.
# A personal Instagram account (not linked to a Facebook Page) cannot be
# accessed this way — the user must have a Business or Creator account linked
# to a Facebook Page in Meta Business Suite.
# ─────────────────────────────────────────────────────────────────────────────


def _channels_url(suffix: str = "") -> str:
    return f"{FRONTEND_URL}{_CHANNELS_PATH}{suffix}"


# ── Request models ────────────────────────────────────────────────────────────

class SyncRequest(BaseModel):
    tenant_id: str


class DisconnectRequest(BaseModel):
    tenant_id: str
    channel_id: str = "instagram"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/connect")
async def instagram_connect(tenant_id: str = Query(..., description="Tenant UUID")):
    """
    Start the Meta OAuth flow.
    Generates a random state token (CSRF protection), stores tenant mapping,
    then 302-redirects the browser to Facebook login.
    """
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id is required")

    state = create_oauth_state(tenant_id)
    oauth_url = build_oauth_url(state=state)
    logger.info("[oauth:connect] tenant=%s state=%s…", tenant_id, state[:8])
    return RedirectResponse(url=oauth_url, status_code=302)


@router.get("/callback")
async def instagram_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    error_reason: str = Query(None),
    error_description: str = Query(None),
):
    """
    Meta OAuth callback.
    Validates CSRF state, exchanges code for token, fetches Instagram account,
    saves to DB, then redirects browser back to the frontend channels page.

    Meta error codes surfaced here:
    - access_denied        — user clicked "Cancel" on the consent dialog
    - redirect_uri_mismatch — registered URI in Meta app != FACEBOOK_REDIRECT_URI in .env
    Any other error is forwarded as-is so the frontend can display it.
    """
    # ── User denied / Meta returned an error ─────────────────────────────────
    if error:
        if error == "access_denied":
            logger.warning("[oauth:callback] user denied permission (reason=%s)", error_reason)
            return RedirectResponse(_channels_url("?error=access_denied"))
        if error == "redirect_uri_mismatch":
            logger.error(
                "[oauth:callback] redirect_uri mismatch — check FACEBOOK_REDIRECT_URI in .env"
                " matches the URI registered in Meta Developer Console"
            )
            return RedirectResponse(_channels_url("?error=redirect_uri_mismatch"))
        logger.warning("[oauth:callback] Meta error=%s desc=%s", error, error_description)
        return RedirectResponse(_channels_url(f"?error={error}"))

    # ── Missing params ────────────────────────────────────────────────────────
    if not code or not state:
        logger.warning("[oauth:callback] missing code or state (code=%s state=%s)", bool(code), bool(state))
        return RedirectResponse(_channels_url("?error=missing_params"))

    # ── CSRF state validation ─────────────────────────────────────────────────
    tenant_id = consume_oauth_state(state)
    if tenant_id is None:
        # state unknown, already used, or expired (> 10 min)
        logger.warning("[oauth:callback] invalid/expired state=%s…", state[:8])
        return RedirectResponse(_channels_url("?error=invalid_state"))

    logger.info("[oauth:callback] state valid, tenant=%s — beginning token exchange", tenant_id)

    try:
        # 1. Exchange auth code → short-lived user token (~1 hour)
        logger.debug("[oauth:step1] exchanging code for short-lived token")
        short_token = await exchange_code_for_token(code)

        # 2. Upgrade → long-lived user token (~60 days)
        logger.debug("[oauth:step2] upgrading to long-lived token")
        long_token = await get_long_lived_token(short_token)
        _last_token[tenant_id] = long_token  # cache for /debug endpoint

        # 3. Fetch Facebook Pages the user manages
        logger.debug("[oauth:step3] fetching Facebook Pages")
        pages = await get_facebook_pages(long_token)
        if not pages:
            logger.warning("[oauth:step3] no Facebook Pages found for tenant=%s", tenant_id)
            return RedirectResponse(_channels_url("?error=no_pages"))
        logger.info("[oauth:step3] found %d page(s) for tenant=%s", len(pages), tenant_id)

        page = pages[0]
        page_id: str = page["id"]
        page_name: str = page["name"]
        # Page-scoped token is required for Instagram Graph API calls
        page_token: str = page.get("access_token", long_token)

        # 4. Resolve linked Instagram Business Account
        logger.debug("[oauth:step4] resolving Instagram Business Account for page=%s", page_id)
        ig_id = await get_instagram_account_id(page_id, page_token)
        if not ig_id:
            logger.warning(
                "[oauth:step4] page=%s has no linked Instagram Business Account (tenant=%s). "
                "User must link an Instagram Professional account to their Facebook Page "
                "via Meta Business Suite → Settings → Instagram.",
                page_id, tenant_id,
            )
            return RedirectResponse(_channels_url("?error=no_instagram_account"))

        # 5. Fetch Instagram username
        logger.debug("[oauth:step5] fetching username for ig_id=%s", ig_id)
        username = await get_instagram_username(ig_id, page_token)
        logger.info("[oauth:step5] resolved @%s (ig_id=%s)", username, ig_id)

        # 6. Persist connection
        channel_store.upsert(
            tenant_id, "instagram",
            handle=f"@{username}" if username else None,
            instagram_id=ig_id,
            page_id=page_id,
            page_name=page_name,
            access_token=page_token,
            token_type="long_lived",
            status="connected",
        )

        logger.info("[oauth:done] Instagram connected — tenant=%s @%s page='%s'", tenant_id, username, page_name)
        return RedirectResponse(_channels_url("?connected=instagram"))

    except httpx.HTTPStatusError as exc:
        body = exc.response.text
        status = exc.response.status_code
        # Meta returns 400 with { "error": { "code": 100, "message": "..." } }
        # for invalid/expired auth codes and redirect_uri mismatches
        if status == 400:
            logger.error("[oauth:error] Meta rejected request (400) — likely expired/reused code. body=%s", body)
            return RedirectResponse(_channels_url("?error=invalid_code"))
        logger.exception("[oauth:error] Meta API HTTP %d: %s", status, body)
        return RedirectResponse(_channels_url("?error=meta_api_error"))
    except Exception:
        logger.exception("[oauth:error] unexpected error in callback for tenant=%s", tenant_id)
        return RedirectResponse(_channels_url("?error=callback_failed"))


@router.get("/status")
async def instagram_status(tenant_id: str = Query(...)):
    """Return the current Instagram connection status for a tenant."""
    row = channel_store.get(tenant_id, "instagram")
    if not row:
        return {"connected": False, "handle": None, "last_sync": None}
    return {
        "connected": row["status"] == "connected",
        "handle": row.get("handle"),
        "last_sync": row.get("last_sync"),
        "instagram_id": row.get("instagram_id"),
        "page_id": row.get("page_id"),
        "page_name": row.get("page_name"),
    }


@router.post("/sync")
async def instagram_sync(req: SyncRequest):
    """
    Update the last_sync timestamp for a tenant's Instagram connection.
    Returns 404 if no active connection exists.
    """
    row = channel_store.get(req.tenant_id, "instagram")
    if not row:
        raise HTTPException(status_code=404, detail="No Instagram connection found")
    if row.get("status") != "connected":
        raise HTTPException(status_code=400, detail="Instagram is not connected")
    if not row.get("access_token"):
        raise HTTPException(status_code=401, detail="Access token missing or expired — please reconnect")

    now = datetime.now(timezone.utc).isoformat()
    channel_store.update(req.tenant_id, "instagram", last_sync=now)
    return {"status": "success", "last_sync": now}


@router.post("/disconnect")
async def instagram_disconnect(req: DisconnectRequest):
    """Deactivate a channel connection — clears the token and marks it disconnected."""
    row = channel_store.get(req.tenant_id, req.channel_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"No {req.channel_id} connection found")
    channel_store.update(req.tenant_id, req.channel_id, status="disconnected", access_token="")
    return {"status": "success", "message": f"{req.channel_id} disconnected"}


@router.get("/debug")
async def instagram_debug(tenant_id: str = Query(...)):
    """
    DEV-ONLY diagnostic endpoint.
    Uses the cached long-lived token from the last OAuth callback to call:
      - /me            → confirm token is valid
      - /debug_token   → show granted scopes
      - /me/accounts   → list Facebook Pages

    Hit this immediately after an OAuth callback to diagnose no_pages errors.
    Usage: GET http://localhost:8000/api/instagram/debug?tenant_id=<your-tenant-id>
    """
    token = _last_token.get(tenant_id)
    if not token:
        raise HTTPException(
            status_code=404,
            detail=(
                "No cached token for this tenant. "
                "Complete the OAuth flow first, then hit this endpoint immediately."
            ),
        )
    try:
        debug_info = await get_token_debug_info(token)
        pages = await get_facebook_pages(token)
        return {
            "diagnosis": {
                "token_valid": debug_info["token_debug"].get("is_valid"),
                "granted_scopes": debug_info["token_debug"].get("scopes", []),
                "pages_show_list_granted": "pages_show_list" in debug_info["token_debug"].get("scopes", []),
                "facebook_pages_found": len(pages),
                "pages": [{"id": p["id"], "name": p["name"]} for p in pages],
            },
            "fix_guide": {
                "no_pages_show_list": "Scope not granted. Delete app, re-authorize, make sure not to uncheck 'Manage your Pages' in the OAuth dialog.",
                "pages_empty_but_scope_ok": "Account has no Facebook Pages OR app is in Development mode and this user is not an admin/tester of the Meta app.",
                "app_in_dev_mode": "Go to Meta Developer Console → App → Roles → Add your account as Tester or Developer. Or switch app to Live mode.",
                "create_page": "Create a Facebook Page at facebook.com/pages/create, then link an Instagram Business/Creator account via Settings > Instagram.",
            },
            **debug_info,
        }
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Meta API error: {exc.response.text}")
