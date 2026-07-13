"""
Facebook Page API — connect, callback, status, disconnect.

Self-contained router (mirrors app/routers/youtube.py's pattern) so the exact
paths the Connected Channels page expects exist: connect, callback, status,
disconnect under /api/facebook.

Flow (Facebook Login for Business, driven by FACEBOOK_CONFIG_ID):
  1. Browser  → GET  /api/facebook/connect?tenant_id=<uuid>
  2. Backend  → 302  → https://www.facebook.com/{v}/dialog/oauth?config_id=...
  3. User     → logs into Facebook, picks a Page, approves permissions
  4. Meta     → 302  → GET /api/facebook/callback?code=XXX&state=XXX
  5. Backend  → exchanges code for tokens, fetches the user's Facebook Pages
  6. Backend  → returns HTML that stores the result in localStorage then
                redirects the browser back to the frontend channels page
  7. Frontend → reads localStorage['facebook_connection'], shows Connected

Reuses app.services.facebook (which itself re-exports Instagram's Meta/Graph
primitives — CSRF state store, token exchange, Page listing — since those are
plain Graph API calls, nothing Instagram-specific about them). Only the
config_id-based OAuth URL is Facebook's own.
"""
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from app.config import FACEBOOK_PAGE_REDIRECT_URI, FRONTEND_URL
from app.services import channel_store
from app.services.facebook import (
    REQUIRED_PAGE_SCOPES,
    build_oauth_url,
    consume_oauth_state,
    create_oauth_state,
    exchange_code_for_token,
    get_facebook_pages,
    get_long_lived_token,
    get_token_debug_info,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_CHANNELS_PATH = "/channels"


def _front(suffix: str = "") -> str:
    return f"{FRONTEND_URL}{_CHANNELS_PATH}{suffix}"


def _js(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")


@router.get("/connect")
async def facebook_connect(tenant_id: str = Query(..., description="Tenant UUID")):
    """Step 1 — start the Facebook Login for Business flow."""
    state = create_oauth_state(tenant_id)
    oauth_url = build_oauth_url(state)
    logger.info("[facebook:connect] tenant=%s state_prefix=%s → redirecting to Meta", tenant_id, state[:8])
    return RedirectResponse(url=oauth_url, status_code=302)


@router.get("/callback")
async def facebook_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    error_reason: str = Query(None),
    error_description: str = Query(None),
):
    """
    Step 2 — Meta OAuth callback.

    Meta error codes surfaced here:
    - access_denied        — user clicked "Cancel" on the consent dialog
    - redirect_uri_mismatch — registered URI in Meta app != FACEBOOK_PAGE_REDIRECT_URI in .env
    Any other error is forwarded as-is so the frontend can display it.
    """
    if error:
        if error == "access_denied":
            logger.warning("[facebook:callback] user denied permission (reason=%s)", error_reason)
            return RedirectResponse(_front("?error=facebook_access_denied"))
        if error == "redirect_uri_mismatch":
            logger.error(
                "[facebook:callback] redirect_uri_mismatch — FACEBOOK_PAGE_REDIRECT_URI in .env"
                " must exactly match the OAuth redirect URI registered for this Config ID"
                " in Meta Developer Console → Facebook Login for Business → Configurations"
            )
            return RedirectResponse(_front("?error=facebook_redirect_uri_mismatch"))
        logger.warning("[facebook:callback] Meta error=%s desc=%s", error, error_description)
        return RedirectResponse(_front(f"?error=facebook_{error}"))

    if not code or not state:
        logger.warning("[facebook:callback] missing code or state (code=%s state=%s)", bool(code), bool(state))
        return RedirectResponse(_front("?error=missing_params"))

    tenant_id = consume_oauth_state(state)
    if not tenant_id:
        logger.warning("[facebook:callback] invalid/expired state=%s…", state[:8])
        return RedirectResponse(_front("?error=invalid_state"))

    logger.info("[facebook:callback] CSRF OK, tenant=%s — starting token exchange", tenant_id)

    try:
        # 1. Exchange auth code → short-lived user token (~1 hour)
        logger.debug("[facebook:step1] exchanging code for short-lived token")
        short_token = await exchange_code_for_token(code, redirect_uri=FACEBOOK_PAGE_REDIRECT_URI)

        # 2. Upgrade → long-lived user token (~60 days)
        logger.debug("[facebook:step2] upgrading to long-lived token")
        long_token = await get_long_lived_token(short_token)

        # 3. Fetch Facebook Pages the user manages
        logger.debug("[facebook:step3] fetching Facebook Pages")
        pages = await get_facebook_pages(long_token)
        if not pages:
            logger.warning(
                "[facebook:step3] no Facebook Pages found for tenant=%s. Likely cause: app in "
                "Development mode and this user is not a Tester/Admin, or the account has no Pages.",
                tenant_id,
            )
            return RedirectResponse(_front("?error=facebook_no_pages"))
        logger.info("[facebook:step3] found %d page(s) for tenant=%s", len(pages), tenant_id)

        page = pages[0]
        page_id: str = page["id"]
        page_name: str = page["name"]
        # Page-scoped token — required for posting to the Page later. Graph
        # omits this field when pages_show_list wasn't granted; falling back
        # to the user token here would silently store a connection that can
        # never publish (page endpoints reject user-scoped tokens).
        page_token: str | None = page.get("access_token")
        if not page_token:
            logger.error(
                "[facebook:step3] page '%s' has no page-scoped access_token for tenant=%s "
                "(missing pages_show_list?) — refusing to fall back to the user token",
                page_name, tenant_id,
            )
            return RedirectResponse(_front("?error=facebook_no_page_token"))

        # Verify the page token actually carries publish permissions. The
        # Facebook Login for Business dialog's permission set is configured
        # server-side via FACEBOOK_CONFIG_ID in Meta Developer Console — if
        # pages_manage_posts/pages_read_engagement aren't in that
        # Configuration (or the app lacks Advanced Access for them), the
        # connection "succeeds" here but every publish later fails with a
        # Graph API (#200) permissions error. Surface it now instead.
        debug = await get_token_debug_info(page_token)
        granted = set(debug.get("token_debug", {}).get("scopes", []))
        missing_scopes = [s for s in REQUIRED_PAGE_SCOPES if s not in granted]
        if missing_scopes:
            logger.error(
                "[facebook:step3] page token for '%s' (tenant=%s) is missing required scope(s) %s "
                "— add them to the Facebook Login for Business Configuration (FACEBOOK_CONFIG_ID) "
                "in Meta Developer Console, then reconnect",
                page_name, tenant_id, missing_scopes,
            )
            return RedirectResponse(_front("?error=facebook_missing_permissions"))

        connected_at = datetime.now(timezone.utc).isoformat()

        # 4. Persist connection — same channel_store every other channel uses.
        try:
            channel_store.upsert(
                tenant_id, "facebook",
                handle=page_name or None,
                page_id=page_id,
                page_name=page_name,
                access_token=page_token,
                token_type="long_lived",
                status="connected",
            )
        except Exception:
            logger.exception("[facebook:db] failed to save Facebook connection for tenant=%s", tenant_id)

        logger.info(
            "[facebook:done] Facebook connected — tenant=%s page='%s' page_id=%s",
            tenant_id, page_name, page_id,
        )

        html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Facebook Connected</title>
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
  <h2>Facebook Connected</h2>
  <p>Page {_js(page_name)} &mdash; redirecting&hellip;</p>
</div>
<script>
var result = {{
  connected: true,
  page_id: '{_js(page_id)}',
  page_name: '{_js(page_name)}',
  handle: '{_js(page_name)}',
  connected_at: '{_js(connected_at)}'
}};
try {{ localStorage.setItem('facebook_connection', JSON.stringify(result)); }} catch(e) {{}}
if (window.opener && !window.opener.closed) {{
  try {{ window.opener.postMessage({{ type: 'FACEBOOK_CONNECTED', data: result }}, '{FRONTEND_URL}'); }} catch(e) {{}}
  window.close();
}} else {{
  window.location.href = '{_front()}?connected=facebook';
}}
</script>
</body>
</html>"""
        return HTMLResponse(content=html)

    except httpx.HTTPStatusError as exc:
        body = exc.response.text
        status = exc.response.status_code
        # Meta returns 400 with { "error": { "code": 100, "message": "..." } }
        # for invalid/expired auth codes and redirect_uri mismatches.
        if status == 400:
            logger.error("[facebook:error] Meta rejected request (400) — likely expired/reused code. body=%s", body)
            return RedirectResponse(_front("?error=facebook_invalid_code"))
        logger.exception("[facebook:error] Meta API HTTP %d: %s", status, body)
        return RedirectResponse(_front("?error=facebook_meta_api_error"))
    except Exception:
        logger.exception("[facebook:error] unexpected error in callback for tenant=%s", tenant_id)
        return RedirectResponse(_front("?error=facebook_callback_failed"))


@router.get("/status")
async def facebook_status(tenant_id: str = Query(...)):
    """Return the current Facebook connection status for a tenant."""
    row = channel_store.get(tenant_id, "facebook")
    if not row or row.get("status") != "connected":
        return {"connected": False, "handle": None, "last_sync": None, "page_id": None, "page_name": None}
    return {
        "connected": True,
        "handle": row.get("handle"),
        "last_sync": row.get("last_sync"),
        "page_id": row.get("page_id"),
        "page_name": row.get("page_name"),
    }


class DisconnectRequest(BaseModel):
    tenant_id: str


@router.post("/disconnect")
async def facebook_disconnect(req: DisconnectRequest):
    """Deactivate the connection — clears the token and marks it disconnected."""
    row = channel_store.get(req.tenant_id, "facebook")
    if not row:
        raise HTTPException(status_code=404, detail="No Facebook connection found")
    channel_store.update(req.tenant_id, "facebook", status="disconnected", access_token="")
    logger.info("[facebook:disconnect] tenant=%s", req.tenant_id)
    return {"status": "success", "message": "Facebook disconnected"}
