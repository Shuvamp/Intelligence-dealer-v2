-- 0016_lead_interactions_validation_logs.sql — Validation Agent (Phase 1).
-- lead_interactions: a record of each detected repeat enquiry (duplicate
-- phone/email). Distinct from lead_events (the general activity timeline).
-- validation_logs: one row per validation attempt, pass or fail — the
-- persisted audit trail the Validation Agent is required to produce.

create table public.lead_interactions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  lead_id          uuid not null references public.leads(id) on delete cascade,
  customer_id      uuid not null references public.customers(id) on delete cascade,
  interaction_type text not null default 'duplicate_enquiry',
  source           text,
  summary          text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index on public.lead_interactions (tenant_id, lead_id, created_at desc);

-- lead_id is nullable: a hard-rejected lead never gets a `leads` row, but its
-- validation attempt must still be traceable via the raw phone/email tried.
create table public.validation_logs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  lead_id    uuid references public.leads(id) on delete set null,
  phone      text,
  email      text,
  status     text not null check (status in ('passed', 'duplicate', 'rejected')),
  errors     jsonb not null default '[]'::jsonb,
  warnings   jsonb not null default '[]'::jsonb,
  source     text,
  created_at timestamptz not null default now()
);
create index on public.validation_logs (tenant_id, lead_id);
create index on public.validation_logs (tenant_id, status);

-- RLS: same tenant-isolation pattern as the rest of the lead module.
alter table public.lead_interactions enable row level security;
alter table public.validation_logs   enable row level security;

create policy lead_interactions_tenant on public.lead_interactions
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy validation_logs_tenant on public.validation_logs
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
