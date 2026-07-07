"""
Background auto-publisher.

A single asyncio task (started from the FastAPI lifespan) polls DuckDB every
``POLL_SECONDS`` for queued posts whose scheduled time has passed — in IST,
the zone scheduled_at is authored in — and drives each one through the
lifecycle:

    Scheduled (queued) -> Publishing -> Published

For every due post it calls the real channel-publish path
(:func:`app.routers.publish.publish`), pushing to the campaign's linked +
connected channels (or every connected channel for events). Per-channel
outcome never blocks the transition to Published, matching the manual flow.

All steps are logged under the ``app.auto_publisher`` logger:
job pickup, publish attempt, per-channel success/failure, final status.
"""
from __future__ import annotations

import asyncio
import logging

from app.db import duckdb as db
from app.routers.publish import PublishRequest, publish as channel_publish
from app.services import channel_store

logger = logging.getLogger("app.auto_publisher")

# How often the scheduler wakes to drain due posts.
POLL_SECONDS = 60


def _connected_channels(tenant_id: str) -> list[str]:
    """Channels this tenant can actually publish to right now."""
    try:
        rows = channel_store.list_for_tenant(tenant_id)
    except Exception:
        logger.exception("[auto-publish] failed reading channels for tenant=%s", tenant_id)
        return []
    return [
        r["channel"]
        for r in rows
        if r.get("status") == "connected" and r.get("access_token")
    ]


def _targets(post: dict, connected: list[str]) -> list[str]:
    """Campaign → its linked channels narrowed to connected; event → all connected."""
    linked = post.get("channels") or []
    pool = linked if linked else connected
    return [c for c in pool if c in connected]


async def _publish_one(post: dict) -> None:
    kind = post["kind"]
    group_id = post["group_id"]
    tenant_id = post["tenant_id"]
    day_date = post.get("day_date") if kind == "campaign" else None
    label = f"{kind}:{group_id}" + (f" day{post.get('day_num')}" if day_date else "")

    connected = _connected_channels(tenant_id)
    targets = _targets(post, connected)
    now = db.now_iso()
    logger.info(
        "[auto-publish] attempt %s tenant=%s scheduled=%s targets=%s",
        label, tenant_id, post.get("scheduled_at"), targets or "(none)",
    )

    # Transient Publishing state (visible if the UI loads mid-tick).
    await asyncio.to_thread(
        db.set_publish_status, kind, group_id, tenant_id, "publishing", day_date, None
    )

    if not targets:
        # No connected channels — still leave the queue (status-only publish),
        # mirroring the manual flow which publishes regardless of channel outcome.
        await asyncio.to_thread(
            db.set_publish_status, kind, group_id, tenant_id, "published", day_date, now
        )
        logger.warning("[auto-publish] %s published status-only — no connected channels", label)
        return

    poster = post.get("poster_url")
    caption = "\n\n".join(
        p for p in [post.get("caption"), " ".join(post.get("hashtags") or [])] if p
    )
    req = PublishRequest(
        tenant_id=tenant_id,
        caption=caption,
        title=post.get("headline") or post.get("theme") or "",
        description=post.get("subheadline") or "",
        platforms=targets,
        image_url=poster if poster and not poster.startswith("data:") else None,
        image_base64=poster if poster and poster.startswith("data:") else None,
    )

    try:
        results = await channel_publish(req)
        for plat, r in (results or {}).items():
            if r.get("status") == "success":
                logger.info("[auto-publish] %s -> %s success", label, plat)
            else:
                logger.warning(
                    "[auto-publish] %s -> %s %s: %s",
                    label, plat, r.get("status"), r.get("error") or r.get("reason"),
                )
    except Exception:
        logger.exception("[auto-publish] %s channel push raised — marking published anyway", label)

    # Move to Published regardless of per-channel outcome (matches manual flow).
    await asyncio.to_thread(
        db.set_publish_status, kind, group_id, tenant_id, "published", day_date, now
    )
    logger.info("[auto-publish] %s -> published", label)


async def _tick() -> None:
    now = db.now_iso()
    due = await asyncio.to_thread(db.list_due_posts, now)
    if not due:
        logger.debug("[auto-publish] tick %s — nothing due", now)
        return
    logger.info(
        "[auto-publish] tick %s — %d post(s) due — routing to publishing agent", now, len(due)
    )
    from app.agents.publishing_agent import run_publishing_tick  # late import avoids circular
    try:
        await run_publishing_tick()
    except Exception:
        logger.exception("[auto-publish] publishing agent raised on tick %s", now)


async def run_loop(stop: asyncio.Event) -> None:
    """Drain due posts every POLL_SECONDS until `stop` is set."""
    logger.info("[auto-publish] scheduler started — every %ds, zone=%s", POLL_SECONDS, db.PUBLISH_TZ)
    while not stop.is_set():
        try:
            await _tick()
        except Exception:
            logger.exception("[auto-publish] tick crashed; continuing")
        try:
            # Sleep, but wake immediately if asked to stop.
            await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
        except asyncio.TimeoutError:
            pass
    logger.info("[auto-publish] scheduler stopped")
