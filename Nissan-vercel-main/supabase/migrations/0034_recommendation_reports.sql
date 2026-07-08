-- Migration 0034 — Recommendation Engine (Phase 6 of the Context/SEO/AEO vertical).
-- See docs/planner/feature_master_plan.md and docs/planner/06_RECOMMENDATION_ENGINE.md.
-- Consumes the latest ready seo_analyses + aeo_analyses rows for an
-- extraction and produces ONE consolidated RecommendationReportResult JSON
-- (unified 10-field recommendations + severity groups + summary), plus a
-- denormalized combined_score column mirroring seo_analyses/aeo_analyses.

create table if not exists public.recommendation_reports (
    id               uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null references public.tenants(id) on delete cascade,
    extraction_id    uuid not null references public.website_extractions(id) on delete cascade,
    context_id       uuid not null references public.context_plans(id) on delete cascade,
    seo_analysis_id  uuid not null references public.seo_analyses(id) on delete cascade,
    aeo_analysis_id  uuid not null references public.aeo_analyses(id) on delete cascade,
    status           text not null default 'queued'
                     check (status in ('queued', 'generating', 'ready', 'failed')),
    report_data      jsonb,
    combined_score   integer,
    errors           jsonb not null default '[]'::jsonb,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    started_at       timestamptz,
    completed_at     timestamptz
);
create index if not exists recommendation_reports_tenant_idx on public.recommendation_reports (tenant_id);
create index if not exists recommendation_reports_extraction_idx on public.recommendation_reports (extraction_id);
create index if not exists recommendation_reports_context_idx on public.recommendation_reports (context_id);
create index if not exists recommendation_reports_status_idx on public.recommendation_reports (tenant_id, status);
alter table public.recommendation_reports enable row level security;
create policy recommendation_reports_tenant on public.recommendation_reports
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
