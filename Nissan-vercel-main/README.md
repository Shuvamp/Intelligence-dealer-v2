# ADIP — Dealer Intelligence OS

Multi-tenant dealership intelligence platform (Agentic Dealership Intelligence Platform).
See `docs/specs/` for the design and `docs/superpowers/plans/` for implementation plans.

## Quick start (hosted Supabase — only supported path)

### Prerequisites
- A hosted Supabase project (migrations in `supabase/migrations/` applied via the SQL Editor or `supabase db push`)
- `apps/web/.env.local` and `apps/api/.env` filled in with that project's URL + keys (see `.env.example` files)

### Run the app
```bash
npm run setup                         # installs root + apps/web deps
npm run setup:agent                   # creates apps/api/.venv + installs FastAPI agent deps
npm run dev                           # starts the web app (:3000) and FastAPI agents (:8000)
```

Open **http://localhost:3000** and sign in with a real account (create one via Supabase Auth in the dashboard, or the app's sign-up flow).

## Structure
```
apps/web/        TanStack Start — frontend + BFF
apps/api/        FastAPI — system API, business logic, agents
supabase/        migrations, RLS policies, seed, tests
docs/            specs + plans
```
