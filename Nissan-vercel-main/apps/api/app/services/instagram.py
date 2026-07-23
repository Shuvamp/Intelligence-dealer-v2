"""Instagram Graph API — OAuth token exchange, account info fetch, and publishing."""
import logging
import secrets
import time
from urllib.parse import urlencode

import httpx

from app.config import (
    API_PUBLIC_URL,
    FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET,
    FACEBOOK_REDIRECT_URI,
    META_API_VERSION,
)

logger = logging.getLogger(__name__)

SCOPES = [
    "pages_show_list",
    "pages_read_engagement",
    "instagram_basic",
    "instagram_content_publish",
    # Required for per-media reach/impressions (/{media-id}/insights). While the
    # Meta app is in Development mode it's granted to admins/testers/developers
    # without App Review; going live needs Advanced Access for this permission.
    # Tokens issued before this line was added lack it — reconnect Instagram.
    "instagram_manage_insights",
    # Required to read AND reply to comments (/{media-id}/comments,
    # /{comment-id}/replies). Tokens issued before this line lack it —
    # reconnect Instagram.
    "instagram_manage_comments",
]

# ── CSRF state store ──────────────────────────────────────────────────────────
# Maps random_state → (tenant_id, created_at). TTL = 10 minutes.
# In production replace with Redis; fine for single-process dev.
_STATE_TTL = 600  # seconds
_state_store: dict[str, tuple[str, float]] = {}


def _purge_expired() -> None:
    now = time.monotonic()
    expired = [k for k, (_, ts) in _state_store.items() if now - ts > _STATE_TTL]
    for k in expired:
        del _state_store[k]


def create_oauth_state(tenant_id: str) -> str:
    """Generate a cryptographically random state token, store tenant mapping."""
    _purge_expired()
    state = secrets.token_urlsafe(32)
    _state_store[state] = (tenant_id, time.monotonic())
    return state


def consume_oauth_state(state: str) -> str | None:
    """
    Validate and consume a state token.
    Returns tenant_id on success, None if unknown or expired.
    Single-use: removed from store immediately.
    """
    _purge_expired()
    entry = _state_store.pop(state, None)
    if entry is None:
        return None
    tenant_id, created_at = entry
    if time.monotonic() - created_at > _STATE_TTL:
        return None
    return tenant_id


def build_oauth_url(state: str, redirect_uri: str | None = None) -> str:
    params = {
        "client_id": FACEBOOK_APP_ID,
        "redirect_uri": redirect_uri or FACEBOOK_REDIRECT_URI,
        "scope": ",".join(SCOPES),
        "response_type": "code",
        "state": state,
        "auth_type": "reauthenticate",  # always ask for credentials — enables account switching
    }
    return f"https://www.facebook.com/{META_API_VERSION}/dialog/oauth?{urlencode(params)}"


async def exchange_code_for_token(code: str, redirect_uri: str | None = None) -> str:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/oauth/access_token",
            params={
                "client_id": FACEBOOK_APP_ID,
                "client_secret": FACEBOOK_APP_SECRET,
                "redirect_uri": redirect_uri or FACEBOOK_REDIRECT_URI,
                "code": code,
            },
        )
        r.raise_for_status()
        return r.json()["access_token"]


async def get_long_lived_token(short_token: str) -> str:
    """Exchange 1-hour user token for a ~60-day long-lived token."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": FACEBOOK_APP_ID,
                "client_secret": FACEBOOK_APP_SECRET,
                "fb_exchange_token": short_token,
            },
        )
        r.raise_for_status()
        return r.json()["access_token"]


async def get_facebook_pages(user_token: str) -> list[dict]:
    """Return pages the user manages, each with its own page-level token."""
    import logging
    log = logging.getLogger(__name__)
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/me/accounts",
            params={"access_token": user_token, "fields": "id,name,access_token"},
        )
        r.raise_for_status()
        body = r.json()
        pages = body.get("data", [])
        log.info("[get_facebook_pages] raw response: %s", body)
        log.info("[get_facebook_pages] found %d page(s)", len(pages))
        return pages


async def get_token_debug_info(user_token: str) -> dict:
    """Fetch token metadata + granted scopes from Meta debug endpoint."""
    import logging
    log = logging.getLogger(__name__)
    async with httpx.AsyncClient() as client:
        # /me — verify token is valid and get user info
        me_r = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/me",
            params={"access_token": user_token, "fields": "id,name"},
        )
        # /debug_token — shows granted scopes, expiry, app binding
        debug_r = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/debug_token",
            params={
                "input_token": user_token,
                "access_token": f"{FACEBOOK_APP_ID}|{FACEBOOK_APP_SECRET}",
            },
        )
        me = me_r.json() if me_r.is_success else {"error": me_r.text}
        debug = debug_r.json().get("data", {}) if debug_r.is_success else {"error": debug_r.text}
        log.info("[debug_token] me=%s debug=%s", me, debug)
        return {
            "me": me,
            "token_debug": {
                "app_id": debug.get("app_id"),
                "type": debug.get("type"),
                "is_valid": debug.get("is_valid"),
                "scopes": debug.get("scopes", []),
                "expires_at": debug.get("expires_at"),
                "user_id": debug.get("user_id"),
            },
        }


async def get_instagram_account_id(page_id: str, page_token: str) -> str | None:
    """Return the Instagram Business Account ID linked to a Facebook Page."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/{page_id}",
            params={"access_token": page_token, "fields": "instagram_business_account"},
        )
        r.raise_for_status()
        account = r.json().get("instagram_business_account")
        return account["id"] if account else None


async def get_instagram_username(ig_id: str, page_token: str) -> str:
    """Fetch the username of an Instagram Business Account."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/{ig_id}",
            params={"access_token": page_token, "fields": "id,username,name"},
        )
        r.raise_for_status()
        return r.json().get("username", "")


# ── Analytics ──────────────────────────────────────────────────────────────
# Mirrors app/services/linkedin.py's error-classification + best-effort
# contract: these never raise into the poller/router, they degrade to a
# status string or an empty/None result instead.

def classify_meta_error(status_code: int) -> str:
    if status_code == 401:
        return "expired_token"
    if status_code == 429:
        return "rate_limited"
    return "error"


async def get_media_list(ig_user_id: str, access_token: str, limit: int = 50) -> list[dict] | str:
    """GET /{ig-user-id}/media — recent posts, newest first. Returns the raw
    media dicts, or a classify_meta_error() status string on failure. Single
    page only — ponytail: add cursor pagination when a tenant publishes
    more than `limit` posts in one poll window."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://graph.facebook.com/{META_API_VERSION}/{ig_user_id}/media",
                params={
                    "access_token": access_token,
                    "fields": "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
                    "limit": limit,
                },
                timeout=15,
            )
        if not r.is_success:
            logger.warning("[instagram:analytics] get_media_list failed ig_user_id=%s status=%d body=%s",
                           ig_user_id, r.status_code, r.text)
            return classify_meta_error(r.status_code)
        return r.json().get("data", [])
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_media_list crashed ig_user_id=%s", ig_user_id)
        return "error"


async def get_account_followers(ig_user_id: str, access_token: str) -> dict:
    """GET /{ig-user-id}?fields=followers_count — current follower total.

    Deliberately NOT the `follower_count` insights metric (daily net gain):
    that needs the instagram_manage_insights scope, Meta app review and every
    tenant reconnecting. This field comes with instagram_basic, which the app
    already holds — growth is derived by diffing stored snapshots instead.
    A 200 missing the field degrades to "unavailable" rather than 0.
    """
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://graph.facebook.com/{META_API_VERSION}/{ig_user_id}",
                params={"access_token": access_token, "fields": "followers_count"},
                timeout=15,
            )
        if not r.is_success:
            logger.warning("[instagram:analytics] get_account_followers failed ig_user_id=%s status=%d body=%s",
                           ig_user_id, r.status_code, r.text)
            return {"followers": None, "status": classify_meta_error(r.status_code)}
        followers = r.json().get("followers_count")
        return {"followers": followers, "status": "ok" if followers is not None else "unavailable"}
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_account_followers crashed ig_user_id=%s", ig_user_id)
        return {"followers": None, "status": "error"}


async def get_media_stats(media_id: str, access_token: str) -> dict:
    """GET /{media-id}?fields=id,caption,like_count,comments_count.

    like_count isn't reliably returned for every media type/API version —
    a 200 response missing it is NOT an error, it degrades likes_status to
    "unavailable" while comments (generally reliable for Business/Creator
    accounts) still populate independently.
    """
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://graph.facebook.com/{META_API_VERSION}/{media_id}",
                params={"access_token": access_token, "fields": "id,caption,like_count,comments_count"},
                timeout=15,
            )
        if not r.is_success:
            logger.warning("[instagram:analytics] get_media_stats failed media_id=%s status=%d body=%s",
                           media_id, r.status_code, r.text)
            return {"likes": None, "comments": None, "likes_status": "unavailable",
                    "status": classify_meta_error(r.status_code)}
        body = r.json()
        likes = body.get("like_count")
        return {
            "likes": likes,
            "comments": body.get("comments_count"),
            "likes_status": "ok" if likes is not None else "unavailable",
            "status": "ok",
        }
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_media_stats crashed media_id=%s", media_id)
        return {"likes": None, "comments": None, "likes_status": "unavailable", "status": "error"}


async def get_media_insights(media_id: str, access_token: str) -> dict:
    """GET /{media-id}/insights — per-post reach + impressions + saved + shares.

    Needs instagram_manage_insights. Metric names moved: `impressions` was
    dropped for media in Graph v22 and replaced by `views`, so this asks for
    `reach,views` first and falls back to the old `reach,impressions` for
    tenants pinned to an older META_API_VERSION, then to `reach` alone (some
    media types report nothing else). Whichever answers, `views`/`impressions`
    lands in the same impressions slot.

    `saved`/`shares` are fetched separately — not every media type supports
    both (older API versions/reels don't report `shares`), so a rejected
    combined request falls back to `saved` alone rather than losing both.

    Anything still missing comes back as None -> stored as NULL, never 0: a
    zero here would read as "nobody saw this post", a different claim from
    "Instagram won't tell us".
    """
    async def _fetch(metrics: str) -> dict | None:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://graph.facebook.com/{META_API_VERSION}/{media_id}/insights",
                params={"access_token": access_token, "metric": metrics},
                timeout=15,
            )
        if not r.is_success:
            logger.warning("[instagram:analytics] get_media_insights failed media_id=%s metrics=%s status=%d body=%s",
                           media_id, metrics, r.status_code, r.text)
            return None
        out: dict = {"_status": "ok"}
        for item in r.json().get("data", []):
            values = item.get("values") or [{}]
            out[item.get("name")] = values[0].get("value")
        return out

    try:
        body = (await _fetch("reach,views")
                or await _fetch("reach,impressions")
                or await _fetch("reach"))
        reach = body.get("reach") if body else None
        impressions = (body.get("views") if body.get("views") is not None else body.get("impressions")) if body else None
        status = "ok" if body else "unavailable"
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_media_insights crashed media_id=%s", media_id)
        reach = impressions = None
        status = "error"

    try:
        extra = await _fetch("saved,shares") or await _fetch("saved")
        saved = extra.get("saved") if extra else None
        shares = extra.get("shares") if extra else None
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_media_insights saved/shares crashed media_id=%s", media_id)
        saved = shares = None

    return {"reach": reach, "impressions": impressions, "saved": saved, "shares": shares, "status": status}


async def get_media_comments(media_id: str, access_token: str, limit: int = 25) -> list[dict]:
    """GET /{media-id}/comments — top-level comments, newest first, each with
    its nested replies edge expanded. This is what keeps the dashboard's
    comment thread in sync with Instagram: replies posted from the app (or
    from Instagram itself, by anyone) all land in the same underlying comment
    thread, so the next fetch here reflects both. Returns [] on any failure
    (best-effort, never raises)."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://graph.facebook.com/{META_API_VERSION}/{media_id}/comments",
                params={
                    "access_token": access_token,
                    "fields": "id,text,username,timestamp,replies{id,text,username,timestamp}",
                    "limit": limit,
                },
                timeout=15,
            )
        if not r.is_success:
            logger.warning("[instagram:analytics] get_media_comments failed media_id=%s status=%d body=%s",
                           media_id, r.status_code, r.text)
            return []
        data = r.json().get("data", [])
        for c in data:
            c["replies"] = (c.get("replies") or {}).get("data", [])
        return data
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] get_media_comments crashed media_id=%s", media_id)
        return []


class InstagramCommentError(Exception):
    """Raised when posting a reply to Instagram fails — unlike the
    best-effort GETs above, the caller must know a reply did NOT go out."""


async def reply_to_comment(comment_id: str, access_token: str, message: str) -> dict:
    """POST /{ig-comment-id}/replies — publishes a reply on the live
    Instagram post immediately; no separate sync step exists or is needed,
    since get_media_comments always re-reads Instagram's own current state."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"https://graph.facebook.com/{META_API_VERSION}/{comment_id}/replies",
            params={"access_token": access_token, "message": message},
            timeout=15,
        )
    if not r.is_success:
        detail = r.json().get("error", {}).get("message") if r.text else str(r.status_code)
        logger.warning("[instagram:comments] reply_to_comment failed comment_id=%s status=%d body=%s",
                        comment_id, r.status_code, r.text)
        raise InstagramCommentError(detail or f"Instagram reply failed ({r.status_code})")
    return r.json()


# ── Publishing ─────────────────────────────────────────────────────────────
# Instagram Content Publishing API — unlike Facebook's /photos (multipart
# bytes upload), this is a two-step, URL-based flow:
#   1. POST /{ig-user-id}/media       (image_url, caption) → creation_id
#   2. POST /{ig-user-id}/media_publish (creation_id)       → published media id
# Meta's servers fetch image_url themselves — it must be public, no raw bytes.


class InstagramPublishError(Exception):
    """Raised when any step of the Instagram publish flow fails. str(exc)
    carries the Graph API's own error message, not a generic message."""


def to_public_url(url: str) -> str:
    """Resolve a possibly-relative poster/video path (e.g. "/posters/x.png",
    as served by this app's own StaticFiles mounts) into an absolute URL
    Meta's servers can fetch. Already-absolute URLs pass through unchanged."""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"{API_PUBLIC_URL}{url if url.startswith('/') else '/' + url}"


async def publish_post(ig_user_id: str, access_token: str, caption: str, image_url: str) -> dict:
    """
    Publish an image to an Instagram Business/Creator account.

    Returns {"status": "success", "post_id": "..."} on success. Raises
    InstagramPublishError (with the full Graph API error body) on failure.
    """
    public_url = to_public_url(image_url)

    async with httpx.AsyncClient() as client:
        logger.info("[instagram:publish] ig_user_id=%s POST /media image_url=%s", ig_user_id, public_url)
        create_r = await client.post(
            f"https://graph.facebook.com/{META_API_VERSION}/{ig_user_id}/media",
            data={"image_url": public_url, "caption": caption, "access_token": access_token},
            timeout=60,
        )
        try:
            create_body = create_r.json()
        except ValueError:
            create_body = {"raw": create_r.text}
        if create_r.status_code not in (200, 201):
            error_detail = (create_body.get("error") or {}).get("message") or create_body
            logger.error("[instagram:publish] ig_user_id=%s media creation FAILED status=%d error=%s",
                         ig_user_id, create_r.status_code, error_detail)
            raise InstagramPublishError(f"Instagram media creation failed ({create_r.status_code}): {error_detail}")

        creation_id = create_body.get("id")
        if not creation_id:
            raise InstagramPublishError(f"Instagram media creation returned no creation id: {create_body}")

        logger.info("[instagram:publish] ig_user_id=%s POST /media_publish creation_id=%s", ig_user_id, creation_id)
        publish_r = await client.post(
            f"https://graph.facebook.com/{META_API_VERSION}/{ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": access_token},
            timeout=60,
        )
        try:
            publish_body = publish_r.json()
        except ValueError:
            publish_body = {"raw": publish_r.text}
        if publish_r.status_code not in (200, 201):
            error_detail = (publish_body.get("error") or {}).get("message") or publish_body
            logger.error("[instagram:publish] ig_user_id=%s media_publish FAILED status=%d error=%s",
                         ig_user_id, publish_r.status_code, error_detail)
            raise InstagramPublishError(f"Instagram publish failed ({publish_r.status_code}): {error_detail}")

    post_id = publish_body.get("id")
    if not post_id:
        raise InstagramPublishError(f"Instagram publish returned no post id: {publish_body}")

    logger.info("[instagram:publish] ig_user_id=%s SUCCESS post_id=%s", ig_user_id, post_id)
    return {"status": "success", "post_id": post_id}
