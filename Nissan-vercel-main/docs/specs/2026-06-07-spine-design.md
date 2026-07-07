# ADIP — Foundation Spine Design Spec

**Project:** Agentic Dealership Intelligence Platform (ADIP) — internally "Dealer Intelligence OS"
**Date:** 2026-06-07
**Status:** Approved (pending written-spec review)
**Scope of this doc:** The shared **spine** only. Module domains (Lead, Campaign, Vehicle, Offer, Analytics) are specified separately in Phase 2.

---

## 1. Product North Star

ADIP is a multi-tenant SaaS that becomes the **operating system for car dealerships** (Phase 1 customer: Nissan dealers). It unifies four products that today live in scattered tools, spreadsheets, and WhatsApp:

1. **Marketing Automation** — AI-generated campaigns, posters, captions; approval + publishing.
2. **Lead Management (CRM)** — unified lead inbox, scoring, assignment, follow-up, pipeline.
3. **Market Intelligence** — signals engine: campaign ROI, lead-source performance, regional demand, vehicle trends.
4. **Executive Copilot** — chat assistant across all data: "which leads should I call today?"

Anchored by **Customer 360** — one canonical customer every module orbits.

**One-line pitch:** *An AI-powered multi-tenant Dealer Intelligence OS that helps dealerships generate marketing content, manage leads, discover business opportunities, and receive AI-driven recommendations from a single platform.*

**Design north star:** Salesforce + HubSpot + Notion + ChatGPT, purpose-built for automotive dealerships. The **dashboard is the center** of the experience; every module contributes insight cards back to it.

---

## 2. Goals & Scope

This effort runs two interleaved tracks on **one codebase** — the demo is not throwaway, it is the spine plus thin module slices.

### Track A — Demo Shell (immediate deadline)
A working app demonstrating the full vision end-to-end. **Real:** auth, sessions, RLS isolation, DB schema, API contracts, navigation, plan/role gating. **Mocked/simplified:** AI generation, external integrations, ML scoring, copilot reasoning.

### Track B — Foundation Spine (long-term)
Multi-tenant architecture, domain model, schema, security model, API boundaries, agent-orchestration design, subscription model, module boundaries — built so the demo sits on top of the same architecture rather than becoming throwaway code.

### In scope for the spine
Tenancy · Locations · Users · Roles & permissions · Subscription/module gating · Customer (canonical anchor) · Agent Registry · Notifications (table) · Audit logs (table) · Tenant branding · Auth · RLS isolation · API conventions · App shell + Mission-Control dashboard + navigation · Repo scaffold + `CLAUDE.md`.

### Explicitly out of the spine (owned by module specs)
Lead, Campaign, Vehicle, Offer, Test Drive, Quotation, Interaction, Campaign Response, Analytics models, and all AI/agent implementations.

---

## 3. Architecture & Stack Boundary

```
┌─────────────────────────────────────────────────────────┐
│  TanStack Start  (apps/web)  — Frontend + BFF            │
│  routing · SSR · UI · session/cookies · Server Functions │
│  NO core business logic                                  │
└───────────────┬─────────────────────────────────────────┘
                │  Server Functions call the API (forward JWT)
┌───────────────▼─────────────────────────────────────────┐
│  FastAPI  (apps/api)  — The System API                  │
│  business logic · workflow + agent orchestration         │
│  (LangGraph) · integrations · AI services · analytics    │
│  Calls Supabase WITH the caller's JWT (RLS in force)     │
└───────────────┬─────────────────────────────────────────┘
┌───────────────▼─────────────────────────────────────────┐
│  Supabase  — PostgreSQL · Auth · Storage · Realtime     │
│  RLS policies = the security boundary                    │
└─────────────────────────────────────────────────────────┘
```

**Stack:** TanStack Start / Query / Table · Shadcn UI · Tailwind · FastAPI · Supabase (Postgres + Auth + Storage + Realtime) · Claude/OpenAI · LangGraph.

---

## 4. Tenancy Model (two-level)

```
tenant (Dealer)  e.g. "ABC Nissan"
  └── location (Showroom)  e.g. "ABC Nissan — Velachery"
        └── users scoped to one or more locations
```

- `tenant` = the dealer. Top isolation boundary.
- `location` = a showroom under a dealer.
- A user belongs to **one tenant**, and may be scoped to **one or more locations** within it.
- Every domain table carries `tenant_id`; tables that are location-specific also carry `location_id`.

**Future (designed-for, not built):** a third level — OEM / Nissan Corporate above tenants, and a Platform Admin above everything. The schema reserves room (nullable `parent_org_id` concept) but V1 ships flat two-level.

---

## 5. Identity, Roles & Permissions

**Roles (V1):**

| Role | Scope | Capability summary |
|---|---|---|
| `dealer_owner` | Whole tenant | Full access, billing, all locations |
| `dealer_manager` | Assigned locations | Manage leads/marketing/users within location(s) |
| `sales_executive` | Assigned locations | Own leads, follow-ups, test drives, quotations |
| `marketing_executive` | Assigned locations | Campaigns, content, publishing |

**Reserved (future):** `platform_admin`, `oem_viewer` (read-only across a brand's dealers).

**Mechanism:** role is an enum on `users`; a **permission matrix** (role → allowed actions/modules) lives in shared app config consumed by both FastAPI (authorization) and TanStack (nav gating). This is deliberately simpler than a full RBAC table for V1 and expands cleanly later.

---

## 6. Subscription & Module Gating

`subscription_plan` is an enum on the tenant. Plan determines which modules are visible/usable:

| Plan | Modules |
|---|---|
| `starter` | Lead Management |
| `growth` | + Marketing Automation |
| `intelligence` | + Market Intelligence + Copilot |
| `enterprise` | + multi-location, API access, custom integrations |

Navigation renders the intersection of **plan** (module available) and **role** (action permitted).

---

## 7. Tenant Isolation — the critical decision

**RLS at the Postgres layer is the security boundary. Application-level filtering is supplementary and never relied upon for isolation.**

- Every domain table has `tenant_id uuid not null`.
- Supabase Auth JWT carries `tenant_id` and `role` as **custom claims**, set via an auth hook / Postgres function at login.
- Standard RLS policy on every domain table:
  ```sql
  using ( tenant_id = (auth.jwt() ->> 'tenant_id')::uuid )
  ```
  (wrapped in an `auth.tenant_id()` helper). Location-scoped access is layered on top where required.
- **FastAPI queries Supabase using the caller's JWT — not the service-role key** — so RLS is actually enforced on every read and write. The service-role key is reserved for explicit, audited system/admin operations only.

> ⚠️ The single easiest way to make this whole model theater: have the API use the service-role key for normal data access. RLS is then silently bypassed. This is a hard rule, not a preference.

---

## 8. Spine Data Model

The spine contains exactly the shared core. Columns below are the V1 minimum; timestamps (`created_at`, `updated_at`) and `tenant_id` (where applicable) are implied on all tables.

### `tenants`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | dealer name |
| brand | text | e.g. "Nissan" |
| subscription_plan | enum | starter / growth / intelligence / enterprise |
| status | enum | active / suspended |
| branding | jsonb | logo_url, primary_color, theme — drives white-label / premium feel |

### `locations`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid fk → tenants | |
| name | text | showroom name |
| address | jsonb | |
| status | enum | active / inactive |

### `users` (1:1 with Supabase `auth.users`)
| column | type | notes |
|---|---|---|
| id | uuid pk | = `auth.users.id` |
| tenant_id | uuid fk → tenants | |
| full_name | text | |
| email | text | |
| role | enum | dealer_owner / dealer_manager / sales_executive / marketing_executive |
| status | enum | active / invited / disabled |

### `user_locations` (many-to-many: user ↔ showroom)
| column | type | notes |
|---|---|---|
| user_id | uuid fk → users | |
| location_id | uuid fk → locations | |

### `customers` — canonical Customer 360 anchor (identity only)
The **one** domain entity in the spine, because every module FKs to it. Kept thin; rich profile is composed (§9).
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid fk → tenants | |
| location_id | uuid fk → locations | primary showroom |
| full_name | text | |
| phone | text | |
| email | text | |
| preferred_vehicle | text | nullable |
| source_channel | text | first-touch channel |
| consent | jsonb | marketing/communication consent |

### `agent_registry` — AI agent catalog (day-1, mostly stubbed)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid fk → tenants | nullable for global/system agents |
| name | text | |
| description | text | |
| module | enum | marketing / leads / intelligence / copilot / platform |
| agent_type | enum | advisor / automation / generator / analyzer / copilot |
| status | enum | stub / active / disabled |
| version | text | |
| config | jsonb | model, prompts, tool refs (later) |

**Seeded agents (status `stub`):**

| name | module | agent_type |
|---|---|---|
| Campaign Planner | marketing | advisor |
| Content Generator | marketing | generator |
| Lead Scorer | leads | analyzer |
| Lead Assignment | leads | automation |
| Follow-up Advisor | leads | advisor |
| Demand Signal | intelligence | analyzer |
| Executive Copilot | copilot | copilot |

### `notifications` — in-app notifications (table only; delivery deferred)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid fk → tenants | |
| user_id | uuid fk → users | recipient |
| title | text | |
| message | text | |
| status | enum | unread / read / dismissed |

**Future notification types (not built):** Follow-up Reminder, Campaign Approved, Hot Lead Alert.

### `audit_logs` — enterprise audit trail (table only; full pipeline deferred)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid fk → tenants | |
| user_id | uuid fk → users | actor (nullable for system) |
| action | text | e.g. "lead.updated", "campaign.approved" |
| entity_type | text | |
| entity_id | uuid | |
| metadata | jsonb | before/after, context |
| created_at | timestamptz | |

---

## 9. Customer 360 as a Composed Read-Model

Customer 360 is the product's heart **without** coupling the spine to module domains.

```
                 customers (spine, canonical identity)
                        ▲  ▲  ▲  ▲  ▲
        ┌───────────────┘  │  │  │  └───────────────┐
   leads (Lead mod)   interactions  test_drives  quotations  campaign_responses
                                (all module-owned, FK → customer_id)

  Customer 360 profile = COMPOSITION of these satellites at read time
  (assembled by the API / a read view), NOT a single fat table.
```

- The spine owns only `customers` (identity).
- Modules own their satellite tables and each FKs `customer_id`.
- The 360 view is assembled by the API (and may later be a Postgres view / materialized read-model). Modules stay decoupled; the customer stays canonical.

---

## 10. API Conventions (FastAPI)

- An auth dependency extracts `tenant_id` + `role` from the JWT on every request; unauthenticated requests are rejected.
- RESTful resources, plural nouns, consistent **error envelope**, **cursor pagination**.
- FastAPI accesses Supabase with the caller's JWT so RLS applies (§7).
- Authorization (role → action) checked in the API via the shared permission matrix; RLS is the backstop for tenant isolation.
- Business logic, workflow/agent orchestration (LangGraph), integrations, and AI services live here — never in TanStack.

---

## 11. App Shell (TanStack Start)

- **Auth:** Supabase Auth login; session via Server Functions + httpOnly cookies. Protected routes redirect unauthenticated users.
- **BFF:** Server Functions are the only place the web app calls FastAPI; they forward the JWT. No business logic in the web tier.
- **Navigation (dashboard-centric):**
  ```
  Dashboard · Leads · Marketing · Intelligence · Copilot · Customers · Reports · Settings
  ```
  Items render per plan × role. Dashboard aggregates insight cards contributed by each module.

- **Dashboard = Mission Control (highest-effort screen).** Not "4 cards + 2 charts." The first impression for Nissan comes from here. Layout:
  ```
  ┌────────────────────────────────────────────────────────┐
  │  Good morning, Muthukumar            [location switch]  │  ← personalized greeting
  ├────────────────────────────────────────────────────────┤
  │  18 Hot Leads   3 Test Drives Today   2 Campaigns Sched │  ← hero metrics (live counts)
  ├────────────────────────────────────────────────────────┤
  │  AI Recommendations                                     │  ← the "wow" row
  │   • SUV demand increasing in Villupuram                 │
  │   • 5 leads waiting for follow-up                       │
  │   • Weekend campaign recommended                        │
  ├────────────────────────────────────────────────────────┤
  │  Module insight cards (Marketing · Leads · Intelligence)│
  └────────────────────────────────────────────────────────┘
  ```
  Recommendation/insight content may be sourced from the Agent Registry stubs (canned for the demo); the **layout and feel are production-grade**, not mock. Build priority for tomorrow weights ~80% UX polish / 20% foundation — the spine is already good enough.
- **Demo build discipline:** all eight nav sections appear; only the **7 MVP screens** are built for the deadline (Dashboard, Marketing Calendar, AI Poster Generation, Lead Pipeline, Lead Detail, Market Intelligence Dashboard, Copilot Chat). Customers / Reports / Settings render as polished placeholders.

---

## 12. Repo Structure

```
adip/
├── CLAUDE.md                       # persistent project context (stack, rules, conventions)
├── README.md
├── docs/
│   └── specs/
│       ├── 2026-06-07-spine-design.md   # this doc
│       └── <module specs added in Phase 2>
├── apps/
│   ├── web/                        # TanStack Start (frontend + BFF)
│   └── api/                        # FastAPI (system API)
└── supabase/
    ├── migrations/                 # schema
    └── policies/                   # RLS policies
```

---

## 13. Build Orchestration

```
PHASE 0  Spec the spine            ← this document (single focused effort)
            │ frozen contract: tenancy, auth, entities, RLS, API shape
            ▼
PHASE 1  Build the spine           ← sequential, single orchestrator
            │ "Salesforce+HubSpot+ChatGPT for dealers" design pass first
            │ (navigation, dashboard layout, user journeys, UI patterns,
            │  Customer 360 model, Agent Registry model, enterprise SaaS UI)
            │ then: repo scaffold · CLAUDE.md · Supabase schema + RLS · auth
            │ · FastAPI tenant-aware skeleton · TanStack app shell + nav
            ▼   ◄── frozen spine = the interface that unblocks parallelism
PHASE 2  Modules in parallel       ← one subagent/team per module + shared UI agent
            ├── Marketing      (Calendar + Poster screen)
            ├── Lead Mgmt      (Pipeline + Detail)
            ├── Intelligence   (Signals dashboard)
            └── Copilot        (Chat interface)
```

Parallel agents are correct **only after** the spine is frozen — before that, modules would disagree about what a tenant, customer, or lead is. Each Phase 2 agent receives `CLAUDE.md` + its module spec + the frozen spine contract.

---

## 14. Acceptance Criteria (spine "done")

1. A user can sign up / log in via Supabase Auth; session persists via Server Functions + cookies.
2. JWT carries `tenant_id` + `role` custom claims.
3. Schema for all §8 tables exists with migrations (incl. `notifications`, `audit_logs`, tenant `branding`); `agent_registry` seeded with the 7 stub agents and their `agent_type`.
4. RLS policies enforce tenant isolation on every domain table; a cross-tenant read returns nothing — verified by test.
5. FastAPI accesses Supabase with the caller's JWT; a tenant-scoped endpoint returns only that tenant's rows.
6. TanStack app shell renders dashboard-centric nav gated by plan × role.
7. Permission matrix is shared between API authorization and nav gating.
8. `CLAUDE.md` documents stack, rules, and conventions for Phase 2 teams.

---

## 15. Open Questions / Future

- **Platform Admin & OEM Viewer:** schema designed-for, not built in V1.
- **Three-level tenancy (OEM → dealer group → dealer):** deferred to Phase 3; two-level ships now.
- **LangGraph wiring:** Agent Registry is the day-1 catalog; actual agent execution graphs are Phase 2+.
- **Subscription billing:** plan gating exists; payment/billing integration deferred.
