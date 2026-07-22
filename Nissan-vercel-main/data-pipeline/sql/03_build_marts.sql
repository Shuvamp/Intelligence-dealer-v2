-- =====================================================================
-- ADIP - data-pipeline : SILVER + GOLD MARTS (plain SQL views)
--
-- Replaces the dbt project. Run via psql after 01_core_ddl.sql:
--   psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE \
--        -v ON_ERROR_STOP=1 -f sql/03_build_marts.sql
--
-- Schema placement (unchanged from former dbt config):
--   silver.*  staging views (stg_*) + dimension/fact views (dim_*/fact_*)
--   gold.*    serving + mart views
--
-- Dependency order:
--   silver stg_*            (bronze sources only)
--   silver dim_*/fact_*     (staging views + silver app tables)
--   gold serving/mart/feat  (silver tables/views; gold ordered by dependency)
--
-- Idempotent: all statements are CREATE OR REPLACE VIEW.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS silver;
CREATE SCHEMA IF NOT EXISTS gold;

-- =====================================================================
-- SILVER STAGING VIEWS
-- source → silver (thin conforming layer over bronze raw tables)
-- =====================================================================

CREATE OR REPLACE VIEW silver.stg_channel_insights AS
select tenant_id, channel, external_post_id, campaign_id, metric_date,
       impressions, coalesce(reach, 0) as reach, clicks, spend, engagements, leads
from bronze.channel_insights_raw;

CREATE OR REPLACE VIEW silver.stg_festivals AS
select distinct tenant_id, festival_name, region, festival_date
from bronze.festival_calendar_raw;

-- Tenant-scoped normalised matching surface (phone last-10, email lower+trim).
CREATE OR REPLACE VIEW silver.stg_identity_keys AS
with unioned as (
    select tenant_id, 'walkin'::text as source, phone, email,
           visitor_name as name, locality as region, model_interest
    from bronze.walkin_raw
    union all
    select tenant_id, 'web', phone, email, null, null, model_interest
    from bronze.web_ga4_raw where event_type = 'form_submit'
    union all
    select tenant_id, 'meta', phone, email, full_name, null, model_interest
    from bronze.meta_lead_raw
    union all
    select tenant_id, 'event', phone, email, visitor_name, locality, model_interest
    from bronze.events_raw
    union all
    select tenant_id, 'call', phone, null, null, null, model_interest
    from bronze.calls_raw
    union all
    select tenant_id, 'oem', phone, email, full_name, locality, model_interest
    from bronze.oem_lead_raw
)
select tenant_id, source,
       nullif(right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10), '') as phone_key,
       nullif(lower(trim(coalesce(email,''))), '') as email_key,
       name, region, model_interest
from unioned;

-- Latest snapshot per (tenant, model, variant, region).
CREATE OR REPLACE VIEW silver.stg_inventory AS
with ranked as (
    select tenant_id, model, variant, region, qty_available, list_price, received_at,
           row_number() over (
               partition by tenant_id, model, variant, region
               order by received_at desc
           ) as rn
    from bronze.inventory_raw
)
select tenant_id, model, variant, region, qty_available, list_price,
       received_at as snapshot_at
from ranked where rn = 1;

-- Latest offer per (tenant, offer_code).
CREATE OR REPLACE VIEW silver.stg_offers AS
select distinct on (tenant_id, offer_code)
    tenant_id, offer_code, description, model,
    discount_type, discount_value, valid_from, valid_to
from bronze.offers_raw
order by tenant_id, offer_code, received_at desc;

-- =====================================================================
-- SILVER DIMENSION VIEWS
-- (depend on staging views above and/or silver app tables from 01_core_ddl)
-- =====================================================================

-- Calendar spine (global; no tenant).
CREATE OR REPLACE VIEW silver.dim_date AS
with spine as (
    select generate_series(
               date_trunc('year', current_date),
               date_trunc('year', current_date) + interval '1 year' - interval '1 day',
               interval '1 day'
           )::date as date_day
)
select date_day from spine;

-- Channels are platform-level (not tenant-owned).
CREATE OR REPLACE VIEW silver.dim_channel AS
select row_number() over (order by channel) as channel_id, channel
from (
    select distinct channel from silver.stg_channel_insights where channel is not null
) c;

-- Campaign dimension from Meta lead data + channel insight rows.
CREATE OR REPLACE VIEW silver.dim_campaign AS
with c as (
    select tenant_id, campaign_id, max(campaign_name) as campaign_name
    from bronze.meta_lead_raw
    where campaign_id is not null
    group by tenant_id, campaign_id
    union
    select tenant_id, campaign_id, null
    from silver.stg_channel_insights
    where campaign_id is not null
)
select tenant_id, campaign_id, max(campaign_name) as campaign_name
from c group by tenant_id, campaign_id;

-- Vehicle model catalog with segment classification.
CREATE OR REPLACE VIEW silver.dim_model AS
with models as (
    select tenant_id, model_interest as model
    from silver.fact_touchpoint
    where model_interest is not null
    union
    select tenant_id, model
    from silver.stg_inventory
    where model is not null
)
select row_number() over (order by tenant_id, model) as model_id,
       tenant_id, model,
       case
           when model ilike any(array['%magnite%','%kicks%','%x-trail%','%suv%']) then 'SUV'
           when model ilike any(array['%sunny%','%sedan%'])                       then 'Sedan'
           when model ilike any(array['%micra%','%hatch%'])                       then 'Hatchback'
           else 'Other'
       end as segment
from (select distinct tenant_id, model from models) m;

CREATE OR REPLACE VIEW silver.dim_offer AS
select row_number() over (order by tenant_id, offer_code) as offer_id,
       tenant_id, offer_code, description, model,
       discount_type, discount_value, valid_from, valid_to
from silver.stg_offers;

-- Region catalog from customers, inventory, and festivals.
CREATE OR REPLACE VIEW silver.dim_region AS
with regions as (
    select tenant_id, region from silver.dim_customer   where region is not null
    union
    select tenant_id, region from silver.stg_inventory  where region is not null
    union
    select tenant_id, region from silver.stg_festivals  where region is not null
)
select row_number() over (order by tenant_id, region) as region_id, tenant_id, region
from (select distinct tenant_id, region from regions) r;

-- =====================================================================
-- SILVER FACT VIEWS
-- =====================================================================

CREATE OR REPLACE VIEW silver.fact_channel_metrics AS
select row_number() over (
           order by tenant_id, metric_date, channel, external_post_id
       ) as metric_id,
       tenant_id, campaign_id, channel, external_post_id, metric_date,
       impressions, reach, clicks, spend, engagements, leads
from silver.stg_channel_insights;

CREATE OR REPLACE VIEW silver.fact_inventory AS
select row_number() over (
           order by tenant_id, model, variant, region
       ) as inventory_id,
       tenant_id, model, variant, region, qty_available, list_price, snapshot_at
from silver.stg_inventory;

-- =====================================================================
-- GOLD VIEWS — dependency order (each view appears after all its deps)
--
--   serving_lead_profile           (silver app tables only)
--   feat_customer_intent           (silver app tables only)
--   feat_lead_scoring              (silver app tables only)
--   mart_region_demand             (silver app tables only)
--   mart_opportunity               (gold.mart_region_demand + silver.fact_inventory)
--   mart_campaign_performance      (silver.fact_channel_metrics + silver.dim_campaign)
--   serving_executive_workload     (silver app tables only)
--   serving_followup_queue         (silver.fact_task + gold.serving_lead_profile)
--   serving_copilot_metrics        (multiple gold views above)
-- =====================================================================

-- Unified profile + latest lead state. Feeds Intake, Assignment, Co-Pilot.
CREATE OR REPLACE VIEW gold.serving_lead_profile AS
select c.customer_id, c.tenant_id, c.region, c.first_seen, c.last_seen,
       l.status, l.lead_score, l.assigned_to,
       tp.touch_count, tp.last_model_interest
from silver.dim_customer c
left join lateral (
    select status, lead_score, assigned_to
    from silver.fact_lead f
    where f.customer_id = c.customer_id
    order by changed_at desc
    limit 1
) l on true
left join lateral (
    select count(*) as touch_count,
           (array_agg(model_interest order by occurred_at desc))[1] as last_model_interest
    from silver.fact_touchpoint t
    where t.customer_id = c.customer_id
) tp on true;

-- Customer intent features for the Lead Scorer agent.
CREATE OR REPLACE VIEW gold.feat_customer_intent AS
select c.tenant_id, c.customer_id,
       count(t.touchpoint_id) filter (where t.occurred_at > now() - interval '30 days')
           as touchpoints_30d,
       count(distinct td.test_drive_id) as test_drives,
       count(distinct q.quotation_id)   as quotes,
       bool_or(td.completed)            as did_test_drive,
       max(t.occurred_at)               as last_touch_at
from silver.dim_customer c
left join silver.fact_touchpoint t  on t.customer_id  = c.customer_id
left join silver.fact_test_drive td on td.customer_id = c.customer_id
left join silver.fact_quotation  q  on q.customer_id  = c.customer_id
group by c.tenant_id, c.customer_id;

-- Lead scoring features per customer.
CREATE OR REPLACE VIEW gold.feat_lead_scoring AS
select c.tenant_id, c.customer_id,
       count(*)                                        as total_touchpoints,
       count(*) filter (where t.source = 'walkin')    as walkin_touches,
       count(*) filter (where t.source = 'web')       as web_touches,
       count(*) filter (where t.source = 'meta')      as meta_touches,
       count(distinct t.model_interest)               as models_considered,
       max(t.occurred_at)                             as last_touch_at,
       bool_or(t.source = 'walkin')                   as has_visited_showroom
from silver.fact_touchpoint t
join silver.dim_customer c using (customer_id)
group by c.tenant_id, c.customer_id;

-- Demand by dealer/region/model. Feeds Demand Signal, Opportunity.
CREATE OR REPLACE VIEW gold.mart_region_demand AS
select c.tenant_id,
       coalesce(c.region, 'unknown') as region,
       t.model_interest,
       count(*)                      as touchpoints,
       count(distinct t.customer_id) as unique_customers
from silver.fact_touchpoint t
join silver.dim_customer c using (customer_id)
where t.model_interest is not null
group by c.tenant_id, 2, t.model_interest;

-- Demand vs available stock. Feeds Opportunity, Campaign Planner.
CREATE OR REPLACE VIEW gold.mart_opportunity AS
select d.tenant_id, d.region, d.model_interest as model,
       d.touchpoints                                      as demand_signal,
       coalesce(i.qty_available, 0)                       as stock_on_hand,
       d.touchpoints - coalesce(i.qty_available, 0)       as demand_gap
from gold.mart_region_demand d
left join lateral (
    select sum(qty_available) as qty_available
    from silver.fact_inventory fi
    where fi.tenant_id = d.tenant_id
      and fi.region    = d.region
      and fi.model     = d.model_interest
) i on true
order by demand_gap desc;

-- Campaign performance from channel metrics. Feeds Campaign Insight agent.
CREATE OR REPLACE VIEW gold.mart_campaign_performance AS
select m.tenant_id, m.campaign_id, cp.campaign_name,
       sum(m.impressions) as impressions,
       sum(m.clicks)      as clicks,
       sum(m.spend)       as spend,
       sum(m.leads)       as leads,
       case when sum(m.leads) > 0
            then round(sum(m.spend) / sum(m.leads), 2)
       end as cost_per_lead
from silver.fact_channel_metrics m
left join silver.dim_campaign cp
       on cp.tenant_id  = m.tenant_id
      and cp.campaign_id = m.campaign_id
group by m.tenant_id, m.campaign_id, cp.campaign_name;

-- Same facts at DAY grain. Feeds the bridge loader's public.campaign_insights
-- pass — the spine stores one insight row per campaign per capture date, and the
-- Marketing dashboard's trend chart and period filter both key off that date, so
-- the lifetime rollup above can't serve it.
CREATE OR REPLACE VIEW gold.mart_campaign_performance_daily AS
select m.tenant_id, m.campaign_id, cp.campaign_name, m.metric_date,
       sum(m.impressions)  as impressions,
       sum(m.reach)        as reach,
       sum(m.engagements)  as engagement,
       sum(m.clicks)       as clicks,
       sum(m.spend)        as spend,
       sum(m.leads)        as leads,
       case when sum(m.leads) > 0
            then round(sum(m.spend) / sum(m.leads), 2)
       end as cost_per_lead
from silver.fact_channel_metrics m
left join silver.dim_campaign cp
       on cp.tenant_id  = m.tenant_id
      and cp.campaign_id = m.campaign_id
group by m.tenant_id, m.campaign_id, cp.campaign_name, m.metric_date;

-- Executive workload + conversion. Feeds Lead Assignment agent.
CREATE OR REPLACE VIEW gold.serving_executive_workload AS
select e.tenant_id, e.sales_exec_id, e.name, e.region, e.expertise,
       count(distinct a.assignment_id)                              as open_leads,
       count(distinct a.assignment_id) filter (where l.status='Hot') as hot_leads,
       count(distinct q.quotation_id)  filter (where q.accepted)     as won_deals
from silver.dim_sales_executive e
left join silver.fact_assignment a
       on a.sales_exec_id = e.sales_exec_id
left join lateral (
    select status
    from silver.fact_lead f
    where f.customer_id = a.customer_id
    order by changed_at desc
    limit 1
) l on true
left join silver.fact_quotation q
       on q.customer_id = a.customer_id
where e.active
group by e.tenant_id, e.sales_exec_id, e.name, e.region, e.expertise;

-- Follow-up task queue with lead context. Feeds Follow-up Advisor agent.
CREATE OR REPLACE VIEW gold.serving_followup_queue AS
select t.tenant_id, t.task_id, t.customer_id, t.sales_exec_id,
       t.task_type, t.due_at, t.status,
       p.status     as lead_status,
       p.lead_score
from silver.fact_task t
left join gold.serving_lead_profile p on p.customer_id = t.customer_id
where t.status in ('open', 'overdue');

-- KPI catalog per dealer for the Executive Co-Pilot.
CREATE OR REPLACE VIEW gold.serving_copilot_metrics AS
select tenant_id, 'hot_leads' as metric, count(*)::numeric as value
  from gold.serving_lead_profile
 where status = 'Hot'
 group by tenant_id
union all
select tenant_id, 'open_followups', count(*)::numeric
  from gold.serving_followup_queue
 group by tenant_id
union all
select tenant_id, 'top_demand_touchpoints', max(touchpoints)::numeric
  from gold.mart_region_demand
 group by tenant_id
union all
select tenant_id, 'biggest_demand_gap', max(demand_gap)::numeric
  from gold.mart_opportunity
 group by tenant_id
union all
select tenant_id, 'best_campaign_cpl', min(cost_per_lead)::numeric
  from gold.mart_campaign_performance
 where cost_per_lead is not null
 group by tenant_id;
