# Context Planner, Website Extraction Engine, Company Summary, SEO Agent, AEO Agent, Recommendation Engine & Report Generator — Current Architecture (Phases 1–7)

Status snapshot of what's actually implemented for Phases 1–7 of the
Context/SEO/AEO vertical (`feature_master_plan.md` → `01_CONTEXT_PLANNER.md` +
`02_WEBSITE_EXTRACTION_ENGINE.md` + `03_COMPANY_SUMMARY.md` +
`04_SEO_AGENT.md` + `05_AEO_AGENT.md` + `06_RECOMMENDATION_ENGINE.md` +
`07_REPORT_GENERATOR.md`). Phase 8 (production hardening) is **not** built yet.

---

# Phase 1 — Context Planner

## Overview

Context Planner is a new, standalone sidebar feature (below Dashboard, gated to
the `intelligence` plan tier) that lets a dealer create a "context" — either
from a website URL or a manual company profile — as the seed record later
phases will build on. Submission is validated, normalized, and stored with a
tracked status; the UI shows loading/success/failure states and a history of
past submissions.

It follows the existing lead-agent conventions in this codebase (agent
package under `apps/api/agents/`, own FastAPI router, DuckDB shim table +
matching Supabase migration, TanStack Start BFF `lib/` client) rather than
introducing new patterns.

## Data model

**Table:** `context_plans` (DuckDB shim: `apps/local-api/server.js`; Postgres:
`supabase/migrations/0029_context_plans.sql`, tenant-scoped with RLS).

| Column | Notes |
|---|---|
| `id` | uuid, the "Context ID" returned to the caller |
| `tenant_id` | FK to `tenants`, RLS-enforced in prod |
| `input_type` | `url` \| `manual` |
| `url` | raw input, url path only |
| `normalized_url` | cleaned URL, url path only |
| `company_name`, `website`, `region`, `industry`, `products`, `services`, `description` | flattened output fields — populated from manual entry, or left mostly `null` on the url path (unknown until Phase 2/3 extraction) |
| `status` | `pending` (transient, never persisted) → `ready` \| `invalid` \| `failed` |
| `errors` | JSON array of validation/storage error strings — persisted even for `invalid` submissions (audit trail) |
| `created_at`, `updated_at` | ISO timestamps |

**Status lifecycle:** every submission — valid or invalid — is persisted.
`ready` = validated + stored; `invalid` = validation failed but still saved
for history; `failed` = the DB write itself threw. Later phases will filter
on `status = 'ready'`.

## Backend — `apps/api/agents/context_planner/`

A LangGraph agent package, mirroring `agents/workflow/` and `agents/followup/`:

| File | Role |
|---|---|
| `state.py` | `ContextPlannerState` TypedDict + `ManualCompanyInput` |
| `nodes.py` | `validate_url_node`, `validate_manual_node`, `normalize_url_node`, `create_context_node`, `store_context_node`, `track_status_node` — plus the pure `is_valid_url()` / `normalize_url()` helpers |
| `graph.py` | Builds and compiles `ContextPlannerGraph` (`StateGraph`), conditional entry point on `input_type` |
| `data.py` | Thin `httpx` → PostgREST client (`insert_context`, `get_context`, `list_contexts`) |
| `service.py` | `create_context()` / `get_context()` / `list_contexts()` — the integration surface called by the router |

**Graph flow** — both branches always run all the way through to
`store_context`/`track_status`, so an invalid submission still gets a full
record persisted (not dropped silently):

```
url path:    START → validate_url → normalize_url → create_context → store_context → track_status → END
manual path: START → validate_manual → create_context → store_context → track_status → END
```

Every node follows the codebase-wide rule: never raise. A validation or
storage failure degrades to a safe `status` and is recorded in `errors`.

**Validation rules:**
- URL: must resolve (after default-`https://` scheme injection) to `http`/`https`,
  a non-credentialed, real-looking hostname (regex-validated, no bare IPs/`localhost`).
- URL normalization: lowercase scheme+host, strip default port, collapse root
  path, drop fragment, strip known tracking params (`utm_*`, `gclid`, `fbclid`, …),
  sort remaining query params.
- Manual entry: `company_name`, `industry`, `description` are **required**;
  `website`, `region`, `products`, `services` are optional.

## Backend API — `apps/api/app/routers/context_planner.py`

Registered in `main.py` as `app.include_router(context_planner.router, prefix="/context-planner", ...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/context-planner/contexts` | Create a context (url or manual) → returns the full record incl. `context_id` and `status` |
| `GET` | `/context-planner/contexts/{context_id}` | Fetch one context (`?tenant_id=...`) |
| `GET` | `/context-planner/contexts` | List a tenant's contexts (`?tenant_id=...&status=...&limit=...`) |

Example:
```bash
curl -X POST http://localhost:8000/context-planner/contexts \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"11111111-1111-1111-1111-111111111111","input_type":"url","url":"nissanindia.in/models/"}'
# → {"context_id":"...","status":"ready","normalized_url":"https://nissanindia.in/models",...}
```

## Frontend — `apps/web`

| File | Role |
|---|---|
| `src/components/shell/nav-items.ts` | New nav entry: "Context Planner" → `/context-planner`, `minPlan: 'intelligence'`, positioned right after Dashboard |
| `src/routes/_authed/context-planner.tsx` | Thin `createFileRoute` wrapper |
| `src/components/context-planner/ContextPlannerPage.tsx` | The UI: URL/Manual toggle, form fields, `useMutation`-driven loading/success/failure states, copyable Context ID, "Recent contexts" list via `useQuery` |
| `src/lib/context-planner.ts` | `createContext` / `listContexts` — TanStack Start `createServerFn` BFF wrappers calling the FastAPI service; resolves `tenant_id` from the logged-in Supabase session (falls back to the seeded demo tenant), same pattern as `lib/assignments.ts` |

## What's intentionally NOT built (later phases)

- No caching/retry/job-queue hardening (Phase 8)

## Verification performed

- Backend: all 4 cases (url valid/invalid, manual valid/invalid) curl-tested
  against a running FastAPI instance — correct `status`/`errors`/normalized
  output each time.
- Persistence: confirmed via `GET /rest/v1/context_plans` against the DuckDB
  shim — rows land with correct fields, `invalid` submissions included.
- Frontend: route registers in TanStack Router's codegen, no compile errors,
  clean SSR redirect-to-login when unauthenticated (no crash). A logged-in
  browser click-through was **not** performed (no browser automation tooling
  available in-session) — recommend manually verifying the form and
  Recent Contexts list once.

---

# Phase 2 — Website Extraction Engine

## Overview

Website Extraction Engine is a backend-only agent (no new frontend UI — the
Phase 2 spec is silent on UI, unlike Phase 1's explicit sidebar mandate) that
crawls a dealer's website and produces ONE normalized JSON covering Website,
Company, Contact, Products, Services, Pages, Images, Videos, Blog, FAQ,
Technology, Technical SEO, and Trust information. It is fully decoupled from
Phase 1: it reads `context_plans` read-only (rows where `input_type='url'`
and `status='ready'`) and never modifies `agents/context_planner/` or its
router. Explicitly out of scope per spec: no SEO/AEO scoring (later phases),
no JS-rendering (static-HTML-only — SPA dealer sites yield thin extractions).

## Data model

**Table:** `website_extractions` (DuckDB shim: `apps/local-api/server.js`;
Postgres: `supabase/migrations/0030_website_extractions.sql`, tenant-scoped
with RLS, FK to `context_plans.id`).

| Column | Notes |
|---|---|
| `id` | uuid, the "Extraction ID" |
| `tenant_id` | FK to `tenants`, RLS-enforced in prod |
| `context_id` | FK to `context_plans.id` — the Phase 1 record this extraction was run for |
| `url` | denormalized copy of the crawled URL, for list views |
| `status` | `queued` → `crawling` → `parsing` → `extracting` → `building` → `ready` \| `failed` |
| `extraction_data` | JSONB — the ONE normalized JSON per spec (not sprawled into per-category columns) |
| `errors` | JSON array — persisted even on `failed` (e.g. SSRF rejection, DNS failure) |
| `created_at`, `updated_at`, `started_at`, `completed_at` | timestamps |

## Backend — `apps/api/agents/website_extraction/`

A LangGraph agent package with 16 nodes (far more than any other agent in
this codebase), split into a `nodes/` package grouped by pipeline stage
rather than one giant file:

| File | Nodes |
|---|---|
| `state.py` | `WebsiteExtractionState` TypedDict + `ParsedPage` (shared per-page parse cache) |
| `schema.py` | Pydantic models for the final JSON (`WebsiteExtractionResult`) — the first agent in this codebase with a dedicated schema file, since its literal deliverable *is* a validated JSON contract |
| `nodes/fetch.py` | `url_validator_node`, `crawler_node`, `html_downloader_node` — the SSRF guard lives here |
| `nodes/parse.py` | `html_parser_node`, `metadata_parser_node`, `navigation_parser_node` |
| `nodes/extract.py` | `product_extractor_node`, `service_extractor_node`, `contact_extractor_node` |
| `nodes/detect.py` | `technology_detector_node`, `blog_detector_node`, `faq_detector_node`, `media_detector_node`, `trust_detector_node` |
| `nodes/build.py` | `json_builder_node`, `validator_node` |
| `graph.py` | Builds/compiles `WebsiteExtractionGraph` — a linear chain, all 16 nodes in fixed order |
| `data.py` | Reads `context_plans` read-only; owns full CRUD on `website_extractions` |
| `service.py` | `create_extraction()` (fire-and-forget), `prepare_extraction()`, `run_extraction()`, `stream_run()`, `get_extraction()`, `list_extractions()` |

**Graph flow** — linear, no branching; every node degrades to a no-op
(`return {}`) when its required upstream input is empty, rather than needing
conditional edges:
```
url_validator → crawler → html_downloader → html_parser
  → metadata_parser → navigation_parser
  → product_extractor → service_extractor → contact_extractor
  → technology_detector → blog_detector → faq_detector → media_detector → trust_detector
  → json_builder → validator
```

**Crawl scope (bounded, "production-grade" per spec):** same host or
subdomain of the seed host only; `robots.txt` respected via stdlib
`urllib.robotparser`; discovery via `sitemap.xml` first, else one-level
nav-link BFS. **Hard cap: 12 pages, 20s time budget, concurrency 5, 3MB
per-page size cap.**

**SSRF mitigation** (the first agent in this codebase to fetch arbitrary
third-party URLs — every other agent's `httpx` usage is internal-only):
resolves hostname via `getaddrinfo`, rejects any private/loopback/
link-local (covers `169.254.169.254` cloud metadata)/multicast/reserved
address; redirects followed manually (max 5 hops) with the same check
re-applied on every hop. Known accepted gap: doesn't close the
DNS-rebinding TOCTOU window (resolve-then-connect race) — deferred to
Phase 8.

**Status lifecycle:** `queued` → `crawling` → `parsing` → `extracting` →
`building` → `ready` | `failed`. A partial failure (e.g. one page 404s)
still reaches `ready` with the error recorded — only a fully-failed crawl
(nothing ever fetched, e.g. SSRF-blocked) reaches `failed`.

## Backend API — `apps/api/app/routers/website_extraction.py`

Registered in `main.py` as `app.include_router(website_extraction.router, prefix="/website-extraction", ...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/website-extraction/extractions` | Fire-and-forget: creates a `queued` row, runs the crawl in the background, returns immediately |
| `GET` | `/website-extraction/extractions/{extraction_id}` | Poll one extraction (`?tenant_id=...`) |
| `GET` | `/website-extraction/extractions` | List a tenant's extractions (`?context_id=...&status=...&limit=...`) |
| `GET` | `/website-extraction/extractions/stream` | SSE — live per-node progress (`?context_id=...&tenant_id=...`), creates its own independent row |

`POST` and `/stream` are independent, non-idempotent entry points (each runs
its own crawl) — mirrors this codebase's existing `POST /followup/{lead_id}`
+ `GET /followup/{lead_id}/stream` precedent.

Example:
```bash
curl -X POST http://localhost:8000/website-extraction/extractions \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"11111111-1111-1111-1111-111111111111","context_id":"<context_id>"}'
# → {"extraction_id":"...","status":"queued",...}
```

## Dependencies added

`beautifulsoup4` + `lxml` (HTML parsing) added to `apps/api/requirements.txt`.
`httpx` (already present) reused for external fetches, reconfigured with a
real User-Agent, manual redirect handling, and size/time caps — distinct
from its existing internal-PostgREST-only usage elsewhere in the codebase.
No Playwright/Selenium — static-HTML-only by design (accepted limitation).

## What's intentionally NOT built (later phases)

- No AEO analysis (Phase 5)
- No recommendation engine or report generation (Phases 6–7)
- No caching/retry/job-queue hardening, no fix for the DNS-rebinding TOCTOU gap (Phase 8)
- No frontend UI for extraction directly (backend-only this phase, by design — Phase 3 later
  added the frontend trigger/view on top, see below)

## Verification performed

- Unit tests: `apps/api/tests/agents/test_website_extraction.py`, 30 tests
  covering the pure/deterministic surface (SSRF/scope guards, page-type
  classifier, HTML parsing, heuristic extractors/detectors, JSON building
  and schema validation, plus one full-graph-run regression test).
- Live E2E: verified against real sites (`example.com`, `www.google.com`,
  `httpbin.org/status/404`) through both the poll (`POST` + `GET`) and SSE
  stream paths, and confirmed the SSRF guard blocks a syntactically-valid
  FQDN that resolves to loopback (`localtest.me`) with zero requests made
  to the target. Confirmed Phase 1 (`context-planner`) is unaffected.
- **Bugs found and fixed during verification** (not just happy-path
  testing): (1) the HTML parser was excluding `mailto:`/`tel:` links,
  silently breaking contact extraction; (2) the heading-to-description
  pairing heuristic swept up trailing nav links when a heading had no
  following heading to stop at; (3) `json_builder_node` dropped the
  crawler's `has_sitemap`/`has_robots_txt`/`robots_txt_respected`/
  `sitemap_used` flags from the final JSON entirely; (4) a route-ordering
  bug made the SSE `/stream` endpoint unreachable (a literal route
  registered after a parameterized one with the same prefix); (5) LangGraph
  represents a node's empty-dict no-op as `None` (not `{}`) in
  `astream(stream_mode="updates")`, which crashed the pipeline on every
  SSRF/DNS rejection until guarded against.

---

# Phase 3 — Company Summary

## Overview

Company Summary consumes Phase 2's normalized extraction JSON and generates
a concise 8-field company summary (Company Name, Website, Region, Industry,
Products, Services, Company Description, Short Verdict) via Groq — the first
phase in this vertical where the spec explicitly requires frontend display.
Unlike every other agent in this codebase (Claude-primary/Groq-fallback),
this one calls **Groq exclusively**: the spec's own wording names Groq as
the required engine, so if `GROQ_API_KEY` isn't set it falls straight to a
deterministic "Unknown"-filled fallback rather than silently using Claude.
Fully decoupled from Phases 1–2: reads `website_extractions` read-only via
its own duplicated data layer, never imports or modifies
`agents/context_planner/` or `agents/website_extraction/`.

## Data model

**Table:** `company_summaries` (DuckDB shim: `apps/local-api/server.js`;
Postgres: `supabase/migrations/0031_company_summaries.sql`, tenant-scoped
with RLS, FK to both `website_extractions.id` and `context_plans.id`).

| Column | Notes |
|---|---|
| `id` | uuid, the "Summary ID" |
| `tenant_id` | FK to `tenants`, RLS-enforced in prod |
| `extraction_id` | FK to `website_extractions.id` — the Phase 2 JSON this summary was generated from |
| `context_id` | denormalized FK to `context_plans.id`, for listing/filtering without a join |
| `company_name`, `website`, `region`, `industry`, `description`, `verdict` | flat text fields — "Unknown" substituted for anything not derivable from the input, never left blank/null by either the LLM or deterministic path |
| `products`, `services` | JSONB arrays of plain name strings (not `{name, description}` objects — matches the spec's own UI example showing bare bullet names) |
| `status` | `pending` (transient) → `ready` \| `failed` — simpler than Phase 2's 6-state lifecycle since this runs synchronously in one request, not across an async crawl |
| `errors` | JSON array |
| `created_at`, `updated_at` | ISO timestamps |

Multiple summary rows may accumulate per `extraction_id`/`context_id` over
time (neither is unique) — "most recent by `created_at`" is treated as
canonical everywhere (API list ordering, frontend panel).

## Backend — `apps/api/agents/company_summary/`

A small 3-node LangGraph agent package (single `nodes.py`, no `nodes/`
package needed — matches the majority convention, not Phase 2's 16-node
exception), and no dedicated `schema.py` (the output is 8 flat fields, same
complexity as Phase 1's `TypedDict`-only fields, not Phase 2's complex
13-section JSON):

| File | Role |
|---|---|
| `state.py` | `CompanySummaryState` TypedDict |
| `llm.py` | `generate_summary()` — Groq-direct call (raw `httpx`, `GROK_API_KEY`/`GROK_MODEL` from `app/config.py`, `response_format: json_object`), with all-or-nothing shape validation (`_valid_shape()` — a mismatched/partial response is entirely discarded, never merged field-by-field); `deterministic_summary()` — zero-config fallback pulling `company.name/region/industry/description` verbatim with "Unknown" substitution; `verdict` has no non-LLM source at all, so it's always the literal string `"Unknown"` in this path, per the spec's own instruction |
| `nodes.py` | `load_extraction_node` (validates already-fetched `extraction_data`, no DB I/O), `generate_summary_node` (tries Groq, falls back to deterministic; `website` is taken directly from `extraction_data.website` — never asked of the LLM at all, eliminating hallucination risk for that field entirely), `store_summary_node` |
| `graph.py` | Builds/compiles `CompanySummaryGraph` — linear: `load_extraction → generate_summary → store_summary` |
| `data.py` | `get_extraction()` — read-only duplicate of the same query shape `website_extraction/data.py` already has (preserves per-phase decoupling); owns full CRUD on `company_summaries` |
| `service.py` | `ExtractionNotEligible` exception; `prepare_summary()` (validates the extraction exists/belongs to tenant/is `status='ready'`, creates a `pending` row); `create_summary()` (runs the graph **synchronously**, used by the endpoint); `get_summary()`/`list_summaries()` |

**Prompt design** (`llm.py`'s `SYSTEM_PROMPT`): use only input facts, never
invent; "Unknown" for anything not derivable; products/services must be
plain names drawn only from the input; description/verdict limited to 1-3
sentences / ~20 words respectively, sourced only from the given JSON.

## Backend API — `apps/api/app/routers/company_summary.py`

Registered in `main.py` as `app.include_router(company_summary.router, prefix="/company-summary", ...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/company-summary/summaries` | **Synchronous** — validates the referenced extraction is `ready`, runs the graph inline, returns the completed summary (`ready`/`failed`) in one response |
| `GET` | `/company-summary/summaries/{summary_id}` | Fetch one summary (`?tenant_id=...`) |
| `GET` | `/company-summary/summaries` | List (`?tenant_id=...&extraction_id=...&context_id=...&limit=...`) |

Deliberately synchronous (unlike Phase 2's fire-and-forget) — one bounded
Groq call plus a couple of PostgREST reads fits comfortably in a normal
request/response cycle; async/poll machinery here would be pure incidental
complexity.

Example:
```bash
curl -X POST http://localhost:8000/company-summary/summaries \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"11111111-1111-1111-1111-111111111111","extraction_id":"<extraction_id>"}'
# → {"summary_id":"...","status":"ready","company_name":"...","verdict":"...",...}
```

## Frontend — `apps/web`

This phase's spec explicitly requires UI (unlike Phase 2's silence), and
also adds the frontend trigger/view Phase 2 itself never got:

| File | Role |
|---|---|
| `src/lib/website-extraction.ts` | New — `createExtraction`/`getExtraction`/`listExtractions`, mirroring `context-planner.ts`'s exact shape. Didn't exist before this phase since Phase 2 was backend-only |
| `src/lib/company-summary.ts` | New — `createSummary`/`getSummary`/`listSummaries`, same shape |
| `src/components/context-planner/CompanySummaryPanel.tsx` | New — queries the latest extraction/summary for a context; a single combined "Generate Summary" `useMutation` that chains: trigger+poll extraction only if none `ready` yet, then generate the summary; renders the 8 spec fields (Products/Services as bullet lists) once ready |
| `src/components/context-planner/ContextPlannerPage.tsx` | Additive only — "Recent contexts" rows are now clickable when `input_type==='url' && status==='ready'`, opening a `Drawer` (existing `kit.tsx` primitive) mounting `CompanySummaryPanel`. No existing form/mutation/list logic touched |

## What's intentionally NOT built (later phases)

- No caching/retry/job-queue hardening (Phase 8)

## Verification performed

- Unit tests: `apps/api/tests/agents/test_company_summary.py`, 22 tests
  covering shape validation, the deterministic fallback, and node behavior
  with the Groq call mocked/absent.
- Live E2E: full chain (context → extraction → summary) run against
  `example.com`. Since no `GROQ_API_KEY` is configured in this dev
  environment, this incidentally exercised and confirmed the **deterministic
  fallback path end-to-end** — every field correctly `"Unknown"` except
  `company_name`/`website` (pulled directly from the extraction). Confirmed
  persistence via `GET /rest/v1/company_summaries`, a clean 400 on a
  nonexistent `extraction_id`, and that Phase 1 (manual context creation)
  remains unaffected.
- Full `tsc --noEmit` typecheck run across `apps/web` — zero errors in any
  file this phase touched.
- **Bug found and fixed during verification**: `ExtractionResult.extraction_data`
  was typed as `Record<string, unknown>`, which failed TanStack Start's
  serializability check and silently degraded the inferred return type of
  every `website-extraction.ts` server function to `{}`, cascading into type
  errors in `CompanySummaryPanel.tsx`. Fixed by typing it as
  `Record<string, any>` instead.
- **Known limitation**: the actual Groq call path (`llm.generate_summary`)
  couldn't be exercised against a real network call in this session (no
  Groq key configured) — covered by unit tests (shape validation, mocked
  responses) but not a live Groq round trip.

---

# Phase 4 — SEO Agent

## Overview

SEO Agent runs 24 independent, rule-based analyzers against Phase 2's
Website Extraction JSON — one per named dimension in the spec (Website
Information through Conversion Optimization) — each returning PASS/WARNING/
FAIL plus structured recommendations (Problem/Reason/Recommendation/
Estimated Impact/Priority/Difficulty). Unlike Phase 3, no LLM is involved:
every analyzer is a pure, deterministic Python function, since the spec
names no engine and the checks are simple presence/threshold rules over
already-structured JSON. This is the first phase whose spec explicitly
demands live streaming ("display every completed agent live"), which drove
the core architectural decision below. Fully decoupled from Phases 1–3:
reads `website_extractions` read-only via its own data layer, never imports
or modifies any prior phase's agent package or router.

## Data model

**Table:** `seo_analyses` (DuckDB shim: `apps/local-api/server.js`;
Postgres: `supabase/migrations/0032_seo_analyses.sql`, tenant-scoped with
RLS, FK to both `website_extractions.id` and `context_plans.id`).

| Column | Notes |
|---|---|
| `id` | uuid, the "Analysis ID" |
| `tenant_id` | FK to `tenants`, RLS-enforced in prod |
| `extraction_id` | FK to `website_extractions.id` — the Phase 2 JSON this analysis was run against |
| `context_id` | denormalized FK to `context_plans.id`, for listing/filtering without a join |
| `status` | `queued` → `analyzing` → `ready` \| `failed` — simpler than Phase 2's 6-state lifecycle (pure computation over already-fetched JSON, no crawl sub-stages) |
| `analysis_data` | JSONB — the ONE normalized `SEOAnalysisResult` (24 dimension results + summary), not sprawled into per-dimension columns |
| `overall_score` | denormalized 0-100 int, for cheap sorting/filtering in list views |
| `errors` | JSON array |
| `created_at`, `updated_at`, `started_at`, `completed_at` | timestamps |

## Backend — `apps/api/agents/seo_agent/`

A 27-node **linear** LangGraph — `load_extraction` → 24 analyzer nodes (one
per spec dimension) → `aggregate_and_build` → `validator` — split across a
`nodes/` package grouped by theme, mirroring Phase 2's per-stage convention:

| File | Dimensions |
|---|---|
| `nodes/business_info.py` | Website Information, Company Information, Contact Information, Products, Services |
| `nodes/technical.py` | Technical SEO, Schema, Performance, Core Web Vitals, Security |
| `nodes/content_seo.py` | Page Analysis, Content Analysis, Keyword Analysis, Blog, FAQ, Accessibility |
| `nodes/links_media.py` | Internal Links, External Links, Images, Videos |
| `nodes/authority_trust.py` | Trust, Local SEO, Brand Authority, Conversion Optimization |
| `nodes/build.py` | `load_extraction_node`, `aggregate_and_build_node` (computes score/grade), `validator_node` |
| `nodes/_common.py` | Shared helpers: `rec()`/`result()`/`always_warning()` builders, `worst()` (FAIL\>WARNING\>PASS), `dimension_result_key()` (derives state field names programmatically so `state.py`, `graph.py`, and `build.py` never drift out of sync), `build_node()` (wraps each pure analyzer with try/except → FAIL "analyzer crashed" on any exception) |

**Why 24 separate nodes, not one node looping internally** (unlike the
Scoring agent's precedent, which computes its 8 dimensions via sequential
in-process calls inside a single node): the spec's "Create independent
agents for: [24 named items]" wording plus its explicit live-streaming
requirement both point away from that precedent. Modeling each dimension as
its own LangGraph node lets this phase reuse Phase 2's proven
`astream(stream_mode="updates")` SSE mechanism completely unchanged — one
`node` event per completed analyzer, satisfying "display every completed
agent live" for free. New defensive plumbing this phase needed that Phase
2/3 didn't: each analyzer node catches its own exceptions (`build_node()`),
since — unlike Phase 2's crawl pipeline, where nodes have real sequential
data dependencies — these 24 checks are mutually independent, so one bug
must not abort the other 23 in a 27-node chain.

**Signal-gap handling**: `WebsiteExtractionResult` has no data at all for 7
of the 24 dimensions (Performance, Core Web Vitals, Keyword Analysis, Brand
Authority, Conversion Optimization, Internal Links, External Links — the
last two because the schema has no link-graph field; `ParsedPage.links`
exists only transiently in Phase 2's internal crawl state). These always
return `WARNING` with an honest explanation via `always_warning()`, never a
fabricated verdict. 4 more dimensions (Security, Accessibility, Content
Analysis, Local SEO) have weak-but-real signal and always attach one
informational recommendation noting the evidence limitation, even on PASS.

**Scoring**: `PASS=2, WARNING=1, FAIL=0` per dimension, equally weighted,
`overall_score = round(100 * sum / 48)`, grade bands A≥90/B≥75/C≥60/D≥40/
F<40 — confirmed with user that the 7 always-WARNING dimensions capping a
flawless site around 85/B is an accepted tradeoff for scoring simplicity.

## Backend API — `apps/api/app/routers/seo_agent.py`

Registered in `main.py` as `app.include_router(seo_agent.router, prefix="/seo-agent", ...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/seo-agent/analyses` | Fire-and-forget: creates a `queued` row, runs all 24 analyzers in the background, returns immediately |
| `GET` | `/seo-agent/analyses/{analysis_id}` | Poll one analysis (`?tenant_id=...`) |
| `GET` | `/seo-agent/analyses` | List (`?extraction_id=...&context_id=...&status=...&limit=...`) |
| `GET` | `/seo-agent/analyses/stream` | SSE — live per-dimension progress (`?extraction_id=...&tenant_id=...`), creates its own independent row. **Registered before** `/analyses/{analysis_id}` — Phase 2's own documented route-ordering gotcha applies here too |

Each `node` SSE event carries `{node, dimension, status, index, total}` —
richer than Phase 2's bare `{node}` payload, safe here since every analyzer
is self-contained with no external I/O, so the frontend can light up each
dimension's badge with its real result the instant it arrives rather than
just ticking a generic spinner.

Example:
```bash
curl -X POST http://localhost:8000/seo-agent/analyses \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"11111111-1111-1111-1111-111111111111","extraction_id":"<extraction_id>"}'
# → {"analysis_id":"...","status":"queued",...}
```

## Frontend — `apps/web`

The first phase since Context Planner to get a dedicated route rather than
extending the existing Drawer — the 24-dimension report is categorically
larger than Phase 3's 8 flat fields:

| File | Role |
|---|---|
| `src/lib/seo-agent.ts` | New — `createAnalysis`/`getAnalysis`/`listAnalyses`, mirroring `website-extraction.ts`'s shape |
| `src/lib/context-planner.ts` | Additive — new `getContext()` export (fetch one context by id), needed because the new route must load context details after a page reload; nothing before this phase needed it |
| `src/routes/_authed/seo-analysis.$contextId.tsx` | New route — thin loader (`getContext`) + wrapper, mirrors `leads.$leadId.tsx`'s shape |
| `src/components/seo-agent/SeoAnalysisPage.tsx` | New — live 24-row checklist grouped into the same 5 themed sections as the backend, browser `EventSource` consumed **directly against the FastAPI service** (not proxied through a server fn) — reuses the exact pattern already established by `leads.$leadId.tsx`'s `FollowupCard` (including its SSE-connection-drop → server-fn fallback logic); once ready, renders a score/grade header + 24 expandable dimension cards |
| `src/components/context-planner/ContextPlannerPage.tsx` | Additive only — one new "Run SEO Analysis →" link added inside the existing Drawer, below `CompanySummaryPanel` |

Client-side `tenant_id` (needed to construct the `EventSource` URL directly,
since SSE bypasses the server-fn/BFF layer) comes from `_authed`'s existing
route context (`user.profile.tenant_id`, already threaded through by
`beforeLoad`) — no new plumbing required.

## What's intentionally NOT built (later phases)

- No caching/retry/job-queue hardening (Phase 8)

## Verification performed

- Unit tests: `apps/api/tests/agents/test_seo_agent.py`, 56 tests covering
  all 24 analyzers' PASS/WARNING/FAIL branches, the shared helpers, the
  aggregate scoring formula, `build_node()`'s exception-catching, and a full
  network-free graph run.
- Live E2E against `example.com`: both the poll path (`POST` + `GET`) and
  the SSE stream path produced identical, correctly-persisted 24-dimension
  reports (score 35/F — 2 PASS, 13 WARNING, 9 FAIL, appropriate for a
  near-empty test site); confirmed the SSE `/stream` route is reachable
  before the parameterized route; confirmed Phases 1 and 3 remain
  unaffected (manual context creation, company summary generation on a
  shared extraction).
- Full `tsc --noEmit` typecheck — zero errors in any file this phase
  touched; full `pytest` run — 154 passed, no regressions.

---

# Phase 5 — AEO Agent

## Overview

AEO Agent runs 11 independent, rule-based analyzers against Phase 2's
Website Extraction JSON — one per named agent in the spec (Entity Detection
through Brand Context) — assessing how well AI search engines (ChatGPT,
Perplexity, Google AI Overviews) can find, understand, and cite this
website, producing a single "AEO Score." Architecturally it's Phase 4's twin
(same rule-based/deterministic reasoning, same PASS/WARNING/FAIL internals,
same streaming mechanism, same per-phase decoupling), but with two
deliberate, spec-driven deviations: a **3-field recommendation shape**
(`why_ai_may_fail` / `how_to_improve` / `expected_impact`) instead of Phase
4's 6-field one, and a **strengths/weaknesses partition** computed and
persisted server-side (rather than Phase 4's flat PASS/WARNING/FAIL grid),
since the spec explicitly asks the frontend to "display strengths" and
"display weaknesses." Fully decoupled from Phases 1–4: reads
`website_extractions` read-only via its own data layer, never imports or
modifies any prior phase's agent package or router.

## Data model

**Table:** `aeo_analyses` (DuckDB shim: `apps/local-api/server.js`;
Postgres: `supabase/migrations/0033_aeo_analyses.sql`, tenant-scoped with
RLS, FK to both `website_extractions.id` and `context_plans.id`).

| Column | Notes |
|---|---|
| `id` | uuid, the "Analysis ID" |
| `tenant_id` | FK to `tenants`, RLS-enforced in prod |
| `extraction_id` | FK to `website_extractions.id` — the Phase 2 JSON this analysis was run against |
| `context_id` | denormalized FK to `context_plans.id`, for listing/filtering without a join |
| `status` | `queued` → `analyzing` → `ready` \| `failed` — same lifecycle shape as `seo_analyses` |
| `analysis_data` | JSONB — the ONE normalized `AEOAnalysisResult` (11 agent results + strengths + weaknesses + summary) |
| `overall_score` | denormalized 0-100 int (same formula as `seo_analyses.overall_score`, for cross-phase comparability — Phase 6's recommendation engine will want to combine SEO + AEO scores) |
| `errors` | JSON array |
| `created_at`, `updated_at`, `started_at`, `completed_at` | timestamps |

## Backend — `apps/api/agents/aeo_agent/`

A 14-node **linear** LangGraph — `load_extraction` → 11 analyzer nodes (one
per spec agent) → `aggregate_and_build` → `validator` — kept in a single
`nodes.py` file rather than a `nodes/` package (11 analyzers + 3 bookkeeping
nodes lands well within this codebase's single-file comfort zone,
demonstrated by Phase 4's own 100-195-line theme files):

| File | Role |
|---|---|
| `schema.py` | Pydantic models for the final JSON (`AEOAnalysisResult`, `AeoRecommendation`, `AeoAgentResult`, `AeoStrength`, `AeoWeakness`, `AeoSummary`) + `AGENT_NAMES` (the 11 names, spec order) |
| `state.py` | `AEOAnalysisState` TypedDict — one `*_result` slot per agent |
| `_common.py` | Shared helpers: `rec()`/`result()`/`always_warning()` builders (3-field recommendation shape), `worst()` (FAIL\>WARNING\>PASS), `agent_result_key()` (derives state field names programmatically, same convention as Phase 4's `dimension_result_key()`), `build_node()` (wraps each pure analyzer with try/except → FAIL "agent crashed" on any exception) |
| `nodes.py` | All 11 analyzer functions (`analyze_entity_detection` … `analyze_brand_context`) + `load_extraction_node`, `aggregate_and_build_node` (computes score + partitions PASS results into `strengths` and WARNING/FAIL results into `weaknesses`), `validator_node` |
| `graph.py` | Builds/compiles `AEOAnalysisGraph` — linear: `load_extraction` → 11 analyzers → `aggregate_and_build` → `validator` |
| `data.py` | Reads `website_extractions` read-only via its own duplicated query; owns full CRUD on `aeo_analyses` |
| `service.py` | `ExtractionNotEligible` exception; `prepare_analysis()`/`create_analysis()` (fire-and-forget)/`run_analysis()`/`stream_run()`/`get_analysis()`/`list_analyses()` — identical shape to `seo_agent/service.py` |

**The 11 agents** (spec order = `AGENT_NAMES`), by signal tier:
- **Strong signal**: Entity Detection (company name + named products/services), Question Detection (FAQ entries phrased as questions), FAQ Analysis (count + schema.org markup), Schema Analysis (AI-answer-friendly schema types — `FAQPage`/`Product`/`Article`/`Organization` — contextually expected based on FAQ/products/blog presence), Trust Analysis (SSL/legal pages/certifications/testimonials, reframed as AI-citation-worthiness), Brand Context (name/description/industry/region completeness).
- **Weak/caveated signal** (always attach one informational recommendation noting the evidence limitation, even on PASS): Answer Quality (FAQ answer length as a substance proxy, not accuracy-verified), AI Readability (meta title/description + page-title coverage, a structural proxy only), Content Chunking (distinct page types + FAQ + blog post count as a proxy for discrete AI-retrievable units, not paragraph-level), LLM Readability (fraction of FAQ answers/description text falling in a 40-300 character "extractable snippet" band, a length-based proxy).
- **Pure fallback**: Citation Analysis — no citation/mention-tracking data exists anywhere in the Phase 2 JSON, so this always returns `WARNING` via `always_warning()`, mirroring Phase 4's own signal-less dimensions (Brand Authority, Conversion Optimization, etc.).

**Why not reuse Phase 4's 6-field `SeoRecommendation`**: the spec's own
wording is literally 3 fields ("Why AI search engines may fail" / "How to
improve" / "Expected impact") — flattening that into Phase 4's
Problem/Reason/Recommendation/Impact/Priority/Difficulty shape would silently
invent two fields the spec never asked for.

**Why compute strengths/weaknesses server-side, not in the frontend**: the
spec explicitly names "Display strengths" / "Display weaknesses" as the UI
requirement (unlike Phase 4's PASS/WARNING/FAIL grid), so `aggregate_and_build_node`
partitions every agent result — PASS → `strengths` (a one-line `note`, reusing
the analyzer's own PASS-time caveat text where one exists, else a generic
"passed all checks" sentence) — WARNING/FAIL → `weaknesses` (carrying that
agent's full recommendation list) — into the one persisted JSON, so the
frontend never has to re-derive the split from the flat `agents` array.

**Scoring**: identical formula to Phase 4 — `PASS=2, WARNING=1, FAIL=0` per
agent, equally weighted, `aeo_score = round(100 * sum / 22)` for 11 agents.
No grade letter (unlike Phase 4's A–F) — the spec asks for a singular "AEO
Score," and Phase 6's spec never references a grade; the DB column stays
`overall_score` for symmetry with `seo_analyses`, while the JSON field is
named `summary.aeo_score` to match the spec's own noun.

## Backend API — `apps/api/app/routers/aeo_agent.py`

Registered in `main.py` as `app.include_router(aeo_agent.router, prefix="/aeo-agent", ...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/aeo-agent/analyses` | Fire-and-forget: creates a `queued` row, runs all 11 analyzers in the background, returns immediately |
| `GET` | `/aeo-agent/analyses/{analysis_id}` | Poll one analysis (`?tenant_id=...`) |
| `GET` | `/aeo-agent/analyses` | List (`?extraction_id=...&context_id=...&status=...&limit=...`) |
| `GET` | `/aeo-agent/analyses/stream` | SSE — live per-agent progress (`?extraction_id=...&tenant_id=...`), creates its own independent row. **Registered before** `/analyses/{analysis_id}` — the same route-ordering rule Phases 2/4 already established |

Each `node` SSE event carries `{node, agent, status, index, total}` — the
payload key is `agent` (not `dimension`), matching this spec's own
vocabulary ("independent agents"); zero cross-phase cost since each phase's
SSE payload is shaped independently.

Example:
```bash
curl -X POST http://localhost:8000/aeo-agent/analyses \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"11111111-1111-1111-1111-111111111111","extraction_id":"<extraction_id>"}'
# → {"analysis_id":"...","status":"queued",...}
```

## Frontend — `apps/web`

A dedicated route, mirroring Phase 4's `seo-analysis.$contextId.tsx`:

| File | Role |
|---|---|
| `src/lib/aeo-agent.ts` | New — `createAnalysis`/`getAnalysis`/`listAnalyses`, mirroring `seo-agent.ts`'s shape |
| `src/routes/_authed/aeo-analysis.$contextId.tsx` | New route — thin loader (`getContext`) + wrapper, mirrors `seo-analysis.$contextId.tsx`'s shape |
| `src/components/aeo-agent/AeoAnalysisPage.tsx` | New — live progress is a **flat 11-item checklist** (no theme grouping, unlike Phase 4's 5 sections — 11 agents fits on one screen); once ready, renders an AEO Score panel (no grade badge) followed by an explicit **Strengths** section (flat list) and a **Weaknesses** section (expandable cards showing `why_ai_may_fail`/`how_to_improve`/`expected_impact`) — a genuine structural difference from Phase 4's PASS/WARNING/FAIL grid, driven directly by the spec's wording |
| `src/components/context-planner/ContextPlannerPage.tsx` | Additive only — one new "Run AEO Analysis →" link added inside the existing Drawer, alongside the existing "Run SEO Analysis →" link |

## What's intentionally NOT built (later phases)

- No caching/retry/job-queue hardening (Phase 8)

## Verification performed

- Unit tests: `apps/api/tests/agents/test_aeo_agent.py`, 45 tests covering
  all 11 analyzers' PASS/WARNING/FAIL branches, the shared helpers, the
  aggregate scoring formula, the strengths/weaknesses partition, and a full
  network-free graph run.
- Live E2E against `example.com`: both the poll path (`POST` + `GET`) and
  the SSE stream path produced identical, correctly-persisted 11-agent
  reports (score 23 — 0 PASS, 6 WARNING, 5 FAIL, appropriate for a
  near-empty test site with no FAQ/products/schema markup); confirmed the
  `agent` SSE payload key (not `dimension`); confirmed the SSE `/stream`
  route is reachable before the parameterized route; confirmed persistence
  via `GET /rest/v1/aeo_analyses`; confirmed Phase 4 (SEO Agent) remains
  unaffected on the same shared extraction.
- Full `pytest` run — 199 passed (154 prior + 45 new), no regressions. Full
  `tsc --noEmit` typecheck — zero errors in any file this phase touched
  (pre-existing unrelated errors in `src/lib/leads.ts` predate this phase).

---

# Phase 6 — Recommendation Engine

## Overview

Recommendation Engine consumes two already-computed reports — the SEO
Agent's 24-dimension report and the AEO Agent's 11-agent report — plus the
underlying Website Extraction JSON, and produces ONE consolidated report
where every recommendation (regardless of which upstream check produced it)
carries a unified 10-field shape: Severity, Priority, Problem, Reason, Fix,
Estimated Time, Expected SEO Impact, Expected AEO Impact, Difficulty, and
Category. Recommendations are grouped into Critical/High/Medium/Low, with
sorting, filtering, and CSV export. Architecturally this phase is a
**transformation pipeline over two already-computed reports**, not an
analyzer fan-out like Phase 4/5 — there's a real sequential data dependency
between its 7 nodes, so it needs no per-node crash isolation. Fully
decoupled from Phases 1–5: reads `website_extractions`, `seo_analyses`, and
`aeo_analyses` read-only via its own data layer, never imports or modifies
any prior phase's agent package or router.

## Data model

**Table:** `recommendation_reports` (DuckDB shim: `apps/local-api/server.js`;
Postgres: `supabase/migrations/0034_recommendation_reports.sql`,
tenant-scoped with RLS, FK to `website_extractions.id`, `context_plans.id`,
`seo_analyses.id`, and `aeo_analyses.id`).

| Column | Notes |
|---|---|
| `id` | uuid, the "Report ID" |
| `tenant_id` | FK to `tenants`, RLS-enforced in prod |
| `extraction_id`, `context_id` | FKs, denormalized for listing |
| `seo_analysis_id`, `aeo_analysis_id` | FKs to the specific SEO/AEO rows this report was built from (traceability/audit) |
| `status` | `queued` → `generating` → `ready` \| `failed` |
| `report_data` | JSONB — the ONE normalized `RecommendationReportResult` (recommendations + severity groups + summary) |
| `combined_score` | denormalized 0-100 int — average of the SEO and AEO overall scores |
| `errors`, `created_at`, `updated_at`, `started_at`, `completed_at` | as in every prior phase |

## Backend — `apps/api/agents/recommendation_engine/`

A short 7-node **linear** LangGraph — `load_reports` → `normalize_seo` →
`normalize_aeo` → `merge_and_sort` → `group_by_severity` → `build_summary` →
`validator` — kept in a single `nodes.py` (no `nodes/` package, matching
`aeo_agent`'s precedent for a small node count):

| File | Role |
|---|---|
| `schema.py` | Pydantic models for the final JSON (`RecommendationReportResult`, `RecommendationItem`, `SeverityGroups`, `RecommendationSummary`) |
| `state.py` | `RecommendationEngineState` TypedDict |
| `_common.py` | `derive_severity()` (status × priority/impact → 4-value Severity), `CATEGORY_MAP` + `category_for()` (the curated taxonomy, below), `estimated_time_for()` (difficulty → human bucket), `grade_for()` (reused A–F banding), `sort_key()` (severity desc, then priority desc) |
| `nodes.py` | `load_reports_node`, `normalize_seo_node`, `normalize_aeo_node`, `merge_and_sort_node`, `group_by_severity_node`, `build_summary_node`, `validator_node` |
| `graph.py` | Builds/compiles `RecommendationEngineGraph` |
| `data.py` | `get_extraction()`, `get_latest_ready_seo_analysis()`, `get_latest_ready_aeo_analysis()` (read-only dups, preserving decoupling); owns full CRUD on `recommendation_reports` |
| `service.py` | `ReportNotEligible`; `prepare_report()`/`create_report()`/`run_report()`/`stream_run()`/`get_report()`/`list_reports()` — identical shape to `seo_agent`/`aeo_agent`'s services |

**Consolidation field mapping** — SEO's 6-field `SeoRecommendation` and
AEO's 3-field `AeoRecommendation` are flattened into the unified shape.
Recommendations are pulled from *every* dimension/agent's `recommendations`
array regardless of parent status — several checks (`Local SEO`, `Answer
Quality`, `AI Readability`, `Content Chunking`, `LLM Readability`, etc.)
attach an informational caveat recommendation even on `PASS`, and those are
not dropped. Fields with no source-side analogue get an honest, never-
fabricated placeholder — the direct analogue of `always_warning()`'s "never
invent a verdict where there's no signal" rule:
- `expected_seo_impact` / `expected_aeo_impact` gain a 4th enum value
  (`"not_applicable"`) for the report that has no signal on that axis (a
  SEO item has no AEO-specific impact, and vice versa).
- `difficulty` gains a 4th value (`"unknown"`) for AEO items, which carry
  no difficulty signal at all.
- AEO's single explanatory field (`why_ai_may_fail`) is honestly reused for
  *both* the unified `problem` and `reason` fields (duplicated, not
  invented) since AEO has no problem/reason split; AEO's `expected_impact`
  is reused as `priority` (its closest existing analogous signal).

**Severity derivation** (`derive_severity()`) — a small matrix combining
parent `status` with the source's priority/impact level, since `priority`
stays a straight 3-value passthrough but the grouping mandate needs a
4-value scale:
```
FAIL + high -> Critical      WARNING + high -> High
FAIL + medium -> High        WARNING + medium -> Medium
FAIL + low -> Medium         WARNING + low -> Low
PASS + * -> Low   (caveat/informational recs on an otherwise-passing check)
```

**Category taxonomy** (`CATEGORY_MAP`) — a curated, 9-bucket taxonomy
(Business Identity & Local Presence, Products & Services, Content &
Messaging, FAQ & Structured Q&A, Technical & Structured Data, Trust &
Authority, Media & Links, Performance & Accessibility, Discovery &
Conversion) that every one of the 24 SEO dimension names and 11 AEO agent
names maps into exactly once (enforced by a unit test). Chosen deliberately
over a pass-through-the-source-name alternative — confirmed with the user —
so that, e.g., SEO's "Trust" and AEO's "Trust Analysis" land in the same
"Trust & Authority" bucket, making filtering-by-category a genuine
cross-report rollup rather than 35 disjoint per-check labels.

**Estimated Time** (`estimated_time_for()`) — a deterministic lookup keyed
by `difficulty` (`low`→"1-2 hours", `medium`→"1-3 days", `high`→"1-2 weeks",
`unknown`→an honest "Unscoped" string for AEO items).

**Scoring**: `combined_score = round((seo_overall_score + aeo_overall_score) / 2)`
— the averaging Phase 5's own architecture note already anticipated —
banded into a `combined_grade` (A–F) reusing Phase 4's grade thresholds.

**Prerequisites**: the caller passes only `extraction_id` (mirrors "most
recent by `created_at` is canonical" from Phase 3+); `prepare_report()`
looks up the **latest `status='ready'`** `seo_analyses` and `aeo_analyses`
rows for that extraction, raising `ReportNotEligible` if the extraction or
either report isn't ready — the exact same eligibility-gate shape as
`ExtractionNotEligible` in Phase 4/5.

## Backend API — `apps/api/app/routers/recommendation_engine.py`

Registered in `main.py` as
`app.include_router(recommendation_engine.router, prefix="/recommendation-engine", ...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/recommendation-engine/reports` | Fire-and-forget: validates a latest-ready SEO+AEO analysis exists for `extraction_id`, creates a `queued` row, runs the 7-node pipeline in the background |
| `GET` | `/recommendation-engine/reports/{report_id}` | Poll one report (`?tenant_id=...`) |
| `GET` | `/recommendation-engine/reports` | List (`?extraction_id=...&context_id=...&status=...&limit=...`) |
| `GET` | `/recommendation-engine/reports/stream` | SSE — 7 `node` events (one per pipeline stage, not per-recommendation) then `event: result`. **Registered before** `/reports/{report_id}` — the same route-ordering rule Phases 2/4/5 already established |

Each `node` SSE event carries `{node, label, index, total, count}` — `count`
is the length of that stage's relevant intermediate list (e.g.
`normalize_seo` reports how many SEO recommendations were flattened),
`null` for stages with no natural count (e.g. `validator`).

Example:
```bash
curl -X POST http://localhost:8000/recommendation-engine/reports \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"11111111-1111-1111-1111-111111111111","extraction_id":"<extraction_id>"}'
# → {"report_id":"...","status":"queued",...}
```

## Frontend — `apps/web`

A dedicated route, mirroring Phase 4/5's shape but one level deeper in its
"ensure prerequisites ready" chain:

| File | Role |
|---|---|
| `src/lib/recommendation-engine.ts` | New — `createReport`/`getReport`/`listReports`, mirroring `aeo-agent.ts`'s shape |
| `src/routes/_authed/recommendation-engine.$contextId.tsx` | New route — thin loader (`getContext`) + wrapper |
| `src/components/recommendation-engine/RecommendationEnginePage.tsx` | New — "Generate Recommendations" chains one level deeper than Phase 4/5: ensure extraction ready → ensure a latest-ready SEO analysis exists (trigger one if not) → ensure a latest-ready AEO analysis exists (trigger one if not) → SSE-stream the 7-stage consolidation pipeline. Report view: a **Combined Score** header (score/grade + SEO/AEO sub-scores + severity counts), a **filter/sort toolbar** (severity toggle chips, source dropdown, category dropdown, sort-by dropdown — all pure client-side array operations over the one fetched `report_data.recommendations`, no new backend query params), **Critical/High/Medium/Low collapsible sections** each with expandable recommendation cards showing all 10 fields + category + source badge, and an **Export CSV** button (client-side `Blob` + `URL.createObjectURL` + hidden `<a download>` — built from scratch, since no reusable export utility existed anywhere in `apps/web/src`) |
| `src/components/context-planner/ContextPlannerPage.tsx` | Additive only — one new "Generate Recommendations →" link added inside the existing Drawer, alongside the SEO/AEO links |

Sorting/filtering/export were deliberately kept client-side rather than new
`GET` query params — both SEO (24 items) and AEO (11 items) already render
their whole bounded report client-side, and Phase 6's ~40-item consolidated
list is similarly bounded, so this avoids new backend surface. This also
keeps Phase 6's export narrowly scoped to "the flat recommendations list,"
leaving Phase 7 (Report Generator) to own JSON/Markdown/PDF narrative
export as its own spec already describes.

## What's intentionally NOT built (later phases)

- No caching/retry/job-queue hardening (Phase 8)

## Verification performed

- Unit tests: `apps/api/tests/agents/test_recommendation_engine.py`, 23
  tests covering the severity-derivation matrix, `CATEGORY_MAP` completeness
  (every SEO dimension + AEO agent name maps exactly once), estimated-time
  bucketing, sort ordering, each of the 7 nodes (including confirming
  PASS-time caveat recommendations are not dropped during normalization,
  and that `not_applicable`/`unknown` land exactly where expected),
  `service.prepare_report()`'s three `ReportNotEligible` branches (missing
  extraction, no ready SEO analysis, no ready AEO analysis), and a full
  network-free graph run.
- Live E2E chaining all 6 built phases against `example.com`: context →
  extraction → SEO analysis → AEO analysis → recommendation report, via
  both the poll path (`POST` + `GET`) and the SSE stream path (confirmed
  exactly 7 `node` events with accurate per-stage counts, e.g. 28 SEO + 12
  AEO = 40 total recommendations, then `event: result`); confirmed
  `critical_count + high_count + medium_count + low_count == total_count`
  and `groups` sums match the flat `recommendations` list; confirmed
  persistence via `GET /rest/v1/recommendation_reports`; confirmed Phases
  1–5 endpoints remain unaffected on the same shared extraction.
- Full `pytest` run — 222 passed (199 prior + 23 new), no regressions. Full
  `tsc --noEmit` typecheck — zero errors in any file this phase touched
  (pre-existing unrelated errors in `src/lib/leads.ts` predate this phase).

---

# Phase 7 — Report Generator

## Overview

Report Generator produces a full narrative audit report with 11 named
sections (Executive Summary, Company Overview, Website Summary, SEO Summary,
AEO Summary, Overall Score, Strengths, Weaknesses, Priority Fixes, Technical
Details, Recommendations), exportable as JSON / Markdown / PDF, with stored
report history and regeneration. Unlike Phases 4-6 it consolidates the
outputs of *all* prior phases: it anchors on a latest-ready Phase 6
recommendation report and, via that row's stored `seo_analysis_id`/
`aeo_analysis_id`, pulls the exact SEO/AEO reports it consolidated, plus the
extraction and the optional company summary — one consistent snapshot.
Fully decoupled: reads `recommendation_reports`, `website_extractions`,
`seo_analyses`, `aeo_analyses`, `company_summaries` read-only via its own
data layer, never imports/modifies any prior phase's package or router.

**Naming note**: an unrelated marketing "Reports" feature already owns
`/reports`, `lib/reports.ts`, `routes/_authed/reports.tsx`, so this phase
uses fully distinct names throughout: table `generated_reports`, router
prefix `/report-generator`, package `agents/report_generator/`, frontend
`report-generator.*`.

## Data model

**Table:** `generated_reports` (DuckDB shim: `apps/local-api/server.js`;
Postgres: `supabase/migrations/0035_generated_reports.sql`, tenant-scoped
with RLS, FK to `website_extractions.id`, `context_plans.id`,
`recommendation_reports.id`, `seo_analyses.id`, `aeo_analyses.id`, and
nullable `company_summaries.id`).

| Column | Notes |
|---|---|
| `id` | uuid, the "Report ID" |
| `tenant_id` | FK to `tenants`, RLS-enforced |
| `extraction_id`, `context_id` | FKs, denormalized for listing |
| `recommendation_report_id` | the Phase 6 anchor this report was built from |
| `seo_analysis_id`, `aeo_analysis_id` | the exact SEO/AEO rows Phase 6 consolidated (consistency/traceability) |
| `company_summary_id` | nullable — Phase 3 is optional; Company Overview falls back to `extraction_data.company` |
| `status` | `queued` → `generating` → `ready` \| `failed` |
| `report_data` | JSONB — the ONE normalized `ReportResult` (11 sections + summary + meta) |
| `markdown_content` | text — the rendered Markdown artifact, stored at build time (makes Markdown export a trivial download and keeps it consistent even if template code later changes) |
| `overall_score` | denormalized int (= Phase 6 combined_score) |
| `errors`, timestamps | as in every prior phase |

Rows accumulate per extraction/context (report history); "latest by
`created_at`" is the default view.

## Backend — `apps/api/agents/report_generator/`

A 6-node **linear** LangGraph — `load_inputs` → `generate_narratives` →
`assemble_structured` → `build_report` → `render_markdown` → `validator` —
in a single `nodes.py`. Like Phase 6 it's a transformation pipeline over
already-computed upstream reports (genuine sequential dependency), not an
analyzer fan-out.

| File | Role |
|---|---|
| `schema.py` | `ReportResult` (11 sections + `ReportSummary` + `ReportMeta`) + `RecommendationItem` (11 fields, DUPLICATED from Phase 6 — decoupling), `OverallScoreSection`, `StrengthItem`/`WeaknessItem`, `TechnicalDetails` |
| `state.py` | `ReportGeneratorState` TypedDict |
| `_common.py` | pure deterministic helpers: `deterministic_narratives()` (the 5 prose templates — the fallback AND the only path in dev), `assemble_strengths()`/`assemble_weaknesses()`/`assemble_technical_details()`/`extract_priority_fixes()`, `render_markdown()`, `grade_for()` |
| `llm.py` | Groq-direct narrative generation (`has_groq()`, `generate_narratives()`, `SYSTEM_PROMPT`, all-or-nothing `_valid_shape` = exactly the 5 narrative keys) — mirrors `company_summary/llm.py`. Returns None when unconfigured → deterministic fallback |
| `nodes.py` | the 6 nodes |
| `graph.py` | `ReportGraph = build_graph()` |
| `data.py` | read-only dups: `get_extraction`, `get_latest_ready_recommendation_report`, `get_seo_analysis(id)`, `get_aeo_analysis(id)`, `get_latest_ready_company_summary`; CRUD on `generated_reports` |
| `service.py` | `ReportNotEligible`; `prepare_report`/`create_report` (fire-and-forget)/`run_report`/`stream_run`/`get_report`/`list_reports` |

**Narrative sections — hybrid LLM/deterministic** (confirmed with user):
the 5 prose sections (Executive/Company/Website/SEO/AEO Summary) are
Groq-generated when a key is present (`generate_narratives_node` tries
`llm.generate_narratives()`), falling back to `_common`'s deterministic
templates otherwise. Since dev has no Groq key, the deterministic path runs
in dev and is load-bearing; `report_data.meta.engine` records which path
ran (`"deterministic"` in dev). The LLM only ever sees already-computed
facts and writes prose — it never invents scores or recommendations.

**Structured sections — always deterministic**: Overall Score ← Phase 6
`summary`; Strengths = AEO `strengths[]` + SEO `PASS` dimensions; Weaknesses
= AEO `weaknesses[]` + SEO `FAIL`/`WARNING` dimensions (each carrying its
first recommendation's text as detail — PASS-time caveats included, nothing
dropped); Priority Fixes = Phase 6 `groups.critical` + `groups.high`;
Technical Details ← `extraction_data.technical_seo`/`.technology`/`.trust`;
Recommendations = Phase 6 `recommendations[]` verbatim.

**Eligibility** (`prepare_report`): requires the extraction to be `ready`
AND a latest-ready `recommendation_reports` row to exist (which transitively
guarantees ready SEO+AEO), then fetches the exact SEO/AEO rows that row
referenced. Raises `ReportNotEligible` (→ 400) on any missing/not-ready
prerequisite.

## Backend API — `apps/api/app/routers/report_generator.py`

Registered in `main.py` as
`app.include_router(report_generator.router, prefix="/report-generator", ...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/report-generator/reports` | Fire-and-forget: validates the Phase 6 anchor, creates a `queued` row, runs the 6-node pipeline in the background |
| `GET` | `/report-generator/reports/{report_id}` | Poll one report (`?tenant_id=...`) |
| `GET` | `/report-generator/reports` | List (report history; `?extraction_id=...&context_id=...&status=...&limit=...`) |
| `GET` | `/report-generator/reports/stream` | SSE — 6 `node` events (pipeline-stage progress) then `event: result`. **Registered before** `/reports/{report_id}` |

## Frontend — `apps/web`

A dedicated route mirroring Phase 6, but with export + history + regenerate:

| File | Role |
|---|---|
| `src/lib/report-generator.ts` | `createReport`/`getReport`/`listReports` + TS interfaces for the 11-section `ReportData` + `markdown_content` |
| `src/routes/_authed/report-generator.$contextId.tsx` | thin loader (`getContext`) + wrapper |
| `src/components/report-generator/ReportGeneratorPage.tsx` | Generate flow chains one level deeper than Phase 6 (ensure extraction → SEO → AEO → recommendation report ready, each triggered if absent, then SSE-stream the 6-stage report pipeline). Renders the 11 sections (prose Panels; Overall Score header; Strengths/Weaknesses source-badged lists; Priority Fixes + Recommendations expandable cards; Technical Details key/value grid). **Report history selector** (dropdown of prior reports by `created_at`, loads any past report from the list query), **Regenerate** button (POST again → new row), and **3 client-side export buttons**: JSON (Blob of `report_data`), Markdown (Blob of the stored `markdown_content`), PDF (`window.print()` over a print-scoped `@media print` render that hides app chrome via a visibility toggle) |
| `src/components/context-planner/ContextPlannerPage.tsx` | Additive only — one new "Generate Report →" link in the Drawer, alongside SEO/AEO/Recommendations |

Export design: JSON + Markdown are the machine-readable artifacts (Markdown
pre-rendered and stored server-side); PDF is a browser "save a copy"
convenience via `window.print()` — zero new dependencies (there is no PDF or
Markdown library anywhere in the project, confirmed). Phase 7 owns the
narrative-document export the master plan assigned it; Phase 6's export
stayed the flat recommendations CSV.

## What's intentionally NOT built (later phases)

- No caching/retry/job-queue hardening (Phase 8)

## Verification performed

- Unit tests: `apps/api/tests/agents/test_report_generator.py`, 19 tests
  covering the deterministic narrative templates (non-empty, graceful
  "Unknown" on empty input, no fabrication), structured assembly (Strengths
  = AEO strengths + SEO PASS; Weaknesses = AEO weaknesses + SEO
  FAIL/WARNING; Priority Fixes = Phase 6 critical+high; Technical Details
  field-mapping; Recommendations pass-through), `render_markdown`
  completeness (all 11 headings + score), the 6 nodes' skip-when-failed
  behavior, the validator, the Groq `_valid_shape` (accept exact 5 keys,
  reject partial/extra/blank), `service.prepare_report`'s `ReportNotEligible`
  branches, and a full network-free graph run asserting all 11 sections +
  `overall_score == combined_score` + `meta.engine == "deterministic"`.
- Live E2E chaining all 7 phases against `example.com`: context → extraction
  → SEO → AEO → recommendation → report, via both poll and SSE (confirmed
  exactly 6 `node` stage events then `event: result`); confirmed all 11
  sections present, `priority_fix_count == critical + high` (19 = 13 + 6),
  `recommendations` count matches Phase 6 (40), all 11 Markdown headings
  present, `overall_score` == the anchor's combined_score (29),
  `meta.engine == "deterministic"`; confirmed a clean 400 on an extraction
  with no ready recommendation report; confirmed persistence via
  `GET /rest/v1/generated_reports`; confirmed Phases 1–6 endpoints
  unaffected on the same shared extraction.
- Full `pytest` run — 241 passed (222 prior + 19 new), no regressions. Full
  `tsc --noEmit` typecheck — zero errors in any file this phase touched
  (pre-existing unrelated errors in `src/lib/leads.ts` predate this phase).
