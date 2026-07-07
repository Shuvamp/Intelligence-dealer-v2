-- isolation_test.sql — RLS must block cross-tenant reads.
begin;
select plan(3);

-- Impersonate an authenticated request from tenant ABC.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","tenant_id":"11111111-1111-1111-1111-111111111111","user_role":"dealer_owner"}';

-- 1. ABC sees only its own customers (10 seeded for tenant ABC).
select is(
  (select count(*)::int from public.customers),
  10,
  'ABC sees exactly its own 10 customers'
);

-- 2. ABC sees zero of XYZ's customers explicitly.
select is(
  (select count(*)::int from public.customers
     where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ABC cannot see XYZ customers'
);

-- 3. ABC sees only its own tenant row.
select is(
  (select count(*)::int from public.tenants),
  1,
  'ABC sees only its own tenant row'
);

select * from finish();
rollback;
