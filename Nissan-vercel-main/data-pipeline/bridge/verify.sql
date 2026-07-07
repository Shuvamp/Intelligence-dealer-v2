-- bridge/verify.sql — acceptance checks for the bridge loader.
--
-- Run via psql against the Supabase local Postgres, e.g.:
--   psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f bridge/verify.sql
--
-- Checks:
--   1. Per-tenant row counts for the bridge-owned outputs.
--   2. FK integrity: every leads.location_id / assigned_to / customer_id
--      belongs to the SAME tenant as the lead.
--   3. RLS isolation: as an `authenticated` JWT for each tenant,
--      cross-tenant rows must be invisible. Each test wrapped in
--      BEGIN…ROLLBACK because SET LOCAL only applies inside a txn
--      (mirrors supabase/tests/isolation_test.sql).
--   4. Spot checks: at least one tenant has totalLeads>0, leads exist in
--      more than one stage, and at least one pipeline-tagged signal.

\echo '== (1) per-tenant row counts =='
SELECT
  t.id AS tenant,
  (SELECT count(*) FROM public.customers      WHERE tenant_id = t.id) AS customers,
  (SELECT count(*) FROM public.leads          WHERE tenant_id = t.id) AS leads,
  (SELECT count(*) FROM public.lead_events    WHERE tenant_id = t.id
       AND metadata ->> 'src' = 'pipeline')                            AS lead_events_pipeline,
  (SELECT count(*) FROM public.market_signals WHERE tenant_id = t.id
       AND source_module = 'pipeline')                                 AS signals_pipeline
  FROM public.tenants t
 ORDER BY t.id;

\echo
\echo '== (2) FK integrity =='

-- location_id must belong to the lead's tenant.
SELECT count(*) AS leads_with_wrong_tenant_location
  FROM public.leads l
  LEFT JOIN public.locations loc ON loc.id = l.location_id
 WHERE l.location_id IS NOT NULL
   AND (loc.id IS NULL OR loc.tenant_id <> l.tenant_id);

-- assigned_to must belong to the lead's tenant.
SELECT count(*) AS leads_with_wrong_tenant_assignee
  FROM public.leads l
  LEFT JOIN public.users u ON u.id = l.assigned_to
 WHERE l.assigned_to IS NOT NULL
   AND (u.id IS NULL OR u.tenant_id <> l.tenant_id);

-- customer_id must belong to the lead's tenant.
SELECT count(*) AS leads_with_wrong_tenant_customer
  FROM public.leads l
  LEFT JOIN public.customers c ON c.id = l.customer_id
 WHERE l.customer_id IS NOT NULL
   AND (c.id IS NULL OR c.tenant_id <> l.tenant_id);

-- spine_customer_map should always agree with public.customers on tenant_id.
SELECT count(*) AS map_tenant_mismatches
  FROM silver.spine_customer_map m
  JOIN public.customers c ON c.id = m.spine_id
 WHERE c.tenant_id <> m.tenant_id;

\echo
\echo '== (3) RLS isolation (one transaction per tenant; mirrors isolation_test.sql) =='

-- For each tenant: impersonate the JWT and assert that cross-tenant rows are zero.
DO $$
DECLARE
  t record;
  claims jsonb;
  cross_leads     int;
  cross_customers int;
  visible_leads   int;
BEGIN
  FOR t IN SELECT id::text AS id FROM public.tenants ORDER BY id LOOP
    claims := jsonb_build_object(
      'role', 'authenticated',
      'tenant_id', t.id,
      'user_role', 'dealer_owner'
    );
    -- SET LOCAL only applies inside a txn; the DO block IS one.
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', claims::text, true);

    SELECT count(*) INTO cross_leads
      FROM public.leads
     WHERE tenant_id <> public.tenant_id();

    SELECT count(*) INTO cross_customers
      FROM public.customers
     WHERE tenant_id <> public.tenant_id();

    SELECT count(*) INTO visible_leads FROM public.leads;

    RAISE NOTICE 'tenant % : visible leads=%, cross-tenant leads=%, cross-tenant customers=%',
      substring(t.id, 1, 8), visible_leads, cross_leads, cross_customers;

    IF cross_leads <> 0 OR cross_customers <> 0 THEN
      RAISE EXCEPTION 'RLS isolation FAILED for tenant %', t.id;
    END IF;

    -- Reset role/claims for the next iteration.
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;
  RAISE NOTICE 'RLS isolation: PASS for all tenants';
END
$$;

\echo
\echo '== (4) spot checks =='

-- At least one tenant has > 0 leads.
SELECT (count(*) > 0)::text AS any_tenant_has_leads
  FROM (SELECT tenant_id, count(*) c FROM public.leads GROUP BY tenant_id) x
 WHERE c > 0;

-- Leads exist across at least 2 distinct stages.
SELECT count(DISTINCT stage) AS distinct_stages FROM public.leads;

-- At least one pipeline-tagged signal exists.
SELECT count(*) AS pipeline_signals
  FROM public.market_signals WHERE source_module = 'pipeline';
