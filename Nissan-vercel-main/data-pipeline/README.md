# ADIP Data Pipeline (prototype, tenant-aligned)

The ingestion + identity-resolution + analytical layer that **populates the
ADIP spine** from real lead sources. ADIP has the destination tables
(`customers`, `leads`, `market_signals`, …); this pipeline fills them.

> **Status:** working prototype on the hosted Supabase Postgres. Tenant-aligned
> to the spine rules (every row has `tenant_id`; identity resolution is
> per-dealer). Wired to Supabase via the bridge loader (`bridge/`).

## What it does

```
6 sources (walk-in, web/GA4, Meta, calls, OEM, events)
        │  ingest (tenant_id)
        ▼
   bronze.*  raw landing
        │  resolve_customer(tenant_id, phone, email)   ← per-dealer identity
        ▼
   silver.*  dim_customer, fact_touchpoint/lead/assignment/task/test_drive/quotation, pii_vault
        │  sql/03_build_marts.sql  (staging → dimension/fact views → serving views)
        ▼
   gold.*    serving_lead_profile, mart_region_demand, mart_opportunity,
             mart_campaign_performance, feat_lead_scoring, serving_copilot_metrics
   agent.*   campaign_plan → content_asset → compliance_check → publish_log (+ run log)
        │
        ▼
   bridge/load.py  →  public.*  (ADIP spine — the platform reads this)
```

## How it maps onto the ADIP spine

| This pipeline | ADIP spine / module table | Integration intent |
|---|---|---|
| `silver.resolve_customer(tenant_id,…)` | `public.customers` (identity) | resolver is a tenant-scoped UPSERT into `customers` |
| `silver.fact_touchpoint` / `fact_lead` | `public.leads` + `public.lead_events` | feed module tables via `bridge/load.py` |
| `agent.campaign_plan/content/compliance/publish` | `public.campaigns/campaign_posts/campaign_insights` | feed marketing module |
| `gold.mart_region_demand` / `feat_lead_scoring` | Intelligence analytics + `public.market_signals` | substrate for Demand Signal / Lead Scorer agents |
| `bronze.*` raw landing | *(ingestion buffer)* | the ingestion buffer ADIP spine lacks |

Every table carries `tenant_id`; **identity never crosses dealers** — the demo
proves the same phone under two dealers resolves to two separate customers.

## Transform layer

The silver staging and gold serving views are built by plain SQL:

```
sql/03_build_marts.sql
```

Run via `psql -f sql/03_build_marts.sql`. All views are `CREATE OR REPLACE`
(idempotent). No dbt, no mashumaro, no Python-version constraint — the only
Python dependency is `psycopg2-binary`.

## Run (hosted Supabase Postgres)

```bash
# 1. Configure the pipeline connection.
cd data-pipeline
pip install psycopg2-binary
cp .env.example .env       # fill in the hosted project's PGHOST/PGPASSWORD

# 2. Run the full pipeline.
./run_local.sh             # DDL -> intake -> marketing -> SQL marts -> demo
```

Or step-by-step:

```bash
set -a && . ./.env && set +a
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f sql/01_core_ddl.sql
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f sql/02_spine_bridge_state.sql
python -m platform_sim.intake
python -m platform_sim.marketing
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f sql/03_build_marts.sql
python -m bridge.load
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f bridge/verify.sql
```

See `bridge/README.md` for full bridge acceptance-check instructions.
