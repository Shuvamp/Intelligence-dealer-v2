# Supabase + Vercel Migration — Status & Runbook

Target Supabase project: **`ajuglsslkuydasasiscg`** (ap-northeast-1, Postgres 17)
URL: `https://ajuglsslkuydasasiscg.supabase.co`

## ✅ Done & verified (database)

1. **Schema** — all 26 migrations (0001–0025) + hardening (0026) applied. 37 tables, all RLS-enabled.
2. **Auth users** — 6 demo accounts created in `auth.users` with fixed UUIDs + `public.users` rows
   (password `Passw0rd!23`):
   - `owner@abcnissan.test` → `10000000-…-001` (dealer_owner, ABC)
   - `manager@abcnissan.test` → `…-002` (dealer_manager, ABC)
   - `sales@xyznissan.test` → `…-003` (sales_executive, XYZ)
   - `ravi@ / karthik@ / divya@ abcnissan.test` → `…-004/005/006` (sales_executive, ABC)
3. **Data** — migrated from the local DuckDB (`dev.duckdb`) with user-FK remap:
   11 customers, 16 leads, 9 lead_events, 1 campaign, 5 posts, 1 insight, 9 notifications, 7 sales_executives.
4. **RLS isolation verified** — ABC owner sees exactly its 16 leads, 0 XYZ leakage; XYZ user sees 0.
   Tenant resolves via `public.tenant_id()` → `auth.uid()` (migration 0013) — **the JWT access-token hook
   does NOT need dashboard enablement.**

> Re-run the data load anytime from `apps/local-api/` : `node export_for_supabase.cjs && node gen_supabase_sql.cjs`
> then apply `load_supabase.sql` (idempotent — `on conflict do nothing`).

## ✅ Done (web app code)

5. **Real Supabase auth restored** — `apps/web/src/lib/auth.ts` reverted from the demo bypass to
   `signInWithPassword` / `getSession` + profile/tenant lookup.
6. **FastAPI un-broken** — `apps/api` had 7 files with committed git merge-conflict markers
   (`main.py` didn't even compile). Restored from clean `origin/main`; all 174 files compile.
7. **Web URL rewiring** — intake (`/intake/leads`, `/intake/stream`) and marketing social-channel
   calls now use `VITE_AGENT_API_URL` / `FASTAPI_URL` instead of `VITE_SUPABASE_URL` or hardcoded
   `localhost:8000`/`:54321`. `assignments.ts` demo-token/`:54321` hack removed → real session token
   + `VITE_AGENT_API_URL`.
8. **Deploy config** — `apps/api/Dockerfile` respects `$PORT`; `render.yaml` blueprint added;
   `apps/web/vite.config.ts` builds with the Vercel preset when `VERCEL=1`; `.env.production.example` added.

## Env vars to set

**Vercel (web)** — Project → Settings → Environment Variables (Production), Root Directory = `apps/web`:
- `VITE_SUPABASE_URL=https://ajuglsslkuydasasiscg.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = Supabase dashboard → Settings → API → **anon/publishable** key
- `VITE_AGENT_API_URL=https://<render-fastapi-url>`
- `FASTAPI_URL=https://<render-fastapi-url>` (server-side marketing/analytics/copilot calls)

**Railway (FastAPI)** — Service → Settings → **Root Directory = `apps/api`** (so `railway.json` +
`Dockerfile` are found), then Variables → add:
- `SUPABASE_URL=https://ajuglsslkuydasasiscg.supabase.co`
- `SUPABASE_SERVICE_KEY` = Supabase dashboard → Settings → API → **service_role** key (secret)
- `ASSIGNMENT_DB_URL=https://ajuglsslkuydasasiscg.supabase.co`
- `FRONTEND_URL` = the Vercel URL
- LLM keys as needed: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`
- Railway injects `PORT` automatically (the Dockerfile already honors it).
- Generate a public domain: Railway → Settings → Networking → Generate Domain.

(`render.yaml` is kept as an alternative host; ignore it if using Railway.)

## ⛔ Remaining work

### A. Port assignments `/api/*` into FastAPI over Supabase
Web `assignments.ts` calls `/api/executives`, `/api/dashboard/stats`, `/api/assignment-history`,
`/api/notifications`, `/api/assign-lead`, `/api/complete-lead`, `/api/deactivate-executive`,
`/api/notifications/{id}/read`. These live only in the DuckDB shim (`apps/local-api/server.js`).
Port them into `apps/api` (a router querying Supabase via PostgREST with the service key), OR rewrite
`assignments.ts` to read Supabase directly. Until then the Assignments page renders empty (errors are
swallowed). Also set `ASSIGNMENT_DB_URL` so the FastAPI assignment agent stops using its `:memory:` DuckDB.

### B. Web-local analytics DuckDB won't run on Vercel
`apps/web/src/lib/analytics.duckdb.ts` reads/writes `apps/web/.duckdb/analytics.duckdb` (a local file).
Vercel's serverless FS is read-only/ephemeral → these writes fail in prod. Migrate this store
(`campaign_posts` analytics, opportunities, campaign-days, media metadata) to Supabase tables and
replace the DuckDB calls with supabase-js.

### C. Files → Supabase Storage
`apps/web/public/uploads/` (posters/media) and `apps/local-api/uploads/` (WhatsApp media) are local
disk. Create Storage buckets, upload existing files, rewrite `campaign_posts.poster_url` /
`lead_documents.url` / asset URLs to the Storage public URLs. Update the upload handlers
(`marketing.ts` `fs.writeFileSync`, shim `/upload`) to write to Storage.

## Deploy steps (once A–C are addressed to your comfort level)
1. **FastAPI → Railway**: New Project → Deploy from repo → Service Settings → Root Directory
   `apps/api` → add the Variables above → Generate Domain. Note the URL.
2. **Web → Vercel**: New Project → Root Directory `apps/web` → add the env vars above
   (`VITE_AGENT_API_URL`/`FASTAPI_URL` = the Railway URL) → deploy.
3. Set Railway `FRONTEND_URL` to the Vercel URL; redeploy FastAPI.
4. Smoke-test: login → dashboard → leads → marketing. Assignments + Storage-backed posters remain
   degraded until A and C are done.

## What works after deploy vs. degraded
- **Works**: login/auth (RLS-isolated), dashboard, leads board + detail, customers, marketing
  campaigns/posts, intake form, live SSE updates.
- **Degraded until A/B/C**: Assignments dashboard (empty — endpoints not ported), marketing analytics
  that used the web-local DuckDB, newly-uploaded posters/media (local FS write fails on Vercel).
