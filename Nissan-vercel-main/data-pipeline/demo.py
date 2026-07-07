"""Tenant-aware full-slice demo. Run after: ddl -> intake -> marketing -> dbt build."""
from platform_sim.db import query

def section(t): print("\n"+"="*72+"\n"+t+"\n"+"="*72)
def table(rows):
    if not rows: print("  (no rows)"); return
    cols=list(rows[0].keys())
    w={c:max(len(c),*(len(str(r[c])) for r in rows)) for c in cols}
    print("  "+" | ".join(c.ljust(w[c]) for c in cols))
    print("  "+"-+-".join("-"*w[c] for c in cols))
    for r in rows: print("  "+" | ".join(str(r[c]).ljust(w[c]) for c in cols))

section("MULTI-TENANT IDENTITY RESOLUTION  (per-dealer, no cross-dealer merge)")
print("Each dealer's leads resolve to their OWN customers:")
table(query("""
  SELECT substr(c.tenant_id::text,1,8) AS dealer, v.full_name, c.customer_id,
         count(t.touchpoint_id) AS touchpoints,
         string_agg(DISTINCT t.source, ', ' ORDER BY t.source) AS sources
  FROM silver.dim_customer c
  JOIN silver.pii_vault v USING (customer_id)
  JOIN silver.fact_touchpoint t USING (customer_id)
  GROUP BY c.tenant_id, v.full_name, c.customer_id
  ORDER BY c.tenant_id, c.customer_id
"""))
print("\nProof of isolation - the SAME phone under two dealers stays two customers:")
table(query("""
  SELECT match_key, substr(tenant_id::text,1,8) AS dealer, customer_id
  FROM silver.identity_map WHERE match_key='phone:9880011111' ORDER BY tenant_id
"""))

section("TEAM 2: LEAD MANAGEMENT  -  unified profile + qualification")
table(query("""
  SELECT substr(p.tenant_id::text,1,8) AS dealer, p.customer_id, p.region, p.status,
         p.lead_score, p.last_model_interest, e.name AS assigned_exec
  FROM gold.serving_lead_profile p
  LEFT JOIN silver.fact_assignment a ON a.customer_id=p.customer_id
  LEFT JOIN silver.dim_sales_executive e ON e.sales_exec_id=a.sales_exec_id
  ORDER BY p.tenant_id, p.lead_score DESC
"""))

print("\ngold.serving_executive_workload (Lead Assignment Agent):")
table(query("SELECT substr(tenant_id::text,1,8) AS dealer, name, region, expertise, open_leads, hot_leads FROM gold.serving_executive_workload ORDER BY tenant_id, open_leads DESC"))

section("TEAM 3: MARKET INTELLIGENCE")
print("gold.mart_region_demand (per dealer):")
table(query("SELECT substr(tenant_id::text,1,8) AS dealer, region, model_interest, touchpoints FROM gold.mart_region_demand ORDER BY tenant_id, touchpoints DESC"))
print("\ngold.mart_opportunity (demand vs stock):")
table(query("SELECT substr(tenant_id::text,1,8) AS dealer, region, model, demand_signal, stock_on_hand, demand_gap FROM gold.mart_opportunity ORDER BY demand_gap DESC LIMIT 6"))
print("\ngold.mart_campaign_performance:")
table(query("SELECT substr(tenant_id::text,1,8) AS dealer, campaign_id, impressions, clicks, spend, leads, cost_per_lead FROM gold.mart_campaign_performance"))

section("TEAM 1: MARKETING  -  agent write-back chain (tenant ABC)")
table(query("""
  SELECT cp.theme, ca.asset_type, ca.status, cc.verdict AS compliance, count(pl.publish_id) AS published_to
  FROM agent.campaign_plan cp JOIN agent.content_asset ca ON ca.plan_id=cp.plan_id
  LEFT JOIN agent.compliance_check cc ON cc.asset_id=ca.asset_id
  LEFT JOIN agent.publish_log pl ON pl.asset_id=ca.asset_id
  GROUP BY cp.theme, ca.asset_type, ca.status, cc.verdict ORDER BY ca.asset_type
"""))

section("MASTER: DEALERSHIP CO-PILOT  -  headline KPIs per dealer")
table(query("SELECT substr(tenant_id::text,1,8) AS dealer, metric, value FROM gold.serving_copilot_metrics ORDER BY tenant_id, metric"))

print("\nDemo complete. Every row is tenant-scoped - ready to plug into the ADIP spine.\n")
