# ADIP — Data Pipeline (Ingestion + Identity Resolution) Spec

**Status:** Proposal / working prototype (Phase 2 data layer). Lives in `data-pipeline/`.
**Sits under:** the spine (`customers`) + the Lead, Marketing, Intelligence modules.
**Author:** Data Engineering (Chirag, Asma, Mohana).

## Why
The spine and modules define the destination tables (`customers`, `leads`,
`lead_events`, `campaigns`, `market_signals`) but there is **no pipeline that
ingests real leads, resolves one customer across sources, and populates them.**
Marketing/Intelligence specs assume "the data already exists." This spec defines
the layer that makes it exist.

## Scope (V1)
- **Sources:** walk-in desk, website (GA4), Meta lead ads, phone calls, OEM leads, showroom events.
- **Identity:** deterministic, **per-tenant** (phone normalised to last-10 digits, email lower+trim; phone-then-email precedence). No cross-dealer merge. Fuzzy/probabilistic matching deferred to V2.
- **Layers:** medallion — `bronze` (raw landing) → `silver` (resolve + conform) → `gold` (serving per agent). `agent.*` holds agent write-back + an observability run log.
- **Tenancy:** every table carries `tenant_id` (two-level dealer → showroom per spine §4). Identity, leads, and analytics are all tenant-scoped.

## How it plugs into the spine
- `silver.resolve_customer(tenant_id, phone, email)` is the missing identity capability. In production it becomes a **tenant-scoped upsert into `public.customers`** (the spine owns identity; the pipeline owns resolution).
- Touchpoints/leads feed `public.leads` + `public.lead_events`; marketing write-back feeds `campaigns/campaign_posts/campaign_insights`; gold marts feed the Intelligence module + `market_signals` and the Lead Scorer / Demand Signal agents in `agent_registry`.
- **PII/DPDP:** raw identifiers isolated in `silver.pii_vault` (encrypted in prod); everything else keys on `customer_id`.

## Open decisions (for the maintainer)
1. **Transform tooling:** adopt **dbt** (this prototype) for silver/gold, or implement as Supabase SQL migrations + (materialized) views to match the current convention.
2. **Ingestion service home:** `apps/api` (FastAPI) once it exists, or a dedicated `services/ingestion`.
3. **RLS for ingestion writes:** bronze landing is system-written — confirm the audited service-role path.

## Prototype
`data-pipeline/` runs the full flow end-to-end on a standalone Postgres
(PostgreSQL + dbt + Python), tenant-aligned, with a smoke test. See its README.

## Out of scope (V2+)
Fuzzy/probabilistic identity + merge-review queue; CRM source; real-time streaming;
richer attribution; scale-out infra.
