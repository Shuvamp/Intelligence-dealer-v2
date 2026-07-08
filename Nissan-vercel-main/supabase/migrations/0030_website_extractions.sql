-- Migration 0030 — Website Extraction Engine (Phase 2 of the Context/SEO/AEO vertical).
-- See docs/planner/feature_master_plan.md and docs/planner/02_WEBSITE_EXTRACTION_ENGINE.md.
-- Consumes context_plans rows where input_type='url' AND status='ready'; crawls
-- normalized_url and stores ONE normalized extraction JSON per spec (no per-category columns).

create table if not exists public.website_extractions (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    context_id      uuid not null references public.context_plans(id) on delete cascade,
    url             text,
    status          text not null default 'queued'
                    check (status in ('queued','crawling','parsing','extracting','building','ready','failed')),
    extraction_data jsonb,
    errors          jsonb not null default '[]'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    started_at      timestamptz,
    completed_at    timestamptz
);
create index if not exists website_extractions_tenant_idx on public.website_extractions (tenant_id);
create index if not exists website_extractions_context_idx on public.website_extractions (context_id);
create index if not exists website_extractions_status_idx on public.website_extractions (tenant_id, status);
alter table public.website_extractions enable row level security;
create policy website_extractions_tenant on public.website_extractions
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
