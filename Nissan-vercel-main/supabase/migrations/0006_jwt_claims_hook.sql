-- 0006_jwt_claims_hook.sql — inject tenant_id + user_role into the access token
-- Signature per Supabase Custom Access Token Hook: receives + returns jsonb event.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
as $$
declare
  claims    jsonb;
  v_tenant  uuid;
  v_role    text;
begin
  select u.tenant_id, u.role::text
    into v_tenant, v_role
    from public.users u
   where u.id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  if v_tenant is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- The Auth admin role must be able to execute the hook and read users.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.users to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
