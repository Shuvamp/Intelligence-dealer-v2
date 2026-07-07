-- 0004_notifications_audit.sql — enterprise stubs (tables only)

create type notification_status as enum ('unread', 'read', 'dismissed');

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null,
  message    text not null,
  status     notification_status not null default 'unread',
  created_at timestamptz not null default now()
);
create index on public.notifications (tenant_id, user_id);

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_logs (tenant_id);
