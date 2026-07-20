-- 0042_opportunities.sql — suggested campaign opportunities (festival/event
-- calendar), ported from DuckDB's `opportunities` table. `id` is caller-
-- supplied (`${tenantId}_${date}_${name}` — see marketing.ts
-- snapshotCampaignPlannerPage), so no default.
--
-- scheduled_at/published_at stay `text`, matching campaign_days (0040) —
-- same IST wall-clock string format, same reason.

create table public.opportunities (
  id             text primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  month          integer not null,
  year           integer not null,
  date           date not null,
  name           text not null,
  kind           text,
  theme          text,
  suggestion     text,
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
  synced_at      timestamptz not null default now()
);
create index on public.opportunities (tenant_id, publish_status);

alter table public.opportunities enable row level security;

create policy opportunities_tenant on public.opportunities
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
