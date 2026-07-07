"""
Facebook / Instagram publishing service — placeholder.

Meta's Instagram Content Publishing API requires a Business / Creator account
linked to a Facebook Page, plus the ``instagram_content_publish`` permission
(only granted via App Review). This module reserves the interface; actual
publishing is implemented once App Review is approved.

All functions return a ``{"status": "skipped", "reason": "..."}`` dict that
matches the shape returned by publish_instagram_tool / publish_facebook_tool
so callers handle both the live and placeholder paths identically.
"""
from __future__ import annotations

import logging
from typing import Optional

# Re-export OAuth helpers so callers can still use the auth flow (connect
# channel) even though publishing itself is not yet implemented.
from app.services.instagram import (  # noqa: F401
    build_oauth_url,
    consume_oauth_state,
    create_oauth_state,
    exchange_code_for_token,
    get_facebook_pages,
    get_instagram_account_id,
    get_instagram_username,
    get_long_lived_token,
    get_token_debug_info,
)

logger = logging.getLogger("app.services.facebook")

NOT_IMPLEMENTED_REASON = "publishing_not_implemented"


async def publish_to_instagram(
    post: dict,
    image_bytes: Optional[bytes] = None,
) -> dict:
    """Instagram post publishing — not yet implemented."""
    logger.info(
        "[facebook_service] publish_to_instagram skipped group=%s", post.get("group_id"),
    )
    return {"status": "skipped", "reason": NOT_IMPLEMENTED_REASON}


async def publish_to_facebook(
    post: dict,
    image_bytes: Optional[bytes] = None,
) -> dict:
    """Facebook Page post publishing — not yet implemented."""
    logger.info(
        "[facebook_service] publish_to_facebook skipped group=%s", post.get("group_id"),
    )
    return {"status": "skipped", "reason": NOT_IMPLEMENTED_REASON}
