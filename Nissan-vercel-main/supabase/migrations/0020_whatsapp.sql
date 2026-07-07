-- Phase 4: WhatsApp Agent (Communication Agent)
-- Extends lead_messages for WhatsApp tracking and adds 3 new tables.
-- All lead_messages changes are additive (nullable) — no existing rows break.

-- 1. Extend lead_messages ─────────────────────────────────────────────────────

alter table public.lead_messages
  add column if not exists whatsapp_message_id text unique,
  add column if not exists status             text
    check (status in ('sent', 'delivered', 'read', 'failed')),
  add column if not exists template_id        uuid,
  add column if not exists attachment_id      uuid,
  add column if not exists error_reason       text;

create index if not exists lead_messages_wamid_idx
  on public.lead_messages (whatsapp_message_id)
  where whatsapp_message_id is not null;

-- 2. message_templates ────────────────────────────────────────────────────────

create table if not exists public.message_templates (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  name        text        not null,
  category    text        not null
    check (category in ('marketing', 'utility', 'authentication')),
  language    text        not null default 'en',
  content     text        not null,
  variables   jsonb       not null default '[]'::jsonb,
  meta_status text        not null default 'pending'
    check (meta_status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now()
);

create index if not exists message_templates_tenant_idx
  on public.message_templates (tenant_id);

alter table public.message_templates enable row level security;

create policy message_templates_tenant on public.message_templates
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

-- 3. attachments ──────────────────────────────────────────────────────────────

create table if not exists public.attachments (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  name          text        not null,
  type          text        not null
    check (type in ('image', 'video', 'pdf', 'document')),
  meta_media_id text,
  url           text,
  size_bytes    bigint,
  created_at    timestamptz not null default now()
);

create index if not exists attachments_tenant_idx
  on public.attachments (tenant_id);

alter table public.attachments enable row level security;

create policy attachments_tenant on public.attachments
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());

-- 4. message_delivery_logs (append-only audit) ────────────────────────────────

create table if not exists public.message_delivery_logs (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  message_id      uuid        not null references public.lead_messages(id) on delete cascade,
  status          text        not null,
  meta_timestamp  timestamptz,
  webhook_payload jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists message_delivery_logs_message_idx
  on public.message_delivery_logs (message_id, created_at desc);

alter table public.message_delivery_logs enable row level security;

create policy message_delivery_logs_tenant on public.message_delivery_logs
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());
