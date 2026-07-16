"""
/auth/instagram — clean Meta OAuth implementation.

Full flow:
  1.  Browser  → GET  /auth/instagram/login?tenant_id=<uuid>
  2.  Backend  → 302  → https://www.facebook.com/v20.0/dialog/oauth
  3.  User     → logs in with Facebook, approves scopes
  4.  Meta     → 302  → GET /auth/instagram/callback?code=XXX&state=XXX
  5.  Backend  → exchanges code for token, fetches FB user/pages/IG account
  6.  Backend  → returns HTML that stores result in localStorage then
                redirects browser back to the frontend channels page
  7.  Frontend → reads localStorage["ig_connection"], shows Connected

Why Facebook login for Instagram?
  Instagram removed its own OAuth in 2020.  Access to an Instagram
  Business/Creator account now requires a Facebook login flow:
    Login with Facebook → authorize a Facebook Page → resolve the
    Instagram Business Account linked to that Page via the Graph API.
  Personal Instagram accounts cannot be accessed this way.
"""
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse, RedirectResponse

from app.config import (
    AUTH_REDIRECT_URI,
    FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET,
    FRONTEND_URL,
    LINKEDIN_REDIRECT_URI,
    META_API_VERSION,
)
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
)
from app.services.linkedin import (
    build_oauth_url as linkedin_build_oauth_url,
    exchange_code_for_token as linkedin_exchange_code,
    get_profile_url as linkedin_get_profile_url,
    get_user_profile as linkedin_get_profile,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_CHANNELS_PATH = "/channels"


def _front(suffix: str = "") -> str:
    return f"{FRONTEND_URL}{_CHANNELS_PATH}{suffix}"


# ─────────────────────────────────────────────────────────────────────────────
# GET /auth/instagram/login
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/instagram/login")
async def instagram_login(tenant_id: str = Query(..., description="Tenant UUID")):
    """
    Step 1 — Start Meta OAuth flow.

    Generates a random CSRF state token (maps to tenant_id),
    builds the Facebook OAuth URL with required scopes,
    and 302-redirects the browser to Facebook login.

    Scopes requested:
      - instagram_basic      : read IG profile and media
      - pages_show_list      : list Facebook Pages the user manages
      - pages_read_engagement: read page engagement data

    The user will see the Facebook login dialog, then a permissions screen.
    After approval, Meta calls /auth/instagram/callback?code=XXX&state=XXX.
    """
    state = create_oauth_state(tenant_id)
    oauth_url = build_oauth_url(state=state, redirect_uri=AUTH_REDIRECT_URI)
    logger.info("[auth:login] tenant=%s state_prefix=%s → redirecting to Meta", tenant_id, state[:8])
    return RedirectResponse(url=oauth_url, status_code=302)


# ─────────────────────────────────────────────────────────────────────────────
# GET /auth/instagram/callback
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/instagram/callback")
async def instagram_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    error_reason: str = Query(None),
    error_description: str = Query(None),
):
    """
    Step 2 — Meta OAuth callback.

    Exchange flow (all API calls to graph.facebook.com):

      code  ──► GET /oauth/access_token        → short-lived user token  (1h)
              ──► GET /oauth/access_token       → long-lived user token   (60d)
      token ──► GET /me                         → facebook_user_id
              ──► GET /me/accounts              → Facebook Pages list
      page  ──► GET /{page_id}?fields=instagram_business_account
                                                → instagram_business_account_id
      ig_id ──► GET /{ig_id}?fields=username   → @handle

    On success: returns HTML that writes result to localStorage then redirects
    browser back to the frontend. If the flow ran in a popup, it also fires
    window.opener.postMessage so the parent tab updates immediately.

    On any error: 302 → frontend with ?error=<code>
    """

    # ── Meta returned an error (user denied, URI mismatch, etc.) ─────────
    if error:
        if error == "access_denied":
            logger.warning("[auth:callback] user denied permission (reason=%s)", error_reason)
            return RedirectResponse(_front("?error=access_denied"))
        if error == "redirect_uri_mismatch":
            logger.error(
                "[auth:callback] redirect_uri_mismatch — "
                "AUTH_REDIRECT_URI in .env must exactly match the URI registered in Meta Developer Console"
            )
            return RedirectResponse(_front("?error=redirect_uri_mismatch"))
        logger.warning("[auth:callback] Meta error=%s desc=%s", error, error_description)
        return RedirectResponse(_front(f"?error={error}"))

    # ── Missing params ────────────────────────────────────────────────────
    if not code or not state:
        logger.warning("[auth:callback] missing code or state (code=%s state=%s)", bool(code), bool(state))
        return RedirectResponse(_front("?error=missing_params"))

    # ── CSRF state validation (single-use, 10-min TTL) ───────────────────
    tenant_id = consume_oauth_state(state)
    if not tenant_id:
        logger.warning("[auth:callback] invalid or expired state=%s…", state[:8])
        return RedirectResponse(_front("?error=invalid_state"))

    logger.info("[auth:callback] CSRF OK, tenant=%s — starting token exchange", tenant_id)

    try:
        # ── Step 1: exchange auth code for short-lived user token (~1 hour) ──
        logger.debug("[auth:step1] exchanging code for short-lived token")
        short_token: str = await exchange_code_for_token(code, redirect_uri=AUTH_REDIRECT_URI)
        logger.debug("[auth:step1] short token obtained")

        # ── Step 2: upgrade to long-lived user token (~60 days) ──────────
        logger.debug("[auth:step2] upgrading to long-lived token")
        long_token: str = await get_long_lived_token(short_token)
        logger.debug("[auth:step2] long-lived token obtained")

        # ── Step 3A: fetch Facebook User ID via GET /me ───────────────────
        logger.debug("[auth:step3a] GET /me — fetching Facebook user ID")
        async with httpx.AsyncClient() as client:
            me_r = await client.get(
                f"https://graph.facebook.com/{META_API_VERSION}/me",
                params={"access_token": long_token, "fields": "id,name"},
                timeout=10,
            )
            me_r.raise_for_status()
            me = me_r.json()
        facebook_user_id: str = me["id"]
        facebook_name: str = me.get("name", "")
        logger.info("[auth:step3a] facebook_user_id=%s (%s)", facebook_user_id, facebook_name)

        # ── Step 3B: fetch Facebook Pages via GET /me/accounts ────────────
        logger.debug("[auth:step3b] GET /me/accounts — fetching Facebook Pages")
        pages = await get_facebook_pages(long_token)
        if not pages:
            logger.warning(
                "[auth:step3b] no pages found — tenant=%s facebook_user_id=%s. "
                "Likely cause: app in Development mode and user is not a Tester, "
                "or account has no Facebook Pages.",
                tenant_id, facebook_user_id,
            )
            return RedirectResponse(_front("?error=no_pages"))
        logger.info("[auth:step3b] %d Facebook page(s) found", len(pages))

        page = pages[0]
        page_id: str = page["id"]
        page_name: str = page["name"]
        # Page-scoped token is required for Instagram Graph API calls.
        page_token: str = page.get("access_token", long_token)
        logger.info("[auth:step3b] using page '%s' (id=%s)", page_name, page_id)

        # ── Step 3C: resolve Instagram Business Account ───────────────────
        logger.debug(
            "[auth:step3c] GET /%s?fields=instagram_business_account", page_id
        )
        ig_id = await get_instagram_account_id(page_id, page_token)
        if not ig_id:
            logger.warning(
                "[auth:step3c] no Instagram Business Account on page=%s (tenant=%s). "
                "User must link an Instagram Professional account to this Facebook Page "
                "via Meta Business Suite → Settings → Instagram.",
                page_id, tenant_id,
            )
            return RedirectResponse(_front("?error=no_instagram_account"))
        logger.info("[auth:step3c] instagram_business_account_id=%s", ig_id)

        # ── Step 4: fetch Instagram username / profile ────────────────────
        username: str = await get_instagram_username(ig_id, page_token)
        handle = f"@{username}" if username else ""
        logger.info("[auth:done] connected — tenant=%s %s page='%s' ig_id=%s",
                    tenant_id, handle, page_name, ig_id)

        connected_at = datetime.now(timezone.utc).isoformat()

        # ── Persist connection to local store ─────────────────────────────
        try:
            channel_store.upsert(
                tenant_id, "instagram",
                handle=handle or None,
                instagram_id=ig_id,
                page_id=page_id,
                page_name=page_name,
                access_token=page_token,
                token_type="long_lived",
                status="connected",
            )
        except Exception:
            logger.exception("[auth:db] failed to save Instagram connection for tenant=%s", tenant_id)

        # ── Return HTML that writes to localStorage then redirects ─────────
        # Single quotes inside JS strings are escaped below.
        def _js(s: str) -> str:
            return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")

        html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Instagram Connected</title>
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
  <h2>Instagram Connected</h2>
  <p>Logged in as {_js(handle)} &mdash; redirecting…</p>
</div>
<script>
// ── Store connection result in localStorage ───────────────────────────────
var result = {{
  connected: true,
  facebook_user_id: '{_js(facebook_user_id)}',
  page_id:          '{_js(page_id)}',
  page_name:        '{_js(page_name)}',
  instagram_business_account_id: '{_js(ig_id)}',
  handle:           '{_js(handle)}',
  access_token:     '{_js(page_token)}',
  token_type:       'long_lived',
  connected_at:     '{_js(connected_at)}'
}};
try {{
  localStorage.setItem('ig_connection', JSON.stringify(result));
}} catch(e) {{
  console.warn('localStorage unavailable:', e);
}}

// ── Notify parent if running in a popup, otherwise redirect ──────────────
if (window.opener && !window.opener.closed) {{
  try {{
    window.opener.postMessage({{ type: 'INSTAGRAM_CONNECTED', data: result }}, '{FRONTEND_URL}');
  }} catch(e) {{}}
  window.close();
}} else {{
  window.location.href = '{_front()}?connected=instagram';
}}
</script>
</body>
</html>"""
        return HTMLResponse(content=html)

    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        body = exc.response.text
        if status_code == 400:
            logger.error("[auth:error] Meta 400 — expired or reused code: %s", body)
            return RedirectResponse(_front("?error=invalid_code"))
        logger.exception("[auth:error] Meta HTTP %d: %s", status_code, body)
        return RedirectResponse(_front("?error=meta_api_error"))
    except Exception:
        logger.exception("[auth:error] unexpected error — tenant=%s", tenant_id)
        return RedirectResponse(_front("?error=callback_failed"))


# ─────────────────────────────────────────────────────────────────────────────
# LinkedIn OAuth
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/linkedin/login")
async def linkedin_login(tenant_id: str = Query(..., description="Tenant UUID")):
    """
    Step 1 — Start LinkedIn OAuth flow.
    Generates CSRF state, redirects to linkedin.com/oauth/v2/authorization.
    Scopes: openid profile email w_member_social
    """
    state = create_oauth_state(tenant_id)
    oauth_url = linkedin_build_oauth_url(state=state)
    logger.info("[linkedin:login] tenant=%s state_prefix=%s → redirecting to LinkedIn", tenant_id, state[:8])
    return RedirectResponse(url=oauth_url, status_code=302)


@router.get("/linkedin/callback")
async def linkedin_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    error_description: str = Query(None),
):
    """
    Step 2 — LinkedIn OAuth callback.

    Exchange flow:
      code  ──► POST /oauth/v2/accessToken  → access_token (60 days)
      token ──► GET  /v2/userinfo           → sub, name, email
    On success: returns HTML that writes result to localStorage then redirects.
    On error:   302 → frontend with ?error=<code>
    """
    if error:
        logger.warning("[linkedin:callback] error=%s desc=%s", error, error_description)
        return RedirectResponse(_front(f"?error=linkedin_{error}"))

    if not code or not state:
        return RedirectResponse(_front("?error=missing_params"))

    tenant_id = consume_oauth_state(state)
    if not tenant_id:
        logger.warning("[linkedin:callback] invalid/expired state=%s…", state[:8])
        return RedirectResponse(_front("?error=invalid_state"))

    logger.info("[linkedin:callback] CSRF OK, tenant=%s — starting token exchange", tenant_id)

    try:
        # 1. Exchange code for access token
        token_data = await linkedin_exchange_code(code)
        access_token: str = token_data["access_token"]

        # 2. Fetch LinkedIn profile
        profile = await linkedin_get_profile(access_token)
        linkedin_id: str = profile.get("sub", "")
        full_name: str = profile.get("name", "")
        email: str = profile.get("email", "")
        picture: str = profile.get("picture", "")
        handle = full_name or email or linkedin_id

        # 3. Fetch public profile URL (best-effort; None if app lacks permission)
        profile_url: str | None = await linkedin_get_profile_url(access_token)
        logger.info("[linkedin:done] tenant=%s name='%s' linkedin_id=%s profile_url=%s",
                    tenant_id, full_name, linkedin_id, profile_url)
        connected_at = datetime.now(timezone.utc).isoformat()

        # 4. Persist connection to local store
        try:
            channel_store.upsert(
                tenant_id, "linkedin",
                handle=handle or None,
                linkedin_id=linkedin_id or None,
                email=email or None,
                picture=picture or None,
                profile_url=profile_url or None,
                access_token=access_token,
                token_type="long_lived",
                status="connected",
            )
        except Exception:
            logger.exception("[linkedin:db] failed to save LinkedIn connection for tenant=%s", tenant_id)

        # 4. Return HTML that writes result to localStorage then redirects
        def _js(s: str) -> str:
            return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")

        html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>LinkedIn Connected</title>
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
  <h2>LinkedIn Connected</h2>
  <p>Logged in as {_js(handle)} &mdash; redirecting&hellip;</p>
</div>
<script>
var result = {{
  connected: true,
  linkedin_id: '{_js(linkedin_id)}',
  handle:      '{_js(handle)}',
  email:       '{_js(email)}',
  token_type:  'long_lived',
  connected_at: '{_js(connected_at)}'
}};
try {{ localStorage.setItem('linkedin_connection', JSON.stringify(result)); }} catch(e) {{}}
if (window.opener && !window.opener.closed) {{
  try {{ window.opener.postMessage({{ type: 'LINKEDIN_CONNECTED', data: result }}, '{FRONTEND_URL}'); }} catch(e) {{}}
  window.close();
}} else {{
  window.location.href = '{_front()}?connected=linkedin';
}}
</script>
</body>
</html>"""
        return HTMLResponse(content=html)

    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        body = exc.response.text
        if status_code == 401:
            logger.error("[linkedin:error] 401 — invalid client credentials or expired code: %s", body)
            return RedirectResponse(_front("?error=linkedin_invalid_code"))
        logger.exception("[linkedin:error] LinkedIn API HTTP %d: %s", status_code, body)
        return RedirectResponse(_front("?error=linkedin_api_error"))
    except Exception:
        logger.exception("[linkedin:error] unexpected error — tenant=%s", tenant_id)
        return RedirectResponse(_front("?error=linkedin_callback_failed"))
