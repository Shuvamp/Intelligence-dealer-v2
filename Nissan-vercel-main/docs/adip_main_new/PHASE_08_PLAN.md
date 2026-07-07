# Phase 8 — Docker & Production Readiness: Implementation Plan

> **Status:** Planning only — no implementation started.
> **Source of truth:** [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md) (post-Phase 7).
> **Spec:** [PHASE_08_DOCKER_PRODUCTION.md](PHASE_08_DOCKER_PRODUCTION.md).
>
> **Committed scope decisions (this plan):**
> 1. **Redis / `langgraph-workers` split (Milestone 5) is DEFERRED to Phase 9.**
>    Phase 8 ships a single-node stack with the event bus running **in-process**
>    inside the `api` container. Phase 7's persist-before-dispatch + `replay()`
>    already gives at-least-once-on-restart without a broker; distributed delivery
>    is the highest-risk piece and a single pilot dealer doesn't need worker
>    horizontal scaling. The transport is swappable behind `EventBus.publish()/
>    subscribe()`, so deferring costs nothing later.
> 2. **Production data target is real Supabase**, NOT a persisted DuckDB. RLS is
>    the entire tenant-isolation model and the shim never enforces it — a DuckDB
>    "production" deploy would have zero tenant isolation. DuckDB shim remains the
>    **dev compose profile**; Supabase is the **prod profile**.
>
> **Committed Phase 8 milestone set:** M1 → M2 → M3 → M4 → M6. (M5 = Phase 9.)

---

## A. Executive Summary

**Purpose.** Phases 1–7 produced a feature-complete platform that runs *only* under
`npm run dev` — three loosely-coordinated processes (Vite `:3000`, Express/DuckDB
shim `:54321`, FastAPI `:8000`) on a developer laptop, backed by an **in-memory**
DuckDB that vanishes on restart and an **in-process** event bus. Phase 8 turns this
into a reproducible, observable, recoverable deployment: containerized services,
real health checks, structured monitoring, and formalized failure recovery —
**without changing agent behaviour**.

**Business value.** Makes the platform demonstrable and deployable beyond one
machine (pilot Nissan dealer hosting), gives operators visibility ("is it up? why
did this lead fail?"), and removes the data-loss risk of an in-memory DB. It is the
precondition for any real customer pilot.

**Technical value.** `docker compose up` as the single source of run-truth; a clean
process boundary between web / API / data; health and metrics endpoints for
orchestration and alerting; production-grade tenant isolation via real Supabase RLS.

**Critical caveats (dominant facts from current state):**
1. **Live secrets in git history** — `apps/api/.env` historically committed a real
   Meta WhatsApp token, app secret, Anthropic key and Groq key (untracked now, but
   present in `origin/srirambala_main` history). **These must be rotated** before any
   deploy. Phase 8 cannot ship secrets-in-image.
2. **DuckDB shim ≠ production database.** In-memory, dev-only, **no RLS** (CLAUDE.md
   hard rule; [§6](CURRENT_ARCHITECTURE.md)). Kept as a dev compose profile only;
   production uses Supabase.

---

## B. Current State Assessment

**Components already available (reusable):**

| Asset | State | Phase 8 relevance |
|---|---|---|
| FastAPI app (`apps/api/main.py`) | Single uvicorn process, all agents in-process | Becomes the `api` container; agents stay in-process (M5 deferred) |
| Event bus (`agents/events/`) | In-process async pub/sub, **persist-before-dispatch + replay**, kill-switch `EVENT_BUS_ENABLED` | Stays in-process for Phase 8; transport swap is Phase 9 |
| `GET /health` | Liveness only | Seed for the 3 required health endpoints |
| Per-agent failure tolerance | Scoring→deterministic fallback; WhatsApp→mock fallback; Call→idempotent retry by `call_id`; all nodes "never raise" | ~70% of the spec's Failure-Recovery matrix already exists |
| DuckDB shim (`apps/local-api/server.js`) | Express + in-memory DuckDB, PostgREST/Auth emulation, SSE hub | The `duckdb` container (dev profile only) |
| Supabase migrations `0001`–`0024` | Schema-as-code | Production DB provisioning path |
| Test suites | 46 Python tests passing; **0 web tests** | Regression gate for the refactor |

**Existing dependencies:** Python 3.12 + uv venv (FastAPI, LangGraph, anthropic,
groq, httpx, faster-whisper), Node (web + shim), external APIs (Anthropic, Groq,
NVIDIA NIM, Meta WhatsApp Cloud API).

**Architectural constraints (from the codebase, not assumptions):**
- **SSE hub is the shim, not FastAPI** ([§7](CURRENT_ARCHITECTURE.md)). The browser's
  `EventSource` connects to `VITE_SUPABASE_URL`. nginx must preserve this and **not
  buffer SSE** (`proxy_buffering off`).
- **In-process event bus is not cross-process.** Worker separation would require a
  cross-process transport first — that whole decision is deferred to Phase 9.
- **DuckDB is embedded, not a server.** The `duckdb` container = the Express shim
  that embeds it. In-memory = no persistence; production uses Supabase.
- **4 assignment tables (`sales_executives`, `lead_assignments`, `lead_completions`,
  `assignment_notifications`) have no Supabase migration** ([§8](CURRENT_ARCHITECTURE.md),
  Tech Debt #5) — a hard production blocker.
- **File uploads (call recordings) write to local disk** (`apps/api/.uploads/`) —
  ephemeral in a container; needs a volume (dev) or Supabase Storage (prod).

---

## C. Gap Analysis

**Missing for Phase 8 (must build):**
- Dockerfiles for `web` and `api`; a `docker-compose.yml` (dev + prod profiles);
  `nginx` reverse-proxy config.
- Two new health endpoints: `/agents/health` (bus enabled + LLM/Meta reachability)
  and `/db/health` (DB connectivity). `/api/health` ≈ existing `/health`.
- Structured logging (JSON), a metrics surface, request tracing/correlation IDs,
  error tracking.
- Secrets management (env injection, not baked images) + **secret rotation**.

**Required enhancements (failure-recovery gaps to close):**
- **Assignment → `UNASSIGNED_POOL`** (today it silently safe-defaults).
- **Workflow failure → create manual task.**
- **DB failure → bounded retry/backoff** on persistence.
- (Validation reject, scoring heuristic, WhatsApp ×3 retry, call-analysis retry
  already exist or are partially present — formalize + add metrics.)

**Required integrations:** Supabase as the production DB target; Supabase Storage
(or volume) for uploads; an error-tracking sink and a metrics scrape target.
(Redis is **not** in Phase 8 scope — Phase 9.)

**Required infrastructure changes:** container images + registry, compose
orchestration, reverse proxy/TLS termination, persistent volumes, health-check
wiring, log aggregation.

---

## D. Architecture Impact Analysis

**Components affected:** all three runtime processes get containerized; FastAPI gains
health/metrics/logging middleware. Event bus stays in-process — no bus refactor.

**New modules required (Phase 8-owned, behind existing seams):**
- `nginx/` reverse-proxy config (new infra dir).
- Health/observability layer in FastAPI (new health routers + logging/metrics
  middleware) — *additive*, no agent edits.

**Existing modules needing extension (not replacement):**
- `apps/api/main.py`: add `/agents/health`, `/db/health`, metrics endpoint, logging
  middleware. The Phase 7 `@app.on_event("startup")` replay hook is reused as-is.
- `apps/local-api/server.js`: add a `/db/health` style check; honour env-configured
  DuckDB path (dev only).
- Assignment / Workflow agents: add the two recovery fallbacks (pool, manual task) —
  small, contained.

**Database impact:** **One blocker migration** to add the 4 assignment tables to
Supabase (likely `0025`). Optional: a dead-letter view on `domain_events` using its
existing `status`/`attempts`/`error` columns. No Phase 1–7 table changes.

**API impact:** Additive only — 3 health endpoints + 1 metrics endpoint. No existing
endpoint changes (preserves Phase 7's "endpoints are producers" contract).

**Event/workflow impact:** None. Bus stays in-process; semantics unchanged.

---

## E. Proposed Technical Design

**High-level container topology (Phase 8 — single-node, in-process bus):**

```
                       ┌─────────────────────────────┐
   Internet ──TLS──►   │  nginx  (ingress, :80/:443) │
                       └───┬───────────┬─────────────┘
            /  , /assets   │           │  /api/* , /whatsapp/* , SSE
                           ▼           ▼
                   ┌────────────┐   ┌──────────────────────────────┐
                   │  web       │   │  api (FastAPI)               │
                   │ TanStack   │   │  HTTP + health + metrics     │
                   │  :3000     │   │  + ALL agents in-process     │
                   └────────────┘   │  + in-process event bus      │
                                    └───────────────┬──────────────┘
                                                    │ data
                                                    ▼
                                       ┌──────────────────────────┐
                          prod ───►    │  future-supabase         │
                                       │  Postgres + Auth +       │
                                       │  Storage + RLS           │
                                       └──────────────────────────┘
                          dev  ───►    ┌──────────────────────────┐
                                       │  duckdb shim (Express)   │
                                       │  in-memory, NO RLS       │
                                       └──────────────────────────┘

  Phase 9 (deferred): redis + langgraph-workers split for cross-process,
  horizontally-scalable event delivery — behind the same publish/subscribe API.
```

**Data flow (unchanged semantics):** intake → `api` persists + `publish(LEAD_ASSIGNED)`
→ in-process bus → Workflow handler runs → `publish(ACTION_RECOMMENDED)`; call→re-score
→workflow and WhatsApp-reply→re-score chains follow the same path. SSE to the browser
still flows FastAPI→shim/Supabase-channel→`EventSource` ([§7](CURRENT_ARCHITECTURE.md));
nginx passes SSE through unbuffered.

**Service interactions:** `web`↔`api` over nginx; `api`↔DB (Supabase prod / shim dev);
`api`↔external LLM/Meta APIs egress; Meta webhooks ingress via nginx → `api`.

**External integrations:** Anthropic, Groq, NVIDIA NIM, Meta WhatsApp Cloud API
(unchanged); Meta webhooks now via real TLS endpoint (ngrok replaced in prod).

**Security:** secrets via env/secret store injected at runtime (never in images);
**rotate the historically-leaked Meta/Anthropic/Groq credentials before first deploy**;
nginx terminates TLS; **RLS verified against real Supabase** (the shim never enforced
it); the shim's wildcard `/rest/v1/:table` handler (Tech Debt #2) kept out of any
internet-facing profile.

**Scalability:** `api` is stateless behind nginx and can scale out for read/HTTP load.
CPU-bound transcription (faster-whisper via `run_in_executor`) is isolated off the
event loop. True per-agent horizontal scaling is a Phase 9 concern (worker split).

---

## F. Implementation Breakdown

> M5 (Redis + worker split) is intentionally **omitted** — deferred to Phase 9.

**Milestone 1 — Production blockers & secrets**
- *Goal:* make it *safe* to containerize at all.
- *Scope:* rotate leaked Meta/Anthropic/Groq creds; define secrets-injection strategy
  (env file out of image, compose `secrets`/host env); add the 4 assignment-table
  Supabase migrations; confirm `.env` gitignored + `.env.example` complete.
- *Dependencies:* none (do first).
- *Deliverables:* rotated keys, migration `0025_assignment_tables.sql` (designed here),
  secrets convention doc.
- *Risks:* missed credential breaks WhatsApp/LLM at runtime — mitigate with
  `/agents/health` provider check (M3).

**Milestone 2 — Containerize (single-node, in-process bus)**
- *Goal:* `docker compose up` runs the whole stack, agents in-process in `api`.
- *Scope:* Dockerfiles (`web`, `api`), `docker-compose.yml` with **dev profile**
  (`duckdb` shim) and **prod profile** (`future-supabase`), `nginx` reverse proxy with
  SSE pass-through, persistent volume for uploads.
- *Dependencies:* M1.
- *Deliverables:* images build; stack serves `/`, `/enquire`, `/leads`; intake→workflow
  chain works end-to-end in a container.
- *Risks:* SSE buffering by nginx (mitigate: `proxy_buffering off`, correct headers);
  in-memory DuckDB loses data on restart (acceptable for dev profile; prod uses Supabase).

**Milestone 3 — Health & observability**
- *Goal:* operators can answer "is it up, and why did X fail?"
- *Scope:* `/api/health`, `/agents/health` (bus enabled? LLM/Meta reachable?),
  `/db/health`; structured JSON logging with correlation IDs; metrics endpoint (intake
  count, score distribution, event success/failure, retry counts); error-tracking sink;
  minimal tracing across the event chain.
- *Dependencies:* M2.
- *Deliverables:* 3 health endpoints wired into compose `healthcheck:`; dashboards/log
  lines for the 6 SSE event types + `domain_events` outcomes.
- *Risks:* health checks that call external APIs flap/cost money — gate provider checks
  behind a shallow-vs-deep query param.

**Milestone 4 — Failure-recovery hardening**
- *Goal:* satisfy the spec's recovery matrix explicitly.
- *Scope:* Assignment→`UNASSIGNED_POOL`; Workflow failure→manual `lead_task`; DB
  persistence→bounded retry/backoff (reuse the bus's backoff-constant pattern);
  formalize the existing WhatsApp ×3 and call-analysis retry; surface failed
  `domain_events` (dead-letter view).
- *Dependencies:* M3 (so failures are visible).
- *Deliverables:* each failure mode has a defined, tested fallback + a metric.
- *Risks:* over-aggressive retries amplify load — cap attempts, jittered backoff.

**Milestone 6 — Production data & rollout**
- *Goal:* run against real Supabase with verified isolation.
- *Scope:* point prod profile at Supabase; run migrations `0001`–`0025`; **verify RLS**
  tenant isolation (never tested under the shim); move uploads to Supabase Storage
  (closes the Documents/Call-recording disk gap); real TLS webhook endpoint replacing
  ngrok.
- *Dependencies:* M1 (assignment migrations), M2.
- *Deliverables:* prod compose validated against Supabase; RLS test evidence;
  Storage-backed uploads.
- *Risks:* RLS misconfiguration leaks cross-tenant data — make RLS verification an
  explicit acceptance gate.

---

## G. Database & Data Model Changes

- **New (blocker):** Supabase migrations for `sales_executives`, `lead_assignments`,
  `lead_completions`, `assignment_notifications` — currently shim-only
  ([§8](CURRENT_ARCHITECTURE.md)). Likely `0025`.
- **Optional:** a `domain_events` dead-letter view/index on `(status, attempts)` for
  failed-event triage (no schema change — uses existing columns).
- **No changes** to Phase 1–7 tables. All additions are additive migrations appended
  after `0024`.
- **Migration strategy:** additive-only, sequential numbering, applied via migration
  apply in the prod profile; shim auto-creates tables in `initSchema()` for dev parity.
  No backfill required.
- **Persistence decision:** production data lives in **Supabase**. DuckDB is never the
  production store; dev may optionally use a file-backed volume for restart survival.

---

## H. API & Integration Changes

**New endpoints (additive):**
- `GET /api/health` — liveness (wraps existing `/health`).
- `GET /agents/health` — bus enabled, optional deep LLM/Meta reachability.
- `GET /db/health` — DB connectivity (Supabase or shim).
- `GET /metrics` (or equivalent) — counters/gauges for scraping.

**Modified endpoints:** none functionally — existing routes keep their Phase 7 producer
contracts.

**Webhooks/events:** Meta webhook ingress now flows through nginx (TLS) instead of
ngrok; the 6 SSE event types and the `domain_events` chain are unchanged.

**Third-party integrations:** Supabase Storage (new, for uploads); error-tracking +
metrics sinks (new); Anthropic/Groq/NVIDIA/Meta unchanged but driven by injected
(rotated) secrets. **Redis is Phase 9, not Phase 8.**

---

## I. Testing Strategy

- **Unit:** keep 46 Python tests green as the refactor gate; add tests for the new
  recovery fallbacks (assignment pool, workflow manual task, DB retry) and health
  endpoints. Add the *first* web tests (vitest configured, currently zero — Tech Debt #11).
- **Integration:** `api`↔Supabase; nginx routing incl. **SSE pass-through** (assert no
  buffering/truncation); Meta webhook HMAC path through nginx.
- **End-to-end:** `docker compose up` then run the canonical chains — intake→score→
  assign→workflow; call upload→transcribe→analyze→re-score→workflow; WhatsApp
  reply→re-score. Confirm `domain_events` rows reach `done`.
- **Performance:** transcription throughput (CPU-bound faster-whisper); SSE under many
  concurrent `EventSource` clients; `api` request latency under load.
- **Security:** **RLS tenant-isolation tests against real Supabase** (non-negotiable
  gate); secret-injection verification (no secrets in image layers); shim wildcard
  `/rest/v1/:table` not exposed in prod; webhook signature rejection.
- **Recovery:** fault-injection — kill `api` mid-dispatch and confirm `replay()`
  recovers; force Assignment/Workflow/DB failures and assert the defined fallbacks fire.

---

## J. Deployment & Rollout Strategy

- **Feature flags:** reuse the established env-flag pattern — `EVENT_BUS_ENABLED`
  (exists), `CALL_AUTO_RESCORE` (exists); a DB-target/profile selector for dev vs prod.
- **Migration plan:** apply `0001`→`0025` to a Supabase staging project first; validate;
  then prod. Dev profile keeps shim auto-schema.
- **Rollback plan:** images are versioned/tagged → redeploy previous tag; additive
  migrations mean old code tolerates new tables; `EVENT_BUS_ENABLED=0` remains the
  bus kill-switch (same reversibility design as Phase 7).
- **Monitoring requirements:** the 3 health endpoints wired to compose `healthcheck:`
  and any external uptime check; alerts on `domain_events.status='failed'` rate,
  LLM-provider downgrade-to-deterministic events (Tech Debt #6 — currently silent),
  WhatsApp `mock_fallback` rate.

---

## K. Risks & Mitigation

| Risk | Type | Mitigation |
|---|---|---|
| Leaked secrets in git history still valid | **Security (critical)** | Rotate Meta token/app-secret, Anthropic, Groq **before** deploy; never bake into images; consider history scrub |
| RLS never verified (shim has none) | Security | Explicit RLS isolation test gate in M6 against real Supabase |
| nginx buffers SSE → broken live updates | Technical | `proxy_buffering off`, correct SSE headers, integration test |
| In-memory DuckDB data loss in container | Operational | Dev-only; prod uses Supabase; optional file-backed volume for dev |
| Lost uploads on container restart (local disk) | Operational | Volume in dev; Supabase Storage in prod (M6) |
| Health checks calling paid LLM APIs | Operational/cost | Shallow-by-default, deep check opt-in |
| Assignment tables missing in Supabase | Technical | Migration `0025` in M1 (blocker) |
| In-process bus not durable mid-crash | Technical | Persist-before-dispatch + startup `replay()` (Phase 7); real broker = Phase 9 |
| Silent provider downgrades / swallowed exceptions (Tech Debt #6, #8) | Operational | Structured logging + metrics + alerts in M3 |

---

## L. Future Compatibility

- **Impact on future phases:** Phase 8 keeps the event bus in-process but leaves the
  `EventBus.publish()/subscribe()` seam untouched — **Phase 9** can introduce Redis +
  `langgraph-workers` (the deferred M5) and any message-driven feature (a real Comms
  agent consuming `ACTION_RECOMMENDED`, the reserved `LEAD_CREATED/VALIDATED/SCORED/
  SENTIMENT_UPDATED` events from [§21](CURRENT_ARCHITECTURE.md)) without touching
  producers or handlers.
- **Recommended extension points:** keep the bus interface stable (transport behind it);
  keep health endpoints composable (per-dependency sub-checks); keep migrations additive;
  keep the kill-switch/flag pattern for every risky subsystem.
- **Technical-debt considerations:** Phase 8 is the moment to retire dev-only debt that
  becomes dangerous in prod — the shim's unwhitelisted `/rest/v1/:table` (#2), duplicate
  scoring/assignment heuristics in shim vs Python (#3/#4), and silent degraded-mode
  operation (#6/#8). It adds modest debt (compose complexity, dual dev/prod profiles)
  that should be documented. Phase 7's open follow-ups (subscriber-less reserved events,
  shim-still-triggers-via-HTTP) carry forward to Phase 9 alongside the bus refactor.

---

## Phase 8 Milestone Summary

| Milestone | Title | In Phase 8? | Key deliverable |
|---|---|---|---|
| M1 | Production blockers & secrets | ✅ | Rotated creds, assignment migration `0025` |
| M2 | Containerize (in-process bus) | ✅ | `docker compose up` (dev + prod profiles) + nginx |
| M3 | Health & observability | ✅ | 3 health endpoints, structured logs, metrics |
| M4 | Failure-recovery hardening | ✅ | Assignment pool, workflow manual task, DB retry |
| M5 | Redis + worker split | ⛔ Deferred → **Phase 9** | (cross-process bus, horizontal scaling) |
| M6 | Production data & rollout | ✅ | Supabase target, RLS verification, Storage uploads |

**Constraints honored:** no production code written, no implementation files generated,
no existing architecture files modified, implementation not started. Awaiting approval
before generating any implementation tasks.
