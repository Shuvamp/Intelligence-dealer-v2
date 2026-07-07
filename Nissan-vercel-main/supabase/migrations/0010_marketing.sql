-- 0010_marketing.sql — Marketing Intelligence module (Phase 2). FKs to the spine.

create type campaign_objective as enum ('awareness', 'lead_gen', 'offer', 'festival', 'launch');
create type campaign_status    as enum ('draft', 'scheduled', 'active', 'completed', 'archived');
create type post_channel        as enum ('facebook', 'instagram', 'google_business', 'whatsapp');
create type post_status         as enum ('draft', 'pending_approval', 'approved', 'scheduled', 'published', 'rejected');
create type post_compliance     as enum ('unchecked', 'approved', 'flagged');

create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name        text not null,
  theme       text,
  objective   campaign_objective not null default 'awareness',
  status      campaign_status not null default 'draft',
  channels    text[] not null default '{}',
  start_date  date,
  end_date    date,
  budget      numeric,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.campaigns (tenant_id, status);

create table public.campaign_posts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  campaign_id   uuid references public.campaigns(id) on delete set null,
  title         text,
  caption       text,
  cta           text,
  hashtags      text[] not null default '{}',
  channel       post_channel not null default 'instagram',
  status        post_status not null default 'draft',
  compliance    post_compliance not null default 'unchecked',
  vehicle       text,
  offer         text,
  poster_url    text,
  poster_prompt text,
  scheduled_at  timestamptz,
  published_at  timestamptz,
  approved_by   uuid references public.users(id) on delete set null,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.campaign_posts (tenant_id, status);
create index on public.campaign_posts (tenant_id, campaign_id);
create index on public.campaign_posts (tenant_id, scheduled_at);

create table public.campaign_insights (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  reach           int not null default 0,
  impressions     int not null default 0,
  engagement      int not null default 0,
  leads_generated int not null default 0,
  conversions     int not null default 0,
  spend           numeric not null default 0,
  cost_per_lead   numeric not null default 0,
  conversion_rate numeric not null default 0,
  captured_at     timestamptz not null default now()
);
create index on public.campaign_insights (tenant_id, campaign_id);

-- RLS: spine pattern.
alter table public.campaigns         enable row level security;
alter table public.campaign_posts    enable row level security;
alter table public.campaign_insights enable row level security;

create policy campaigns_tenant on public.campaigns
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy campaign_posts_tenant on public.campaign_posts
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy campaign_insights_tenant on public.campaign_insights
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

-- Register the remaining 6 marketing agents (Campaign Planner + Content Generator
-- already seeded in 0003). The Agent Registry built into the spine now backs the
-- multi-agent marketing system.
insert into public.agent_registry (name, description, module, agent_type) values
  ('Marketing Strategy', 'Prioritizes campaigns by business impact',            'marketing', 'advisor'),
  ('Creative Poster',    'Generates poster concepts, prompts and variations',   'marketing', 'generator'),
  ('Brand Compliance',   'Verifies Nissan + dealership branding on creative',   'marketing', 'analyzer'),
  ('Publishing',         'Schedules posts and optimizes posting time',          'marketing', 'automation'),
  ('Campaign Insight',   'Tracks reach, engagement, leads and conversions',     'marketing', 'analyzer'),
  ('Marketing Copilot',  'Answers marketing questions with recommendations',    'marketing', 'copilot');
