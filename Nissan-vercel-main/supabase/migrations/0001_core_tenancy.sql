-- 0001_core_tenancy.sql — enums + tenant/location/user core

create type subscription_plan as enum ('starter', 'growth', 'intelligence', 'enterprise');
create type tenant_status     as enum ('active', 'suspended');
create type location_status   as enum ('active', 'inactive');
create type user_role         as enum ('dealer_owner', 'dealer_manager', 'sales_executive', 'marketing_executive');
create type user_status       as enum ('active', 'invited', 'disabled');

create table public.tenants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  brand             text not null default 'Nissan',
  subscription_plan subscription_plan not null default 'starter',
  status            tenant_status not null default 'active',
  branding          jsonb not null default '{}'::jsonb,  -- logo_url, primary_color, theme
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  address     jsonb not null default '{}'::jsonb,
  status      location_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.locations (tenant_id);

create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        user_role not null,
  status      user_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.users (tenant_id);

create table public.user_locations (
  user_id     uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  primary key (user_id, location_id)
);
