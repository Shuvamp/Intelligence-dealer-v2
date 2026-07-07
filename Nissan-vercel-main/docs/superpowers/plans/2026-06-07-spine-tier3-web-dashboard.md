# Spine Tier 3 — Web Shell & Mission Control Dashboard

> **For agentic workers:** Build on the verified Tier 1 data foundation. The dashboard is the demo's centerpiece — visual quality and information hierarchy are the goal, not feature completeness.

**Goal:** A production-quality TanStack Start web app — branded login, a HubSpot/Salesforce-grade app shell, and a "Mission Control" dashboard — running on the real multi-tenant spine with tenant-aware, RLS-enforced data.

**Architecture:** TanStack Start (frontend + BFF). Server functions read Supabase using the **caller's session JWT** (RLS enforces tenant isolation). No FastAPI yet — it's inserted in Phase 2 when business logic/AI arrives; the boundary is preserved (all data access goes through server functions, never the browser hitting Supabase with the service key).

**Tech Stack:** TanStack Start (`@tanstack/react-start` v1) · TanStack Router/Query/Table · Tailwind · shadcn/ui · `@supabase/supabase-js` + `@supabase/ssr`.

**References:** `docs/specs/2026-06-07-spine-design.md` §10–§11 (Mission Control layout), Tier 1 plan (schema, `public.tenant_id()`, demo accounts).

---

## Navigation (Customer 360 is first-class)

```
Dashboard          ← Mission Control
Customers          ← directly under Dashboard: the platform's center
Leads
Marketing
Intelligence
Copilot
Reports
Settings
```

Story the order tells: **Customer → Lead → Campaign → Insight → Copilot.** Items render per plan × role (gating wired in but permissive for the demo). Dashboard, Customers are built screens; the rest are polished placeholders for now.

---

## Dashboard layout (Mission Control)

| Zone | Content | Data source |
|---|---|---|
| **Top bar** | Dealer branding (logo/color from `tenants.branding`), global search, notifications bell w/ unread count, profile menu | **REAL** (tenant, notifications) |
| **Hero** | "Good morning, {name}", today's focus line, one-line AI summary | name REAL; summary presentational |
| **Mission Control cards** | Hot Leads · Test Drives Today · Campaigns Scheduled · Revenue Pipeline · Customers | Customers REAL; leads/campaigns/pipeline presentational |
| **AI Recommendations** | 3–4 insight bullets ("Villupuram SUV demand ↑", "Magnite drove 42% of leads", "Recommend weekend SUV campaign") | presentational (Agent Registry names shown as the source) |
| **Recent Activity** | timeline of recent actions | **REAL** (`audit_logs`) |
| **Upcoming Tasks** | follow-up reminders / alerts | **REAL** (`notifications`) |

**Real vs presentational is explicit and centralized** in `src/lib/demo-metrics.ts` so the presentational numbers swap to real module queries in Phase 2 without touching components.

---

## File structure (`apps/web/src`)

| File | Responsibility |
|---|---|
| `lib/supabase.server.ts` | Server-side Supabase client bound to the request's session (RLS-enforced) |
| `lib/auth.server.ts` | Server functions: `signIn`, `signOut`, `getSession` (cookie-based via `@supabase/ssr`) |
| `lib/demo-metrics.ts` | Centralized presentational numbers + AI recommendation copy (clearly marked TODO→real) |
| `lib/queries.server.ts` | Server functions: `getDashboardData`, `getCustomers` (tenant-aware reads) |
| `routes/__root.tsx` | Root layout, providers (Query), global styles |
| `routes/login.tsx` | Branded login page |
| `routes/_authed.tsx` | Protected layout: redirect if no session; renders `<AppShell>` |
| `routes/_authed/dashboard.tsx` | Mission Control |
| `routes/_authed/customers.tsx` | Customer 360 list (real data, TanStack Table) |
| `routes/_authed/{leads,marketing,intelligence,copilot,reports,settings}.tsx` | Placeholder screens |
| `components/shell/AppShell.tsx` | Top bar + sidebar composition |
| `components/shell/Sidebar.tsx` | Nav list with plan×role gating |
| `components/shell/TopBar.tsx` | Branding, search, notifications, profile |
| `components/dashboard/*` | `HeroSection`, `MetricCard`, `AIRecommendations`, `RecentActivity`, `UpcomingTasks` |

---

## Build order

1. **Scaffold** (`@tanstack/cli create` with shadcn + query + table) — done out-of-band.
2. **Supabase wiring** — env (`.env` with local API URL + publishable key), `supabase.server.ts`, `auth.server.ts` (cookie session via `@supabase/ssr`).
3. **Login page** — branded, calls `signIn` server fn, redirects to `/dashboard`.
4. **Protected layout + AppShell** — `_authed.tsx` guards session; Sidebar + TopBar; nav with Customers first-class.
5. **Mission Control dashboard** — all six zones; real data via `getDashboardData`, presentational via `demo-metrics`.
6. **Customers page** — real customer list (TanStack Table) proving tenant-aware data on screen.
7. **Placeholder routes** — clean "coming soon" cards so nav is complete.
8. **Seed liveliness** — extend `scripts/seed_demo_users.py` to insert demo `notifications` + `audit_logs` for the ABC owner so Recent Activity / Upcoming Tasks render real rows.

## Verification (Tier 3 done)
- Log in as `owner@abcnissan.test` → land on a branded Mission Control dashboard.
- Top bar shows ABC branding + unread notification count; Recent Activity shows real `audit_logs`; Upcoming Tasks shows real `notifications`.
- Customers page lists exactly ABC's customers (RLS-enforced through the session).
- Logging in as `sales@xyznissan.test` shows XYZ's data only — isolation visible in the UI.
- App looks production-grade (typography, spacing, hierarchy) — not a template.
