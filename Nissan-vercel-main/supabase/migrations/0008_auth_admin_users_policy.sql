-- 0008_auth_admin_users_policy.sql
-- The custom_access_token_hook runs as supabase_auth_admin and reads public.users
-- to look up tenant_id + role. With RLS enabled on public.users, that role needs an
-- explicit SELECT policy — GRANT alone does NOT bypass RLS. Without this, the hook
-- reads zero rows, injects no claims, and every real login gets a tenant-less JWT
-- (RLS then denies the user all data). This is the documented Supabase pattern.

create policy auth_admin_read_users on public.users
  for select to supabase_auth_admin
  using (true);
