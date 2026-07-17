-- 0036_linkedin_analytics.sql — LinkedIn post URN capture + periodic analytics
--
-- Adds: Company Page identity on the connection row (nullable — null means a
-- personal/member connection, since org identity can only be resolved once the
-- LinkedIn Developer App has Marketing Developer Platform access and the
-- rw_organization_admin scope); a durable record of published post URNs; and
-- timestamped metric snapshots (post-level + account-level) so history is kept
-- rather than overwritten, mirroring the campaign_insights pattern (0010_marketing.sql).

alter table public.social_channel_connections
  add column if not exists linkedin_org_urn text,
  add column if not exists linkedin_org_name text;

create table public.linkedin_posts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  urn                   text not null,
  org_urn               text,
  caption               text,
  title                 text,
  image_asset_urn       text,
  image_url             text,
  image_url_expires_at  timestamptz,
  published_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (tenant_id, urn)
);
create index on public.linkedin_posts (tenant_id);

create table public.linkedin_post_metrics (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  post_urn         text not null,
  likes            int,
  comments         int,
  shares           int,
  impressions      int,
  reach            int,
  clicks           int,
  engagement_rate  numeric,
  status           text not null check (status in ('ok', 'unavailable', 'mdp_required', 'error')),
  error_message    text,
  captured_at      timestamptz not null default now()
);
create index on public.linkedin_post_metrics (tenant_id, post_urn, captured_at desc);

create table public.linkedin_account_metrics (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  org_urn           text,
  followers_growth  int,
  profile_views     int,
  status            text not null check (status in ('ok', 'unavailable', 'mdp_required', 'error')),
  error_message     text,
  captured_at       timestamptz not null default now()
);
create index on public.linkedin_account_metrics (tenant_id, captured_at desc);

alter table public.linkedin_posts           enable row level security;
alter table public.linkedin_post_metrics    enable row level security;
alter table public.linkedin_account_metrics enable row level security;

create policy linkedin_posts_tenant on public.linkedin_posts
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy linkedin_post_metrics_tenant on public.linkedin_post_metrics
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy linkedin_account_metrics_tenant on public.linkedin_account_metrics
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
