# ADIP — Dealer Intelligence OS

Multi-tenant dealership intelligence platform (Agentic Dealership Intelligence Platform).
See `docs/specs/` for the design and `docs/superpowers/plans/` for implementation plans.

## Quick start (DuckDB — no Docker, recommended for development)

The fastest way to run the whole app. Uses a local DuckDB server (`apps/local-api`) that
speaks Supabase's API, so **no Docker, colima, or Supabase CLI** is required. Needs **Node 20+**.

```bash
git clone https://github.com/muthukumarp-dm/adip.git
cd adip
npm run setup     # installs all deps + writes apps/web/.env.local (points at the local API)
npm run dev       # starts the DuckDB API (:54321) and the web app (:3000)
```

Open **http://localhost:3000** and log in with a demo account (password `Passw0rd!23`):
`owner@abcnissan.test`, `manager@abcnissan.test`, or `sales@xyznissan.test`.

Data is seeded in-memory on each restart. How it works, supported queries and how to switch
to real Supabase: [`apps/local-api/README.md`](apps/local-api/README.md). Note: the shim does
**not** enforce RLS — verify tenant-isolation behavior against real Supabase.

## Production-parity stack (real Supabase)

### Prerequisites
- A container runtime — **colima** (`brew install colima docker`, then `colima start`)
- Supabase CLI (`brew install supabase/tap/supabase`)

### Run the data layer
```bash
colima start                          # start the local container runtime
supabase start                        # boot local Postgres + Auth + Studio
supabase db reset                     # apply migrations + seed (wipes auth users)
python3 scripts/seed_demo_users.py    # create demo login accounts (run after reset)
supabase test db                      # run RLS isolation tests
```
Studio: http://localhost:54323

### Demo accounts (password `Passw0rd!23`)
| Email | Dealer | Role |
|---|---|---|
| `owner@abcnissan.test` | ABC Nissan | dealer_owner |
| `manager@abcnissan.test` | ABC Nissan | dealer_manager |
| `sales@xyznissan.test` | XYZ Nissan | sales_executive |

`auth.users` is wiped by `supabase db reset`, so re-run the seeder after each reset (it's idempotent).

## Structure
```
apps/web/        TanStack Start — frontend + BFF
apps/local-api/  DuckDB shim — local Supabase-compatible API (dev only)
apps/api/        FastAPI — system API, business logic, agents
supabase/        migrations, RLS policies, seed, tests
docs/            specs + plans
```
