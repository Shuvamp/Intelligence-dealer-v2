-- Migration 0025 — Assignment tables (Phase 8 production blocker)
--
-- These 4 tables exist in the DuckDB shim (apps/local-api/server.js) but had
-- no Supabase migration, making them a hard blocker for any real Supabase deploy.
-- Column shapes match the shim DDL exactly so the Assignment Agent works unchanged.
--
-- RLS predicate uses public.tenant_id() for consistency with every other table
-- (resolves via auth.uid() per migration 0013 — no JWT app_metadata dependency).

create table if not exists public.sales_executives (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants(id) on delete cascade,
    name                text not null,
    status              text not null default 'active' check (status in ('active', 'inactive')),
    current_lead_count  integer not null default 0,
    max_lead_limit      integer not null default 10,
    created_at          timestamptz not null default now()
);
create index if not exists sales_executives_tenant_idx on public.sales_executives (tenant_id);
alter table public.sales_executives enable row level security;
create policy sales_executives_tenant on public.sales_executives
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create table if not exists public.lead_assignments (
    assignment_id   uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    lead_id         uuid not null references public.leads(id) on delete cascade,
    executive_id    uuid references public.sales_executives(id) on delete set null,
    score           text,
    priority_rank   integer not null default 1,
    assigned_at     timestamptz not null default now()
);
create index if not exists lead_assignments_tenant_lead_idx on public.lead_assignments (tenant_id, lead_id);
create index if not exists lead_assignments_executive_idx   on public.lead_assignments (executive_id);
alter table public.lead_assignments enable row level security;
create policy lead_assignments_tenant on public.lead_assignments
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create table if not exists public.lead_completions (
    completion_id   uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    lead_id         uuid not null references public.leads(id) on delete cascade,
    executive_id    uuid references public.sales_executives(id) on delete set null,
    completed_at    timestamptz not null default now()
);
create index if not exists lead_completions_tenant_lead_idx on public.lead_completions (tenant_id, lead_id);
alter table public.lead_completions enable row level security;
create policy lead_completions_tenant on public.lead_completions
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create table if not exists public.assignment_notifications (
    notification_id uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    lead_id         uuid not null references public.leads(id) on delete cascade,
    executive_id    uuid references public.sales_executives(id) on delete set null,
    event_type      text not null,
    message         text,
    is_read         boolean not null default false,
    created_at      timestamptz not null default now()
);
create index if not exists assignment_notifications_tenant_exec_idx
    on public.assignment_notifications (tenant_id, executive_id);
alter table public.assignment_notifications enable row level security;
create policy assignment_notifications_tenant on public.assignment_notifications
    for all to authenticated
    using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
