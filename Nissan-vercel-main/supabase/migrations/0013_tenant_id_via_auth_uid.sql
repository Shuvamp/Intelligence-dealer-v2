-- 0013_tenant_id_via_auth_uid.sql
-- Make tenant isolation work WITHOUT the custom access token hook, so the app
-- runs on hosted Supabase (where enabling the hook needs the dashboard/Mgmt API).
--
-- tenant_id()/user_role() now resolve from public.users via auth.uid(), as
-- SECURITY DEFINER functions (owned by the migration role) so the lookup bypasses
-- RLS on public.users — this avoids recursion with the users_tenant policy.
-- A JWT-claim path is kept first as a fast/back-compat fallback (used by the
-- pgTAP isolation test and by deployments that DO enable the hook).

create or replace function public.tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
    (select u.tenant_id from public.users u where u.id = auth.uid())
  );
$$;

create or replace function public.user_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'user_role',
    (select u.role::text from public.users u where u.id = auth.uid())
  );
$$;

grant execute on function public.tenant_id() to authenticated, anon;
grant execute on function public.user_role() to authenticated, anon;
