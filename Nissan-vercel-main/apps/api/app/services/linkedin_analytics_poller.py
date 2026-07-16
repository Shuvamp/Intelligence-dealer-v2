"""
Background LinkedIn analytics poller.

A single asyncio task (started from the FastAPI lifespan, same shape as
app/services/auto_publisher.py) wakes every ``POLL_SECONDS`` and, for every
tenant with a connected LinkedIn account:

  - refreshes likes/comments for each tracked post (member-tier `socialActions`
    — works today, no MDP needed)
  - if a Company Page (Organization) is connected, also refreshes shares/
    impressions/reach/clicks/engagement rate per post, plus followers growth
    and profile views for the account, via LinkedIn's Organization APIs — these
    require Marketing Developer Platform (MDP) approval, so until the app has
    it every one of these calls returns "mdp_required", which is stored as-is
    (not treated as an error) so the dashboard can show the correct message.
  - re-resolves each post's image URL (LinkedIn's asset CDN links expire).

All steps are logged under the ``app.linkedin_analytics`` logger with a
``[linkedin:analytics] ...`` prefix, matching auto_publisher's convention.
"""
from __future__ import annotations

import asyncio
import logging
import time

from app.config import LINKEDIN_ANALYTICS_POLL_SECONDS
from app.services import channel_store, linkedin_analytics_store as store
from app.services import linkedin as li

logger = logging.getLogger("app.linkedin_analytics")

POLL_SECONDS = LINKEDIN_ANALYTICS_POLL_SECONDS


async def _refresh_post(tenant_id: str, org_urn: str | None, token: str, post: dict) -> None:
    urn = post["urn"]
    likes = comments = shares = impressions = reach = clicks = None
    engagement_rate = None
    status = "unavailable"
    error_message = None

    member_stats = await li.get_post_stats(token, urn)
    if member_stats:
        likes, comments = member_stats["likes"], member_stats["comments"]
        status = "ok"
    else:
        status = "unavailable"

    if org_urn:
        org_stats = await li.get_org_share_statistics(token, org_urn, [urn])
        if isinstance(org_stats, str):
            status = org_stats  # "mdp_required" / "expired_token" / "rate_limited" / "error"
            error_message = f"organizationalEntityShareStatistics: {org_stats}"
        else:
            row = org_stats.get(urn)
            if row:
                likes = row["likes"]
                comments = row["comments"]
                shares = row["shares"]
                impressions = row["impressions"]
                reach = row["reach"]
                clicks = row["clicks"]
                engagement_rate = row["engagement_rate"]
                status = "ok"

    await store.insert_post_metrics(
        tenant_id, urn, status,
        likes=likes, comments=comments, shares=shares,
        impressions=impressions, reach=reach, clicks=clicks,
        engagement_rate=engagement_rate, error_message=error_message,
    )

    # Re-resolve the image URL if missing/expired — LinkedIn's asset CDN links expire.
    asset_urn = post.get("image_asset_urn")
    expires_at = post.get("image_url_expires_at")
    now_ms = int(time.time() * 1000)
    needs_refresh = asset_urn and (not post.get("image_url") or not expires_at or _parse_ms(expires_at) < now_ms)
    if needs_refresh:
        resolved = await li.resolve_asset_url(token, asset_urn)
        if resolved:
            url, expires_at_ms = resolved
            await store.update_post_image(tenant_id, urn, url, expires_at_ms)


def _parse_ms(iso_or_ms) -> int:
    if isinstance(iso_or_ms, (int, float)):
        return int(iso_or_ms)
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(iso_or_ms).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:  # noqa: BLE001
        return 0


async def _refresh_account(tenant_id: str, org_urn: str, token: str) -> None:
    now_ms = int(time.time() * 1000)
    since_ms = now_ms - POLL_SECONDS * 1000 * 4  # look back a few poll windows to smooth gaps
    growth = await li.get_follower_growth(token, org_urn, since_ms, now_ms)
    views = await li.get_page_views(token, org_urn, since_ms, now_ms)

    status = "ok"
    error_message = None
    followers_growth = growth if isinstance(growth, int) else None
    profile_views = views if isinstance(views, int) else None
    if isinstance(growth, str):
        status = growth
        error_message = f"organizationalEntityFollowerStatistics: {growth}"
    elif isinstance(views, str):
        status = views
        error_message = f"organizationPageStatistics: {views}"

    await store.insert_account_metrics(
        tenant_id, org_urn, status,
        followers_growth=followers_growth, profile_views=profile_views,
        error_message=error_message,
    )


async def refresh_tenant(tenant_id: str, connection: dict) -> None:
    token = connection.get("access_token") or ""
    org_urn = connection.get("linkedin_org_urn") or None
    if not token:
        return
    posts = await store.get_posts_for_tenant(tenant_id)
    for post in posts:
        try:
            await _refresh_post(tenant_id, org_urn, token, post)
        except Exception:  # noqa: BLE001 — one bad post never blocks the rest
            logger.exception("[linkedin:analytics] post refresh failed tenant=%s urn=%s", tenant_id, post.get("urn"))
    if org_urn:
        try:
            await _refresh_account(tenant_id, org_urn, token)
        except Exception:  # noqa: BLE001
            logger.exception("[linkedin:analytics] account refresh failed tenant=%s org=%s", tenant_id, org_urn)


async def _tick() -> None:
    connections = await asyncio.to_thread(channel_store.list_connected, "linkedin")
    if not connections:
        logger.debug("[linkedin:analytics] tick — no connected LinkedIn accounts")
        return
    logger.info("[linkedin:analytics] tick — refreshing %d tenant(s)", len(connections))
    for conn in connections:
        tenant_id = conn.get("tenant_id")
        if not tenant_id:
            continue
        try:
            await refresh_tenant(tenant_id, conn)
        except Exception:  # noqa: BLE001 — one tenant's failure never blocks the others
            logger.exception("[linkedin:analytics] tenant refresh failed tenant=%s", tenant_id)


async def run_loop(stop: asyncio.Event) -> None:
    """Refresh LinkedIn analytics every POLL_SECONDS until `stop` is set."""
    logger.info("[linkedin:analytics] scheduler started — every %ds", POLL_SECONDS)
    while not stop.is_set():
        try:
            await _tick()
        except Exception:
            logger.exception("[linkedin:analytics] tick crashed; continuing")
        try:
            await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
        except asyncio.TimeoutError:
            pass
    logger.info("[linkedin:analytics] scheduler stopped")
