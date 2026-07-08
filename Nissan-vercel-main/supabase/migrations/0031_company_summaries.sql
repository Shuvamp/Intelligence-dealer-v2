-- Migration 0031 — Company Summary (Phase 3 of the Context/SEO/AEO vertical).
-- See docs/planner/feature_master_plan.md and docs/planner/03_COMPANY_SUMMARY.md.
-- Consumes website_extractions rows where status='ready'; generates one concise
-- 8-field company summary per run via Groq. context_id is a denormalized FK
-- (also present on website_extractions) purely so the frontend can list/filter
-- summaries by context without a join.

create table if not exists public.company_summaries (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    extraction_id   uuid not null references public.website_extractions(id) on delete cascade,
    context_id      uuid not null references public.context_plans(id) on delete cascade,
    company_name    text,
    website         text,
    region          text,
    industry        text,
    products        jsonb not null default '[]'::jsonb,
    services        jsonb not null default '[]'::jsonb,
    description     text,
    verdict         text,
    status          text not null default 'pending'
                    check (status in ('pending', 'ready', 'failed')),
    errors          jsonb not null default '[]'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists company_summaries_tenant_idx on public.company_summaries (tenant_id);
create index if not exists company_summaries_extraction_idx on public.company_summaries (extraction_id);
create index if not exists company_summaries_context_idx on public.company_summaries (context_id);
create index if not exists company_summaries_status_idx on public.company_summaries (tenant_id, status);
alter table public.company_summaries enable row level security;
create policy company_summaries_tenant on public.company_summaries
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
