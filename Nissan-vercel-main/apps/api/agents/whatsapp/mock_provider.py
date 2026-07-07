"""MockWhatsAppProvider — zero-credential fallback for local dev and CI.

Behaves identically to the real provider from the caller's perspective:
returns a wamid, stores the same DB rows, emits the same log lines — the
only difference is that no real HTTP call is made and no real message is
delivered. This makes it safe to use in unit tests and in demo environments.
"""
from __future__ import annotations

import logging
import os
import uuid

logger = logging.getLogger(__name__)

VERIFY_TOKEN = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "")


class MockWhatsAppProvider:
    async def send_text(self, phone: str, message: str) -> dict:
        wamid = f"mock-wamid-{uuid.uuid4().hex[:12]}"
        logger.info("[MOCK WhatsApp] → %s: %s…", phone, message[:80])
        return {"wamid": wamid, "status": "sent"}

    async def send_media(self, phone: str, media_id: str, caption: str | None) -> dict:
        wamid = f"mock-wamid-{uuid.uuid4().hex[:12]}"
        logger.info("[MOCK WhatsApp] → %s: media_id=%s caption=%s", phone, media_id, caption)
        return {"wamid": wamid, "status": "sent"}

    async def send_url_media(
        self, phone: str, url: str, media_type: str, caption: str | None
    ) -> dict:
        wamid = f"mock-wamid-{uuid.uuid4().hex[:12]}"
        logger.info("[MOCK WhatsApp] → %s: %s url=%s caption=%s", phone, media_type, url, caption)
        return {"wamid": wamid, "status": "sent"}

    async def verify_webhook(self, mode: str, token: str, challenge: str) -> str:
        if mode == "subscribe" and token == VERIFY_TOKEN:
            return challenge
        raise ValueError("Webhook verification failed")

    async def parse_webhook_event(self, payload: dict) -> list[dict]:
        return _parse_meta_payload(payload)


def _parse_meta_payload(payload: dict) -> list[dict]:
    """Shared parser used by both mock and real providers."""
    events: list[dict] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for status in value.get("statuses", []):
                events.append({
                    "event_type": "status",
                    "wamid": status.get("id"),
                    "status": status.get("status"),
                    "recipient_id": status.get("recipient_id"),
                    "meta_timestamp": status.get("timestamp"),
                })
            for msg in value.get("messages", []):
                events.append({
                    "event_type": "inbound",
                    "wamid": msg.get("id"),
                    "from_phone": msg.get("from"),
                    "message_type": msg.get("type"),
                    "body": (msg.get("text") or {}).get("body", ""),
                    "meta_timestamp": msg.get("timestamp"),
                })
    return events
