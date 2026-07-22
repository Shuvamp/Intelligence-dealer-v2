-- 0052_instagram_account_metrics.sql — Instagram account-level snapshots
--
-- 0040_instagram_analytics.sql deliberately shipped no account-level table
-- ("the feature never asked for follower analytics"). The dashboard's Audience
-- Growth chart now needs one, so this mirrors linkedin_account_metrics: a
-- timestamped snapshot per poll tick rather than an overwritten current value,
-- so growth is derived from real history.
--
-- `followers` is the point-in-time `followers_count` field on /{ig-user-id},
-- readable with the instagram_basic scope the app already holds. The daily
-- net-gain metric (`follower_count` insight) would need instagram_manage_insights
-- + Meta app review + every tenant reconnecting, so we diff snapshots instead.

create table public.instagram_account_metrics (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  ig_user_id     text,
  followers      int,
  status         text not null check (status in ('ok', 'unavailable', 'expired_token', 'rate_limited', 'error')),
  error_message  text,
  captured_at    timestamptz not null default now()
);
create index on public.instagram_account_metrics (tenant_id, captured_at desc);

alter table public.instagram_account_metrics enable row level security;

create policy instagram_account_metrics_tenant on public.instagram_account_metrics
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
