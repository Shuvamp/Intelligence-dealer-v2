-- =====================================================================
-- Nissan ADIP - data-pipeline : CORE DDL  (tenant-aligned, first pass)
--
-- Aligned to the ADIP spine rules (docs/specs/2026-06-07-spine-design.md):
--   * Every domain table carries tenant_id (two-level: dealer -> showroom).
--   * Identity resolution is SCOPED PER TENANT - the same phone/email under
--     two different dealers must NOT merge into one customer.
--
-- In the real platform, silver.resolve_customer() becomes a tenant-scoped
-- UPSERT into public.customers (the spine identity table). Here it runs on a
-- standalone Postgres so the pipeline is demoable without the full Supabase
-- stack; the resolution + tenancy semantics match what ADIP needs.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS bronze;
CREATE SCHEMA IF NOT EXISTS silver;
CREATE SCHEMA IF NOT EXISTS gold;
CREATE SCHEMA IF NOT EXISTS agent;

-- ---------------------------------------------------------------------
-- BRONZE - raw landing (append-only). tenant_id supplied by ingestion.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bronze.walkin_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    visitor_name text, phone text, email text,
    model_interest text, locality text, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.web_ga4_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    ga_client_id text, event_type text, phone text, email text,
    model_interest text, page_path text, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.meta_lead_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    meta_lead_id text, campaign_id text, campaign_name text,
    full_name text, phone text, email text, model_interest text, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.events_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    event_name text, visitor_name text, phone text, email text,
    model_interest text, locality text, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.calls_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    call_id text, direction text, phone text, duration_sec integer,
    disposition text, model_interest text, transcript text, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.oem_lead_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    oem_lead_id text, full_name text, phone text, email text,
    model_interest text, locality text, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.inventory_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    model text, variant text, region text,
    qty_available integer, list_price numeric, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.offers_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    offer_code text, description text, model text, discount_type text,
    discount_value numeric, valid_from date, valid_to date, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.festival_calendar_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    festival_name text, region text, festival_date date, payload jsonb);

CREATE TABLE IF NOT EXISTS bronze.channel_insights_raw (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    channel text, external_post_id text, campaign_id text, metric_date date,
    impressions bigint, clicks bigint, spend numeric,
    engagements bigint, leads bigint, payload jsonb);

-- ---------------------------------------------------------------------
-- SILVER - APP-OWNED tables (written by the tenant-aware intake path).
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS silver.customer_id_seq;

-- match key is unique WITHIN a tenant -> identity never crosses dealers.
CREATE TABLE IF NOT EXISTS silver.identity_map (
    tenant_id uuid NOT NULL,
    match_key text NOT NULL,                 -- 'phone:99...' | 'email:a@b.com'
    customer_id bigint NOT NULL,
    PRIMARY KEY (tenant_id, match_key));

CREATE TABLE IF NOT EXISTS silver.dim_customer (
    customer_id bigint PRIMARY KEY DEFAULT nextval('silver.customer_id_seq'),
    tenant_id uuid NOT NULL,
    region text, first_seen timestamptz, last_seen timestamptz, source_first text);
CREATE INDEX IF NOT EXISTS dim_customer_tenant_idx ON silver.dim_customer(tenant_id);

CREATE TABLE IF NOT EXISTS silver.pii_vault (
    customer_id bigint PRIMARY KEY REFERENCES silver.dim_customer(customer_id),
    tenant_id uuid NOT NULL,
    full_name text, phone_enc bytea, email_enc bytea,
    consent_at timestamptz, retain_until date);

CREATE TABLE IF NOT EXISTS silver.dim_sales_executive (
    sales_exec_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    name text, region text, expertise text, active boolean DEFAULT true);

CREATE TABLE IF NOT EXISTS silver.fact_touchpoint (
    touchpoint_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    customer_id bigint REFERENCES silver.dim_customer(customer_id),
    source text, event_type text, model_interest text,
    campaign_id text, occurred_at timestamptz);

CREATE TABLE IF NOT EXISTS silver.fact_lead (
    lead_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    customer_id bigint REFERENCES silver.dim_customer(customer_id),
    status text, lead_score numeric, assigned_to text, changed_at timestamptz);

CREATE TABLE IF NOT EXISTS silver.fact_assignment (
    assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    customer_id bigint REFERENCES silver.dim_customer(customer_id),
    sales_exec_id bigint REFERENCES silver.dim_sales_executive(sales_exec_id),
    assigned_at timestamptz, assignment_reason text);

CREATE TABLE IF NOT EXISTS silver.fact_task (
    task_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    customer_id bigint REFERENCES silver.dim_customer(customer_id),
    sales_exec_id bigint REFERENCES silver.dim_sales_executive(sales_exec_id),
    task_type text, due_at timestamptz, status text, created_at timestamptz);

CREATE TABLE IF NOT EXISTS silver.fact_test_drive (
    test_drive_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    customer_id bigint REFERENCES silver.dim_customer(customer_id),
    model text, scheduled_at timestamptz, completed boolean, outcome text);

CREATE TABLE IF NOT EXISTS silver.fact_quotation (
    quotation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    customer_id bigint REFERENCES silver.dim_customer(customer_id),
    model text, offer_code text, quoted_price numeric,
    quoted_at timestamptz, accepted boolean);

-- Tenant-scoped deterministic resolver. Match precedence phone, then email,
-- ONLY within the given tenant. Mints a new customer otherwise. Idempotent.
CREATE OR REPLACE FUNCTION silver.resolve_customer(p_tenant uuid, p_phone text, p_email text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
    IF p_phone IS NOT NULL THEN
        SELECT customer_id INTO v_id FROM silver.identity_map
         WHERE tenant_id = p_tenant AND match_key = 'phone:'||p_phone;
    END IF;
    IF v_id IS NULL AND p_email IS NOT NULL THEN
        SELECT customer_id INTO v_id FROM silver.identity_map
         WHERE tenant_id = p_tenant AND match_key = 'email:'||p_email;
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO silver.dim_customer (tenant_id, first_seen, last_seen)
        VALUES (p_tenant, now(), now()) RETURNING customer_id INTO v_id;
    END IF;
    IF p_phone IS NOT NULL THEN
        INSERT INTO silver.identity_map (tenant_id, match_key, customer_id)
        VALUES (p_tenant, 'phone:'||p_phone, v_id) ON CONFLICT (tenant_id, match_key) DO NOTHING;
    END IF;
    IF p_email IS NOT NULL THEN
        INSERT INTO silver.identity_map (tenant_id, match_key, customer_id)
        VALUES (p_tenant, 'email:'||p_email, v_id) ON CONFLICT (tenant_id, match_key) DO NOTHING;
    END IF;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- AGENT - persisted agent OUTPUTS + observability (tenant-scoped).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent.campaign_plan (
    plan_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    plan_month date, region text, theme text, model_focus text,
    offer_code text, posting_schedule jsonb,
    created_by_run bigint, created_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS agent.content_asset (
    asset_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    plan_id bigint REFERENCES agent.campaign_plan(plan_id),
    asset_type text, body text, media_url text,
    status text DEFAULT 'draft', created_by_run bigint,
    created_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS agent.compliance_check (
    check_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    asset_id bigint REFERENCES agent.content_asset(asset_id),
    verdict text, reasons jsonb,
    checked_by_run bigint, checked_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS agent.publish_log (
    publish_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL,
    asset_id bigint REFERENCES agent.content_asset(asset_id),
    channel text, external_post_id text, status text,
    error_detail text, published_at timestamptz);

CREATE TABLE IF NOT EXISTS agent.agent_run_log (
    run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid,                          -- nullable: global/system agents
    agent_name text, customer_id bigint, input_ref jsonb, output_ref jsonb,
    confidence numeric, human_decision text, latency_ms integer,
    status text, ran_at timestamptz DEFAULT now());
