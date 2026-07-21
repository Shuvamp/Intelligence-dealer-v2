# ADIP Production Readiness Audit — Lead Management & Marketing

**Date:** 2026-07-21
**Scope:** Full end-to-end audit of the Lead Management and Marketing modules (frontend → API → agents → Supabase), with cross-cutting sections (auth, RLS, tests, performance) covered to the depth needed to support those findings. Rest of the platform reviewed only where it touches these two modules.
**Method:** Static code reading only. No live requests were made against the running dev server or the hosted Supabase project; every claim below is backed by a `file:line` citation that was read directly, not inferred from naming. All paths are relative to `Nissan-vercel-main/` unless stated otherwise.
**Verdict up front:** **Not production ready. No-Go.** See §14 for the full verdict; the short version is a systemic multi-tenant security bypass (§13) plus several silent-failure bugs that are cheap to fix once found (§3).

---

## Table of Contents

1. [End-to-End Workflow Audit](#1-end-to-end-workflow-audit)
2. [Production Readiness Review](#2-production-readiness-review)
3. [Broken Code Detection](#3-broken-code-detection)
4. [UI Integrity Audit](#4-ui-integrity-audit)
5. [Data Flow Verification](#5-data-flow-verification)
6. [Supabase Audit](#6-supabase-audit)
7. [Cloud Persistence Verification](#7-cloud-persistence-verification)
8. [API Audit](#8-api-audit)
9. [Frontend Audit](#9-frontend-audit)
10. [Integration Audit](#10-integration-audit)
11. [Architecture Impact Analysis](#11-architecture-impact-analysis)
12. [Performance Audit](#12-performance-audit)
13. [Security Audit](#13-security-audit)
14. [Final Production Verdict](#14-final-production-verdict)

---

## 1. End-to-End Workflow Audit

Legend: ✅ Working · ⚠ Needs Attention · ❌ Broken

### 1.1 Lead Management

#### Operation 1–2: Create Lead (website enquiry `/enquire` and internal `/leads/new`)

```
UI (enquire.tsx / leads.new.tsx)   lib/intake.ts        FastAPI                    Pipeline (main.py._run_pipeline)         Supabase
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[submit] ──✅──▶ submitLead() ──✅──▶ POST /intake/leads ──✅──▶ validate_node ──✅──▶ customers + leads INSERT
                (lib/intake.ts:29-49)  (main.py:775-896)         (lead_validator/nodes.py:147-270, real dedup/validation)
                                                                        ▼
                                                                  normalize_node ──✅ Claude haiku / static fallback
                                                                        ▼
                                                                  score_node ──✅ Groq holistic scorer
                                                                        ▼
                                                                  assign_node ──✅ sales_executives / lead_assignments /
                                                                                    assignment_notifications (real writes)
                                                                        ▼
                                                        leads.assigned_to PATCH ──✅
                                                                        ▼
                                                        SSE broadcast (new lead toast) ──✅
                                                                        ▼
                                                        bus.publish(LEAD_ASSIGNED) ──⚠ fire-and-forget, no UI consumer
```
Both entry points share the exact same backend path — `leads.new.tsx` has no separate code path. ✅ Working end-to-end, including real persistence to `customers`, `leads`, `sales_executives`, `lead_assignments`, `assignment_notifications`. One correctness caveat: `tenant_id` is the hardcoded `ABC_TENANT_ID` (`main.py:102`), not derived from anything about the request — see §13.

#### Operation 3: "Update Lead" — does not exist as a distinct feature

No generic field/notes editor exists anywhere in the codebase. This requested workflow is fully subsumed by the more specific mutations below (stage, assignment, score, messages, tasks). Not a bug — just not a real, separate feature to report on.

#### Operation 4: Move Lead / Stage Change

```
KanbanBoard drag           lib/leads.ts                    Supabase                      FastAPI (broadcast only)
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
handleMoveStage ──✅──▶ updateLeadStage() ──✅──▶ leads.stage UPDATE + lead_events INSERT ──✅
(leads.index.tsx:72-89)  (lib/leads.ts:128-172)                                              │
                                                                                              ▼ (best-effort side call)
                                                                          POST /events/stage-change ──✅──▶ SSE broadcast
                                                                          (main.py:930-935, genuinely wired, unlike        (cross-tab toast +
                                                                           the whatsapp_inbound/rescore_complete paths     router.invalidate)
                                                                           below which target a nonexistent URL)
```
✅ Fully working, including the real-time cross-tab broadcast.

#### Operation 5: Assign Lead

```
leads.$leadId.tsx / AgentAvailability.tsx        lib/leads.ts::assignLead        Supabase
──────────────────────────────────────────────────────────────────────────────────────────
handleAssign ──✅──▶ assignLead() ──✅──▶ leads.assigned_to UPDATE + lead_events INSERT

                                          lib/assignments.ts::assignLead   FastAPI /api/assign-lead   sales_executives /
                                          ──❌ ZERO CALL SITES ANYWHERE──▶  (fully implemented,        lead_assignments
                                                                             never invoked)             (never updated
                                                                                                          post-intake)
```
⚠/❌ **Real dead-code bug, not two legitimate actions** (confirmed independently by Agents A and D): a second, fully-built assignment path (`lib/assignments.ts` → `POST /api/assign-lead` → `AssignmentAgent`, which correctly updates `sales_executives.current_lead_count`/`lead_assignments`/`assignment_notifications`) has **zero callers** in the entire frontend. Every real assignment after the initial intake-time auto-assign only touches `leads.assigned_to` — so `sales_executives`/`lead_assignments` reflect reality for exactly one moment (right after intake) and drift stale forever after. The Assignment Dashboard happens to still look correct only because it reads `leads.assigned_to` directly rather than the (now-stale) assignment tables (see §11).

#### Operation 6: Lead Score Update (initial + rescore)

```
Initial: score_node (Op 1) ──✅──▶ leads.score/score_value/score_reasons PATCH (no lead_score_history row)

Rescore:
RescoreButton                rescore.ts              FastAPI                    rescoring/service.py              Supabase
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
handleRescore ──✅──▶ runRescore() ──✅──▶ POST /rescore/{id} ──✅──▶ rescore_lead() ──✅──▶ leads PATCH (if changed)
                                                                              ├──✅──▶ lead_score_history INSERT (always)
                                                                              ├──✅──▶ score_events INSERT (always)
                                                                              ├──⚠──▶ bus.publish(LEAD_RESCORED) → Workflow re-run
                                                                              └──❌──▶ SSE 'rescore_complete' broadcast:
                                                                                       POSTs to SUPABASE_URL/events/rescore-complete
                                                                                       — no such Supabase REST route exists, always
                                                                                       fails, exception swallowed
```
✅ The manual "Re-score" button works fully (the calling tab gets its update from the direct HTTP response, not the broken broadcast). ❌ Any rescore triggered by something *other* than the manual button (stage change, WhatsApp reply, test-drive booked, call completed) updates the database correctly but never notifies any open browser tab — the toast-broadcast code path targets a URL that doesn't exist.

#### Operation 7: Follow-up Generation

```
FollowupCard          followup.ts / SSE          FastAPI                followup/graph.py                  Supabase
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
run() ──✅──▶ EventSource /followup/{id}/stream ──✅──▶ fetch_detail → decide_action → draft_message → write_nba
       (falls back to POST if SSE fails)                                        │
                                                                                 ├──✅──▶ lead_events INSERT (type='nba')
                                                                                 └──❌──▶ create_notification() → POST
                                                                                          /rest/v1/notifications — table
                                                                                          requires user_id NOT NULL, this
                                                                                          call never supplies it → every
                                                                                          insert violates the constraint →
                                                                                          exception silently swallowed
                                                                        ▼
                                                        finish() ──✅──▶ addLeadMessage() persists drafted message
```
⚠ Partially broken: NBA event and drafted message persist correctly; the assignee-notification record silently fails every single time due to a schema mismatch (see §3).

#### Operation 8: WhatsApp Messaging

```
WhatsAppSendCard        whatsapp.ts        FastAPI                  whatsapp/nodes.py              Provider selection            Supabase
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
handleSend ──✅──▶ sendWhatsAppMessage() ──✅──▶ POST /whatsapp/send/{id} ──✅──▶ load_context → send_message ──⚠──▶
                                              (tenant_id hardcoded to ABC_TENANT_ID)             _provider_for_tenant(): checks
                                                                                                  tenant's own connected channel
                                                                                                  first, else env WHATSAPP_PROVIDER
                                                                                                  (real Meta send, or Mock if no
                                                                                                  token) — any send failure falls
                                                                                                  back to Mock transparently, UI
                                                                                                  shows "Sent (fallback)" badge
                                                                                                        ▼
                                                                                          log_delivery_node ──✅──▶ lead_messages +
                                                                                                                     message_delivery_logs
```
✅ Outbound send + delivery-status ticks (sent→delivered→read) genuinely work, including a transparent, well-surfaced mock fallback on failure. ⚠ Because `tenant_id` is hardcoded, every dealer beyond the seed demo tenant is looked up against the demo tenant's channel connection, not their own. ❌ Inbound-reply live toast is broken by the same dead-SSE-broadcast issue as Op 6 (message itself still persists correctly — only the live notification is missing).

#### Operation 9: Call Intelligence — orphaned feature

```
Backend (fully implemented and correct)                              Frontend
──────────────────────────────────────────────────────────────────────────────────────────
POST /calls/upload ──✅──▶ background process_call() ──✅──▶            ❌ CallIntelligence component
  transcribe → extract → persist → handoff (all real)                    (DetailSections.tsx:125) is
                                                                           never imported by any route
```
❌ The entire feature — upload, transcription, AI analysis, timeline handoff — is fully built and correctly wired on the backend, but has **zero UI entry point**; `leads.$leadId.tsx` never renders the component that would call it. Separately: `transcribe.py`'s mock-transcript fallback triggers on *any* runtime failure (not just explicit `CALL_TRANSCRIBE_MODE=mock`) — a missing model download, missing ffmpeg, or corrupt audio silently substitutes a canned transcript with no flag distinguishing "real" from "faked" analysis anywhere in the data model.

#### Operation 10: Notifications — non-functional

```
AssignmentDashboard ──✅──▶ fetchNotifications() ──❌──▶ hardcoded `return []` always
                                                          (lib/assignments.ts:168-172, comment:
                                                           "No notifications table is wired yet")
```
❌ Cannot ever show anything, independent of the notifications-insert bug in Op 7 — there is no working write-then-read loop for notifications anywhere in the product.

#### Operation 11: Lead Messages / Tasks

✅ Messages: real, RLS-safe (anon-key client), fully working, UI-reachable.
❌ Tasks: `TasksPanel` is fully built and RLS-safe/functional on the backend, but — like Call Intelligence — is never imported by `leads.$leadId.tsx`. No user can create or complete a lead task through the product today.

#### Operation 12: Domain Events

✅ Real, persisted, retried backend pub/sub driving Workflow-Agent triggering and rescoring triggers. ❌ No frontend anywhere reads `GET /events` or subscribes to `domain_events` — purely backend-to-backend, by design, not a bug.

### 1.2 Lead Management — Summary Table

| # | Operation | API reached | Supabase reached | Live UI refresh | Verdict |
|---|---|---|---|---|---|
| 1–2 | Create Lead | ✅ | ✔ Stored | ✅ SSE | ✅ Working |
| 3 | "Update Lead" | — | — | — | N/A, not a real feature |
| 4 | Move stage | ✅ | ✔ Stored | ✅ SSE | ✅ Working |
| 5 | Assign Lead | ⚠ dead second path | ✔/⚠ partial (assignment tables stale after intake) | ✅ local only | ⚠ Real dead-code bug |
| 6 | Score — initial | ✅ | ✔ Stored | ✅ | ✅ Working |
| 6 | Score — rescore | ✅ | ✔ Stored | ⚠ manual-trigger tab only | ⚠ Broken broadcast |
| 7 | Follow-up | ✅ | ⚠ partial (notification insert fails) | ✅ calling tab | ⚠ Partially broken |
| 8 | WhatsApp send | ✅ | ✔ Stored | ⚠ inbound toast broken | ⚠ Partially broken |
| 9 | Call Intelligence | ✅ backend only | ✔ if invoked / never invoked in practice | ❌ no entry point | ❌ Orphaned |
| 10 | Notifications | ✅ backend exists | ✖ Not stored | ❌ | ❌ Non-functional |
| 11 | Messages | ✅ direct Supabase | ✔ Stored | ✅ | ✅ Working |
| 11 | Tasks | ✅ direct Supabase | ✔ Stored | ❌ no entry point | ❌ Orphaned |
| 12 | Domain events | ✅ | ✔ Stored | ❌ no consumer | ✅ Working as designed (backend-only) |

### 1.3 Marketing

#### Operation 1: Campaign Creation

```
campaign-planner.tsx      marketing.ts            FastAPI                     campaign_planning.py            Supabase
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
"New Campaign" ──✅──▶ generateCampaignPlan() ──✅──▶ POST /marketing/campaigns/plan ──✅──▶ 5-node LangGraph
                       (marketing.ts:1598)             (real Claude/Grok theme planning)
                              ▼
                       createCampaignFromPlan() ──✅──▶ upsertCampaign(-Days) → /db/campaigns/* ──✅──▶ campaigns,
                              │                                                                          campaign_days
                              ▼
                       fetchBatchContent() ──✅──▶ /marketing/content/batch ──✅──▶ content_generation.py (real LLM)
```
✅ Working, real AI-driven planning and persistence. ⚠ A second, non-AI `createCampaign` path exists behind two dialogs (`NewCampaignDialog`, `QuickCampaignDialog`) that are imported by zero routes — dead but harmless.

#### Operation 2: Campaign Management / Status Changes

No pause/resume/edit feature exists anywhere in the product (confirmed by full-tree search) — the only lifecycle actions are hard **Delete** and content-level **Approve/Reject/Publish** (Operation 5). This is a scope gap against the audit's own premise, not a hidden bug.

#### Operation 3: Content Studio — Poster/Caption Generation

```
content-studio.tsx        marketing.ts               FastAPI                                  Supabase / Storage
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
handleGenerate ──✅──▶ generateDayContent() ──✅──▶ /marketing/content/batch ──✅──▶ campaign_days/opportunities
handleGeneratePoster ──✅──▶ generatePosterImage() ──✅──▶ /marketing/poster/banner ──✅──▶ real Gemini image
                                                            (build_poster_prompt + gemini_image)   composite → Storage
                                                                                                    bucket `posters`
handleApprove ──✅──▶ approveCampaign/Event() ──✅──▶ /db/publishing/approve-* ──✅──▶ queued for Publishing
```
✅ Content and poster generation work and persist for real. ❌ **Critical gap**: `brand_compliance.py`'s compliance agent is wired to two FastAPI endpoints, and the frontend has its own duplicate rule-based compliance check (`runCompliance` in `marketing.ts`) — **neither is ever called from any UI component**. Content flows generation → approval → scheduling → publish with **zero compliance gate actually enforced**, despite the feature existing and looking "done" in the codebase. A second, disabled `/marketing/poster/generate` endpoint (docstring: "always returns None") sits confusingly next to the real `/poster/banner` one.

#### Operation 4: Media Library

✅ Upload and hard-delete are real (Supabase Storage bucket `media`, RLS-scoped). ⚠ The "Trash" UI state is client-memory-only — reloading before "Empty Trash" silently un-deletes the item from the user's perspective (nothing was ever removed server-side).

#### Operation 5: Publishing / Multi-Channel Fan-Out

```
PATH A (scheduled, actually runs unattended) ──✅
main.py startup → auto_publisher.run_loop() (every 60s) → publishing_agent.py (REAL 7-node
ReAct agent) → publish_{linkedin,youtube,instagram,facebook}_tool → real Graph/LinkedIn/
YouTube API calls → status='published' only if ≥1 channel succeeded (correct, conservative)

PATH B (manual "Publish Now" button) ──⚠
publishGroupToConnected() → POST /api/publish → same real per-channel services, BUT the
frontend then unconditionally calls publishCampaignDb/publishEventDb regardless of outcome
— a post that fails on every channel still gets marked "Published" in the UI

PATH C (mock agent, dead from the product's perspective but live on the wire) ──❌
app/agents/publishing.py (explicit mock) is wired to a real, working POST
/marketing/agents/publish endpoint. Zero frontend callers, but reachable by anyone who
hits the endpoint directly (Swagger/curl/future integration) and gets a fake "success".
```
⚠/❌ The scheduled path is solid; the manual path has a status-semantics bug that misleads users about real publish outcomes; a live mock endpoint sits unused but reachable. `facebook_service.py`'s "not yet implemented" claim is stale — the real, working Facebook/Instagram publishing lives in the similarly-named `facebook.py`/`instagram.py`, easy to confuse during a review.

#### Operation 6: Connected Channels

```
channels.tsx ──✅──▶ getChannelStatus() ──✅──▶ GET /api/channels ──✅──▶ channel_store (real read)
   (falls back to MOCK_CHANNEL_STATUS on error OR on a legitimately-empty tenant — misleading fallback naming, not a functional bug)

Instagram/Facebook/LinkedIn/YouTube connect-callback flows ──✅ all persist real tokens to social_channel_connections

WhatsApp connect/disconnect ──❌ CRITICAL BUG
whatsapp_channel.py calls channel_store.upsert/get/update WITHOUT `await` on async
functions — the coroutine is created but never executed. The API returns
{"status":"success"} to the UI, but the write to Supabase never happens. On reload,
WhatsApp always shows disconnected. disconnect() similarly never fires (the "not found"
guard is always falsy because a coroutine object is always truthy).
```
❌ WhatsApp channel connection is completely broken — this is the single clearest outright bug found in the whole audit (see §3). Everything else in Connected Channels works.

#### Operation 7–8: Budget Planner / Marketing Strategy

✅ Both are real, stateless (request/response only, no persistence of the plan itself — this is by design, matches the task's own framing), reading real upstream `company_summaries`/`generated_reports` data with a documented deterministic fallback when no LLM key is present.

#### Operation 9: SEO / AEO Analysis

✅ Real fire-and-forget background analysis with client-side polling (not SSE, despite a fully-built SSE endpoint existing and being completely unused by the frontend — dead but harmless). Persists to `seo_analyses`/`aeo_analyses`.

#### Operation 10: Company Summary, Website Extraction, Recommendation Engine, Report Generator

✅ Full pipeline confirmed genuinely wired end-to-end — every downstream stage reads its stated upstream table for real (no stub data anywhere in this chain).

#### Operation 11: Analytics Pollers

✅ LinkedIn/Instagram background pollers are started at FastAPI startup (via the deprecated `@app.on_event("startup")` API rather than the modern `lifespan` context manager — a maintenance smell, not a bug) and the dashboard genuinely displays their stored snapshots, not a live call.

#### Operation 12: Marketing Copilot

✅ Real, reachable via its own page. A duplicate rule-based `marketingCopilot` function in `marketing.ts` is dead code (zero callers) — same "two implementations, one orphaned" pattern seen repeatedly in this module.

### 1.4 Marketing — Summary Table

| # | Operation | API reached | Supabase reached | Live UI refresh | Verdict |
|---|---|---|---|---|---|
| 1 | Campaign creation | ✅ | ✔ Stored | ✅ | ✅ Working |
| 2 | Campaign mgmt/status | ✅ (delete only) | ✔ Stored | ✅ | ⚠ No pause/resume/edit exists |
| 3 | Content Studio | ✅ | ✔ Stored | ✅ | ⚠ Compliance gate never runs |
| 4 | Media Library | ✅ | ✔ Stored / ✖ trash | ✅ | ⚠ Trash UX mismatch |
| 5 | Publishing | ✅ | ✔ Stored | ⚠ | ⚠/❌ Manual path always marks Published |
| 6 | Connected Channels | ✅ (5/6) | ✔ Stored (5/6) / ✖ WhatsApp | ✅ (except WhatsApp) | ❌ WhatsApp broken |
| 7 | Budget Planner | ✅ | ✖ stateless by design | ✅ | ✅ Working |
| 8 | Marketing Strategy | ✅ | ✖ stateless by design | ✅ | ✅ Working |
| 9 | SEO/AEO | ✅ | ✔ Stored | ✅ | ✅ Working |
| 10 | Summary/Extraction/Rec/Report | ✅ | ✔ Stored (all stages) | ✅ | ✅ Working |
| 11 | Analytics pollers | ✅ | ✔ Stored | ✅ | ✅ Working |
| 12 | Marketing Copilot | ✅ | ✖ stateless | ✅ | ✅ Working |

---

## 2. Production Readiness Review

| Category | Rating | Notes |
|---|---|---|
| Architecture | ⚠ Fair | Genuinely good patterns in places (LangGraph agent decomposition, fire-and-forget+SSE/poll for long analyses, deterministic LLM fallbacks, sound RLS schema design) undermined by the FastAPI layer's wholesale service-key/RLS-bypass design (§13) and several duplicated/parallel implementations of the same feature (§11). |
| Folder structure | ✅ Good | Clear `apps/web` / `apps/api` split; agent-per-directory convention is easy to navigate once understood. |
| Separation of concerns | ⚠ Fair | Thin-BFF principle (CLAUDE.md) is followed by most `lib/*.ts` proxy functions, but several files (`leads.ts`, `marketing.ts`) mix direct-Supabase reads with FastAPI proxy calls inconsistently, and `db.py`'s untyped dict-based endpoints blur validation responsibility. |
| Error handling | ⚠ Needs Attention | No centralized exception handler; at least 4 different error-response shapes in production (§8); several endpoints (`/intake/leads`, `/whatsapp/send/{id}`, all of `marketing.py`'s LLM endpoints) have zero try/except at all. |
| Logging | ✅ Good | Consistent `logger.exception(...)` usage everywhere a catch exists; no raw secrets found logged. |
| Exception handling | ⚠ Needs Attention | Same as Error handling — inconsistent across ~170 files, "never raises" is a real, mostly-followed convention but has real exceptions (§2 cross-cutting notes). |
| Loading states | ✅ Good | SSE/polling patterns for long-running agents are well-implemented where wired up. |
| Empty states | ⚠ Fair | `DocumentsPanel`'s explicit "coming soon" placeholder is honest; several other "empty" states (Notifications, MOCK_CHANNEL_STATUS) are actually silent failures rather than genuine empty states. |
| Retry mechanisms | ⚠ Fair | Domain event bus has real retry/backoff (`EVENT_MAX_RETRIES`/`EVENT_RETRY_BACKOFF_MS`); LLM fallback ladders (Claude→Groq→NVIDIA→deterministic) are a strong pattern; no retry on the broken SSE broadcasts or the WhatsApp channel-store await bug (because those aren't recognized as failures at all — see §3). |
| Security | ❌ Critical | See §13 — systemic. |
| Validation | ⚠ Needs Attention | Pydantic models used on most Lead Management/Marketing endpoints, but with no format/length constraints; `db.py` accepts fully untyped `dict`/`list` bodies. |
| Authentication | ❌ Critical | No JWT verification anywhere in FastAPI except a partial, fail-open implementation in one router (§13). |
| Authorization | ❌ Critical | No role/permission checks found on any Lead Management or Marketing endpoint. |
| Multi-tenancy | ❌ Critical | `tenant_id` is caller-supplied and unverified on nearly every marketing/analytics endpoint; hardcoded to a single demo tenant on the lead-core endpoints (§13). |
| Rate limiting | ❌ Missing | No rate-limiting library or middleware anywhere in `apps/api`. |
| Configuration | ⚠ Needs Attention | Silent-failure risk: `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` default to `""`/`None` with no startup validation, duplicated independently across ~19 files. |
| Environment variables | ⚠ Needs Attention | Reasonable defaults for LLM keys (intentional, documented degrade-to-deterministic); unreasonable silent defaults for tenant/location IDs and Supabase credentials. |
| Scalability | ⚠ Needs Attention | `uvicorn --workers 2` for the whole API; unbounded full-table fetches (Kanban board, marketing analytics); several LLM calls with up to 360s timeouts block a shared thread pool with no rate limit. |
| Maintainability | ⚠ Fair | Real technical debt from parallel/duplicate implementations (two Instagram OAuth flows, two publishing agents, two assignLead functions, channel metadata copy-pasted 6×, stage taxonomy duplicated 4× and already diverging) — all catalogued in §3/§11. |

---

## 3. Broken Code Detection

Only genuinely broken/dead/mock/duplicated code is listed; "intentional, documented" stubs (e.g. `DocumentsPanel`'s honest placeholder, the deterministic LLM fallbacks) are noted for context but not flagged as defects.

| File | Reason | Severity | Recommendation |
|---|---|---|---|
| `apps/api/app/routers/whatsapp_channel.py:66,90,93` | Calls async `channel_store.upsert/get/update` **without `await`** — the coroutine is created but never runs. WhatsApp connect/disconnect silently never persists to Supabase despite returning `{"status":"success"}`. `disconnect()`'s "not found" check is always false (a coroutine object is always truthy). | **Critical** | Add `await` to all three calls; add a regression test asserting a connection row actually exists after `/connect`. |
| `apps/api/agents/followup/data.py:95-101` vs `supabase/migrations/0004_notifications_audit.sql:5-13` | `create_notification()` never supplies `user_id`, which the `notifications` table requires (`NOT NULL`, no default). Every insert violates the constraint; the exception is swallowed in `agents/followup/graph.py:239-251`, so `assignee_notified` is always `False`. | **High** | Either add `user_id` to the insert (resolve the assignee's user id) or make the column nullable if truly optional; stop swallowing the exception silently — log it distinctly from "no assignee" cases. |
| `apps/api/main.py:1139-1147` (`_handle_inbound_message`) and `apps/api/agents/rescoring/service.py:322-339` (`rescore_lead` step 6) | Both POST to `SUPABASE_URL/events/whatsapp-inbound` / `/events/rescore-complete` — a Supabase project has no such REST route. Always fails, caught by a bare `except Exception: logger.warning(...)`. The equivalent, working pattern (`_handle_delivery_status`, `main.py:1091`) calls the in-process `_broadcast_*` helper directly — these two paths never do. | **High** | Call the in-process broadcast helper directly (as `_handle_delivery_status` does) instead of POSTing to a nonexistent external URL. |
| `apps/web/src/lib/leads.ts:174-187` vs `apps/web/src/lib/assignments.ts:174-183,185,196` | Two functions named `assignLead` with different signatures/backing stores. The `lib/assignments.ts` version (plus its siblings `completeLead`/`deactivateExecutive`) proxies to a fully-working FastAPI assignment-agent API with **zero callers anywhere in the frontend** — every real assignment bypasses `sales_executives`/`lead_assignments`/`assignment_notifications` after the initial intake auto-assign. | **High** | Decide which system is canonical; either wire the UI to call the real assignment-agent endpoints (recommended, since it's the only path that keeps `sales_executives.current_lead_count` accurate) or delete the dead path and rename to remove the collision risk. |
| `apps/web/src/lib/assignments.ts:168-172` | `fetchNotifications` hardcoded to `return [] as any[]`; `fetchDashboardStats` hardcodes `total_completions: 0, unread_notifications: 0, executives: []`. The Assignment Dashboard's notification panel and several stat tiles are permanently empty/zero regardless of real state. | **Medium** | Wire to the real `notifications`/assignment tables once the above bugs are fixed, or clearly label these tiles as "not yet available" instead of showing misleading zeros. |
| `apps/web/src/components/leads/DetailSections.tsx` — `CallHistory` (:23), `CallIntelligence` (:125), `TasksPanel` (:407) | Fully-built, backend-wired features never imported by `leads.$leadId.tsx` (only `MessagesPanel`/`ScoreHistoryPanel` are rendered). Call Intelligence in particular represents a complete upload→transcribe→analyze pipeline that no user can reach. | **High** | Product/eng decision needed: wire back into the lead detail page, or remove to stop the code from misrepresenting what's shipped. |
| `apps/web/src/components/leads/EventComposer.tsx`, `NextBestAction.tsx` (component export only — `compactNextAction` is used), `CustomerLeadStatus.tsx` | Zero importers anywhere in the app. | **Low** | Remove or wire up; low risk either way but currently pure dead weight. |
| `apps/api/agents/assignment/database.py:84,155` | Hand-rolled string-matching SQL dispatcher; `NotImplementedError` branches aren't hit today (confirmed all current call sites match a whitelisted prefix) but any future edit to the literal SQL text in `agent.py`/`seeding.py` not mirrored here will silently raise at runtime with no compile-time warning. | **Medium** | Replace with a real parameterized query interface, or at minimum add a test that exercises every literal SQL string this dispatcher must recognize. |
| `apps/web/src/components/PlaceholderPage.tsx` | Zero importers anywhere — fully dead code (contradicts the plan's initial scoping assumption that it was a reachable "coming soon" stub). | **Low** | Delete, or confirm it's intentionally kept for near-future use. |
| `apps/api/app/services/facebook_service.py` | Entire file is a stale "not yet implemented" placeholder with zero callers. The real, working Facebook/Instagram publish logic lives in the similarly-named `app/services/facebook.py`/`instagram.py`. Easy to misdiagnose "Facebook publishing isn't implemented" during a future review. | **Medium** | Delete the file, or add a prominent `# UNUSED — see facebook.py` header. |
| `apps/api/app/agents/publishing.py` + `apps/api/app/routers/marketing.py:28,284-301` | Explicitly-labeled mock publishing agent wired to a live, working `POST /api/marketing/agents/publish` endpoint with zero frontend callers — reachable by anyone hitting the endpoint directly and would silently return fake success. | **Medium** | Remove the mock wiring from the router, or gate it behind an explicit `/debug` prefix. |
| `apps/web/src/lib/marketing.ts` — **25 confirmed-dead exports**: `getMonthPlan` (:107), `getRecommendedCampaigns` (:126), `getMarketingOverview` (:139), `getCampaignPosts` (:791), `getCampaign` (:803), `getContentCalendar` (:818), `getApprovalQueue` (:833), `getCampaignScorecard` (:848), `marketingCopilot` (:861), `runCompliance` (:980 — only "usage" is a code comment, not a real import), `submitForApproval` (:1002), `approvePost` (:1006 — same, comment-only), `rejectPost` (:1014), `requestChangesPost` (:1018), `schedulePost` (:1022), `publishPost` (:1027), `getPublishingQueue` (:1031), `getPublishedLog` (:1046), `publishToConnectedChannels` (:1478), `publishCampaign` (:2200), `publishEvent` (:2230), `snapshotCampaignPlannerPage` (:2275), `queryCampaignAnalytics` (:2331), `suggestCampaignHashtags` (:2367 — a same-named but differently-implemented function in `lib/anthropic.server.ts:169` is what's actually used) | An entire earlier generation of the publish/approval workflow (built on `campaign_posts`) was superseded by the current group-based system but never deleted; verified via per-symbol grep across all of `apps/web/src` with manual false-positive filtering (comment mentions, name collisions across files were excluded). | **Medium** | Delete dead exports; they add real cognitive load for anyone onboarding onto this module. |
| `apps/web/src/routes/_authed/marketing.content-studio.tsx` / `apps/api/app/agents/brand_compliance.py` + `marketing.ts:980-993` (`runCompliance`) | Compliance checking is fully implemented twice (Python agent + a hand-rolled frontend duplicate) and **never invoked from any UI path**. Content publishes with zero compliance gate despite the feature existing. | **High** | Wire the compliance check into the content-approval or publish flow before this ships; decide which of the two implementations is canonical and delete the other. |
| `apps/web/src/routes/_authed/channels.tsx:352` | `handleConnect()` for `google_business`/`x`/`telegram`/`threads` does a raw `alert("... coming soon.")` with no backend call — a real dead button in a shipped page (the channel tiles for these are otherwise rendered identically to working ones). | **Low** | Either implement, or visibly disable/gray out these channel tiles instead of presenting a live-looking Connect button. |
| `apps/web/src/routes/_authed/leads.new.tsx:70` | A `notes` field is defined in component state, never rendered as an input, never included in the `submitLead()` payload. | **Low** | Remove the vestigial state, or wire it to an actual textarea if the intent was to collect notes. |
| Duplicated stage taxonomy — `apps/api/main.py:116`, `apps/web/src/lib/types.ts:122-123`, `apps/web/src/routes/_authed/leads.$leadId.tsx:1035`, `apps/web/src/components/leads/CustomerLeadStatus.tsx:17-19` | Four independent hardcoded "which stages count as closed/terminal" lists, and they **already disagree** on whether `booked` and `delivered` count as terminal. | **Medium** | Define `OPEN_STAGES`/`CLOSED_STAGES`/`WON_STAGES` once in a shared module both frontend and backend can reference (or at least cross-reference in comments), and resolve the `booked`/`delivered` inconsistency deliberately. |
| Channel metadata duplicated 6× — `channels.tsx:33-42`, `marketing.publishing.tsx:26-33`, `ChannelFilter.tsx:5-12`, `ChannelIcon.tsx`, `AnalyticsSections.tsx:20-22`, `AnalyticsCharts.tsx:10-20` | Labels and colors already disagree between copies (e.g. "WhatsApp Business" vs "WhatsApp"; Instagram `#DD2A7B` vs `#E1306C`; X/Twitter `#000000` vs `#111111`). | **Low-Medium** | Extract one shared `lib/channels.ts` constant and import everywhere. |

---

## 4. UI Integrity Audit

- **Dead buttons found:** `channels.tsx:352`'s `alert()`-only Connect button for 4 unimplemented channels (see §3).
- **Fully-built-but-unreachable pages/panels:** Call Intelligence, Tasks, and the Documents placeholder's siblings on the lead detail page; `CustomerLeadStatus`/`EventComposer` components. These aren't "broken buttons" so much as entire feature surfaces with no navigation path to them at all — a user cannot discover them exist.
- **Forms:** the lead-detail and intake forms were traced and correctly call their backing mutations; `leads.new.tsx`'s unused `notes` field is the one exception (§3).
- **Tables/Filters/Sorting/Search/Pagination:** the Kanban board and lead table have no pagination and fetch the entire `leads` table unbounded (§12) — this is a performance/scalability finding, not a broken-UI finding; the controls that do exist (stage filters, search) were not found to be non-functional.
- **Dialogs:** `NewCampaignDialog`/`QuickCampaignDialog` are fully functional dialogs that are simply never opened by any route (dead, not broken).
- **Loading/error states:** SSE/poll-driven pages (SEO/AEO, website extraction, recommendation engine, report generator) correctly show loading states during background processing.
- **State updates / navigation:** no broken routing or circular-import issues were found in the audited directories (Agent D verified every import target resolves to a real export).
- **Responsive layout / accessibility:** out of scope for this static-code-only pass — would require actual rendering/browser testing, which the user's chosen verification method (static only) excludes. Flagged as unverified, not as passing or failing.
- **Misleading empty/mock states:** `MOCK_CHANNEL_STATUS` triggers both on real API failure and on a legitimately-brand-new tenant with zero connections — conflating "the backend is down" with "you haven't connected anything yet" behind the same fallback data (§3, low-medium severity, not actively deceptive since the mock content itself is all-`disconnected`, but it does mask real outages).

---

## 5. Data Flow Verification

For every operation in §1, exactly where data flow stops (if it does) is called out in that section's diagram. Summarizing the stop-points found:

| Operation | Where it stops | Why |
|---|---|---|
| Rescore (non-manual triggers) | Between the successful DB write and the browser | SSE broadcast POSTs to a nonexistent Supabase REST route |
| Follow-up notification | At the `notifications` INSERT | Missing required `user_id`, NOT NULL violation, swallowed |
| WhatsApp inbound reply | Between the successful `lead_messages` insert and the browser | Same broken SSE broadcast pattern as rescore |
| WhatsApp channel connect/disconnect | At the Supabase write itself | Missing `await` — the write never executes at all |
| Lead assignment (post-intake) | At the UI layer | The UI only calls the shallow direct-Supabase assign path; the real assignment-agent endpoint that updates `sales_executives`/`lead_assignments` is never invoked |
| Notifications (dashboard) | At the read | `fetchNotifications` is a hardcoded stub, independent of whether anything is actually in the table |
| Call Intelligence / Tasks | At the UI layer | Components exist and are wired correctly to real backends, but are never rendered/imported by any route |
| Content compliance check | Before it ever starts | The compliance agent/endpoint is never called from any UI path |
| Manual "Publish Now" status | Between the real per-channel result and the persisted status | Frontend always marks the group "Published" regardless of actual per-channel success |
| Media Library "Trash" | At the client | Deletion is only reflected in local React state until "Empty Trash" is explicitly clicked |

---

## 6. Supabase Audit

- **Tables/relationships:** 51 migrations reviewed at the scoping level; the RLS-relevant subset (leads: `0005-0009,0013,0016,0018-0028`; marketing: `0010,0036-0044,0048,0051`) was read in full by the security agent.
- **RLS:** **No gap found.** Every table introduced across the audited migrations has `enable row level security` **and** a matching tenant-scoped policy. The one exception, `marketing_budget_benchmarks` (0048, `select ... using (true)`), is deliberate, documented global reference data with no `tenant_id` column — correctly not a gap. Storage RLS for the `media` bucket (0051) is correctly tenant-folder-scoped, closing a genuine prior gap left open by 0050.
- **Policies:** core plumbing (`tenant_id()`/`user_role()` SQL functions, the JWT custom-claims hook, and its `SECURITY DEFINER` `auth.uid()`-based fallback for hosted Supabase without the custom-hook feature) is sound and defensively hardened (`0026` pins `search_path` per a Supabase advisor finding).
- **The gap is not in the RLS design — it's that the FastAPI layer never uses a role that RLS applies to.** Every one of ~170 Python data-access files uses `SUPABASE_SERVICE_KEY`, which bypasses RLS by definition. See §13 for full detail; this is the single most consequential finding of the whole audit and it sits exactly at the Supabase/FastAPI boundary.
- **Missing inserts/updates/deletes / silent failures identified:** the WhatsApp channel-store missing-`await` bug, the `notifications` NOT NULL violation, and the two broken SSE-broadcast paths (§3) are the concrete instances found of "an operation that should reach Supabase but silently doesn't" (or, for the SSE cases, reaches an unrelated system rather than the browser).
- **Data consistency risk:** `sales_executives`/`lead_assignments` drifting stale from actual lead ownership (§1.1 Op 5) is a genuine, ongoing data-consistency issue, not a one-time bug.
- **Race conditions:** not directly evaluated under static-only verification (would require load/concurrency testing); no obvious missing-lock pattern was flagged by any of the five research passes.

---

## 7. Cloud Persistence Verification

| Business action | Status |
|---|---|
| Lead created (website + internal) | ✔ Stored |
| Lead stage changed | ✔ Stored |
| Lead assigned (initial, intake-time) | ✔ Stored |
| Lead assigned (any subsequent manual reassignment) | ⚠ Partially stored (leads.assigned_to only; assignment-agent tables never updated) |
| Lead score (initial + rescore) | ✔ Stored |
| Follow-up NBA event + drafted message | ✔ Stored |
| Follow-up assignee notification | ✖ Not stored (constraint violation, silently swallowed) |
| WhatsApp outbound message + delivery log | ✔ Stored |
| WhatsApp channel connection (connect/disconnect) | ✖ Not stored (missing `await` bug) |
| Call recording, transcript, analysis | ✔ Stored *if the endpoint is ever hit* — but the feature has no UI entry point, so in practice this is never exercised by a real user |
| Lead task create/complete | ✔ Stored (same caveat — feature has no UI entry point) |
| Notifications (assignment) | ✖ Not stored |
| Campaign creation, campaign days, generated content | ✔ Stored |
| Poster/banner images | ✔ Stored (Supabase Storage) |
| Media library upload / hard delete | ✔ Stored |
| Media library soft-delete ("Trash") | ✖ Not stored (client-memory only) |
| Multi-channel publish (scheduled path) | ✔ Stored, with accurate per-channel status |
| Multi-channel publish (manual "Publish Now") | ⚠ Partially accurate (always marked Published regardless of real outcome) |
| Connected-channel OAuth tokens (Instagram/Facebook/LinkedIn/YouTube) | ✔ Stored |
| Budget plan / marketing strategy output | ✖ Not stored (stateless by design, not a bug) |
| SEO/AEO analyses, website extraction, recommendations, generated reports | ✔ Stored (every stage) |
| LinkedIn/Instagram analytics poller snapshots | ✔ Stored |
| Domain events (backend observability) | ✔ Stored |

---

## 8. API Audit

- **HTTP methods:** conventional and correct throughout (GET for reads, POST for actions/creates, PATCH implied via Supabase `.update()` on the direct-access paths, DELETE for the one delete endpoint found).
- **Validation:** inconsistent. `IntakeLeadRequest` and most marketing routers use real Pydantic models (typed, but no format/length constraints — phone/email are plain `str | None`); `apps/api/app/routers/db.py` accepts fully untyped `dict`/`list` bodies for nearly every mutation (campaigns, campaign-days, opportunities, publishing actions, assets) — a malformed payload only surfaces as an uncaught `KeyError` → generic 500.
- **Error handling / status codes:** **at least four different error-response shapes ship in production** — `{"error": str(e)}` via `JSONResponse(500)` in most of `main.py`; FastAPI's native `{"detail": ...}` shape from `HTTPException` in the Phase-N routers; and, uniquely in `app/routers/assignments.py`, **failures returned as HTTP 200 with `{"success": false, "message": ...}`** — meaning a caller that only checks the status code (rather than parsing the body) will treat a failed assign/complete/deactivate as a success. Several endpoints have no try/except at all and will surface FastAPI's bare default 500 or an uncaught traceback under `--reload` (`/intake/leads`, `/whatsapp/send/{id}`, every LLM endpoint in `app/routers/marketing.py`, `/events`, `company_summary`'s `create_summary`, the `/calls/*` read endpoints).
- **Authentication/Authorization:** see §13 — effectively absent except for a partial, fail-open implementation in `assignments.py`.
- **Duplicate endpoints:** `/marketing/poster/generate` (disabled) vs `/marketing/poster/banner` (real); `/api/instagram/connect` (orphaned) vs `/auth/instagram/login` (used); `/marketing/agents/publish` (mock, live but unused) vs `/api/publish` (real, used).
- **Unused endpoints:** the assignment-agent trio (`/api/assign-lead`, `/api/complete-lead`, `/api/deactivate-executive`) is fully implemented and correct but has zero frontend callers; `/api/instagram/connect`+`/callback` (superseded by `auth.py`'s version); `/marketing/agents/publish`, `/marketing/agents/compliance`, `/marketing/compliance/check`; `GET /seo-agent/analyses/stream` and its AEO equivalent.
- **Missing endpoints:** no generic "edit lead" or campaign pause/resume/edit endpoints exist, matching the UI gaps noted in §1.
- **Timeout handling:** no request-level timeout is configured anywhere (`uvicorn` runs with no `--timeout-keep-alive` tuning); the only bound on a slow request is the sum of per-provider LLM client timeouts, which for poster/banner generation can reach ~360 seconds (two sequential Gemini model attempts at 180s each) with the calling frontend `fetch()` setting no `AbortController`/timeout of its own.
- **Consistency:** CORS is configured once, globally, as `allow_origins=["*"]` with a comment justifying it for local dev only — none of the four checked deploy configs (`Dockerfile.railway`, `railway.json`, `render.yaml`, `docker-compose.yml`) override it for production.

---

## 9. Frontend Audit

- **Unused pages:** none found as standalone routes (the dead components in §3 are sub-components of pages that do render, not entire unused route files) — except that `PlaceholderPage.tsx` is a component with zero route usage at all.
- **Unused components (entire files with zero importers, verified by per-symbol grep across all of `apps/web/src`):** `components/leads/CustomerLeadStatus.tsx` (152 ln, both `CustomerLeadStatus`/`CustomerActivity` exports dead), `components/leads/EventComposer.tsx` (81 ln), `components/marketing/NewCampaignDialog.tsx` (216 ln), `components/marketing/QuickCampaignDialog.tsx` (155 ln), plus `CallHistory`/`CallIntelligence`/`TasksPanel`/`DocumentsPanel` (unused exports within the otherwise-live `DetailSections.tsx`), `NextBestAction` (component export — only the sibling `compactNextAction` from the same file is actually used), and `PlaceholderPage` — eleven confirmed dead/orphaned components.
- **Unused API calls / dead server functions:** **25 dead exports in `lib/marketing.ts`** alone (the entire superseded publish/approval generation — `getMonthPlan`, `getRecommendedCampaigns`, `getMarketingOverview`, `getCampaignPosts`, `getCampaign`, `getContentCalendar`, `getApprovalQueue`, `getCampaignScorecard`, `marketingCopilot`, `runCompliance`, `submitForApproval`, `approvePost`, `rejectPost`, `requestChangesPost`, `schedulePost`, `publishPost`, `getPublishingQueue`, `getPublishedLog`, `publishToConnectedChannels`, `publishCampaign`, `publishEvent`, `snapshotCampaignPlannerPage`, `queryCampaignAnalytics`, `suggestCampaignHashtags`, plus 2 dead-internal types), 3 in `lib/assignments.ts` (`assignLead`/`completeLead`/`deactivateExecutive`), plus the `lib/calls.ts` wrapper (whose only consumer is the orphaned `CallIntelligence` component) and a scattering of type-only exports never used outside their own file (`VoiceProviderId`/`VoiceCallbacks`/`VoiceStartOptions`/`VoiceProvider` in `voiceInput.ts`, `CheckStatus`/`ScoreTone` in `analysis-ui.tsx`, `PRIORITY_META` in `lead-ui.tsx`) — roughly **30 dead exports** total across the two modules, verified with false-positive filtering (excluding comment-only mentions and same-named-but-different functions in other files).
- **State management issues:** the Media Library "Trash" client-only state is the one confirmed state/persistence mismatch found (§3/§4).
- **Memory leaks / rendering issues / large unnecessary re-renders:** not directly evaluated — would require runtime profiling, outside this audit's static-only method; not flagged as passing or failing.
- **Improper loading logic:** none found beyond what's noted in §1/§4.
- **Broken routing:** none found — all traced imports resolve correctly (Agent D verified this explicitly across both modules' directories).
- **Console/runtime errors:** not evaluated under static-only verification (would require actually running the app in a browser); a prior, separate session in this same conversation did smoke-test the app's login page live and found zero console errors there, but that check did not cover the authenticated Lead Management/Marketing screens this audit focuses on.
- **Test coverage:** exactly **one** frontend test file exists in the entire repo (`BudgetPlannerPage.test.tsx`). Every other component and route touched by this audit — `leads.index.tsx` (319 ln), `leads.$leadId.tsx` (1287 ln), `KanbanBoard.tsx`, `AssignmentDashboard.tsx`, `marketing.content-studio.tsx` (1887 ln), `marketing.campaign-planner.tsx` (486 ln), and every other Lead Management/Marketing page — has zero tests. `vitest` is configured and runnable (`npm run test`), it's simply never applied to this code, and nothing in the deploy pipeline (`vercel.json`) runs it as a gate.

---

## 10. Integration Audit

| Integration | Status | Notes |
|---|---|---|
| Frontend ↔ FastAPI | ⚠ | Functionally wired correctly for every path traced in §1, but with no auth token verification on the receiving end for ~95% of endpoints (§13), and 4 inconsistent error-response shapes (§8). |
| FastAPI ↔ Services | ✅ | The service-layer decomposition (agents/*/service.py as the integration surface for graphs) is clean and consistently applied. |
| Services ↔ LangGraph | ✅ | Every agent graph traced (intake, scoring, assignment, rescoring, followup, call intelligence, campaign planning, content generation, SEO/AEO, recommendation engine, report generator, publishing) is real, not a stub, and correctly wired to its service layer. |
| Services ↔ Supabase | ❌ | Systemically uses the service-role key rather than the caller's JWT — see §13. This is the integration point where the RLS design (sound) meets the FastAPI implementation (bypasses it entirely). |
| Realtime updates | ⚠ | Two independent realtime mechanisms exist: an older `_sse_clients` broadcast set (used correctly for new-lead/stage-change/whatsapp-delivery-status) and the domain-event bus (backend-only, no frontend consumer). Two of the SSE broadcast call sites (whatsapp-inbound, rescore-complete) are broken by construction (§3). |
| Authentication | ❌ | See §13 — the frontend's Supabase session auth is solid; it just doesn't extend meaningfully into FastAPI. |
| Marketing services | ⚠ | Real for the scheduled publish path and every content-generation/analysis pipeline; broken specifically for WhatsApp channel connection and the manual-publish status semantics. |
| Lead services | ⚠ | Real for intake/scoring/stage-change/messages; broken specifically for the parallel assignment-agent path, notifications, two SSE broadcasts, and unreachable for Call Intelligence/Tasks. |
| AI Agents | ✅ | Every agent graph checked is a genuine, working LangGraph implementation with sensible LLM-provider fallback ladders — this is one of the codebase's actual strengths. |

**Where integrations are incomplete, in one sentence each:** Auth is incomplete because FastAPI trusts caller-supplied identity instead of verifying it. Lead assignment is incomplete because the UI was never updated to call the real assignment-agent endpoint after it was built. Notifications are incomplete because of a schema mismatch nobody surfaced (swallowed exception). Two SSE broadcasts are incomplete because they target the wrong system (Supabase REST instead of the app's own broadcast mechanism). WhatsApp channel connection is incomplete because of a missing `await` keyword. Compliance checking is incomplete because it was built but never plugged into the publish pipeline. Call Intelligence and Tasks are incomplete because their UI mounting point was apparently dropped in a page refactor.

---

## 11. Architecture Impact Analysis

- **The service-role-key pattern is the single component with the widest cascading impact.** It touches every agent's `data.py`, every router in `apps/api/app/routers/`, and `main.py` itself — roughly 170 files share this one design decision. Fixing it properly (forwarding and verifying the caller's JWT, letting RLS do the tenant-scoping it was designed for) is a cross-cutting change, not a local patch, and until it's done, RLS's correct schema design (§6) provides zero actual protection at the API boundary.
- **Duplicate/parallel implementations are a recurring pattern, not isolated incidents:** two Instagram OAuth flows, two publishing agents (mock + real), two poster-generation endpoints (disabled + real), two `assignLead` functions, two compliance-check implementations, a whole superseded generation of marketing publish/approval functions, channel metadata copy-pasted 6×, and stage taxonomy duplicated 4× (already diverging). This suggests a development process where new implementations were added alongside old ones rather than replacing them — worth addressing at the team-process level, not just file-by-file.
- **The hand-rolled SQL-string-matching shim in `agents/assignment/database.py`** is a tightly-coupled, invisible dependency between two files (`agent.py`/`seeding.py`'s literal SQL text and `database.py`'s whitelist) that will silently break on a future edit to either side with no compiler or test to catch it — a clear case of "poor abstraction masquerading as a compatibility layer."
- **Performance bottleneck:** `uvicorn --workers 2` for the entire API, combined with several endpoints capable of blocking a worker's thread pool for up to 360 seconds (poster generation) with zero rate limiting or per-tenant throttling, means a small number of concurrent expensive requests from any single tenant can degrade service for every tenant — this is an architecture-level capacity risk, not a code bug.
- **Hidden dependency:** the Assignment Dashboard's apparent correctness depends entirely on it reading `leads.assigned_to` directly rather than the "proper" assignment tables — if a future developer "fixes" the dashboard to read from `sales_executives`/`lead_assignments` (the seemingly more correct source), it will start showing stale/wrong data, because the write path to those tables was already silently abandoned (§1.1 Op 5). This is a landmine for future maintenance.
- **Recommended approach, in priority order:** (1) fix the auth/tenant-isolation boundary at the FastAPI layer before anything else — this blocks production regardless of any other finding; (2) fix the concrete silent-failure bugs (WhatsApp await, notifications NOT NULL, two SSE broadcasts) — all four are small, well-understood, low-risk fixes; (3) resolve the assignment-path split (pick one, delete the other) before it causes a real data-integrity incident; (4) decide the fate of the orphaned Call Intelligence/Tasks features and the never-invoked compliance check — both are product decisions as much as engineering ones.

---

## 12. Performance Audit

- **Unbounded queries:** `getLeadBoard()` (`lib/leads.ts:43-50`, the Kanban board's data source) fetches the tenant's **entire** `leads` table with no `.limit()`, doing all bucketing/counting client-side in JS. `getMarketingAnalytics()` (`lib/marketing.ts:304-309`) does the same for `campaigns`/`campaign_posts` — the "date range" filter is applied in JS after an unbounded fetch, not pushed to the query, so cost grows with total history, not the selected window.
- **N+1 / sequential-write smells:** `createCampaignFromPlan` and `getMonthEvents` (`lib/marketing.ts:1712-1724`, `:1783-1794`) both batch their LLM generation call but then persist results via a `for` loop issuing one `await` per day/event sequentially, inconsistent with an adjacent batched-upsert call in the same function.
- **Blocking LLM calls with no protective timeout/rate limit:** `/score`, `/validate-and-score`, `/followup/{id}`, `/workflow/{id}`, `/whatsapp/send/{id}`, `/rescore/{id}`, and every synchronous endpoint in `app/routers/marketing.py` (content generation, campaign planning, compliance, copilot) block the calling request for the duration of the LLM call. Poster/banner generation (`gemini_image()`) can take up to ~360 seconds (two sequential 180s Gemini attempts). None of these have any per-tenant concurrency limit — a single tenant issuing repeated expensive requests can exhaust the shared thread pool.
- **Process-level capacity:** `apps/api/Dockerfile:26` runs only `--workers 2` for the entire API surface (both Lead Management and Marketing combined), sharing one small thread pool across cheap lookups and 360-second image-generation calls alike.
- **Fire-and-forget/SSE usage (positive pattern):** correctly applied for website extraction, SEO/AEO analysis, recommendation engine, report generator, and call-recording processing — these do *not* block the request thread, and this is a well-implemented pattern worth preserving/extending to the synchronous endpoints above.
- **Caching / lazy loading:** no caching layer was found anywhere (no Redis, no in-memory TTL cache) — every read hits Supabase/PostgREST directly, including the repeated per-tenant config lookups (`channel_store`, `tenant_id()` resolution) on every single request.
- **Realtime subscriptions:** the `_sse_clients` broadcast mechanism is in-process and per-server-instance — on a horizontally-scaled deployment (more than one FastAPI process/container), a broadcast from one instance would never reach a client connected to a different instance. This wasn't explicitly tested by the research agents but follows directly from the in-process-set implementation described in the Lead Management trace, and is worth flagging as a scaling limitation to watch for.

---

## 13. Security Audit

This section consolidates the dedicated security deep-dive (Agent C), cross-referenced against the module-specific traces (Agents A/B).

### 13.1 Authentication — Critical

**Zero JWT verification exists anywhere in `apps/api`**, confirmed by a full read of `main.py` and a grep across all ~170 Python files under `apps/api/agents/` and `apps/api/app/`. No `Depends(...)` auth dependency, no `HTTPBearer`/`OAuth2PasswordBearer`, no JWT-decoding middleware anywhere. The **one partial exception** is `app/routers/assignments.py`'s `_resolve_tenant_id`, which extracts the caller's bearer token and calls Supabase's `/auth/v1/user` to resolve identity — but if the token is missing or invalid, it **silently falls back to a demo tenant** rather than rejecting with 401. So even the one router that tries to authenticate fails open, not closed.

### 13.2 Authorization / Multi-tenancy — Critical

Every Python data-access module uses `SUPABASE_SERVICE_KEY` (never a per-request JWT) when talking to PostgREST — **RLS is bypassed for the entire FastAPI layer**, regardless of caller identity. This directly contradicts the project's own CLAUDE.md hard rule ("FastAPI calls Supabase with the caller's JWT, never the service-role key for normal data access").

Since RLS provides no protection once a request reaches FastAPI, the only remaining question is where `tenant_id` comes from — and for nearly every marketing/analytics endpoint, it's a **plain, unverified, client-supplied query or body parameter**: `app/routers/db.py` (campaigns, campaign-days, opportunities, publishing, assets), `channels.py`, `whatsapp_channel.py`, `context_planner.py`, `website_extraction.py`, `company_summary.py`, `seo_agent.py`, `aeo_agent.py`, `recommendation_engine.py`, `report_generator.py`, `marketing_strategy.py`, `marketing_budget_planner.py`, `instagram.py`/`facebook.py`/`linkedin.py`/`youtube.py`/`auth.py` (OAuth connect/status flows). **Any authenticated user of the app can supply another tenant's UUID and read or write that tenant's campaigns, marketing assets, connected-channel status, WhatsApp credentials, or OAuth diagnostics.** This is a full cross-tenant IDOR across the entire marketing module.

The Lead Management core (`/intake/leads`, `/followup`, `/workflow`, `/rescore`) is not spoofable via a `tenant_id` param specifically because it's hardcoded to one demo tenant (`ABC_TENANT_ID`) — but that just means the deployment itself only supports one tenant at this layer; there's still no code path verifying which tenant a caller actually belongs to.

An unauthenticated `GET /api/instagram/debug?tenant_id=<any>` endpoint additionally leaks OAuth scope/connected-page diagnostics for any guessable tenant ID with no auth check at all.

### 13.3 Frontend auth posture — consistent, but reveals the gap

The frontend's own session handling (`_authed.tsx`, `auth.ts`, `supabase.server.ts`) is standard, correct Supabase SSR usage, and every direct-to-Supabase call (via the anon key + user cookie) is genuinely RLS-protected. The frontend correctly does *not* bother attaching an auth token to ~95% of its FastAPI calls, because FastAPI doesn't check it anyway — the one file that does attach a bearer token (`lib/assignments.ts`) is the one router built to expect it. This confirms the security gap is systemic and structural, not an oversight in any individual file.

### 13.4 Input validation — Needs Attention

Most Lead Management/Marketing Pydantic models are typed but unconstrained (no length/format limits on phone/email/free-text fields). `app/routers/db.py` accepts fully untyped `dict`/`list` bodies for most of its mutations — no schema at all.

### 13.5 Secrets handling — Mostly good, one leak found

No raw secret values were found logged anywhere. `.gitignore`s correctly exclude `.env*` in both apps. The one leak: the unauthenticated `/api/instagram/debug` endpoint above returns real per-tenant OAuth diagnostics to anyone who calls it.

### 13.6 CORS & production config — High

`main.py` sets `CORSMiddleware(allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])` with a dev-only justification comment, and **none** of the four checked deploy configs (`Dockerfile.railway`, `railway.json`, `render.yaml`, `docker-compose.yml`) override it — `render.yaml` even documents a `FRONTEND_URL` env var "for CORS," but `main.py`'s CORS middleware never actually reads it. The wildcard ships to production unmodified.

### 13.7 Prompt injection — Medium

User-supplied free text (lead notes/messages, public-intake-form fields, campaign briefs) is interpolated directly into LLM prompts in the scoring agent, follow-up agent, and content-generation agent, with no delimiter/instruction-hierarchy strategy. Mitigation exists only for the scoring agent's *numeric* outputs (clamped/capped) — free-text outputs (reasoning, outreach messages, ad captions) are unvalidated before reaching the DB/UI or, for marketing content, a live publish with no compliance gate enforced (§1.3 Op 3).

### 13.8 Severity summary

1. **Critical, systemic:** service-role key used for 100% of FastAPI→Supabase data access; RLS fully bypassed at this layer app-wide.
2. **Critical:** nearly every marketing/analytics endpoint takes `tenant_id` as an unverified client param — full cross-tenant IDOR given #1.
3. **High:** CORS wildcard ships to production unmodified across all checked deploy paths.
4. **Medium:** `db.py` accepts untyped payloads for most mutations.
5. **Medium:** unauthenticated Instagram debug endpoint leaks per-tenant OAuth diagnostics.
6. **Medium:** unsanitized LLM prompt interpolation across scoring/followup/content-generation, with no compliance gate enforced on published marketing content.
7. **Positive:** the RLS schema design itself (migrations reviewed) is complete and correctly tenant-scoped everywhere checked — the fix belongs at the FastAPI layer, not in the database schema.

---

## 14. Final Production Verdict

### Production readiness score: **30 / 100**

This is not a reflection of code quality in isolation — the LangGraph agent architecture, LLM fallback ladders, and RLS schema design are genuinely well-built. The score is low because the specific things a **multi-tenant SaaS** cannot ship without — verified authentication, enforced tenant isolation, and a small number of completely silent data-loss bugs — are not in place, and several headline features (Call Intelligence, Tasks, brand compliance, WhatsApp channel connection) don't actually work end-to-end despite looking complete in the code.

### Lead Management readiness: **45 / 100**
The core create → validate → score → assign pipeline is real, well-architected, and works end-to-end, including genuine LLM-driven scoring with sensible fallbacks. It's dragged down by: the hardcoded single-tenant assumption on every core endpoint, a real dead-code bug in the assignment path that causes silent data drift, a swallowed-exception bug that makes assignee notifications never fire, two broken realtime broadcasts, and two fully-built features (Call Intelligence, Tasks) with no way for a user to reach them.

### Marketing readiness: **30 / 100**
Content generation, campaign planning, the analysis pipeline (website extraction → SEO/AEO → recommendations → reports), and the scheduled publishing agent are all genuinely well-built and working. It's dragged down further than Lead Management by: this module carrying the brunt of the cross-tenant IDOR (nearly every endpoint here takes an unverified `tenant_id`), a completely broken WhatsApp channel connection (missing `await`), a compliance-check feature that's built but never actually runs before publish, and a manual-publish path that misreports success/failure to users.

### Critical blockers (must fix before any production deployment)
1. FastAPI's use of the Supabase service-role key for all data access, bypassing RLS entirely (§13.1–13.2).
2. Unverified, client-supplied `tenant_id` on nearly every marketing/analytics endpoint (§13.2) — full cross-tenant data exposure.
3. CORS wildcard shipping unmodified to production (§13.6).
4. WhatsApp channel connect/disconnect silently never persisting (missing `await`, §3).

### High-priority issues
5. `notifications` insert always violates a NOT NULL constraint, silently swallowed (§3).
6. Two SSE broadcasts (WhatsApp inbound, non-manual rescore) target a nonexistent endpoint and never reach the browser (§3).
7. Zero test coverage on the core scoring/assignment/rescoring/intake-pipeline agents and on essentially the entire frontend (one test file in the whole repo), with no CI gate running any tests before deploy (§9, cross-cutting).
8. Brand compliance is fully built but never invoked before content publishes (§1.3 Op 3).
9. Dead assignment path causes `sales_executives`/`lead_assignments` to silently drift stale after the first lead (§1.1 Op 5, §11).
10. Unauthenticated Instagram OAuth debug endpoint leaks per-tenant diagnostics (§13.5).

### Medium-priority issues
- Manual "Publish Now" always marks a post Published regardless of real per-channel outcome.
- Four different API error-response shapes in production, including one router that returns failures as HTTP 200.
- No rate limiting or per-tenant throttling anywhere, combined with LLM endpoints that can block for up to 360 seconds.
- Duplicated, already-diverging business logic: stage taxonomy (4 copies), channel metadata (6 copies).
- `db.py` accepts fully untyped request bodies for most mutations.
- Prompt-injection surface on scoring/follow-up/content-generation with no output validation.

### Low-priority issues / quick wins
- Delete ~20 confirmed-dead frontend exports and the stale `facebook_service.py`/mock `publishing.py` wiring.
- Fix the `assignLead` naming collision.
- Unify the two Instagram OAuth implementations and the two poster-generation endpoints (delete the disabled/orphaned one in each pair).
- Fix the Media Library "Trash" client-only state.
- Wire up or remove `CallIntelligence`/`TasksPanel`/`EventComposer`/`CustomerLeadStatus`.

### Technical debt
The recurring pattern of building a second, parallel implementation alongside an old one instead of replacing it (publishing agents, Instagram OAuth, poster endpoints, assignment functions, compliance checks, an entire prior generation of publish/approval functions) is the largest structural debt item — it's not any single bug, but a process issue that will keep generating "which one is real?" audits like this one until addressed.

### Risk assessment
Deploying today would expose real dealer data across tenants (any authenticated user of one dealer could plausibly read/write another's campaigns, channel credentials, or diagnostics), would silently fail to notify sales reps about follow-ups, would silently fail to connect WhatsApp for marketing outreach, and would publish marketing content with no compliance safety net — all without any error surfaced to an operator, because the failures are swallowed by design in most of these cases.

### Go / No-Go recommendation: **No-Go**

Do not deploy to production, or to any environment serving more than one real tenant, until at minimum the four Critical blockers above are resolved. The High-priority items (especially the notification/broadcast bugs and the test-coverage gap) should be fixed in the same push, since they're cheap relative to the blockers and materially affect whether reps can trust the system day-to-day. Everything below Medium can reasonably be tracked as follow-up technical debt rather than a release blocker.
