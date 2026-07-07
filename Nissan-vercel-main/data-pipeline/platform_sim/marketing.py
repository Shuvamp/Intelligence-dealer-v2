"""
Marketing automation simulator (tenant-aware) - Team 1 + channel metrics.

Runs for one dealer (ABC Nissan) to keep the demo focused; every row carries
tenant_id so it obeys the ADIP isolation rule and is RLS-ready. Persists each
agent OUTPUT (write-back) and logs the run.
"""
import json
from datetime import datetime, date, timedelta, timezone
from platform_sim.db import connect

now = datetime.now(timezone.utc); today = date.today()
ABC = "11111111-1111-1111-1111-111111111111"

INVENTORY = [
    ("Magnite","XV Turbo","Bengaluru-South",3,1050000),
    ("Magnite","XV Turbo","Bengaluru-North",1,1050000),
    ("Kicks","XL","Bengaluru-East",6,1420000),
    ("X-Trail","Premium","Bengaluru-North",8,4970000),
    ("Sunny","XV","Bengaluru-East",5,980000),
    ("Micra","XL","Bengaluru-South",4,720000),
]
OFFERS = [
    ("DIWALI10","Diwali 10% off + exchange bonus","Magnite","cash",105000,today,today+timedelta(days=30)),
    ("KICKSEMI","Kicks easy-EMI festival offer","Kicks","finance",0,today,today+timedelta(days=30)),
]
FESTIVALS = [("Diwali","Bengaluru-South",today+timedelta(days=12)),
             ("Diwali","Bengaluru-North",today+timedelta(days=12))]


def log_run(cur, agent_name, output_ref, confidence=0.9):
    cur.execute("""INSERT INTO agent.agent_run_log (tenant_id,agent_name,output_ref,confidence,human_decision,latency_ms,status)
                   VALUES (%s,%s,%s,%s,'accepted',%s,'ok') RETURNING run_id""",
                (ABC, agent_name, json.dumps(output_ref), confidence, 800))
    return cur.fetchone()[0]


def reset(cur):
    cur.execute("""
        TRUNCATE bronze.inventory_raw, bronze.offers_raw,
                 bronze.festival_calendar_raw, bronze.channel_insights_raw RESTART IDENTITY;
        TRUNCATE agent.publish_log, agent.compliance_check,
                 agent.content_asset, agent.campaign_plan RESTART IDENTITY CASCADE;
        TRUNCATE agent.agent_run_log RESTART IDENTITY;
    """)


def main():
    conn = connect(); cur = conn.cursor()
    reset(cur)

    for m,v,r,q,p in INVENTORY:
        cur.execute("INSERT INTO bronze.inventory_raw (tenant_id,model,variant,region,qty_available,list_price,payload) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (ABC,m,v,r,q,p,json.dumps({})))
    for code,desc,model,dt,dv,vf,vt in OFFERS:
        cur.execute("INSERT INTO bronze.offers_raw (tenant_id,offer_code,description,model,discount_type,discount_value,valid_from,valid_to,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (ABC,code,desc,model,dt,dv,vf,vt,json.dumps({})))
    for fn,reg,fd in FESTIVALS:
        cur.execute("INSERT INTO bronze.festival_calendar_raw (tenant_id,festival_name,region,festival_date,payload) VALUES (%s,%s,%s,%s,%s)",
                    (ABC,fn,reg,fd,json.dumps({})))

    schedule = {"slots":[str(today+timedelta(days=d)) for d in (2,5,9,12)]}
    cur.execute("""INSERT INTO agent.campaign_plan (tenant_id,plan_month,region,theme,model_focus,offer_code,posting_schedule,created_by_run)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING plan_id""",
                (ABC, today.replace(day=1), "Bengaluru-South", "Diwali Dhamaka", "Magnite", "DIWALI10", json.dumps(schedule), None))
    plan_id = cur.fetchone()[0]
    run = log_run(cur, "campaign_planner", {"plan_id": plan_id})
    cur.execute("UPDATE agent.campaign_plan SET created_by_run=%s WHERE plan_id=%s", (run, plan_id))

    assets = [
        ("poster","Light up Diwali with the Nissan Magnite - 10% off + exchange bonus!","https://cdn.dealer/diwali_magnite.png"),
        ("caption","This Diwali, drive home the bold new Magnite. Limited festive offer. #Nissan #Magnite #DiwaliDhamaka",None),
        ("hashtag_set","#Nissan #Magnite #DiwaliDhamaka #Bengaluru #FestiveOffer",None),
    ]
    asset_ids = []
    for atype, body, media in assets:
        cur.execute("""INSERT INTO agent.content_asset (tenant_id,plan_id,asset_type,body,media_url,status,created_by_run)
                       VALUES (%s,%s,%s,%s,%s,'draft',%s) RETURNING asset_id""",
                    (ABC, plan_id, atype, body, media, log_run(cur,"content_creation",{"plan_id":plan_id,"type":atype})))
        asset_ids.append(cur.fetchone()[0])

    for i, aid in enumerate(asset_ids):
        if i == 1:
            verdict, reasons = "requires_changes", {"failed":["dealer_contact_missing"]}
        else:
            verdict, reasons = "approved", {"failed":[]}
        cur.execute("""INSERT INTO agent.compliance_check (tenant_id,asset_id,verdict,reasons,checked_by_run)
                       VALUES (%s,%s,%s,%s,%s)""",
                    (ABC, aid, verdict, json.dumps(reasons), log_run(cur,"brand_compliance",{"asset_id":aid,"verdict":verdict})))
        cur.execute("UPDATE agent.content_asset SET status=%s WHERE asset_id=%s",
                    ("approved" if verdict == "approved" else "rejected", aid))

    cur.execute("SELECT asset_id FROM agent.content_asset WHERE status='approved'")
    approved = [r[0] for r in cur.fetchall()]
    for aid in approved:
        for ch in ["facebook","instagram","gbp","website"]:
            pid = f"{ch[:2]}-{aid}-{plan_id}"
            cur.execute("""INSERT INTO agent.publish_log (tenant_id,asset_id,channel,external_post_id,status,published_at)
                           VALUES (%s,%s,%s,%s,'published',%s)""", (ABC, aid, ch, pid, now))
            log_run(cur, "publishing", {"asset_id": aid, "channel": ch})
            cur.execute("""INSERT INTO bronze.channel_insights_raw
                           (tenant_id,channel,external_post_id,campaign_id,metric_date,impressions,clicks,spend,engagements,leads,payload)
                           VALUES (%s,%s,%s,'C-DIWALI',%s,%s,%s,%s,%s,%s,%s)""",
                        (ABC, ch, pid, today, 12000, 480, 6000, 950, 18, json.dumps({})))

    conn.commit()
    cur.execute("SELECT count(*) FROM agent.publish_log")
    n = cur.fetchone()[0]; conn.close()
    print("[marketing] (tenant ABC) plan -> 3 assets -> compliance (1 needs changes) -> %d published posts + channel metrics." % n)


if __name__ == "__main__":
    main()
