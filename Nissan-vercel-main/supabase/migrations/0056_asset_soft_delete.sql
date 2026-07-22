-- 0056_asset_soft_delete.sql — media library Trash was browser-only state, so a
-- deleted asset came back on reload. deleted_at makes the trash durable:
-- set = in Trash, null = live, row removal = permanent purge.

alter table public.marketing_assets
  add column if not exists deleted_at timestamptz;

create index if not exists marketing_assets_deleted_at_idx
  on public.marketing_assets (tenant_id, deleted_at);
