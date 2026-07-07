# ADIP — Team Onboarding & Iteration Guide

Welcome. This is how to understand the project, run it locally, and start iterating on your module.

---

## 1. What ADIP is

**ADIP = Agentic Dealership Intelligence Platform** (internally "Dealer Intelligence OS") — a
multi-tenant SaaS that is the **operating system for car dealerships**. Phase-1 customer: **Nissan dealers**.

Today a dealership's data is scattered across OEM leads, website, Instagram/Facebook, walk-ins,
phone calls, WhatsApp and spreadsheets. ADIP unifies it into **one platform** with four products,
all orbiting one canonical customer:

| Product | What it does |
|---|---|
| **Marketing Intelligence** | A multi-agent marketing command center — plan campaigns around festivals, generate posters/captions, run approval + publishing, measure ROI. |
| **Lead Management (CRM)** | Unified lead inbox from every source, AI scoring (hot/warm/cold), assignment, follow-ups, test drives, quotations, a visual pipeline. |
| **Market Intelligence** | The signals engine — lead-source performance, pipeline funnel, vehicle & regional demand, campaign ROI, opportunity signals. |
| **Executive Copilot** | A chat assistant grounded in the dealership's live data ("which leads should I call today?"). |
| **Customer 360** | The anchor — every lead, campaign and signal connects to one canonical customer. |

One-line pitch: *An AI-powered multi-tenant Dealer Intelligence OS that helps dealerships generate
marketing, manage leads, discover opportunities, and get AI recommendations from a single platform.*

**Status: a complete, working V1.** All four products + Customer 360, Reports and Subscription are
built and run on real data. Your job is to **deepen your module** (more features, real AI, edge
cases, tests) — not start from scratch.

---

## 2. Architecture & stack (read this once)

```
TanStack Start (apps/web)          FastAPI (apps/api) — NOT built yet
  frontend + BFF (server functions)   reserved for Phase-2 business logic
  NO business logic                    + LangGraph agent orchestration
        │  server functions read Supabase with the caller's session
        ▼
Supabase — PostgreSQL + Auth + Storage
  RLS is the security boundary (tenant isolation), not app code
```

- **Frontend/BFF:** TanStack Start v1 (`@tanstack/react-start`), file-based routing, TanStack
  Query/Table, Tailwind v4, shadcn tokens. Server functions (`createServerFn`) are the data layer.
- **Backend:** Supabase. Every domain table has `tenant_id`; **Row-Level Security** enforces that a
  user only ever sees their dealership's data. Isolation is resolved via `auth.uid()` (no auth hook).
- **AI:** `@anthropic-ai/sdk` (Claude). The marketing content/poster agents and the copilot make
  real Claude calls when `ANTHROPIC_API_KEY` is set, and fall back to deterministic templates otherwise.
- **Multi-tenancy:** two levels — **dealer (tenant) → showroom (location)**. Roles: `dealer_owner`,
  `dealer_manager`, `sales_executive`, `marketing_executive`. Subscription plan gates module access.

---

## 3. Run it locally

### Option A — DuckDB (recommended, no Docker) ⚡

The fastest path. A local DuckDB server (`apps/local-api`) speaks Supabase's API, so you
**don't need Docker, colima, or the Supabase CLI** — just **Node 20+**. The web app runs
unchanged; only its `VITE_SUPABASE_URL` points at the local server.

```bash
git clone https://github.com/muthukumarp-dm/adip.git
cd adip
npm run setup     # installs all deps + auto-writes apps/web/.env.local (points at the local API)
npm run dev       # starts the DuckDB API (:54321) and the web app (:3000) together
```

That's it — open **http://localhost:3000**. Data is seeded in-memory on each restart. See
[`apps/local-api/README.md`](../apps/local-api/README.md) for what it implements and how to
extend it. **Caveat:** the shim does **not** enforce RLS — verify tenant-isolation behavior
(§8) against real Supabase (Option B) before relying on it.

### Option B — real Supabase (production parity)

Use this when you need RLS, migrations, Studio, or pgTAP tests.

**Prerequisites:** a container runtime (`brew install colima docker`), Supabase CLI
(`brew install supabase/tap/supabase`), Node 20+.

```bash
git clone https://github.com/muthukumarp-dm/adip.git
cd adip

# 1. Backend (local Supabase in a container)
colima start
supabase start
supabase db reset                      # applies all migrations + seed.sql
python3 scripts/seed_demo_users.py     # creates demo users + leads/marketing/copilot data

# 2. Frontend
cd apps/web
cp .env.example .env                   # local Supabase URL + anon key (defaults are correct)
npm install
npm run dev                            # http://localhost:3000
```

Open **http://localhost:3000**. Demo accounts (password `Passw0rd!23`):

| Email | Dealer | Role |
|---|---|---|
| `owner@abcnissan.test` | ABC Nissan (Intelligence plan — all modules) | Owner |
| `manager@abcnissan.test` | ABC Nissan | Manager |
| `sales@xyznissan.test` | XYZ Nissan (Growth plan — Intelligence/Copilot locked) | Sales Executive |

Log in as both ABC and XYZ to see **tenant isolation** and **plan gating** in action.

**Optional — turn on real AI:** put `ANTHROPIC_API_KEY=sk-ant-...` in `apps/web/.env`, restart `npm run dev`.
Without it, the AI agents use template fallbacks and the demo still works.

---

## 4. Who owns what (the three teams)

Each team owns one module and works on its own branch off `main`:

| Team | Module | Branch | Build screens | Server fns | Spec |
|---|---|---|---|---|---|
| **Team A** | Lead Management | `feature/lead-management` | `apps/web/src/routes/_authed/leads.*` | `apps/web/src/lib/leads.ts` | `docs/specs/2026-06-07-lead-management.md` |
| **Team B** | Marketing | `feature/marketing-automation` | `apps/web/src/routes/_authed/marketing.*` | `apps/web/src/lib/marketing.ts`, `anthropic.server.ts` | `docs/specs/2026-06-07-marketing-automation.md` + `docs/handoff/marketing-module.md` |
| **Team C** | Intelligence + Copilot | `feature/market-intelligence` | `apps/web/src/routes/_authed/intelligence.tsx`, `copilot.tsx` | `intelligence.ts`, `copilot.ts` | `docs/specs/2026-06-07-market-intelligence.md` |

The **spine** (`supabase/migrations`, auth, the app shell, Customer 360, Dashboard) is **shared** —
coordinate before changing it; prefer raising it with the lead rather than editing unilaterally.

**The Lead Management module is the worked example** — it's the most complete (board + detail + full
CRUD). Read its route + server-fn files to learn the patterns before building.

---

## 5. How to start (git workflow)

```bash
git checkout main && git pull
git checkout -b feature/<your-module>     # e.g. feature/marketing-automation
# ... build ...
git add -A && git commit -m "feat(<module>): ..."
git push -u origin feature/<your-module>
# open a Pull Request against main when a slice is ready; the lead reviews + merges
```

Keep PRs small and focused. Rebase on `main` regularly so the spine stays in sync.

---

## 6. The pattern: foundation first, then build

Every module follows the same shape — **don't reinvent it**:

1. **Schema + RLS** (`supabase/migrations/*.sql`) — tables with `tenant_id`, RLS policy
   `tenant_id = public.tenant_id()`. Add a migration; never edit an applied one.
2. **Types** (`apps/web/src/lib/types.ts`) — the shared TypeScript contract.
3. **Server functions** (`apps/web/src/lib/<module>.ts`) — reads + mutations, the frozen contract the UI builds on.
4. **UI kit** (`apps/web/src/components/<module>/`) — shared badges/cards for visual consistency.
5. **Pages** (`apps/web/src/routes/_authed/`) — loaders fetch via server fns; mutations call a server fn then `router.invalidate()`.

Make the foundation real and verified first, then build the pages on top.

---

## 7. Hard rules / gotchas (these will bite you — learn them now)

- **Never name a server-fn file `*.server.ts`** — TanStack mocks those on the client and the RPC breaks.
  Server functions live in plain names (`leads.ts`); only genuinely server-only helpers that import
  `@tanstack/react-start/server` or `@anthropic-ai/sdk` are `*.server.ts` (e.g. `supabase.server.ts`, `anthropic.server.ts`).
- **jsonb / `unknown` in a server-fn return type breaks it** — use the `JsonValue` type from `#/lib/types`.
- **After a mutation, call `await router.invalidate()`** to refresh loader data. **Never `router.navigate`
  to the same page** (it aborts the in-flight RPC). After sign-in/out use a hard `window.location` nav.
- **RLS is the security boundary** — every domain table needs `tenant_id` + the tenant RLS policy.
  Server functions read Supabase with the caller's session, so RLS auto-applies. Never use the service-role key for normal reads.
- **Import alias `#/` → `src/`.** Tailwind v4 — only valid classes (no `font-700`, no `h-5.5`).
  Brand accent via `var(--brand)` / `brand-bg` / `brand-text`; numbers use the `num` class.
- **AI agents** are real-when-keyed, template-fallback-otherwise — keep that seam (see `anthropic.server.ts`).

---

## 8. Verify before you call it done

- `cd apps/web && npx tsc --noEmit` must be clean (0 errors).
- Verify in a **real browser**: log in, exercise your feature, and confirm **tenant isolation**
  (log in as XYZ — you must only see XYZ data). The `apps/web/scripts/verify-*.mjs` Playwright scripts
  show the pattern.
- Don't merge with failing types or a broken login.

---

## 9. Where to look

- `CLAUDE.md` — project rules at a glance.
- `docs/specs/` — the design specs (spine + each module).
- `docs/handoff/marketing-module.md` — a detailed module hand-off example.
- `docs/superpowers/plans/` — the original implementation plans.
- Worked example to copy: `apps/web/src/routes/_authed/leads.index.tsx` and `leads.$leadId.tsx`.

Questions about the spine or cross-module concerns → raise with the project lead before changing shared code.
