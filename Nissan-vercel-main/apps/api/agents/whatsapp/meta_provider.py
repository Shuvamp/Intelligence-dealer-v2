"""MetaWhatsAppProvider — real WhatsApp Cloud API (v20.0).

Requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to be set.
Uses httpx.AsyncClient — same pattern as workflow/data.py.
"""
from __future__ import annotations

import hmac
import logging
import os
from hashlib import sha256

import httpx

from .mock_provider import _parse_meta_payload

logger = logging.getLogger(__name__)

class MetaWhatsAppProvider:
    def __init__(self, access_token: str | None = None, phone_number_id: str | None = None):
        # Per-tenant creds (from the channel_store connection) take precedence;
        # fall back to env so get_provider()/CI keep working with zero args.
        self._token = access_token or os.getenv("WHATSAPP_ACCESS_TOKEN", "")
        self._phone_id = phone_number_id or os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")

    def _api_url(self) -> str:
        return f"https://graph.facebook.com/v20.0/{self._phone_id}/messages"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    async def send_text(self, phone: str, message: str) -> dict:
        payload = {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "text",
            "text": {"body": message},
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(self._api_url(), json=payload, headers=self._headers())
            if not r.is_success:
                err = r.json() if "application/json" in r.headers.get("content-type", "") else r.text
                logger.error("Meta API %s → %s", r.status_code, err)
                raise ValueError(f"Meta {r.status_code}: {err}")
            data = r.json()
        wamid = (data.get("messages") or [{}])[0].get("id", "")
        logger.info("WhatsApp sent to %s → wamid=%s", phone, wamid)
        return {"wamid": wamid, "status": "sent"}

    async def send_media(self, phone: str, media_id: str, caption: str | None) -> dict:
        payload = {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "image",
            "image": {"id": media_id, **({"caption": caption} if caption else {})},
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(self._api_url(), json=payload, headers=self._headers())
            if not r.is_success:
                err = r.json() if "application/json" in r.headers.get("content-type", "") else r.text
                logger.error("Meta API %s → %s", r.status_code, err)
                raise ValueError(f"Meta {r.status_code}: {err}")
            data = r.json()
        wamid = (data.get("messages") or [{}])[0].get("id", "")
        return {"wamid": wamid, "status": "sent"}

    async def send_url_media(
        self, phone: str, url: str, media_type: str, caption: str | None
    ) -> dict:
        """Send image/video/document by public URL (no prior upload required)."""
        media_type = media_type or "image"
        payload: dict = {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": media_type,
            media_type: {"link": url, **({"caption": caption} if caption else {})},
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(self._api_url(), json=payload, headers=self._headers())
            if not r.is_success:
                err = r.json() if "application/json" in r.headers.get("content-type", "") else r.text
                logger.error("Meta API %s → %s", r.status_code, err)
                raise ValueError(f"Meta {r.status_code}: {err}")
            data = r.json()
        wamid = (data.get("messages") or [{}])[0].get("id", "")
        logger.info("WhatsApp %s sent to %s → wamid=%s", media_type, phone, wamid)
        return {"wamid": wamid, "status": "sent"}

    async def verify_webhook(self, mode: str, token: str, challenge: str) -> str:
        verify_token = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "")
        if mode == "subscribe" and token == verify_token:
            return challenge
        raise ValueError("Webhook verification failed")

    async def parse_webhook_event(self, payload: dict) -> list[dict]:
        return _parse_meta_payload(payload)

    @staticmethod
    def verify_signature(body: bytes, signature: str) -> bool:
        """Return True if the X-Hub-Signature-256 header matches the payload."""
        secret = os.getenv("WHATSAPP_APP_SECRET", "")
        if not secret:
            logger.warning("WHATSAPP_APP_SECRET not set — skipping HMAC verification")
            return True
        expected = "sha256=" + hmac.new(secret.encode(), body, sha256).hexdigest()
        return hmac.compare_digest(signature, expected)
