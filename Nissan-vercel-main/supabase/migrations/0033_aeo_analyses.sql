-- Migration 0033 — AEO Agent (Phase 5 of the Context/SEO/AEO vertical).
-- See docs/planner/feature_master_plan.md and docs/planner/05_AEO_AGENT.md.
-- Consumes website_extractions rows where status='ready'; runs 11 independent
-- rule-based agents and stores ONE normalized AEOAnalysisResult JSON
-- (agents + strengths + weaknesses + summary), plus a denormalized
-- overall_score column mirroring seo_analyses for cross-phase comparability.

create table if not exists public.aeo_analyses (
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
create index if not exists aeo_analyses_tenant_idx on public.aeo_analyses (tenant_id);
create index if not exists aeo_analyses_extraction_idx on public.aeo_analyses (extraction_id);
create index if not exists aeo_analyses_context_idx on public.aeo_analyses (context_id);
create index if not exists aeo_analyses_status_idx on public.aeo_analyses (tenant_id, status);
alter table public.aeo_analyses enable row level security;
create policy aeo_analyses_tenant on public.aeo_analyses
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
