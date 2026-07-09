-- Migration 0029 — Context Planner (Phase 1 of the Context/SEO/AEO vertical).
--
-- See docs/planner/feature_master_plan.md and docs/planner/01_CONTEXT_PLANNER.md.
-- Stores the initial "context" a dealer creates (either a website URL or a
-- manual company profile) before later phases (extraction, SEO/AEO analysis)
-- pick it up. Column shapes match apps/local-api/server.js's context_plans
-- DDL exactly so the Context Planner agent works unchanged against either.
--
-- RLS predicate uses public.tenant_id() for consistency with every other
-- table (resolves via auth.uid() per migration 0013).

create table if not exists public.context_plans (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    input_type      text not null check (input_type in ('url', 'manual')),
    url             text,
    normalized_url  text,
    company_name    text,
    website         text,
    region          text,
    industry        text,
    products        text,
    services        text,
    description     text,
    status          text not null default 'pending' check (status in ('pending', 'ready', 'invalid', 'failed')),
    errors          jsonb not null default '[]'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists context_plans_tenant_idx on public.context_plans (tenant_id);
create index if not exists context_plans_status_idx on public.context_plans (tenant_id, status);
alter table public.context_plans enable row level security;
create policy context_plans_tenant on public.context_plans
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
