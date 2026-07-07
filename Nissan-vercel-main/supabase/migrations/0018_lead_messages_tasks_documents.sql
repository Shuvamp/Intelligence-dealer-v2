-- 0018_lead_messages_tasks_documents.sql — Lead Board UI (Phase 2) detail-view
-- sections. Call History needs no table — it's a filtered view of the
-- existing lead_events (type = 'call'). Documents intentionally ships with
-- only a stubbed table here; the upload/storage system itself is out of
-- scope for this phase (see CURRENT_ARCHITECTURE.md / PHASE_02 gap analysis).

create type lead_message_channel as enum ('whatsapp', 'sms', 'email', 'call_note');
create type lead_message_direction as enum ('inbound', 'outbound');

create table public.lead_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  channel     lead_message_channel not null,
  direction   lead_message_direction not null default 'outbound',
  body        text not null,
  -- Set when this row originated from the Follow-up Agent's drafted message
  -- rather than a manually logged one (closes the "lost on reload" gap).
  source      text not null default 'manual',
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.lead_messages (tenant_id, lead_id, created_at desc);

create table public.lead_tasks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  title       text not null,
  due_at      timestamptz,
  status      text not null default 'open' check (status in ('open', 'done')),
  assigned_to uuid references public.users(id) on delete set null,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.lead_tasks (tenant_id, lead_id, status);

-- Stub only — no upload/storage wiring in this phase. Schema exists so a
-- later phase can wire real uploads without another migration.
create table public.lead_documents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  file_name   text not null,
  url         text,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.lead_documents (tenant_id, lead_id);

alter table public.lead_messages  enable row level security;
alter table public.lead_tasks     enable row level security;
alter table public.lead_documents enable row level security;

create policy lead_messages_tenant on public.lead_messages
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy lead_tasks_tenant on public.lead_tasks
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy lead_documents_tenant on public.lead_documents
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
