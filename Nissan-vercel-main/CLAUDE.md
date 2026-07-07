# ADIP — Agentic Dealership Intelligence Platform ("Dealer Intelligence OS")

Multi-tenant SaaS: the operating system for car dealerships. Phase 1 customer: Nissan dealers.

## Architecture
- **TanStack Start** (`apps/web`) — frontend + BFF. NO business logic.
- **FastAPI** (`apps/api`) — the system API: business logic, agent orchestration (LangGraph), integrations, AI.
- **Supabase** — PostgreSQL + Auth + Storage + Realtime.

## Team Standard (Nissan Project)
- **Frontend:** TanStack Start (React) — `apps/web`
- **Backend API:** FastAPI (Python) — `apps/api`
- **AI / Agents:** LangGraph (Python) — `apps/api/agents/`
- **Dev DB:** DuckDB in-memory shim — `apps/local-api/` (local dev ONLY, not production)
- **Prod DB:** Supabase PostgreSQL

> **Rule:** All new backend APIs and AI agents MUST use FastAPI + Python LangGraph.
> Node.js (`apps/local-api`) is a local dev shim only — it is NOT the production backend.
> Exception needed for any new Node.js backend work.

## Hard Rules
- Multi-tenant, two-level: **tenant (dealer) → location (showroom)**. Every domain table has `tenant_id`.
- **Tenant isolation is enforced by Supabase RLS, NOT app-layer filtering.**
- FastAPI calls Supabase with the **caller's JWT**, never the service-role key for normal data access.
- Roles (V1): `dealer_owner`, `dealer_manager`, `sales_executive`, `marketing_executive`.
- Keep the spine **thin**. Lead/Campaign/Vehicle/Offer live in module specs, not the spine.
- **Customer 360 = composed read-model**, not a fat table. Spine owns `customers` (identity only); modules own satellites that FK `customer_id`.
- No mock implementations in the foundation. AI/integrations may be stubbed in modules.

## Specs & Plans
- `docs/specs/2026-06-07-spine-design.md` — frozen spine design
- `docs/specs/future-vision.md` — Phase 1–4 roadmap
- `docs/superpowers/plans/` — implementation plans (built tier by tier: Data → API → Web)

## Lead Intake Pipeline (multi-agent — built by the team)
**Before editing any intake/agent code, read `docs/LEAD-PIPELINE.md`.** Leads from
the website form + Facebook/Instagram demos flow through ONE pipeline of 4 plain-async
agent nodes, in order: `validate → normalize → score → assign → DuckDB`.
- Orchestrator (wires the nodes): `apps/api/agents/intake_pipeline/graph.py` — **do not edit**.
- Shared contract (state + I/O shapes): `apps/api/agents/intake_pipeline/contracts.py` — **read-only**.
- One node per file under `apps/api/agents/intake_pipeline/nodes/`; each owner edits ONLY their node:
  `validate.py` (Amirtha) · `normalize.py` (Partha ✅) · `score.py` (Csriram) · `assign.py` (Keerthana).
- Every node ships a working baseline stub, so the pipeline runs end-to-end today; replace the `TODO(owner)` block with the real agent. Keep a deterministic fallback (no `ANTHROPIC_API_KEY` required for local dev).
- Endpoints: `POST /intake/leads` and `GET /intake/stream` served by FastAPI on port 8000.
- Amirtha's validator: `apps/api/agents/lead_validator/` — still separate (validate_phone→email→fields→dedup_and_persist).
- Scoring agent (node 3): `apps/api/agents/scoring/` (Csriram) — holistic Groq + md rubric, returns HOT+/HOT/WARM/COLD/DEAD; see `docs/SCORING-AGENT.md`.
- Assignment agent (node 4): `apps/api/agents/assignment/` (Keerthana) — least-loaded executive selection with capacity limits; see `docs/ASSIGNMENT-AGENT.md`.

### Follow-up agent (post-assignment, on demand)
`apps/api/agents/followup/` — LangGraph `fetch_detail → decide_action → draft_message → write_nba`.
Given a lead it picks the next best action (call/whatsapp/email/test_drive/manager/nurture/none),
drafts an outreach message (Groq `llama-3.1-8b-instant`, deterministic fallback — no key needed),
logs an `nba` event on the lead's timeline, and notifies the assignee. Competitor handling: if the
customer named a rival, it weaves in 1–2 Nissan advantages without naming the rival.
- Endpoint: `POST /followup/{lead_id}` (FastAPI, port 8000). Data access is over PostgREST to the shim.
- UI: the **"Generate follow-up"** button on the lead detail page (`/leads/$leadId`) → server fn
  `runFollowup` (`apps/web/src/lib/followup.ts`) → the endpoint; the NBA event then shows in the timeline.

## Local dev — DEFAULT: DuckDB (no Docker/Supabase CLI needed)
For day-to-day development, use the **DuckDB shim** in `apps/local-api` — a small Express
server that speaks Supabase's Auth + PostgREST API, backed by in-memory DuckDB. The web app
runs **unchanged**; only `VITE_SUPABASE_URL` points at it. Use this unless you specifically
need real Supabase/RLS.

```bash
npm run setup        # installs root + apps/local-api + apps/web deps; writes apps/web/.env.local
npm run setup:agent  # once: creates apps/api/.venv + installs FastAPI agent deps (needs Python 3.12 + uv)
npm run dev          # starts DuckDB shim (:54321) + web (:3000) + FastAPI agents (:8000)
```
- `npm run dev` now also launches the FastAPI agent service (`apps/api`, port 8000) so the
  intake pipeline and the Leads follow-up agent work out of the box. (`dev:agent` runs it alone.)
- Non-Windows: the `dev:agent` script's venv path is `apps/api/.venv/bin/python` (the committed
  script uses the Windows `Scripts` path).
- `apps/web/.env.local` is auto-generated to point at `http://localhost:54321` (zero config).
- Demo logins (password `Passw0rd!23`): `owner@abcnissan.test`, `manager@abcnissan.test`, `sales@xyznissan.test`.
- Details, supported query shapes, and caveats: `apps/local-api/README.md`.
- **The shim does NOT enforce RLS** — tenant-isolation behavior must be verified against real Supabase.

## Local dev — production-parity (real Supabase)
- Container runtime: **colima** (`colima start`), Docker CLI client.
- `supabase start` boots the local stack. Migrations in `supabase/migrations/`. Seed in `supabase/seed.sql`.
- `supabase db reset` re-applies migrations + seed. `supabase test db` runs pgTAP tests.
- Studio: http://localhost:54323
- To use it from the web app, set the real `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `apps/web/.env.local`.
