"""
Agent 6 (real) — ReAct Publishing Agent.

7-node async LangGraph StateGraph. Wraps the existing publish services as
tools and drives every queued post through:

    fetch_due_posts
      ├─ (nothing due) ──────────────────────────────→ done → END
      └─ (posts exist) → select_next_post → get_targets
                                                ├─ (no targets) ─────→ update_status
                                                └─ (targets) → prepare_poster → publish_channel ←┐
                                                                                   │ (more)        ┘
                                                                                   └ (done) → update_status
                                                                                                ├─ (more posts) → select_next_post
                                                                                                └─ (all done)  → done → END

Backward-compatibility guarantees:
- IST semantics unchanged (db.now_iso() used for all timestamps)
- One channel's failure never blocks another channel's attempt
- Poster data:/http split handled identically to the existing router
- LinkedIn + YouTube: real; Instagram/Facebook: placeholder skipped response

Status is no longer unconditional: a post only moves to "published" if at
least one targeted channel actually succeeded — otherwise it moves to
"failed" (never silently claims success). The per-channel outcome is
persisted as `channel_status` (JSON) — see _update_status.

Entrypoint: ``run_publishing_tick()`` — called by auto_publisher._tick().
The existing ``agents/publishing.py`` mock is NOT touched.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional, TypedDict

from langgraph.graph import END, StateGraph

from app.db import duckdb as db
from app.tools.publishing_tools import (
    get_due_posts_tool,
    group_targets_tool,
    log_failure_tool,
    prepare_poster_tool,
    publish_facebook_tool,
    publish_instagram_tool,
    publish_linkedin_tool,
    publish_youtube_tool,
    update_status_tool,
)

logger = logging.getLogger("app.agents.publishing")


# ─────────────────────────────────────────────────────────────────────────────
# State
# ─────────────────────────────────────────────────────────────────────────────

class PublishingState(TypedDict):
    due_posts: list[dict]
    post_index: int
    current_post: Optional[dict]
    current_targets: list[str]
    channel_index: int
    current_poster: Optional[dict]       # {"type": "base64"|"url", "payload": str} | None
    post_results: dict[str, Any]         # group_id → {channel → result}
    failures: list[dict]
    done: bool


# ─────────────────────────────────────────────────────────────────────────────
# Nodes (all async — compatible with asyncio event loop in auto_publisher)
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_due_posts(state: PublishingState) -> dict:
    """Tool call: get_due_posts_tool — lists all posts due now (IST)."""
    posts = await get_due_posts_tool()
    logger.info("[publish-agent] fetch_due_posts: %d post(s)", len(posts))
    return {"due_posts": posts, "post_index": 0, "done": len(posts) == 0}


async def _select_next_post(state: PublishingState) -> dict:
    """
    Pick the next post, reset per-post tracking, mark status='publishing'.
    Setting 'publishing' here mirrors the existing auto_publisher flow — the
    status is visible in the UI while the publish is in-flight.
    """
    post = state["due_posts"][state["post_index"]]
    kind      = post["kind"]
    group_id  = post["group_id"]
    tenant_id = post["tenant_id"]
    day_date  = post.get("day_date") if kind == "campaign" else None
    label     = f"{kind}:{group_id}" + (f" day{post.get('day_num')}" if day_date else "")

    logger.info(
        "[publish-agent] select_next_post: %s scheduled=%s",
        label, post.get("scheduled_at"),
    )
    await update_status_tool(kind, group_id, tenant_id, "publishing", day_date, None)
    return {
        "current_post":    post,
        "current_targets": [],
        "channel_index":   0,
        "current_poster":  None,
    }


async def _get_targets(state: PublishingState) -> dict:
    """Tool call: group_targets_tool — resolve publish channels for this post."""
    targets = await group_targets_tool(state["current_post"])
    return {"current_targets": targets}


async def _prepare_poster(state: PublishingState) -> dict:
    """Tool call: prepare_poster_tool — resolve poster into typed payload."""
    poster = prepare_poster_tool(state["current_post"])
    return {"current_poster": poster}


async def _publish_channel(state: PublishingState) -> dict:
    """
    Dispatch to the channel tool at current_targets[channel_index], record
    the result, increment the index. Self-loops while channel_index < len(targets).
    Per-channel failure never raises — the conditional edge always routes correctly.
    """
    post    = state["current_post"]
    poster  = state["current_poster"]
    channel = state["current_targets"][state["channel_index"]]
    group_id = post.get("group_id", "")

    logger.info("[publish-agent] publish_channel: %s → %s", group_id, channel)

    # Dispatch
    if channel == "linkedin":
        result = await publish_linkedin_tool(post, poster)
    elif channel == "youtube":
        result = await publish_youtube_tool(post)  # video-only — no poster payload
    elif channel == "instagram":
        result = await publish_instagram_tool(post, poster)
    elif channel == "facebook":
        result = await publish_facebook_tool(post, poster)
    else:
        result = {"status": "skipped", "reason": "unknown_channel"}

    # Accumulate results
    post_results: dict[str, Any] = dict(state.get("post_results") or {})
    if group_id not in post_results:
        post_results[group_id] = {}
    post_results[group_id][channel] = result

    failures: list[dict] = list(state.get("failures") or [])
    if result.get("status") == "error":
        err = result.get("error", "unknown")
        log_failure_tool(group_id, channel, err)
        failures.append({"post_id": group_id, "channel": channel, "error": err})
        logger.warning("[publish-agent] %s → %s error: %s", group_id, channel, err)
    else:
        logger.info(
            "[publish-agent] %s → %s %s",
            group_id, channel, result.get("status"),
        )

    return {
        "post_results":  post_results,
        "failures":      failures,
        "channel_index": state["channel_index"] + 1,
    }


async def _update_status(state: PublishingState) -> dict:
    """
    Flip status → 'published' if at least one targeted channel actually
    succeeded, else 'failed' (e.g. YouTube selected with no video attached —
    a broken upload must never read as a successful publish). A post with no
    targets at all (current_targets == []) still goes to 'published'
    status-only, matching the pre-existing zero-connected-channels behaviour.
    The per-channel outcome is persisted as channel_status (JSON) so the
    Publishing queue can show why.
    """
    post      = state["current_post"]
    kind      = post["kind"]
    group_id  = post["group_id"]
    tenant_id = post["tenant_id"]
    day_date  = post.get("day_date") if kind == "campaign" else None
    now       = db.now_iso()

    per_channel = (state.get("post_results") or {}).get(group_id, {})
    if not state["current_targets"]:
        final_status, published_at, channel_status = "published", now, None
    else:
        succeeded = any(r.get("status") == "success" for r in per_channel.values())
        final_status = "published" if succeeded else "failed"
        published_at = now if succeeded else None
        channel_status = json.dumps(per_channel)

    await update_status_tool(kind, group_id, tenant_id, final_status, day_date, published_at, channel_status)

    new_index = state["post_index"] + 1
    done      = new_index >= len(state["due_posts"])
    logger.info("[publish-agent] update_status: %s:%s → %s (done=%s)", kind, group_id, final_status, done)
    return {"post_index": new_index, "done": done}


async def _done(state: PublishingState) -> dict:
    """Terminal node — logs a summary and returns unchanged state."""
    n_posts    = len(state.get("due_posts") or [])
    n_failures = len(state.get("failures") or [])
    logger.info(
        "[publish-agent] done — processed %d post(s), %d channel failure(s)",
        n_posts, n_failures,
    )
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# Conditional routing
# ─────────────────────────────────────────────────────────────────────────────

def _route_after_fetch(state: PublishingState) -> str:
    return "done" if state["done"] else "select_next_post"


def _route_after_targets(state: PublishingState) -> str:
    return "update_status" if not state["current_targets"] else "prepare_poster"


def _route_after_channel(state: PublishingState) -> str:
    return (
        "publish_channel"
        if state["channel_index"] < len(state["current_targets"])
        else "update_status"
    )


def _route_after_update(state: PublishingState) -> str:
    return "done" if state["done"] else "select_next_post"


# ─────────────────────────────────────────────────────────────────────────────
# Graph construction
# ─────────────────────────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(PublishingState)

    g.add_node("fetch_due_posts",  _fetch_due_posts)
    g.add_node("select_next_post", _select_next_post)
    g.add_node("get_targets",      _get_targets)
    g.add_node("prepare_poster",   _prepare_poster)
    g.add_node("publish_channel",  _publish_channel)
    g.add_node("update_status",    _update_status)
    g.add_node("done",             _done)

    g.set_entry_point("fetch_due_posts")

    g.add_conditional_edges(
        "fetch_due_posts", _route_after_fetch,
        {"done": "done", "select_next_post": "select_next_post"},
    )
    g.add_edge("select_next_post", "get_targets")
    g.add_conditional_edges(
        "get_targets", _route_after_targets,
        {"update_status": "update_status", "prepare_poster": "prepare_poster"},
    )
    g.add_edge("prepare_poster", "publish_channel")
    g.add_conditional_edges(
        "publish_channel", _route_after_channel,
        {"publish_channel": "publish_channel", "update_status": "update_status"},
    )
    g.add_conditional_edges(
        "update_status", _route_after_update,
        {"done": "done", "select_next_post": "select_next_post"},
    )
    g.add_edge("done", END)

    return g.compile()


_publishing_graph = _build_graph()


# ─────────────────────────────────────────────────────────────────────────────
# Public entrypoint
# ─────────────────────────────────────────────────────────────────────────────

async def run_publishing_tick() -> dict:
    """
    Run one publishing cycle.

    Called by auto_publisher._tick() instead of the old per-post loop.
    Returns the final PublishingState (post_results + failures) for the caller
    to inspect if needed; auto_publisher ignores it.
    """
    initial: PublishingState = {
        "due_posts":       [],
        "post_index":      0,
        "current_post":    None,
        "current_targets": [],
        "channel_index":   0,
        "current_poster":  None,
        "post_results":    {},
        "failures":        [],
        "done":            False,
    }
    result = await _publishing_graph.ainvoke(initial)
    return result
