-- 0015_social_channel_connections.sql — OAuth connections for social channels per tenant

create table public.social_channel_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  channel       text not null check (channel in ('instagram', 'facebook', 'google_business', 'whatsapp')),
  handle        text,            -- display handle, e.g. @nissan_marketing_group
  instagram_id  text,            -- Instagram Business Account ID
  page_id       text,            -- Facebook Page ID linked to this account
  page_name     text,            -- Facebook Page display name
  access_token  text not null default '',
  token_type    text not null default 'long_lived',
  status        text not null default 'connected' check (status in ('connected', 'disconnected')),
  last_sync     timestamptz default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, channel)
);

create index on public.social_channel_connections (tenant_id);

alter table public.social_channel_connections enable row level security;

create policy social_channel_connections_tenant on public.social_channel_connections
  for all to authenticated
  using (tenant_id = public.tenant_id())
  with check (tenant_id = public.tenant_id());
