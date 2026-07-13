"""
Social publishing API — multi-platform fan-out.

POST /api/publish fans a single creative out to every connected channel for a
tenant. Each platform publishes independently: one platform's failure never
blocks the others. The response carries a per-platform status block.

  - LinkedIn : real UGC image/text publishing via app.services.linkedin
  - YouTube  : real video upload via app.services.youtube (videos.insert) —
    requires req.video_url; skipped with reason="video_required" if absent
  - Facebook : real Page post via app.services.facebook — /photos when an
    image is attached, /feed for text-only
  - Instagram : graceful "not implemented yet" status (no real push), so the
    existing connection logic stays intact and the response shape holds.
"""
import base64
import logging

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.services import channel_store, linkedin_analytics_store
from app.services.facebook import FacebookPublishError, publish_post as facebook_publish
from app.services.linkedin import LinkedInPublishError, publish_post as linkedin_publish
from app.services.youtube import publish_video_from_url as youtube_publish

logger = logging.getLogger(__name__)
router = APIRouter()

# Platforms attempted when the caller doesn't pin a subset.
_DEFAULT_PLATFORMS = ["instagram", "facebook", "linkedin", "youtube"]


class PublishRequest(BaseModel):
    tenant_id: str
    caption: str
    image_url: str | None = None      # fetched server-side into bytes
    image_base64: str | None = None   # optional inline image (data-URI tolerated)
    title: str | None = None
    description: str | None = None
    platforms: list[str] | None = None  # default: all connected of _DEFAULT_PLATFORMS
    video_url: str | None = None        # required for youtube — /videos/<tenant>/<file>
    privacy_status: str = "private"     # youtube only: private | unlisted | public


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
                # Record the post URN so the analytics poller can later fetch its
                # metrics. Best-effort — never fail publish.
                urn = res.get("post_id") if isinstance(res, dict) else None
                if urn:
                    try:
                        await linkedin_analytics_store.insert_post(
                            req.tenant_id, urn, req.caption or "", req.title or "",
                            org_urn=row.get("linkedin_org_urn"),
                            image_asset_urn=res.get("asset_urn"),
                        )
                    except Exception:  # noqa: BLE001
                        logger.warning("[publish:linkedin] could not record URN %s", urn)
            elif platform == "youtube":
                results[platform] = await youtube_publish(
                    req.tenant_id, row, req.title or "", req.description or "",
                    req.video_url, req.privacy_status,
                )
            elif platform == "facebook":
                page_id = row.get("page_id")
                page_token = row.get("access_token")
                logger.info(
                    "[publish:facebook] tenant=%s page_id=%s page_name=%s caption_len=%d has_image=%s",
                    req.tenant_id, page_id, row.get("page_name"), len(req.caption or ""), bool(image_bytes),
                )
                if not page_id:
                    logger.error("[publish:facebook] tenant=%s missing page_id on connection row", req.tenant_id)
                    results[platform] = {"status": "error", "error": "Facebook connection missing page_id — reconnect"}
                else:
                    results[platform] = await facebook_publish(
                        page_id, page_token, req.caption, image_bytes or None,
                    )
            else:
                # Instagram real publishing is not built yet — report it
                # without breaking the multi-platform response.
                results[platform] = {
                    "status": "skipped",
                    "reason": "publishing_not_implemented",
                }
        except LinkedInPublishError as e:
            logger.error("[publish:%s] %s", platform, e)
            results[platform] = {"status": "error", "error": str(e)}
        except FacebookPublishError as e:
            logger.error("[publish:facebook] %s", e)
            results[platform] = {"status": "error", "error": str(e)}
        except Exception as e:  # noqa: BLE001 — isolate per-platform failures
            logger.exception("[publish:%s] unexpected error", platform)
            results[platform] = {"status": "error", "error": str(e)}

    return results
