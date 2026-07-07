-- 0012_copilot.sql — Executive Copilot module: conversation store.
-- The copilot answers over leads/marketing/intelligence data (basic in V1).

create type copilot_role as enum ('user', 'assistant');

create table public.copilot_conversations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid references public.users(id) on delete set null,
  title      text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.copilot_conversations (tenant_id, user_id, updated_at desc);

create table public.copilot_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.copilot_conversations(id) on delete cascade,
  role            copilot_role not null,
  content         text not null,
  citations       jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
create index on public.copilot_messages (tenant_id, conversation_id, created_at);

alter table public.copilot_conversations enable row level security;
alter table public.copilot_messages      enable row level security;

create policy copilot_conversations_tenant on public.copilot_conversations
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy copilot_messages_tenant on public.copilot_messages
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
