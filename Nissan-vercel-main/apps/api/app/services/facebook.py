"""Facebook Page OAuth service — Facebook Login for Business + Page connection.

Reuses Instagram's Meta/Graph primitives (CSRF state store, code→token
exchange, long-lived token upgrade, Page listing) — those are plain Facebook
Graph API calls with nothing Instagram-specific about them. The one thing
that's genuinely different for Facebook is the OAuth dialog itself: Facebook
Login for Business is driven by a pre-configured FACEBOOK_CONFIG_ID (set up in
Meta Developer Console → App → Facebook Login for Business → Configurations,
which bundles the requested permissions server-side) instead of a raw `scope`
list like Instagram's flow uses.
"""
import logging
from urllib.parse import urlencode

import httpx

from app.config import FACEBOOK_APP_ID, FACEBOOK_PAGE_REDIRECT_URI, META_API_VERSION

logger = logging.getLogger(__name__)

# Re-exported so app/routers/facebook.py has one service module to import from
# (matches every other channel's router ↔ service pairing) — the calls
# themselves are identical Meta Graph API requests Instagram already made.
from app.services.instagram import (  # noqa: F401
    consume_oauth_state,
    create_oauth_state,
    exchange_code_for_token,
    get_facebook_pages,
    get_long_lived_token,
    get_token_debug_info,
)

REQUIRED_PAGE_SCOPES = ("pages_manage_posts", "pages_read_engagement")

# Classic Facebook Login scopes — mirrors Instagram's flow so the user gets the
# plain Page picker (not the Business asset-sharing dialog the config_id flow
# shows). pages_show_list is needed to enumerate the user's Pages in the callback.
SCOPES = ("pages_show_list", *REQUIRED_PAGE_SCOPES)


def build_oauth_url(state: str, redirect_uri: str | None = None) -> str:
    """Classic Facebook Login dialog with a raw `scope` list — same as
    Instagram's build_oauth_url. Requests Page permissions directly instead of
    routing through a Meta-side config_id (which renders the business
    asset-sharing UI)."""
    params = {
        "client_id": FACEBOOK_APP_ID,
        "redirect_uri": redirect_uri or FACEBOOK_PAGE_REDIRECT_URI,
        "scope": ",".join(SCOPES),
        "response_type": "code",
        "state": state,
        "auth_type": "reauthenticate",  # always ask for credentials — enables account switching
    }
    return f"https://www.facebook.com/{META_API_VERSION}/dialog/oauth?{urlencode(params)}"


# ── Page publishing ───────────────────────────────────────────────────────────
# Text-only  → POST /{page_id}/feed     (message=caption)
# With image → POST /{page_id}/photos   (source=bytes, caption=caption)
# Single real implementation — app/routers/publish.py (manual/Content Studio)
# and app/tools/publishing_tools.py (scheduled ReAct agent) both call this
# instead of re-implementing the Graph API request.


class FacebookPublishError(Exception):
    """Raised when a Facebook Page publish request fails. str(exc) carries the
    Graph API's own error message, not a generic message."""


async def publish_post(
    page_id: str,
    page_token: str,
    caption: str,
    image_bytes: bytes | None = None,
) -> dict:
    """
    Publish to a Facebook Page. Posts a photo (captioned) when image_bytes is
    given, else a text-only feed post. Returns {"status": "success", "post_id": "..."}
    — same shape as app.services.linkedin.publish_post. Raises
    FacebookPublishError (with the full Graph API error body) on failure.
    """
    if image_bytes:
        url = f"https://graph.facebook.com/{META_API_VERSION}/{page_id}/photos"
        logger.info("[facebook:publish] page_id=%s POST %s (photo, %d bytes)", page_id, url, len(image_bytes))
        async with httpx.AsyncClient() as client:
            r = await client.post(
                url,
                data={"caption": caption, "access_token": page_token},
                files={"source": ("image.jpg", image_bytes)},
                timeout=60,
            )
    else:
        url = f"https://graph.facebook.com/{META_API_VERSION}/{page_id}/feed"
        logger.info("[facebook:publish] page_id=%s POST %s (text)", page_id, url)
        async with httpx.AsyncClient() as client:
            r = await client.post(
                url,
                data={"message": caption, "access_token": page_token},
                timeout=30,
            )

    try:
        body = r.json()
    except ValueError:
        body = {"raw": r.text}
    logger.info("[facebook:publish] page_id=%s response status=%d body=%s", page_id, r.status_code, body)

    if r.status_code not in (200, 201):
        error_detail = (body.get("error") or {}).get("message") or body
        logger.error("[facebook:publish] page_id=%s FAILED status=%d error=%s", page_id, r.status_code, error_detail)
        raise FacebookPublishError(f"Facebook publish failed ({r.status_code}): {error_detail}")

    # /photos returns {"id": <photo_id>, "post_id": <feed_post_id>}; /feed
    # returns just {"id": <feed_post_id>} — prefer post_id when both exist.
    post_id = body.get("post_id") or body.get("id")
    if not post_id:
        logger.error("[facebook:publish] page_id=%s returned no post id: %s", page_id, body)
        raise FacebookPublishError(f"Facebook publish returned no post id: {body}")

    logger.info("[facebook:publish] page_id=%s SUCCESS post_id=%s", page_id, post_id)
    return {"status": "success", "post_id": post_id}
