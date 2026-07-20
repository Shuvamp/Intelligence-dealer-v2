# ADIP — Dealer Intelligence OS

Multi-tenant dealership intelligence platform (Agentic Dealership Intelligence Platform).
See `docs/specs/` for the design and `docs/superpowers/plans/` for implementation plans.

## Quick start (real Supabase — only supported path)

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
npm run setup                         # installs deps + writes apps/web/.env.local from `supabase status`
npm run dev                           # starts the web app (:3000) and FastAPI agents (:8000)
```
Studio: http://localhost:54323

Open **http://localhost:3000** and log in with a demo account (password `Passw0rd!23`):
`owner@abcnissan.test`, `manager@abcnissan.test`, or `sales@xyznissan.test`.

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
apps/api/        FastAPI — system API, business logic, agents
supabase/        migrations, RLS policies, seed, tests
docs/            specs + plans
```
