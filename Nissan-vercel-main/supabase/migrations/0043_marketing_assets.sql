-- 0041_marketing_assets.sql — uploaded creative assets (poster/video/logo
-- library), ported from DuckDB's `marketing_assets` table. `id` is caller-
-- supplied (apps/web generates the UUID client-side), so no default.

create table public.marketing_assets (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  asset_type   text not null,
  vehicle      text,
  sub_category text,
  file_url     text not null,
  file_size    integer,
  metadata     text,
  created_at   timestamptz not null default now()
);
create index on public.marketing_assets (tenant_id, asset_type);

alter table public.marketing_assets enable row level security;

create policy marketing_assets_tenant on public.marketing_assets
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
