-- 0049_asset_campaign_selected.sql — mark media assets as "selected for the
-- campaign planner". Tenant-shared + durable (replaces the per-browser
-- localStorage staging). campaign_selected_at gives a deterministic pick order
-- so the first-picked logo lands top-left, the second top-right.

alter table public.marketing_assets
  add column if not exists campaign_selected    boolean not null default false,
  add column if not exists campaign_selected_at timestamptz;

create index if not exists marketing_assets_campaign_selected_idx
  on public.marketing_assets (tenant_id, campaign_selected);
