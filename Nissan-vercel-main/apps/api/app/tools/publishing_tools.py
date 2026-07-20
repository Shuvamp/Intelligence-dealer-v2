"""
Publishing tools for the ReAct publishing agent.

Each function is a discrete, testable unit that wraps an existing service.
No business logic lives here — tools are thin, named operations the agent
calls by name in its reasoning loop.

db.py and channel_store.py are natively async (Supabase over httpx), so
tools await them directly — no to_thread() needed.
"""
from __future__ import annotations

import base64
import logging
from typing import Optional

import httpx

from app.db import duckdb as db
from app.services import channel_store, linkedin_analytics_store
from app.services.linkedin import LinkedInPublishError
from app.services.linkedin import publish_post as _linkedin_publish
from app.services.facebook import FacebookPublishError
from app.services.facebook import publish_post as _facebook_publish
from app.services.instagram import InstagramPublishError
from app.services.instagram import publish_post as _instagram_publish
from app.services.youtube import publish_video_from_url as _youtube_publish

logger = logging.getLogger("app.tools.publishing")


# ─────────────────────────────────────────────────────────────────────────────
# Tool 1 — get_due_posts
# ─────────────────────────────────────────────────────────────────────────────

async def get_due_posts_tool() -> list[dict]:
    """
    Return every queued campaign-day and event whose scheduled_at ≤ now (IST).

    Preserves the existing IST semantics: scheduled_at is a naive IST string,
    now_iso() adds +5:30 without any timezone library.
    """
    now   = db.now_iso()
    posts = await db.list_due_posts(now)
    logger.info("[tool:get_due_posts] %d post(s) due at %s", len(posts), now)
    return posts


# ─────────────────────────────────────────────────────────────────────────────
# Tool 2 — group_targets
# ─────────────────────────────────────────────────────────────────────────────

async def group_targets_tool(
    post: dict,
    selected_platforms: Optional[list[str]] = None,
) -> list[str]:
    """
    Determine publish targets using the unchanged groupTargets() logic:

    Campaign  →  post.linked_channels ∩ connected ∩ selected
    Event     →  all connected ∩ selected

    `selected_platforms` is only supplied by the manual-publish path; the
    auto-publisher leaves it None (targets all connected channels).
    """
    tenant_id = post.get("tenant_id", "")
    try:
        rows = await channel_store.list_for_tenant(tenant_id)
    except Exception:
        logger.exception("[tool:group_targets] channel_store failed tenant=%s", tenant_id)
        return []

    connected: list[str] = [
        r["channel"]
        for r in rows
        if r.get("status") == "connected" and r.get("access_token")
    ]

    linked: list[str] = post.get("channels") or []
    pool   = linked if linked else connected
    targets = [c for c in pool if c in connected]

    if selected_platforms is not None:
        targets = [c for c in targets if c in selected_platforms]

    logger.info(
        "[tool:group_targets] group=%s targets=%s",
        post.get("group_id"), targets or "(none)",
    )
    return targets


# ─────────────────────────────────────────────────────────────────────────────
# Tool 3 — prepare_poster
# ─────────────────────────────────────────────────────────────────────────────

def prepare_poster_tool(post: dict) -> Optional[dict]:
    """
    Resolve the poster attached to a post into a typed payload dict.

    Returns:
        {"type": "base64", "payload": "<b64_string>"}  — data: URL (Gemini-generated)
        {"type": "url",    "payload": "https://..."}   — FastAPI-hosted poster
        None                                            — no poster on this post

    Preserves existing poster-handling split: data: URLs are sent inline as
    base64 because the backend cannot fetch a data: URI; http(s) URLs are
    fetched server-side.
    """
    poster = post.get("poster_url")
    if not poster:
        return None
    if poster.startswith("data:"):
        # Strip "data:<mime>;base64," prefix — keep only the raw b64 payload.
        payload = poster.split(",", 1)[-1]
        return {"type": "base64", "payload": payload}
    return {"type": "url", "payload": poster}


# ─────────────────────────────────────────────────────────────────────────────
# Internal helper — resolve poster to image bytes (shared by channel tools)
# ─────────────────────────────────────────────────────────────────────────────

async def _resolve_image_bytes(poster: Optional[dict]) -> Optional[bytes]:
    """Decode base64 or fetch URL → raw image bytes. None on any failure."""
    if not poster:
        return None
    if poster["type"] == "base64":
        try:
            return base64.b64decode(poster["payload"])
        except Exception as exc:
            logger.warning("[tool:_resolve_image] b64 decode failed: %s", exc)
            return None
    # URL path — fetch once server-side.
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            resp = await client.get(poster["payload"])
            resp.raise_for_status()
            return resp.content
    except Exception as exc:
        logger.warning(
            "[tool:_resolve_image] fetch failed url=%s err=%s",
            poster["payload"], exc,
        )
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Tool 4 — publish_linkedin
# ─────────────────────────────────────────────────────────────────────────────

async def publish_linkedin_tool(post: dict, poster: Optional[dict]) -> dict:
    """
    Publish to LinkedIn using the real linkedin service (unchanged).

    Records the post URN via linkedin_analytics_store for analytics (best-effort).
    Returns {"status": "success", "post_id": "urn:li:share:..."} on success,
    {"status": "error", "error": "..."} on failure,
    {"status": "skipped", "reason": "not_connected"} when disconnected.
    """
    tenant_id = post.get("tenant_id", "")
    row = await channel_store.get(tenant_id, "linkedin")
    if not (row and row.get("status") == "connected" and row.get("access_token")):
        logger.info("[tool:publish_linkedin] not_connected tenant=%s", tenant_id)
        return {"status": "skipped", "reason": "not_connected"}

    caption = "\n\n".join(
        part
        for part in [post.get("caption"), " ".join(post.get("hashtags") or [])]
        if part
    )
    image_bytes = await _resolve_image_bytes(poster)

    try:
        res = await _linkedin_publish(
            row["access_token"],
            caption,
            image_bytes,
            title=post.get("headline") or post.get("theme") or "",
            description=post.get("subheadline") or "",
        )
        result: dict = res if isinstance(res, dict) else {"status": "success"}
        urn = result.get("post_id")
        if urn:
            try:
                await linkedin_analytics_store.insert_post(
                    tenant_id, urn, caption, post.get("headline") or "",
                    org_urn=row.get("linkedin_org_urn"),
                    image_asset_urn=result.get("asset_urn"),
                )
            except Exception:
                logger.warning("[tool:publish_linkedin] URN record failed urn=%s", urn)
        logger.info(
            "[tool:publish_linkedin] success group=%s urn=%s", post.get("group_id"), urn,
        )
        return result
    except LinkedInPublishError as exc:
        logger.error("[tool:publish_linkedin] group=%s err=%s", post.get("group_id"), exc)
        return {"status": "error", "error": str(exc)}
    except Exception:
        logger.exception("[tool:publish_linkedin] unexpected group=%s", post.get("group_id"))
        return {"status": "error", "error": "Unexpected LinkedIn error"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 4b — publish_youtube
# ─────────────────────────────────────────────────────────────────────────────

async def publish_youtube_tool(post: dict) -> dict:
    """
    Publish to YouTube using the real youtube service (videos.insert).

    Unlike LinkedIn/IG/FB, YouTube needs an actual video file — post['video_url']
    (set via Content Studio's video attachment) — not the poster image, so this
    tool takes only `post`, no `poster` param.
    Returns {"status": "success", "video_id": "...", "video_url": "..."},
    {"status": "skipped", "reason": "not_connected" | "video_required"}, or
    {"status": "error", "error": "..."}.
    """
    tenant_id = post.get("tenant_id", "")
    row = await channel_store.get(tenant_id, "youtube")
    if not (row and row.get("status") == "connected" and row.get("access_token")):
        logger.info("[tool:publish_youtube] not_connected tenant=%s", tenant_id)
        return {"status": "skipped", "reason": "not_connected"}

    result = await _youtube_publish(
        tenant_id, row,
        title=post.get("headline") or post.get("theme") or "",
        description=post.get("subheadline") or "",
        video_url=post.get("video_url"),
        privacy_status="private",
    )
    logger.info(
        "[tool:publish_youtube] group=%s -> %s", post.get("group_id"), result.get("status"),
    )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Tool 5 — publish_instagram
# ─────────────────────────────────────────────────────────────────────────────

async def publish_instagram_tool(post: dict, poster: Optional[dict]) -> dict:
    """
    Publish to Instagram using the real instagram service (media container +
    media_publish). Instagram requires an image — text-only posts aren't
    possible via the Graph API — and the image must be reachable at a public
    URL (Meta's servers fetch it themselves), so a base64/data: poster can't
    be used here the way it can for Facebook/LinkedIn.

    Returns {"status": "success", "post_id": "..."} on success,
    {"status": "error", "error": "..."} on failure,
    {"status": "skipped", "reason": "not_connected" | "image_required" | "image_url_required"}.
    """
    tenant_id = post.get("tenant_id", "")
    row = await channel_store.get(tenant_id, "instagram")
    if not (row and row.get("status") == "connected" and row.get("access_token")):
        logger.info("[tool:publish_instagram] not_connected tenant=%s", tenant_id)
        return {"status": "skipped", "reason": "not_connected"}

    ig_user_id = row.get("instagram_id")
    if not ig_user_id:
        logger.error("[tool:publish_instagram] tenant=%s connected but missing instagram_id", tenant_id)
        return {"status": "error", "error": "Instagram connection missing instagram_id — reconnect"}

    if not poster:
        logger.info("[tool:publish_instagram] group=%s skipped: no image attached", post.get("group_id"))
        return {"status": "skipped", "reason": "image_required"}
    if poster["type"] != "url":
        logger.info("[tool:publish_instagram] group=%s skipped: poster is base64, not a public URL", post.get("group_id"))
        return {"status": "skipped", "reason": "image_url_required"}

    caption = "\n\n".join(
        part
        for part in [post.get("caption"), " ".join(post.get("hashtags") or [])]
        if part
    )

    logger.info(
        "[tool:publish_instagram] group=%s ig_user_id=%s caption_len=%d",
        post.get("group_id"), ig_user_id, len(caption),
    )

    try:
        result = await _instagram_publish(ig_user_id, row["access_token"], caption, poster["payload"])
        logger.info(
            "[tool:publish_instagram] success group=%s ig_user_id=%s post_id=%s",
            post.get("group_id"), ig_user_id, result.get("post_id"),
        )
        return result
    except InstagramPublishError as exc:
        logger.error("[tool:publish_instagram] group=%s ig_user_id=%s err=%s", post.get("group_id"), ig_user_id, exc)
        return {"status": "error", "error": str(exc)}
    except Exception:
        logger.exception("[tool:publish_instagram] unexpected group=%s ig_user_id=%s", post.get("group_id"), ig_user_id)
        return {"status": "error", "error": "Unexpected Instagram error"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 6 — publish_facebook
# ─────────────────────────────────────────────────────────────────────────────

async def publish_facebook_tool(post: dict, poster: Optional[dict]) -> dict:
    """
    Publish to Facebook using the real facebook service (Page /feed or /photos).

    Records nothing extra beyond the returned result — unlike LinkedIn there's
    no analytics store wired up yet for Facebook Page posts.
    Returns {"status": "success", "post_id": "..."} on success,
    {"status": "error", "error": "..."} on failure,
    {"status": "skipped", "reason": "not_connected"} when disconnected.
    """
    tenant_id = post.get("tenant_id", "")
    row = await channel_store.get(tenant_id, "facebook")
    if not (row and row.get("status") == "connected" and row.get("access_token")):
        logger.info("[tool:publish_facebook] not_connected tenant=%s", tenant_id)
        return {"status": "skipped", "reason": "not_connected"}

    page_id = row.get("page_id")
    if not page_id:
        logger.error("[tool:publish_facebook] tenant=%s connected but missing page_id", tenant_id)
        return {"status": "error", "error": "Facebook connection missing page_id — reconnect"}

    caption = "\n\n".join(
        part
        for part in [post.get("caption"), " ".join(post.get("hashtags") or [])]
        if part
    )
    image_bytes = await _resolve_image_bytes(poster)

    logger.info(
        "[tool:publish_facebook] group=%s page_id=%s page_name=%s caption_len=%d has_image=%s",
        post.get("group_id"), page_id, row.get("page_name"), len(caption), bool(image_bytes),
    )

    try:
        result = await _facebook_publish(page_id, row["access_token"], caption, image_bytes)
        logger.info(
            "[tool:publish_facebook] success group=%s page_id=%s post_id=%s",
            post.get("group_id"), page_id, result.get("post_id"),
        )
        return result
    except FacebookPublishError as exc:
        logger.error("[tool:publish_facebook] group=%s page_id=%s err=%s", post.get("group_id"), page_id, exc)
        return {"status": "error", "error": str(exc)}
    except Exception:
        logger.exception("[tool:publish_facebook] unexpected group=%s page_id=%s", post.get("group_id"), page_id)
        return {"status": "error", "error": "Unexpected Facebook error"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 7 — update_status
# ─────────────────────────────────────────────────────────────────────────────

async def update_status_tool(
    kind: str,
    group_id: str,
    tenant_id: str,
    status: str,
    day_date: Optional[str] = None,
    published_at: Optional[str] = None,
    channel_status: Optional[str] = None,
) -> None:
    """
    Flip publish_status (and, when given, the per-channel channel_status JSON)
    in DuckDB. `status` should be 'failed' rather than 'published' when the
    caller already knows no channel actually succeeded — see
    app/agents/publishing_agent.py's _update_status, which decides this from
    the accumulated post_results before calling here.
    """
    await db.set_publish_status(
        kind, group_id, tenant_id, status, day_date, published_at, channel_status,
    )
    logger.info("[tool:update_status] %s:%s → %s", kind, group_id, status)


# ─────────────────────────────────────────────────────────────────────────────
# Tool 8 — log_failure
# ─────────────────────────────────────────────────────────────────────────────

def log_failure_tool(post_id: str, channel: str, error: str) -> None:
    """
    Emit a structured warning log for a per-channel publish failure.
    Does NOT affect publish_status — failures are recorded for observability only.
    """
    logger.warning(
        "[tool:log_failure] post=%s channel=%s error=%s",
        post_id, channel, error,
    )
