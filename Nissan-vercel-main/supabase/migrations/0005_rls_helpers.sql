-- 0005_rls_helpers.sql — read tenant_id/role from the JWT claims.
-- Helpers live in `public` (the `auth` schema is reserved/locked by Supabase).

-- Returns the tenant_id claim from the current request's JWT, or null.
create or replace function public.tenant_id()
returns uuid
language sql stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id',
    ''
  )::uuid;
$$;

-- Returns the app role claim (not the Postgres role) from the JWT.
create or replace function public.user_role()
returns text
language sql stable
as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'user_role';
$$;

grant execute on function public.tenant_id() to authenticated, anon;
grant execute on function public.user_role() to authenticated, anon;
