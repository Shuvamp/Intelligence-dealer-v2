-- 0009_leads.sql — Lead Management module domain (Phase 2). FKs to the spine.

create type lead_source     as enum ('oem', 'website', 'facebook', 'instagram', 'walkin', 'phone', 'event', 'referral');
create type lead_stage      as enum ('new', 'contacted', 'qualified', 'test_drive', 'quotation', 'negotiation', 'won', 'lost');
create type lead_score      as enum ('hot', 'warm', 'cold');
create type lead_event_type as enum ('note', 'call', 'email', 'whatsapp', 'stage_change', 'assignment', 'test_drive', 'quotation');

create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  location_id      uuid references public.locations(id) on delete set null,
  customer_id      uuid references public.customers(id) on delete set null,
  source           lead_source not null default 'website',
  stage            lead_stage  not null default 'new',
  score            lead_score  not null default 'cold',
  score_value      int not null default 0 check (score_value between 0 and 100),
  assigned_to      uuid references public.users(id) on delete set null,
  vehicle_interest text,
  budget           numeric,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index on public.leads (tenant_id, stage);
create index on public.leads (tenant_id, assigned_to);
create index on public.leads (tenant_id, customer_id);

create table public.lead_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  type       lead_event_type not null,
  summary    text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.lead_events (tenant_id, lead_id, created_at desc);

-- RLS: same tenant-isolation pattern as the spine.
alter table public.leads       enable row level security;
alter table public.lead_events enable row level security;

create policy leads_tenant on public.leads
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy lead_events_tenant on public.lead_events
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
