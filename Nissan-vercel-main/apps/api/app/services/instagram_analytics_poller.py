"""
Background Instagram analytics poller.

A single asyncio task (started from the FastAPI lifespan, same shape as
app/services/linkedin_analytics_poller.py) wakes every ``POLL_SECONDS`` and,
for every tenant with a connected Instagram account:

  - backfills any media published outside this app (organic posts) into
    instagram_posts, so the dashboard reflects the whole account, not just
    what was published through this platform
  - refreshes like/comment counts for each tracked post — like_count isn't
    reliably returned for every media type/API version, so a missing value
    degrades to likes_status="unavailable" rather than being treated as an
    error; comments still populate independently.

All steps are logged under the ``app.instagram_analytics`` logger with a
``[instagram:analytics] ...`` prefix, matching linkedin_analytics_poller's
convention.
"""
from __future__ import annotations

import asyncio
import logging

from app.config import INSTAGRAM_ANALYTICS_POLL_SECONDS
from app.services import channel_store, instagram_analytics_store as store
from app.services import instagram as ig

logger = logging.getLogger("app.instagram_analytics")

POLL_SECONDS = INSTAGRAM_ANALYTICS_POLL_SECONDS


async def _backfill_media(tenant_id: str, ig_user_id: str, token: str) -> None:
    media = await ig.get_media_list(ig_user_id, token)
    if isinstance(media, str):
        logger.warning("[instagram:analytics] backfill failed tenant=%s status=%s", tenant_id, media)
        return
    tracked = await store.get_media_ids_for_tenant(tenant_id)
    for item in media:
        media_id = item.get("id")
        if not media_id or media_id in tracked:
            continue
        await store.insert_post(
            tenant_id, media_id,
            caption=item.get("caption") or "",
            media_type=item.get("media_type") or "",
            media_url=item.get("media_url"),
            thumbnail_url=item.get("thumbnail_url"),
            permalink=item.get("permalink"),
            published_at=item.get("timestamp"),
        )


async def _refresh_post(tenant_id: str, token: str, post: dict) -> None:
    media_id = post["media_id"]
    stats = await ig.get_media_stats(media_id, token)
    status = stats["status"] if stats["status"] != "ok" else stats["likes_status"]
    # reach/impressions/saved/shares come from a separate endpoint
    # (instagram_manage_insights); it failing must not lose the like/comment
    # counts we already have.
    insights = await ig.get_media_insights(media_id, token)
    await store.insert_post_metrics(
        tenant_id, media_id, status,
        likes=stats["likes"], comments=stats["comments"],
        reach=insights["reach"], impressions=insights["impressions"],
        saved=insights["saved"], shares=insights["shares"],
    )


async def refresh_tenant(tenant_id: str, connection: dict) -> None:
    token = connection.get("access_token") or ""
    ig_user_id = connection.get("instagram_id") or ""
    if not token or not ig_user_id:
        return
    try:
        await _backfill_media(tenant_id, ig_user_id, token)
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] backfill failed tenant=%s", tenant_id)

    try:
        acct = await ig.get_account_followers(ig_user_id, token)
        await store.insert_account_metrics(
            tenant_id, acct["status"], ig_user_id=ig_user_id, followers=acct["followers"],
        )
    except Exception:  # noqa: BLE001
        logger.exception("[instagram:analytics] follower snapshot failed tenant=%s", tenant_id)

    posts = await store.get_posts_for_tenant(tenant_id)
    for post in posts:
        try:
            await _refresh_post(tenant_id, token, post)
        except Exception:  # noqa: BLE001 — one bad post never blocks the rest
            logger.exception("[instagram:analytics] post refresh failed tenant=%s media_id=%s",
                              tenant_id, post.get("media_id"))

    # Fresh snapshots are in; roll them into the Marketing dashboard's
    # campaign_insights (post -> campaign by publish-date window).
    n = await store.refresh_campaign_insights(tenant_id)
    logger.info("[instagram:analytics] campaign insights refreshed tenant=%s rows=%d", tenant_id, n)


async def _tick() -> None:
    connections = await channel_store.list_connected("instagram")
    if not connections:
        logger.debug("[instagram:analytics] tick — no connected Instagram accounts")
        return
    logger.info("[instagram:analytics] tick — refreshing %d tenant(s)", len(connections))
    for conn in connections:
        tenant_id = conn.get("tenant_id")
        if not tenant_id:
            continue
        try:
            await refresh_tenant(tenant_id, conn)
        except Exception:  # noqa: BLE001 — one tenant's failure never blocks the others
            logger.exception("[instagram:analytics] tenant refresh failed tenant=%s", tenant_id)


async def run_loop(stop: asyncio.Event) -> None:
    """Refresh Instagram analytics every POLL_SECONDS until `stop` is set."""
    logger.info("[instagram:analytics] scheduler started — every %ds", POLL_SECONDS)
    while not stop.is_set():
        try:
            await _tick()
        except Exception:
            logger.exception("[instagram:analytics] tick crashed; continuing")
        try:
            await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
        except asyncio.TimeoutError:
            pass
    logger.info("[instagram:analytics] scheduler stopped")
