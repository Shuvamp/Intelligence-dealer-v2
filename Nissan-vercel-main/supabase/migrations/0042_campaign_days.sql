-- 0040_campaign_days.sql — per-day generated content for a campaign
-- (ported from DuckDB's `campaign_days` table). Distinct from
-- `campaign_posts` (0010): campaign_posts is one row per ad-hoc post,
-- campaign_days is one row per calendar day of a planned campaign.
--
-- scheduled_at/published_at stay `text` (not timestamptz) — the publishing
-- pipeline (apps/api/app/db/duckdb.py, auto_publisher.py) stores/compares
-- these as naive IST wall-clock strings ("YYYY-MM-DDTHH:MM", see PUBLISH_TZ)
-- rather than UTC instants; keeping the same representation avoids changing
-- that comparison logic as part of this migration.

create table public.campaign_days (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  day_date       date not null,
  day_num        integer not null,
  theme          text not null,
  vehicle        text,
  headline       text,
  subheadline    text,
  caption        text,
  hashtags       text[] not null default '{}',
  cta            text,
  offer          text,
  content_status text not null default 'pending',
  scheduled_at   text,
  publish_status text not null default 'draft',
  published_at   text,
  poster_url     text,
  video_url      text,
  channel_status text,
  unique (campaign_id, tenant_id, day_date)
);
create index on public.campaign_days (tenant_id, publish_status);

alter table public.campaign_days enable row level security;

create policy campaign_days_tenant on public.campaign_days
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
