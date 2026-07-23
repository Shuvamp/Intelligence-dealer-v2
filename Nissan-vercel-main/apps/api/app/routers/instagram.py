"""Instagram OAuth router — connect, callback, status, sync, disconnect."""
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.config import FRONTEND_URL
from app.services import channel_store, instagram_analytics_store as analytics_store
from app.services.instagram import (
    InstagramCommentError,
    build_oauth_url,
    consume_oauth_state,
    create_oauth_state,
    exchange_code_for_token,
    get_facebook_pages,
    get_instagram_account_id,
    get_instagram_username,
    get_long_lived_token,
    get_media_comments,
    get_token_debug_info,
    reply_to_comment,
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
        await channel_store.upsert(
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
    row = await channel_store.get(tenant_id, "instagram")
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
    row = await channel_store.get(req.tenant_id, "instagram")
    if not row:
        raise HTTPException(status_code=404, detail="No Instagram connection found")
    if row.get("status") != "connected":
        raise HTTPException(status_code=400, detail="Instagram is not connected")
    if not row.get("access_token"):
        raise HTTPException(status_code=401, detail="Access token missing or expired — please reconnect")

    now = datetime.now(timezone.utc).isoformat()
    await channel_store.update(req.tenant_id, "instagram", last_sync=now)
    return {"status": "success", "last_sync": now}


def build_audience_series(
    snapshots: list[dict], date_from: str | None = None, date_to: str | None = None,
) -> list[dict]:
    """Follower snapshots → one point per UTC day, with a day-over-day delta.

    The last snapshot of each day wins (snapshots arrive oldest-first). Deltas
    are computed over the FULL history *before* the range filter, so the first
    in-range point still shows a real change rather than null. `net` is null
    only for the very first day ever recorded — nothing to diff against.
    """
    by_day: dict[str, int] = {}
    for snap in snapshots:
        followers = snap.get("followers")
        if followers is None:
            continue
        by_day[(snap.get("captured_at") or "")[:10]] = followers

    series: list[dict] = []
    prev: int | None = None
    for day in sorted(by_day):
        total = by_day[day]
        series.append({"date": day, "followers": total, "net": None if prev is None else total - prev})
        prev = total

    if date_from:
        series = [p for p in series if p["date"] >= date_from[:10]]
    if date_to:
        series = [p for p in series if p["date"] <= date_to[:10]]
    return series


@router.get("/insights")
async def instagram_insights(
    tenant_id: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    """
    Instagram insights read from stored snapshots (written by the background
    analytics poller, app/services/instagram_analytics_poller.py) — not
    fetched live, so this loads instantly regardless of Graph API latency.

    like_count isn't reliably returned for every media type/API version —
    when it's missing, likesMetricsStatus degrades to "unavailable" instead
    of a bare 0, while comments (generally reliable for Business/Creator
    accounts) still populate independently.
    """
    empty = {
        "connected": False, "handle": None, "last_sync": None,
        "postsTracked": 0, "postsWithStats": 0,
        "likes": 0, "comments": 0, "engagement": 0, "avgEngagementPerPost": 0,
        "likesMetricsStatus": "unavailable",
        "topPosts": [], "posts": [], "audience": [],
    }

    row = await channel_store.get(tenant_id, "instagram")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        return empty

    posts = await analytics_store.get_posts_for_tenant(tenant_id)
    if date_from:
        posts = [p for p in posts if (p.get("published_at") or "") >= date_from]
    if date_to:
        posts = [p for p in posts if (p.get("published_at") or "") <= date_to]

    latest_metrics = await analytics_store.get_latest_post_metrics(tenant_id)

    # Campaign attribution by publish-date window — same rule as the SQL in
    # refresh_campaign_insights_from_instagram (0053/0055): a post falls under
    # whichever campaign's [start_date, end_date] range contains its publish
    # date. Sorted latest-start-first so the first window match wins on overlap.
    campaigns = await analytics_store.get_campaigns_for_tenant(tenant_id)
    campaigns.sort(key=lambda c: c.get("start_date") or "", reverse=True)
    today = datetime.now(timezone.utc).date().isoformat()

    def campaign_for(published_at: str | None) -> str | None:
        if not published_at:
            return None
        day = published_at[:10]
        for c in campaigns:
            start = c.get("start_date")
            if not start or day < start:
                continue
            if day <= (c.get("end_date") or today):
                return c.get("name")
        return None

    per: list[dict] = []
    likes = comments = 0
    # "ok" (likes available on at least one post) wins over any degraded
    # status; otherwise surface the last-seen degraded status.
    likes_status = "unavailable"
    for p in posts:
        m = latest_metrics.get(p["media_id"])
        if not m:
            continue
        likes += m.get("likes") or 0
        comments += m.get("comments") or 0
        if likes_status != "ok" and m.get("status"):
            likes_status = m["status"]
        reach = m.get("reach")
        engagement_rate = (
            round(((m.get("likes") or 0) + (m.get("comments") or 0) + (m.get("shares") or 0) + (m.get("saved") or 0)) / reach * 100, 1)
            if reach else None
        )
        per.append({
            "mediaId": p["media_id"],
            "caption": p.get("caption"),
            "mediaType": p.get("media_type"),
            "imageUrl": p.get("thumbnail_url") or p.get("media_url"),
            "permalink": p.get("permalink"),
            "at": p.get("published_at"),
            "likes": m.get("likes"),
            "comments": m.get("comments"),
            "reach": reach,
            "impressions": m.get("impressions"),
            "shares": m.get("shares"),
            "saved": m.get("saved"),
            "engagementRate": engagement_rate,
            "campaign": campaign_for(p.get("published_at")),
            "status": m.get("status"),
        })

    engagement = likes + comments
    top = sorted(per, key=lambda x: (x["likes"] or 0) + (x["comments"] or 0), reverse=True)[:10]

    audience = build_audience_series(
        await analytics_store.get_account_metrics(tenant_id), date_from, date_to,
    )

    return {
        "connected": True,
        "handle": row.get("handle"),
        "last_sync": row.get("last_sync"),
        "postsTracked": len(posts),
        "postsWithStats": len(per),
        "likes": likes,
        "comments": comments,
        "engagement": engagement,
        "avgEngagementPerPost": round(engagement / len(per), 1) if per else 0,
        "likesMetricsStatus": likes_status,
        "topPosts": top,
        "posts": per,
        "audience": audience,
    }


@router.get("/comments")
async def instagram_comments(tenant_id: str = Query(...), media_id: str = Query(...)):
    """On-demand comment text list for one post — not batched into /insights
    (avoids an N+1 Graph API call per post on every dashboard load/poll tick).
    Called when a user expands a specific post on the dashboard."""
    row = await channel_store.get(tenant_id, "instagram")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        raise HTTPException(status_code=400, detail="Instagram is not connected")
    comments = await get_media_comments(media_id, row["access_token"])
    return {"media_id": media_id, "comments": comments}


class ReplyToCommentRequest(BaseModel):
    tenant_id: str
    comment_id: str
    message: str


@router.post("/comments/reply")
async def instagram_reply_to_comment(req: ReplyToCommentRequest):
    """Reply to one Instagram comment from the dashboard's Comments panel —
    posts through the Graph API so it shows up on the live Instagram post
    too. No local reply storage: the next GET /comments call re-reads
    Instagram's own state, so app and Instagram never diverge."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Reply message is required")
    row = await channel_store.get(req.tenant_id, "instagram")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        raise HTTPException(status_code=400, detail="Instagram is not connected")
    try:
        result = await reply_to_comment(req.comment_id, row["access_token"], req.message.strip())
    except InstagramCommentError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "id": result.get("id"),
        "text": req.message.strip(),
        "username": row.get("handle"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


class RefreshAnalyticsRequest(BaseModel):
    tenant_id: str


@router.post("/analytics/refresh")
async def instagram_refresh_analytics(req: RefreshAnalyticsRequest):
    """Manually run one analytics poll for a single tenant (the dashboard's
    "Refresh analytics" button) instead of waiting for the next scheduled tick."""
    row = await channel_store.get(req.tenant_id, "instagram")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        raise HTTPException(status_code=400, detail="Instagram is not connected")
    from app.services.instagram_analytics_poller import refresh_tenant
    try:
        await refresh_tenant(req.tenant_id, row)
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] manual refresh failed tenant=%s", req.tenant_id)
        raise HTTPException(status_code=502, detail="Instagram analytics refresh failed")
    return {"status": "success"}


@router.post("/disconnect")
async def instagram_disconnect(req: DisconnectRequest):
    """Deactivate a channel connection — clears the token and marks it disconnected."""
    row = await channel_store.get(req.tenant_id, req.channel_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"No {req.channel_id} connection found")
    await channel_store.update(req.tenant_id, req.channel_id, status="disconnected", access_token="")
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
