# ADIP — Future Vision & Roadmap

This file aligns the architecture with where the product is going. The spine
(`2026-06-07-spine-design.md`) is built so each phase below slots in without
re-architecting. Build only what Phase 1 needs now; design so later phases fit.

---

## Phase 1 — Dealer Intelligence OS V1 (current)
The four core products on a thin multi-tenant spine.

- Marketing Automation (calendar, AI poster/caption — simplified)
- Lead Management (pipeline, detail, scoring — rule-based)
- Market Intelligence (signals dashboard)
- Executive Copilot (chat interface — scripted/simple retrieval)
- Customer 360 (composed read-model)

Goal: demoable V1 for Nissan on the real foundation.

---

## Phase 2 — Channel Integrations
Make leads and publishing real across the channels dealers actually use.

- WhatsApp integration
- Facebook integration
- Instagram integration
- Google Business publishing

---

## Phase 3 — Real Agents
Turn the Agent Registry from stubs into running workflows.

- LangGraph execution graphs wired to `agent_registry` entries
- Autonomous workflows (auto follow-up, auto-assignment, campaign generation)
- Agent observability and guardrails

---

## Phase 4 — OEM & Network Intelligence
Move up the tenancy hierarchy toward the three-level model reserved in the spine.

- OEM / Nissan Corporate portal (read across a brand's dealers)
- Dealer benchmarking (compare performance across dealers)
- Regional intelligence (cross-tenant demand and trend analysis)
- Platform Admin tier

---

## Architectural reservations already in place
- Two-level tenancy now; schema reserves room for OEM → dealer-group → dealer (Phase 4).
- `agent_registry` + `agent_type` exist day 1 so Phase 3 is a wiring job, not a redesign.
- `notifications` and `audit_logs` tables exist day 1 so delivery/audit pipelines are additive.
- Roles `platform_admin` and `oem_viewer` reserved for Phase 4.
