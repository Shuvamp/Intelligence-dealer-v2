"""Gemini client — poster image generation ONLY.

Text generation has moved to app.llm (Claude primary, Grok fallback).
This module now exposes only gemini_image() and has_gemini_key().
"""
import logging

import httpx

from app.config import GEMINI_API_KEY, GEMINI_IMAGE_MODEL

logger = logging.getLogger(__name__)


def has_gemini_key() -> bool:
    return bool(GEMINI_API_KEY)


def gemini_image(
    prompt: str,
    image_b64: str | None = None,
    image_mime: str = "image/jpeg",
    logo_b64: str | None = None,
    logo_mime: str = "image/png",
) -> tuple[str, str] | None:
    """Generate (or edit) an image via Gemini 3 image models.

    With image_b64, the car photo is passed as an inline part. With logo_b64,
    the user-selected logo is prepended as the FIRST image part so the model
    renders it exactly. Returns (b64, mime) of the first image part.
    Tries GEMINI_IMAGE_MODEL, then gemini-3.1-flash-image. None if all fail.
    """
    if not GEMINI_API_KEY:
        return None

    parts: list[dict] = []
    # Logo MUST come first so the prompt can reference it as "the first image".
    if logo_b64:
        parts.append({"inlineData": {"mimeType": logo_mime, "data": logo_b64}})
    if image_b64:
        parts.append({"inlineData": {"mimeType": image_mime, "data": image_b64}})
    parts.append({"text": prompt})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
    }

    for mdl in [GEMINI_IMAGE_MODEL, "gemini-3.1-flash-image"]:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{mdl}"
            f":generateContent?key={GEMINI_API_KEY}"
        )
        try:
            logger.info("[gemini-image] generating with %s (input image: %s)", mdl, bool(image_b64))
            resp = httpx.post(url, json=body, timeout=180.0)
            if resp.status_code != 200:
                logger.warning("[gemini-image] %s HTTP %s: %s", mdl, resp.status_code, resp.text[:200])
                continue
            for part in resp.json()["candidates"][0]["content"]["parts"]:
                inline = part.get("inlineData")
                if inline and inline.get("data"):
                    logger.info("[gemini-image] %s OK (%d b64 chars)", mdl, len(inline["data"]))
                    return inline["data"], inline.get("mimeType", "image/png")
            logger.warning("[gemini-image] %s returned no image part", mdl)
        except Exception as exc:
            logger.warning("[gemini-image] %s failed: %s", mdl, exc)
    return None

