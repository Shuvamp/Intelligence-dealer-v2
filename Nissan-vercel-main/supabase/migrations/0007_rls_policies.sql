-- 0007_rls_policies.sql — RLS is the tenant-isolation boundary.

-- Enable RLS on all domain tables.
alter table public.tenants        enable row level security;
alter table public.locations      enable row level security;
alter table public.users          enable row level security;
alter table public.user_locations enable row level security;
alter table public.customers      enable row level security;
alter table public.agent_registry enable row level security;
alter table public.notifications  enable row level security;
alter table public.audit_logs     enable row level security;

-- tenants: a user sees only their own tenant row.
create policy tenant_isolation_select on public.tenants
  for select to authenticated
  using (id = public.tenant_id());

-- Generic tenant_id-scoped tables: full access within own tenant.
create policy loc_tenant on public.locations
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy users_tenant on public.users
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy customers_tenant on public.customers
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy notifications_tenant on public.notifications
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

create policy audit_tenant on public.audit_logs
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

-- user_locations: scoped via the joined user's tenant.
create policy user_locations_tenant on public.user_locations
  for all to authenticated
  using (exists (
    select 1 from public.users u
     where u.id = user_locations.user_id and u.tenant_id = public.tenant_id()
  ))
  with check (exists (
    select 1 from public.users u
     where u.id = user_locations.user_id and u.tenant_id = public.tenant_id()
  ));

-- agent_registry: global agents (tenant_id null) are visible to all; tenant agents scoped.
create policy agents_visibility on public.agent_registry
  for select to authenticated
  using (tenant_id is null or tenant_id = public.tenant_id());
create policy agents_write on public.agent_registry
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
