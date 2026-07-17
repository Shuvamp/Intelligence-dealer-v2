"""
Background auto-publisher.

A single asyncio task (started from the FastAPI lifespan) wakes every
``POLL_SECONDS`` and hands off to the real publishing pipeline —
:func:`app.agents.publishing_agent.run_publishing_tick`, a LangGraph agent
that drains every queued post whose scheduled time has passed (IST) through:

    Scheduled (queued) -> Publishing -> Published / Failed

This module owns only the scheduling loop; the actual per-post, per-channel
publish logic (including the YouTube video branch and the
Published-vs-Failed decision) lives in app/agents/publishing_agent.py and
app/tools/publishing_tools.py — see those for the real implementation.

All steps are logged under the ``app.auto_publisher`` logger.
"""
from __future__ import annotations

import asyncio
import logging

from app.db import duckdb as db

logger = logging.getLogger("app.auto_publisher")

# How often the scheduler wakes to drain due posts.
POLL_SECONDS = 60


async def _tick() -> None:
    now = db.now_iso()
    due = await db.list_due_posts(now)
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
