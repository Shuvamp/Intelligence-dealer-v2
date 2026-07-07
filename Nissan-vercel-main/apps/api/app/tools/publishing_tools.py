"""
Publishing tools for the ReAct publishing agent.

Each function is a discrete, testable unit that wraps an existing service.
No business logic lives here — tools are thin, named operations the agent
calls by name in its reasoning loop.

Async tools use asyncio.to_thread() for sync DB / channel-store calls so the
agent's ainvoke() path stays fully non-blocking.
"""
from __future__ import annotations

import asyncio
import base64
import logging
from typing import Optional

import httpx

from app.db import duckdb as db
from app.services import channel_store
from app.services.linkedin import LinkedInPublishError
from app.services.linkedin import publish_post as _linkedin_publish

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
    posts = await asyncio.to_thread(db.list_due_posts, now)
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
        rows = await asyncio.to_thread(channel_store.list_for_tenant, tenant_id)
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

    Records the post URN in channel_store for analytics (best-effort).
    Returns {"status": "success", "post_id": "urn:li:share:..."} on success,
    {"status": "error", "error": "..."} on failure,
    {"status": "skipped", "reason": "not_connected"} when disconnected.
    """
    tenant_id = post.get("tenant_id", "")
    row = await asyncio.to_thread(channel_store.get, tenant_id, "linkedin")
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
                await asyncio.to_thread(
                    channel_store.add_linkedin_post,
                    tenant_id, urn, caption, post.get("headline") or "",
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
# Tool 5 — publish_instagram  (placeholder — preserves existing behaviour)
# ─────────────────────────────────────────────────────────────────────────────

async def publish_instagram_tool(post: dict, poster: Optional[dict]) -> dict:
    """
    Instagram publishing — not implemented yet.
    Returns the same skipped payload as the existing publish router.
    """
    logger.info(
        "[tool:publish_instagram] not_implemented group=%s", post.get("group_id"),
    )
    return {"status": "skipped", "reason": "publishing_not_implemented"}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 6 — publish_facebook  (placeholder — preserves existing behaviour)
# ─────────────────────────────────────────────────────────────────────────────

async def publish_facebook_tool(post: dict, poster: Optional[dict]) -> dict:
    """
    Facebook publishing — not implemented yet.
    Returns the same skipped payload as the existing publish router.
    """
    logger.info(
        "[tool:publish_facebook] not_implemented group=%s", post.get("group_id"),
    )
    return {"status": "skipped", "reason": "publishing_not_implemented"}


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
) -> None:
    """
    Flip publish_status in DuckDB.

    Always called regardless of per-channel outcome — preserves the existing
    semantics where channel failures never block the status transition.
    """
    await asyncio.to_thread(
        db.set_publish_status,
        kind, group_id, tenant_id, status, day_date, published_at,
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
