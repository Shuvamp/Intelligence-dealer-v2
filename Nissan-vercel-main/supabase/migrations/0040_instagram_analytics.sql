-- 0038_instagram_analytics.sql — Instagram media capture + periodic analytics
--
-- Mirrors 0036_linkedin_analytics.sql. Adds a durable record of tracked media
-- (seeded on publish, backfilled for organically-published posts by the
-- background poller) and timestamped like/comment snapshots. No account-level
-- metrics table (unlike LinkedIn) — the feature never asked for Instagram
-- follower/account-level analytics, only per-post likes/comments.

create table public.instagram_posts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  media_id       text not null,
  caption        text,
  media_type     text,
  media_url      text,
  thumbnail_url  text,
  permalink      text,
  published_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (tenant_id, media_id)
);
create index on public.instagram_posts (tenant_id);

create table public.instagram_post_metrics (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  media_id       text not null,
  likes          int,
  comments       int,
  status         text not null check (status in ('ok', 'unavailable', 'expired_token', 'rate_limited', 'error')),
  error_message  text,
  captured_at    timestamptz not null default now()
);
create index on public.instagram_post_metrics (tenant_id, media_id, captured_at desc);

alter table public.instagram_posts         enable row level security;
alter table public.instagram_post_metrics  enable row level security;

create policy instagram_posts_tenant on public.instagram_posts
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy instagram_post_metrics_tenant on public.instagram_post_metrics
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
