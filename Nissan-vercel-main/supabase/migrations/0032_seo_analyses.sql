-- Migration 0032 — SEO Agent (Phase 4 of the Context/SEO/AEO vertical).
-- See docs/planner/feature_master_plan.md and docs/planner/04_SEO_AGENT.md.
-- Consumes website_extractions rows where status='ready'; runs 24 independent
-- rule-based analyzers and stores ONE normalized SEOAnalysisResult JSON
-- (not sprawled into per-dimension columns), plus a denormalized overall_score
-- for cheap sorting/filtering in list views.

create table if not exists public.seo_analyses (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    extraction_id   uuid not null references public.website_extractions(id) on delete cascade,
    context_id      uuid not null references public.context_plans(id) on delete cascade,
    status          text not null default 'queued'
                    check (status in ('queued', 'analyzing', 'ready', 'failed')),
    analysis_data   jsonb,
    overall_score   integer,
    errors          jsonb not null default '[]'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    started_at      timestamptz,
    completed_at    timestamptz
);
create index if not exists seo_analyses_tenant_idx on public.seo_analyses (tenant_id);
create index if not exists seo_analyses_extraction_idx on public.seo_analyses (extraction_id);
create index if not exists seo_analyses_context_idx on public.seo_analyses (context_id);
create index if not exists seo_analyses_status_idx on public.seo_analyses (tenant_id, status);
alter table public.seo_analyses enable row level security;
create policy seo_analyses_tenant on public.seo_analyses
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
