-- 0003_agent_registry.sql — AI agent catalog (day-1, stubbed)

create type agent_module as enum ('marketing', 'leads', 'intelligence', 'copilot', 'platform');
create type agent_type   as enum ('advisor', 'automation', 'generator', 'analyzer', 'copilot');
create type agent_status as enum ('stub', 'active', 'disabled');

create table public.agent_registry (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,  -- null = global/system
  name        text not null,
  description text,
  module      agent_module not null,
  agent_type  agent_type not null,
  status      agent_status not null default 'stub',
  version     text not null default '0.1.0',
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.agent_registry (tenant_id);

-- Seed the 7 global stub agents (tenant_id null = available to all tenants)
insert into public.agent_registry (name, description, module, agent_type) values
  ('Campaign Planner',  'Plans 30-day marketing calendars',        'marketing',    'advisor'),
  ('Content Generator', 'Generates posters and captions',          'marketing',    'generator'),
  ('Lead Scorer',       'Scores leads hot/warm/cold',              'leads',        'analyzer'),
  ('Lead Assignment',   'Assigns leads to sales executives',       'leads',        'automation'),
  ('Follow-up Advisor', 'Suggests next-best follow-up actions',    'leads',        'advisor'),
  ('Demand Signal',     'Detects regional/vehicle demand signals', 'intelligence', 'analyzer'),
  ('Executive Copilot', 'Conversational dealership assistant',     'copilot',      'copilot');
