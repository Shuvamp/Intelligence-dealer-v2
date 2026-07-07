"""
Social publishing API — multi-platform fan-out.

POST /api/publish fans a single creative out to every connected channel for a
tenant. Each platform publishes independently: one platform's failure never
blocks the others. The response carries a per-platform status block.

  - LinkedIn : real UGC image/text publishing via app.services.linkedin
  - Instagram / Facebook : graceful "not implemented yet" status (no real push),
    so the existing connection logic stays intact and the response shape holds.
"""
import base64
import logging

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.services import channel_store
from app.services.linkedin import LinkedInPublishError, publish_post as linkedin_publish

logger = logging.getLogger(__name__)
router = APIRouter()

# Platforms attempted when the caller doesn't pin a subset.
_DEFAULT_PLATFORMS = ["instagram", "facebook", "linkedin"]


class PublishRequest(BaseModel):
    tenant_id: str
    caption: str
    image_url: str | None = None      # fetched server-side into bytes
    image_base64: str | None = None   # optional inline image (data-URI tolerated)
    title: str | None = None
    description: str | None = None
    platforms: list[str] | None = None  # default: all connected of _DEFAULT_PLATFORMS


async def _resolve_image_bytes(image_url: str | None, image_base64: str | None) -> bytes:
    if image_base64:
        payload = image_base64.split(",", 1)[-1]  # strip any data: URI prefix
        return base64.b64decode(payload)
    if image_url:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.get(image_url, timeout=30)
            r.raise_for_status()
            return r.content
    return b""


@router.post("")
async def publish(req: PublishRequest):
    targets = req.platforms or _DEFAULT_PLATFORMS
    results: dict[str, dict] = {}

    # Fetch the creative once; reuse across platforms. A fetch failure degrades
    # gracefully (LinkedIn falls back to a text-only share).
    image_bytes = b""
    try:
        image_bytes = await _resolve_image_bytes(req.image_url, req.image_base64)
    except Exception as e:  # noqa: BLE001 — log + continue, don't abort the whole request
        logger.warning("[publish] image fetch failed: %s", e)

    for platform in targets:
        row = channel_store.get(req.tenant_id, platform)
        connected = bool(row and row.get("status") == "connected" and row.get("access_token"))
        if not connected:
            results[platform] = {"status": "skipped", "reason": "not_connected"}
            continue

        try:
            if platform == "linkedin":
                res = await linkedin_publish(
                    row["access_token"],
                    req.caption,
                    image_bytes or None,
                    title=req.title or "",
                    description=req.description or "",
                )
                results[platform] = res
                # Record the post URN so the analytics dashboard can later fetch
                # its likes/comments (socialActions). Best-effort — never fail publish.
                urn = res.get("post_id") if isinstance(res, dict) else None
                if urn:
                    try:
                        channel_store.add_linkedin_post(req.tenant_id, urn, req.caption or "", req.title or "")
                    except Exception:  # noqa: BLE001
                        logger.warning("[publish:linkedin] could not record URN %s", urn)
            else:
                # Instagram/Facebook real publishing is not built yet — report it
                # without breaking the multi-platform response.
                results[platform] = {
                    "status": "skipped",
                    "reason": "publishing_not_implemented",
                }
        except LinkedInPublishError as e:
            logger.error("[publish:%s] %s", platform, e)
            results[platform] = {"status": "error", "error": str(e)}
        except Exception as e:  # noqa: BLE001 — isolate per-platform failures
            logger.exception("[publish:%s] unexpected error", platform)
            results[platform] = {"status": "error", "error": str(e)}

    return results
