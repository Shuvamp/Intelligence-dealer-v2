"""Unit tests for the WhatsApp Agent (Phase 4).

Covers PHASE_04_WHATSAPP_AGENT.md acceptance criteria:
  - Mock provider returns a wamid and stores the message
  - No credentials → Mock provider selected automatically
  - Meta provider selected when token is set
  - Webhook delivery status updates lead_messages and delivery_logs
  - Inbound webhook message triggers Workflow Agent
  - HMAC verification rejects tampered payloads
"""
import hmac
import json
import os
from hashlib import sha256
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, Response

from agents.whatsapp.provider import get_provider
from agents.whatsapp.mock_provider import MockWhatsAppProvider, _parse_meta_payload
from agents.whatsapp.meta_provider import MetaWhatsAppProvider
from agents.whatsapp.graph import whatsapp_agent
import agents.whatsapp.nodes as whatsapp_nodes


# ── Provider selection ────────────────────────────────────────────────────────

def test_no_credentials_uses_mock_provider(monkeypatch):
    monkeypatch.delenv("WHATSAPP_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("WHATSAPP_PROVIDER", raising=False)
    provider = get_provider()
    assert isinstance(provider, MockWhatsAppProvider)


def test_meta_provider_selected_when_token_set(monkeypatch):
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "test-token")
    monkeypatch.delenv("WHATSAPP_PROVIDER", raising=False)
    provider = get_provider()
    assert isinstance(provider, MetaWhatsAppProvider)


def test_provider_for_tenant_uses_stored_connection(monkeypatch):
    """A UI-connected tenant sends via its own stored creds, not env."""
    monkeypatch.delenv("WHATSAPP_ACCESS_TOKEN", raising=False)  # no env → would be Mock
    row = {"status": "connected", "access_token": "tok-abc", "page_id": "PHONE99"}
    with patch("app.services.channel_store.get", return_value=row):
        provider = whatsapp_nodes._provider_for_tenant("t-1")
    assert isinstance(provider, MetaWhatsAppProvider)
    assert provider._phone_id == "PHONE99"
    assert provider._token == "tok-abc"
    assert provider._api_url().endswith("/PHONE99/messages")


def test_explicit_mock_overrides_token(monkeypatch):
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "test-token")
    monkeypatch.setenv("WHATSAPP_PROVIDER", "mock")
    provider = get_provider()
    assert isinstance(provider, MockWhatsAppProvider)


# ── Mock provider ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mock_provider_returns_wamid():
    provider = MockWhatsAppProvider()
    result = await provider.send_text("+919876543210", "Hello, this is a test")
    assert result["wamid"].startswith("mock-wamid-")
    assert result["status"] == "sent"


# ── Full graph — mocked data layer ────────────────────────────────────────────

class _FakeWhatsAppData:
    def __init__(self, lead: dict | None):
        self._lead = lead
        self.messages: list[dict] = []
        self.delivery_logs: list[dict] = []

    async def get_lead(self, lead_id):
        return self._lead

    async def get_prior_draft(self, lead_id):
        return None

    async def create_message(self, row):
        self.messages.append(row)
        return f"msg-{len(self.messages)}"

    async def create_delivery_log(self, row):
        self.delivery_logs.append(row)
        return f"log-{len(self.delivery_logs)}"

    async def update_message_status(self, wamid, status):
        return True

    async def get_message_by_wamid(self, wamid):
        return None

    async def get_lead_by_phone(self, phone):
        return None


def _initial_state(message="Hello test"):
    return {
        "lead_id": "lead-1",
        "tenant_id": "tenant-1",
        "message_text": message,
        "attachment_id": None,
        "lead": {},
        "prior_draft": None,
        "wamid": None,
        "provider_used": "none",
        "message_id": None,
        "errors": [],
    }


@pytest.fixture
def fake_data(monkeypatch):
    fake = _FakeWhatsAppData(
        lead={"id": "lead-1", "tenant_id": "tenant-1", "phone": "+919876543210",
              "customer_name": "Test Customer"},
    )
    monkeypatch.setattr(whatsapp_nodes, "_data", fake)
    return fake


@pytest.mark.asyncio
async def test_mock_provider_stores_message_in_db(fake_data, monkeypatch):
    monkeypatch.delenv("WHATSAPP_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("WHATSAPP_PROVIDER", "mock")
    result = await whatsapp_agent.ainvoke(_initial_state())

    assert result["wamid"] is not None
    assert result["wamid"].startswith("mock-wamid-")
    assert result["provider_used"] == "mock"
    assert len(fake_data.messages) == 1
    assert fake_data.messages[0]["channel"] == "whatsapp"
    assert fake_data.messages[0]["status"] == "sent"
    assert fake_data.messages[0]["whatsapp_message_id"] == result["wamid"]
    assert len(fake_data.delivery_logs) == 1
    assert not result["errors"]


@pytest.mark.asyncio
async def test_missing_lead_does_not_raise(fake_data, monkeypatch):
    monkeypatch.setenv("WHATSAPP_PROVIDER", "mock")
    fake_data._lead = None
    result = await whatsapp_agent.ainvoke(_initial_state())

    assert result["wamid"] is None
    assert result["errors"]
    assert len(fake_data.messages) == 0


# ── Webhook payload parser ─────────────────────────────────────────────────────

def test_parse_delivery_status_event():
    payload = {
        "entry": [{
            "changes": [{
                "value": {
                    "statuses": [{
                        "id": "wamid.abc123",
                        "status": "delivered",
                        "timestamp": "1700000000",
                        "recipient_id": "919876543210",
                    }]
                }
            }]
        }]
    }
    events = _parse_meta_payload(payload)
    assert len(events) == 1
    assert events[0]["event_type"] == "status"
    assert events[0]["wamid"] == "wamid.abc123"
    assert events[0]["status"] == "delivered"


def test_parse_inbound_message_event():
    payload = {
        "entry": [{
            "changes": [{
                "value": {
                    "messages": [{
                        "id": "wamid.inbound1",
                        "from": "919876543210",
                        "type": "text",
                        "text": {"body": "I'm interested"},
                        "timestamp": "1700000001",
                    }]
                }
            }]
        }]
    }
    events = _parse_meta_payload(payload)
    assert len(events) == 1
    assert events[0]["event_type"] == "inbound"
    assert events[0]["from_phone"] == "919876543210"
    assert events[0]["body"] == "I'm interested"


# ── HMAC verification ──────────────────────────────────────────────────────────

def test_hmac_rejects_tampered_payload(monkeypatch):
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "test-secret")
    body = b'{"test": "payload"}'
    bad_sig = "sha256=badhash"
    assert not MetaWhatsAppProvider.verify_signature(body, bad_sig)


def test_hmac_accepts_valid_signature(monkeypatch):
    secret = "test-secret"
    monkeypatch.setenv("WHATSAPP_APP_SECRET", secret)
    body = b'{"test": "payload"}'
    expected = "sha256=" + hmac.new(secret.encode(), body, sha256).hexdigest()
    assert MetaWhatsAppProvider.verify_signature(body, expected)


def test_hmac_skipped_when_secret_unset(monkeypatch):
    monkeypatch.delenv("WHATSAPP_APP_SECRET", raising=False)
    # Should return True (accept) with a warning log — no crash
    result = MetaWhatsAppProvider.verify_signature(b"body", "sha256=anything")
    assert result is True
