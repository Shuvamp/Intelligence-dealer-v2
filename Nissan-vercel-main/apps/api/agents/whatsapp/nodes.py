"""WhatsApp Agent nodes (Phase 4).

load_context → send_message → log_delivery → END

Every node follows the "never break the platform" rule: no node raises,
partial failures degrade to safe defaults and are recorded in `errors`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from .data import WhatsAppData
from .mock_provider import MockWhatsAppProvider
from .provider import get_provider
from .state import WhatsAppState

logger = logging.getLogger(__name__)
_data = WhatsAppData()


async def load_context_node(state: WhatsAppState) -> dict:
    lead = await _data.get_lead(state["lead_id"])
    if not lead:
        return {
            "lead": {},
            "prior_draft": None,
            "errors": [*state.get("errors", []), f"Lead {state['lead_id']} not found"],
        }
    prior_draft = await _data.get_prior_draft(state["lead_id"])
    return {"lead": lead, "prior_draft": prior_draft, "errors": state.get("errors", [])}


async def send_message_node(state: WhatsAppState) -> dict:
    if not state.get("lead"):
        return {"wamid": None, "provider_used": "none"}

    lead = state["lead"]
    # Normalise to E.164: strip spaces, dashes, dots — Meta requires +CCNUMBER
    raw_phone = lead.get("phone") or ""
    phone = "+" + "".join(c for c in raw_phone if c.isdigit()) if raw_phone else ""
    if raw_phone and not phone.startswith("+"):
        phone = raw_phone  # already clean
    message = state.get("message_text", "").strip()
    attachment_id = state.get("attachment_id")
    errors = list(state.get("errors", []))

    if not phone:
        errors.append("send_failed:no_phone_number")
        return {"wamid": None, "provider_used": "none", "errors": errors}

    # Allow empty message text when media is attached (image/video sent with no caption is valid).
    if not message and not media_url and not attachment_id:
        errors.append("send_failed:empty_message")
        return {"wamid": None, "provider_used": "none", "errors": errors}

    provider = get_provider()
    provider_name = type(provider).__name__.replace("WhatsAppProvider", "").lower()
    media_url = state.get("media_url")
    media_type = state.get("media_type") or "image"

    async def _send(p) -> dict:
        if media_url:
            return await p.send_url_media(phone, media_url, media_type, message or None)
        if attachment_id:
            return await p.send_media(phone, attachment_id, message or None)
        return await p.send_text(phone, message)

    try:
        result = await _send(provider)
        return {"wamid": result.get("wamid"), "provider_used": provider_name, "errors": errors}
    except Exception as exc:
        logger.warning("WhatsApp send failed via %s (%s) — falling back to mock", provider_name, exc)
        errors.append(f"meta_error_fallback_to_mock: {exc}")
        try:
            result = await _send(MockWhatsAppProvider())
            return {"wamid": result.get("wamid"), "provider_used": "mock_fallback", "errors": errors}
        except Exception as exc2:
            logger.exception("Mock fallback also failed")
            errors.append(f"send_failed:mock_fallback: {exc2}")
            return {"wamid": None, "provider_used": provider_name, "errors": errors}


async def log_delivery_node(state: WhatsAppState) -> dict:
    wamid = state.get("wamid")
    errors = list(state.get("errors", []))
    now = datetime.now(timezone.utc).isoformat()

    if not wamid:
        return {"message_id": None, "errors": errors}

    lead = state.get("lead") or {}
    message_id = None
    try:
        message_id = await _data.create_message({
            "tenant_id": state["tenant_id"],
            "lead_id": state["lead_id"],
            "channel": "whatsapp",
            "direction": "outbound",
            "body": state.get("message_text", ""),
            "source": "whatsapp_agent",
            "whatsapp_message_id": wamid,
            "status": "sent",
            "attachment_id": state.get("attachment_id"),
            "created_at": now,
        })
    except Exception:
        logger.exception("lead_messages insert failed for wamid=%s", wamid)
        errors.append("log_delivery_failed:lead_messages")

    if message_id:
        try:
            await _data.create_delivery_log({
                "tenant_id": state["tenant_id"],
                "message_id": message_id,
                "status": "sent",
                "webhook_payload": {},
                "created_at": now,
            })
        except Exception:
            logger.exception("message_delivery_logs insert failed")
            errors.append("log_delivery_failed:delivery_logs")

    return {"message_id": message_id, "errors": errors}
