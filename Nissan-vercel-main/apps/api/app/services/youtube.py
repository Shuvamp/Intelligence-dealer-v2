"""YouTube OAuth service — token exchange, channel fetch, and resumable video upload.

Uses the official Google SDKs (google-auth-oauthlib for OAuth, google-api-python-client
for the Data API v3), unlike Instagram/LinkedIn (raw httpx) — confirmed with the user,
since every SDK call here is synchronous and this repo has no precedent for handling
YouTube's resumable-upload chunk/retry loop by hand.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from app.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI

logger = logging.getLogger(__name__)

# Content Studio video attachments — written by app/routers/marketing.py's
# /video/upload (same directory, computed the same way), served by main.py's
# /videos static mount. Resolved back to a local path here rather than
# fetched over HTTP, since every caller runs in this same process/host.
VIDEOS_DIR = Path(__file__).resolve().parent.parent.parent / "generated" / "videos"

# Reuse the shared CSRF state store (same in-memory map/TTL Instagram + LinkedIn use).
from app.services.instagram import create_oauth_state, consume_oauth_state  # noqa: F401

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]

TOKEN_URI = "https://oauth2.googleapis.com/token"

# google-auth-oauthlib's Flow auto-generates a PKCE code_verifier per instance
# and embeds its S256 challenge in the authorization URL (autogenerate_code_verifier
# defaults True) — but build_oauth_url and exchange_code_for_token run in separate
# HTTP requests, each constructing its own throwaway Flow. Without persisting the
# verifier across that boundary, the token exchange sends no code_verifier at all
# and Google rejects it with "(invalid_grant) Missing code verifier." Store it
# keyed by state, same TTL/single-use pattern as the CSRF state store.
_VERIFIER_TTL = 600  # seconds
_verifier_store: dict[str, tuple[str, float]] = {}


def _purge_expired_verifiers() -> None:
    now = time.monotonic()
    expired = [k for k, (_, ts) in _verifier_store.items() if now - ts > _VERIFIER_TTL]
    for k in expired:
        del _verifier_store[k]


class YouTubePublishError(Exception):
    """Raised when any step of the YouTube publish flow fails."""


def _client_config() -> dict:
    return {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_uri": TOKEN_URI,
            "redirect_uris": [GOOGLE_REDIRECT_URI],
        }
    }


def _flow(code_verifier: str | None = None) -> Flow:
    return Flow.from_client_config(
        _client_config(), scopes=SCOPES, redirect_uri=GOOGLE_REDIRECT_URI, code_verifier=code_verifier,
    )


def build_oauth_url(state: str) -> str:
    flow = _flow()
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    _purge_expired_verifiers()
    _verifier_store[state] = (flow.code_verifier, time.monotonic())
    return url


def _exchange_code_sync(code: str, code_verifier: str | None) -> Credentials:
    flow = _flow(code_verifier=code_verifier)
    flow.fetch_token(code=code)
    return flow.credentials


async def exchange_code_for_token(code: str, state: str) -> Credentials:
    _purge_expired_verifiers()
    entry = _verifier_store.pop(state, None)
    code_verifier = entry[0] if entry else None
    return await asyncio.to_thread(_exchange_code_sync, code, code_verifier)


def _get_channel_info_sync(credentials: Credentials) -> dict:
    youtube = build("youtube", "v3", credentials=credentials)
    resp = youtube.channels().list(part="snippet", mine=True).execute()
    items = resp.get("items") or []
    if not items:
        raise YouTubePublishError("No YouTube channel found for this Google account")
    item = items[0]
    return {"id": item["id"], "title": item.get("snippet", {}).get("title", "")}


async def get_channel_info(credentials: Credentials) -> dict:
    return await asyncio.to_thread(_get_channel_info_sync, credentials)


def credentials_from_row(row: dict) -> Credentials:
    return Credentials(
        token=row.get("access_token") or None,
        refresh_token=row.get("refresh_token") or None,
        token_uri=TOKEN_URI,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )


def _is_expired(token_expires_at: str | None) -> bool:
    if not token_expires_at:
        return True
    try:
        expiry = datetime.fromisoformat(token_expires_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) >= expiry
    except Exception:  # noqa: BLE001
        return True


def _refresh_sync(credentials: Credentials) -> Credentials:
    credentials.refresh(GoogleAuthRequest())
    return credentials


async def refresh_if_expired(row: dict) -> tuple[Credentials, bool]:
    """Returns (credentials, was_refreshed). Caller persists new token/expiry
    back to channel_store when was_refreshed is True."""
    credentials = credentials_from_row(row)
    if not _is_expired(row.get("token_expires_at")):
        return credentials, False
    if not credentials.refresh_token:
        raise YouTubePublishError("No refresh token stored — reconnect YouTube")
    credentials = await asyncio.to_thread(_refresh_sync, credentials)
    return credentials, True


async def get_valid_credentials(tenant_id: str, row: dict) -> Credentials:
    """Return usable Credentials for a stored YouTube connection, refreshing
    (and persisting the refreshed access token back to channel_store) first
    if it has expired. Shared by every publish entry point — the standalone
    /api/youtube/publish endpoint and the /api/publish fan-out's youtube
    branch — so token refresh is written once, not duplicated per caller."""
    from app.services import channel_store  # local import: avoid a module-load-order cycle

    credentials, refreshed = await refresh_if_expired(row)
    if refreshed:
        channel_store.update(
            tenant_id, "youtube",
            access_token=credentials.token or "",
            token_expires_at=credentials.expiry.replace(tzinfo=timezone.utc).isoformat() if credentials.expiry else None,
        )
    return credentials


def _upload_video_sync(
    credentials: Credentials,
    file_obj: BinaryIO,
    mimetype: str,
    title: str,
    description: str,
    tags: list[str],
    privacy_status: str,
) -> dict:
    youtube = build("youtube", "v3", credentials=credentials)
    body = {
        "snippet": {"title": title, "description": description, "tags": tags},
        "status": {"privacyStatus": privacy_status},
    }
    media = MediaIoBaseUpload(file_obj, mimetype=mimetype, chunksize=4 * 1024 * 1024, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            logger.info("[youtube:upload] progress %d%%", int(status.progress() * 100))

    video_id = response["id"]
    return {"video_id": video_id, "video_url": f"https://www.youtube.com/watch?v={video_id}"}


async def upload_video(
    credentials: Credentials,
    file_obj: BinaryIO,
    mimetype: str,
    title: str,
    description: str,
    tags: list[str],
    privacy_status: str,
) -> dict:
    try:
        return await asyncio.to_thread(
            _upload_video_sync, credentials, file_obj, mimetype, title, description, tags, privacy_status,
        )
    except YouTubePublishError:
        raise
    except Exception as e:  # noqa: BLE001
        raise YouTubePublishError(f"YouTube upload failed: {e}") from e


def _local_video_path(video_url: str | None) -> Path | None:
    """Map a stored video_url (e.g. '.../videos/<tenant>/<file>.mp4') back to
    its file on disk. Returns None if it isn't ours or the file is gone."""
    if not video_url:
        return None
    marker = "/videos/"
    idx = video_url.find(marker)
    if idx == -1:
        return None
    rel = video_url[idx + len(marker):]
    candidate = (VIDEOS_DIR / rel).resolve()
    if VIDEOS_DIR.resolve() not in candidate.parents:
        return None  # path-traversal guard
    return candidate if candidate.is_file() else None


async def publish_video_from_url(
    tenant_id: str,
    row: dict,
    title: str,
    description: str,
    video_url: str | None,
    privacy_status: str = "private",
) -> dict:
    """
    The one real implementation behind every "publish this video to YouTube"
    entry point — the manual /api/publish fan-out (app/routers/publish.py) and
    the scheduled ReAct publishing agent (app/tools/publishing_tools.py) both
    call this instead of re-implementing credential refresh + upload_video().

    Unlike LinkedIn/Instagram/Facebook (image or text shares), YouTube's
    videos.insert() needs an actual video file — so "connected but no video
    attached" is reported as its own status rather than folded into a generic
    failure or "not built yet".

    Returns {"status": "success", "video_id", "video_url"} on success,
    {"status": "skipped", "reason": "video_required"} with no video attached,
    {"status": "error", "error": <full Google API error text>} otherwise.
    """
    if not video_url:
        return {"status": "skipped", "reason": "video_required"}
    video_path = _local_video_path(video_url)
    if not video_path:
        return {"status": "error", "error": f"video file not found on disk for video_url={video_url!r}"}

    try:
        credentials = await get_valid_credentials(tenant_id, row)
        with video_path.open("rb") as f:
            result = await upload_video(
                credentials, f, "video/*", title or "Untitled", description, [], privacy_status,
            )
    except YouTubePublishError as exc:
        logger.error("[youtube:publish] tenant=%s err=%s", tenant_id, exc)
        return {"status": "error", "error": str(exc)}

    from app.services import youtube_video_store  # local import: avoid a module-load-order cycle
    try:
        await youtube_video_store.insert_video(
            tenant_id, result["video_id"], result["video_url"], title, description, privacy_status,
        )
    except Exception:  # noqa: BLE001 — best-effort record, never fail the publish
        logger.warning("[youtube:publish] could not record video %s", result.get("video_id"))

    return {"status": "success", "video_id": result["video_id"], "video_url": result["video_url"]}


async def revoke_token(token: str) -> None:
    """Best-effort revoke — never raises, matches the repo's degrade-gracefully idiom."""
    if not token:
        return
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://oauth2.googleapis.com/revoke",
                params={"token": token},
                headers={"content-type": "application/x-www-form-urlencoded"},
                timeout=10,
            )
    except Exception:  # noqa: BLE001
        logger.warning("[youtube:disconnect] token revoke failed (continuing)")
