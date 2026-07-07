"""Instagram Graph API — OAuth token exchange and account info fetch."""
import secrets
import time
from urllib.parse import urlencode

import httpx

from app.config import (
    FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET,
    FACEBOOK_REDIRECT_URI,
    META_API_VERSION,
)

SCOPES = [
    "pages_show_list",
    "pages_read_engagement",
    "instagram_basic",
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
