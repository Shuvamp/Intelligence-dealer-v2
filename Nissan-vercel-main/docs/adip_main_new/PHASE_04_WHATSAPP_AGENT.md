# Phase 4 - WhatsApp Agent (Production-Grade Spec)

## Option 3 = Meta WhatsApp Cloud API. This is the correct “production-grade + low-cost” way.

---

## 1. Objective

Build a manual-reviewed WhatsApp communication system inside ADIP that allows sales reps to:

- Review AI-generated WhatsApp messages before sending
- Edit messages before sending
- Send messages via WhatsApp Cloud API (Meta)
- Track delivery lifecycle (sent → delivered → read → failed)
- Receive inbound customer replies and trigger workflow actions

---

## 2. Core Principles

- Manual send only (v1) — no auto messaging to customers
- Provider abstraction layer (Meta + Mock support)
- Graceful degradation (works without credentials)
- Event-driven architecture (Webhook + SSE)
- Full audit trail of all messages

---

## 3. Technology

- WhatsApp Business Cloud API (Meta)
- FastAPI (backend)
- Supabase (database)
- ngrok (local webhook testing)
- SSE (real-time UI updates via existing event system)

---

## 4. Inputs

From Workflow + Follow-up Agent:

- lead_id
- lead_name
- phone_number
- vehicle_model
- lead_score (hot / warm / cold)
- sentiment (positive / neutral / negative)
- recommended_action (whatsapp_followup)
- drafted_message (AI-generated message)
- attachments (optional media: image, pdf, video)

---

## 5. Outputs

- WhatsApp message sent (or stored as draft if provider unavailable)
- Meta message ID (wamid)
- Delivery status updates:
  - sent
  - delivered
  - read
  - failed
- Persisted message history in database
- Real-time UI updates via SSE

---

## 6. WhatsApp Provider Layer

### Interface

- send_text()
- send_media()
- verify_webhook()
- parse_webhook_event()

### Implementations

- MetaWhatsAppProvider (production)
- MockWhatsAppProvider (fallback for dev)

### Selection Logic

- If WHATSAPP_ACCESS_TOKEN exists → Meta provider
- Else → Mock provider

---

## 7. WhatsApp Cloud API

### Send Message Endpoint

POST:
https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages

### Payload

{
  "messaging_product": "whatsapp",
  "to": "<phone_number>",
  "type": "text",
  "text": {
    "body": "<message>"
  }
}

### Response

- returns wamid (message id)
- used for tracking delivery lifecycle

---

## 8. Webhook System

### Endpoints

GET /whatsapp/webhook
- Meta verification handshake

POST /whatsapp/webhook
- Delivery status updates
- Read receipts
- Inbound customer messages

### Security

- HMAC-SHA256 verification using WHATSAPP_APP_SECRET
- Reject invalid signatures

### Event Handling

#### Delivery Event
- Update lead_messages.status
- Append message_delivery_logs
- Emit SSE event

#### Inbound Message
- Store inbound message in lead_messages
- Link to lead via phone number
- Trigger Workflow Agent (trigger_source = whatsapp_reply)

---

## 9. Database Schema

### lead_messages (extended)

- whatsapp_message_id (wamid)
- status (sent / delivered / read / failed)
- direction (inbound / outbound)
- channel = whatsapp
- template_id (nullable)
- attachment_id (nullable)
- error_reason (nullable)

---

### message_templates

- id
- tenant_id
- name
- category (marketing / utility / authentication)
- language
- content
- variables (JSON)
- meta_status (pending / approved / rejected)

---

### attachments

- id
- tenant_id
- name
- type (image / video / pdf / document)
- meta_media_id
- url
- size_bytes

---

### message_delivery_logs (append-only)

- id
- tenant_id
- message_id
- status
- meta_timestamp
- webhook_payload

---

## 10. Real-Time Updates (SSE)

Event Flow:

Webhook → DB update → SSE broadcast → UI update

Event Format:

{
  "type": "whatsapp_status",
  "lead_id": "...",
  "wamid": "...",
  "status": "delivered",
  "updated_at": "..."
}

---

## 11. UI Components

### WhatsAppSendCard

- Shows Follow-up Agent drafted message
- Editable textarea
- Send via WhatsApp button
- Attachment selector (list only in v1)
- Shows message status live

### Status Indicators

- Sent ✓
- Delivered ✓✓
- Read (blue ticks)
- Failed (error state)

---

## 12. Execution Flow

1. Lead enters system
2. Workflow Agent processes lead
3. Follow-up Agent generates WhatsApp draft
4. Rep opens lead detail page
5. Rep edits message (optional)
6. Rep clicks "Send via WhatsApp"
7. Backend calls WhatsApp Provider
8. Meta returns wamid
9. Message stored in lead_messages
10. Webhook updates delivery status
11. SSE updates UI in real-time
12. Customer replies (optional)
13. Inbound message triggers Workflow Agent

---

## 13. Testing

### Unit Tests

- Message send returns wamid
- Mock provider fallback works
- Webhook updates status correctly
- Inbound message triggers workflow agent
- HMAC verification works
- System works without credentials (mock mode)

---

## 14. Development Modes

### Mock Mode

- No Meta credentials required
- No real messages sent
- Messages stored as draft/virtual send

### Live Mode

- Uses Meta Cloud API
- Real WhatsApp messages sent
- Webhook + SSE fully active

---

## 15. Environment Variables

WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WABA_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_PROVIDER=meta | mock

---

## 16. Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| Meta API failure | fallback to mock provider |
| webhook downtime | persist-first design |
| duplicate webhook events | idempotent wamid checks |
| message loop | manual send only v1 |
| token expiry | environment refresh strategy |

---

## 17. Acceptance Criteria

- Messages sent successfully via WhatsApp Cloud API
- Manual review required before sending
- wamid stored in database
- Delivery tracking works (sent/delivered/read/failed)
- Real-time UI updates via SSE
- Inbound messages captured
- Workflow triggers on inbound replies
- Works in mock + live mode
- No changes required to Phase 1–3 system

---

## 18. Implementation Order

1. Provider abstraction layer
2. Mock provider
3. Meta API integration (meta_client.py)
4. Database migrations
5. Send message API
6. Webhook implementation
7. SSE integration
8. Frontend WhatsAppSendCard
9. Status UI updates
10. Unit tests