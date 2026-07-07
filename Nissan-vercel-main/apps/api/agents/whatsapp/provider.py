"""WhatsApp provider abstraction layer.

Defines the WhatsAppProvider Protocol (interface) and the `get_provider()`
factory.  Selection logic:

  WHATSAPP_PROVIDER=meta  → MetaWhatsAppProvider (always)
  WHATSAPP_PROVIDER=mock  → MockWhatsAppProvider (always)
  (unset / other)         → Meta if WHATSAPP_ACCESS_TOKEN is set, else Mock

This means local dev and CI work with zero credentials by default, and
switching to the real API is a single env-var change — same zero-config
philosophy used by Claude/Groq across every other agent.
"""
from __future__ import annotations

import os
from typing import Protocol, runtime_checkable


@runtime_checkable
class WhatsAppProvider(Protocol):
    async def send_text(self, phone: str, message: str) -> dict:
        """Send a plain-text message. Returns {"wamid": str, "status": "sent"}."""
        ...

    async def send_media(self, phone: str, media_id: str, caption: str | None) -> dict:
        """Send a media message using a pre-uploaded Meta media ID."""
        ...

    async def verify_webhook(self, mode: str, token: str, challenge: str) -> str:
        """Validate Meta's hub.challenge handshake. Returns challenge or raises."""
        ...

    async def parse_webhook_event(self, payload: dict) -> list[dict]:
        """Normalise a raw Meta webhook payload into a flat list of events.

        Each event dict has at minimum: {"event_type": "status"|"inbound",
        "wamid": str, ...}.
        """
        ...


def get_provider() -> WhatsAppProvider:
    """Return the correct provider based on environment configuration."""
    from .meta_provider import MetaWhatsAppProvider
    from .mock_provider import MockWhatsAppProvider

    setting = os.getenv("WHATSAPP_PROVIDER", "").lower()
    if setting == "meta":
        return MetaWhatsAppProvider()
    if setting == "mock":
        return MockWhatsAppProvider()
    # Auto-detect: use Meta only when a token is present
    if os.getenv("WHATSAPP_ACCESS_TOKEN"):
        return MetaWhatsAppProvider()
    return MockWhatsAppProvider()
