"""Integration surface for the WhatsApp Agent (Phase 4).

`run_whatsapp_agent(...)` mirrors `agents/workflow/service.py`'s signature
shape so callers (FastAPI's POST /whatsapp/send/{lead_id}) look the same as
every other agent surface.
"""
from .graph import whatsapp_agent
from .state import WhatsAppState


def _initial_state(
    lead_id: str,
    tenant_id: str,
    message_text: str,
    attachment_id: str | None,
    media_url: str | None = None,
    media_type: str | None = None,
) -> WhatsAppState:
    return {
        "lead_id": lead_id,
        "tenant_id": tenant_id,
        "message_text": message_text,
        "attachment_id": attachment_id,
        "media_url": media_url,
        "media_type": media_type,
        "lead": {},
        "prior_draft": None,
        "wamid": None,
        "provider_used": "none",
        "message_id": None,
        "errors": [],
    }


async def run_whatsapp_agent(
    lead_id: str,
    tenant_id: str,
    message_text: str,
    attachment_id: str | None = None,
    media_url: str | None = None,
    media_type: str | None = None,
) -> WhatsAppState:
    initial = _initial_state(lead_id, tenant_id, message_text, attachment_id, media_url, media_type)
    return await whatsapp_agent.ainvoke(initial)
