# local-api — DuckDB Supabase shim (local development)

A tiny Express server backed by **DuckDB** that speaks the same HTTP API as Supabase
(Auth + PostgREST). It exists so the team can develop the frontend **without** Docker,
colima, or the Supabase CLI. Point the web app at it and everything works against
seeded in-memory data.

> **This is a development convenience, not production.** Production uses real Supabase.
> Migrating is a config change, not a code change — see "Switching to Supabase" below.

## Why this exists

The frontend talks to Supabase through `@supabase/supabase-js`, which is just an HTTP
client for the Supabase Auth + PostgREST endpoints. This server implements the subset
of those endpoints the app uses, so `apps/web` runs unchanged — only its
`VITE_SUPABASE_URL` differs.

## Run it

From the repo root (recommended — starts API + web together):

```bash
npm run setup   # installs deps for root, local-api and web; writes apps/web/.env.local
npm run dev     # starts the DuckDB API (:54321) and the web app (:3000)
```

Or run this server on its own:

```bash
cd apps/local-api
npm install
npm start        # http://localhost:54321  (also writes apps/web/.env.local if missing)
```

On boot it **auto-creates `apps/web/.env.local`** pointing at `http://localhost:54321`,
so there is no manual env step.

### Demo accounts (password `Passw0rd!23`)

| Email | Dealer | Role |
|---|---|---|
| `owner@abcnissan.test` | ABC Nissan | dealer_owner |
| `manager@abcnissan.test` | ABC Nissan | dealer_manager |
| `sales@xyznissan.test` | XYZ Nissan | sales_executive |

Data is **in-memory** and re-seeded on every restart (see `seed()` in `server.js`).

## What it implements

- **Auth** — `POST /auth/v1/token?grant_type=password` (sign in, issues a JWT),
  `GET /auth/v1/user`, `POST /auth/v1/logout`.
- **PostgREST REST** — `GET/POST/PATCH/DELETE /rest/v1/:table` with the filters the app
  uses: `eq/neq/gt/lt/gte/lte/like/ilike`, `is.null` / `not.is.null`, `order`, `limit`,
  `offset`, `select` (incl. embedded joins like `customer:customers!fk(full_name)`),
  exact counts via `Prefer: count=exact` + HTTP `HEAD`, and single-object responses for
  `.single()` / `.maybeSingle()` (the `Accept: application/vnd.pgrst.object+json` header).

If a screen needs a query shape that isn't handled yet, extend the handler in
`server.js` — the filter parser and join map are small and commented.

## Switching to Supabase (production / when ready)

No application code changes. Either:

1. Stop this server and put the real values in `apps/web/.env.local`:
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<real-anon-key>
   ```
2. …or follow the full local-Supabase path in [`docs/TEAM-ONBOARDING.md`](../../docs/TEAM-ONBOARDING.md) §3.

Because this server mirrors Supabase's contract, the same `apps/web` code runs against
either backend.

## Caveats (it's a dev shim)

- In-memory only — no persistence across restarts; no RLS (tenant isolation is **not**
  enforced here, unlike real Supabase). Don't rely on it for security testing.
- Implements only the query shapes the app uses today, not all of PostgREST.
- SQL is built by escaping values (fine for local dev); not hardened for untrusted input.
