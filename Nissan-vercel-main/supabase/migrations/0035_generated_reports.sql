-- Migration 0035 — Report Generator (Phase 7 of the Context/SEO/AEO vertical).
-- See docs/planner/feature_master_plan.md and docs/planner/07_REPORT_GENERATOR.md.
-- Anchors on a latest-ready recommendation_reports row (Phase 6), fetching the
-- exact seo_analyses/aeo_analyses rows it consolidated, plus the extraction and
-- optional company_summary, and produces ONE narrative report: an 11-section
-- ReportResult JSON plus a stored Markdown artifact (markdown_content), plus a
-- denormalized overall_score (= Phase 6 combined_score). Rows accumulate per
-- extraction/context (report history); "latest by created_at" is canonical.

create table if not exists public.generated_reports (
    id                        uuid primary key default gen_random_uuid(),
    tenant_id                 uuid not null references public.tenants(id) on delete cascade,
    extraction_id             uuid not null references public.website_extractions(id) on delete cascade,
    context_id                uuid not null references public.context_plans(id) on delete cascade,
    recommendation_report_id  uuid not null references public.recommendation_reports(id) on delete cascade,
    seo_analysis_id           uuid not null references public.seo_analyses(id) on delete cascade,
    aeo_analysis_id           uuid not null references public.aeo_analyses(id) on delete cascade,
    company_summary_id        uuid references public.company_summaries(id) on delete set null,
    status                    text not null default 'queued'
                              check (status in ('queued', 'generating', 'ready', 'failed')),
    report_data               jsonb,
    markdown_content          text,
    overall_score             integer,
    errors                    jsonb not null default '[]'::jsonb,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    started_at                timestamptz,
    completed_at              timestamptz
);
create index if not exists generated_reports_tenant_idx on public.generated_reports (tenant_id);
create index if not exists generated_reports_extraction_idx on public.generated_reports (extraction_id);
create index if not exists generated_reports_context_idx on public.generated_reports (context_id);
create index if not exists generated_reports_status_idx on public.generated_reports (tenant_id, status);
alter table public.generated_reports enable row level security;
create policy generated_reports_tenant on public.generated_reports
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
