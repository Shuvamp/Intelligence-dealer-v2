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

-- Same idea for campaigns: the pipeline's free-text campaign code (from
-- bronze.channel_insights_raw / silver.dim_campaign) -> public.campaigns.id.
-- The platform owns the campaign dimension; the loader NEVER creates a campaign,
-- it only attaches pipeline facts to campaigns the dealer already has.
CREATE TABLE IF NOT EXISTS silver.spine_campaign_map (
    tenant_id     uuid NOT NULL,
    campaign_code text NOT NULL,                       -- silver.dim_campaign.campaign_id
    spine_id      uuid NOT NULL,                       -- public.campaigns.id
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, campaign_code)
);
