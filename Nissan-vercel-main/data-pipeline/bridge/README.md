# Bridge loader — pipeline → ADIP spine

Takes the pipeline's `silver.*` / `gold.*` output and writes it into the ADIP
spine (`public.customers / leads / lead_events / market_signals`) so the
existing web screens (Dashboard, Leads board, Intelligence) render real,
multi-tenant data computed from our pipeline.

> **Governing principle:** the **platform** owns the dimensions
> (`public.tenants / locations / users`); we own the facts. The loader reads
> the platform's real dimension rows and attaches our pipeline-generated facts
> to those real keys. It never invents a tenant, location, or user.

## Topology

In-DB. The pipeline schemas (`bronze`, `silver`, `gold`, `agent`) live in the
**same Postgres** as the spine (`public.*`) — the local Supabase Postgres on
`localhost:54322`, database `postgres`. One DB = one transaction = a trivial
ID bridge (no FDW, no two connection pools).

## Auth path

The loader connects directly as the `postgres` role (DB superuser →
`BYPASSRLS`). This is the spec's audited system-ingestion path. The
service-role JWT is **not** used here — that key is for the GoTrue auth-admin
API (which `scripts/seed_demo_users.py` needs because it creates auth users).
The bridge writes only to `public.*`, so it doesn't need it.

Normal app access (web/BFF) continues to use the caller's JWT.

## One-time setup

```bash
# 1. Ensure Supabase local stack is up; seed the demo dimensions.
cd /c/Users/New\ User/Desktop/adip
supabase start
python3 scripts/seed_demo_users.py     # tenants/locations/users now real

# 2. Point the pipeline at Supabase and install its schemas.
cd data-pipeline
cp .env.example .env                    # defaults already target :54322/postgres
set -a && . ./.env && set +a
psql -v ON_ERROR_STOP=1 -f sql/01_core_ddl.sql
psql -v ON_ERROR_STOP=1 -f sql/02_spine_bridge_state.sql
```

## Run end-to-end

```bash
# Generate pipeline facts (silver + gold). Existing scripts, unchanged.
python -m platform_sim.intake
python -m platform_sim.marketing
dbt build --project-dir dbt --profiles-dir dbt

# Bridge silver/gold -> public.*
python -m bridge.load
```

Re-running `python -m bridge.load` is idempotent: customers are upserted via
the `silver.spine_customer_map` sidecar; leads upsert by
`(tenant_id, customer_id, source)`; lead_events / market_signals delete
bridge-tagged rows (`metadata->>'src' = 'pipeline'` /
`source_module = 'pipeline'`) and reinsert. UI- and agent-authored rows are
never touched.

## Acceptance checks

```bash
# Mapping unit tests (no DB).
python -m unittest bridge.test_mapping

# DB-level acceptance: per-tenant counts, FK integrity, RLS isolation, spot checks.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f bridge/verify.sql

# Idempotency: a second loader run produces identical counts.
python -m bridge.load
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f bridge/verify.sql
```

Then, signed in as `owner@abcnissan.test` in the web app:
- Dashboard hero metrics non-zero (hot leads, test drives, scheduled posts).
- Leads pipeline board shows leads across stages with real assignee names.
- Intelligence Regional Demand shows real `public.locations` names.
- Cross-tenant isolation holds (ABC sees zero of XYZ's leads) — proven both
  in the UI and by `verify.sql` step 3.

## Files

| file | role |
|---|---|
| `load.py` | the loader (driver + 4 passes) |
| `mapping.py` | pure source/score/stage/event-type/severity mappers (no DB) |
| `test_mapping.py` | unit tests for `mapping.py` |
| `verify.sql` | per-tenant counts, FK integrity, RLS isolation, spot checks |
| `../sql/02_spine_bridge_state.sql` | `silver.spine_customer_map` (bigint → uuid sidecar) |

## What the loader does NOT do (yet)

- Load `public.campaign_insights` from `gold.mart_campaign_performance` —
  follow-up.
- Real source ingestion. Bronze/silver are still populated by the
  `platform_sim.intake` simulator; facts remain pipeline-generated.
- Map silver's free-text `region` to a specific `public.locations` row.
  V1 distributes locations round-robin per tenant. A tenant-config table
  could later make this semantic.
