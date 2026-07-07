-- 0002_customers.sql — canonical Customer 360 anchor (identity only)

create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  location_id       uuid references public.locations(id) on delete set null,
  full_name         text not null,
  phone             text,
  email             text,
  preferred_vehicle text,
  source_channel    text,
  consent           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.customers (tenant_id);
create index on public.customers (tenant_id, location_id);
