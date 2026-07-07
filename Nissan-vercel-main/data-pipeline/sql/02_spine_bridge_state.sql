-- =====================================================================
-- ADIP - data-pipeline : SPINE BRIDGE STATE
--
-- Persistent state owned by the bridge loader (data-pipeline/bridge/load.py).
-- Maps the pipeline's bigint customer_id -> the spine's uuid public.customers.id,
-- per tenant, so reruns keep stable identity and never duplicate customers.
--
-- The (tenant_id, customer_id_bi) PK enforces "identity is scoped per tenant"
-- and the same silver customer always resolves to the same spine UUID.
-- =====================================================================

CREATE TABLE IF NOT EXISTS silver.spine_customer_map (
    tenant_id      uuid   NOT NULL,
    customer_id_bi bigint NOT NULL,                    -- silver.dim_customer.customer_id
    spine_id       uuid   NOT NULL,                    -- public.customers.id
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, customer_id_bi)
);

CREATE INDEX IF NOT EXISTS spine_customer_map_spine_idx
    ON silver.spine_customer_map (spine_id);
