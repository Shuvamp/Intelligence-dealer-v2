from __future__ import annotations
from typing import TypedDict


class WhatsAppState(TypedDict):
    # Input
    lead_id: str
    tenant_id: str
    message_text: str          # rep's final message text (may differ from AI draft)
    attachment_id: str | None  # optional media from the attachments table
    media_url: str | None      # direct URL for image/video/document (bypasses attachments table)
    media_type: str | None     # "image" | "video" | "document" | None

    # Loaded in load_context
    lead: dict                 # full lead row including phone, customer_name
    prior_draft: str | None    # Follow-up Agent's last draft, for reference

    # Produced by send_message
    wamid: str | None          # Meta message ID (or mock-wamid-xxx)
    provider_used: str         # "meta" | "mock"

    # Produced by log_delivery
    message_id: str | None     # lead_messages.id of the new row

    errors: list[str]
