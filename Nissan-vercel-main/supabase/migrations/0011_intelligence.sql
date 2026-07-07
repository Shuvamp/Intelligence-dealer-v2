-- 0011_intelligence.sql — Market Intelligence module. Mostly derived analytics;
-- one owned table (market_signals) so agents can persist the signals feed.

create type signal_kind     as enum ('demand', 'intent', 'opportunity', 'trend', 'risk');
create type signal_severity as enum ('low', 'medium', 'high');
create type signal_status   as enum ('open', 'watching', 'actioned', 'dismissed');

create table public.market_signals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  kind          signal_kind not null,
  title         text not null,
  detail        text,
  metric_label  text,
  metric_value  text,
  severity      signal_severity not null default 'medium',
  source_module text,
  status        signal_status not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.market_signals (tenant_id, severity, created_at desc);

alter table public.market_signals enable row level security;
create policy market_signals_tenant on public.market_signals
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

-- Register the remaining intelligence agents (Demand Signal already in 0003).
insert into public.agent_registry (name, description, module, agent_type) values
  ('Intent Signal',        'Detects buying intent from lead behaviour',        'intelligence', 'analyzer'),
  ('Opportunity Detector', 'Surfaces revenue opportunities from the data',     'intelligence', 'advisor'),
  ('Trend Analyzer',       'Tracks vehicle, source and regional trends',       'intelligence', 'analyzer');
