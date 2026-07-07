"""
Real-time intake lane (tenant-aware) - Team 2: Lead Management.

Aligned to the ADIP spine rule: every record carries tenant_id, and identity
resolution is SCOPED PER TENANT. The same phone/email under two different
dealers stays two different customers (no cross-dealer merge).

  source webhook -> bronze insert (tenant_id)
                 -> silver.resolve_customer(tenant_id, phone, email)
                 -> fact_touchpoint -> qualify -> assign -> follow-up -> convert

In ADIP, resolve_customer() upserts public.customers (the spine identity);
here it runs standalone so the pipeline is demoable. Re-runnable: resets first.
"""
import json, re
from datetime import datetime, timedelta, timezone
from platform_sim.db import connect

now = datetime.now(timezone.utc)

# Two demo dealers - UUIDs match the ADIP spine seed (supabase/seed.sql).
ABC = "11111111-1111-1111-1111-111111111111"   # ABC Nissan
XYZ = "22222222-2222-2222-2222-222222222222"   # XYZ Nissan


def norm_phone(p):
    if not p:
        return None
    d = re.sub(r"\D", "", p)
    return d[-10:] if len(d) >= 10 else (d or None)


def norm_email(e):
    return e.strip().lower() if e else None


# (tenant, name, phone, email, model, region, source, event_type)
EVENTS = [
    # --- ABC Nissan (7 distinct customers) ---
    (ABC, "Rahul Verma", "+91 98800 11111", "rahul.v@gmail.com", "Magnite", "Bengaluru-South", "walkin", "walk_in"),
    (ABC, "Rahul Verma", "9880011111",      "rahul.v@gmail.com", "Magnite", None,              "web",    "form_submit"),
    (ABC, "Sneha Iyer",  "+91 99001 22222", "sneha.iyer@yahoo.com", "Kicks", "Bengaluru-East", "meta",   "meta_lead"),
    (ABC, "Sneha Iyer",  "9900122222",      None,                   "Kicks", None,             "call",   "call"),
    (ABC, "Arjun Menon", "+91 98456 33333", "arjun.m@outlook.com", "X-Trail", "Bengaluru-North", "oem",  "oem_lead"),
    (ABC, "Arjun Menon", "9845633333",      "arjun.m@outlook.com", "X-Trail", "Bengaluru-North", "event","walk_in"),
    (ABC, "Divya Shah",  "+91 90080 44444", "divya.shah@gmail.com", "Sunny",  "Bengaluru-East",  "walkin","walk_in"),
    (ABC, "Karan Gupta", "+91 90190 55555", "karan.g@gmail.com",    "Micra",  "Bengaluru-South", "web",  "form_submit"),
    (ABC, "Meera Pillai","+91 90290 66666", "meera.p@gmail.com",    "Magnite","Bengaluru-North", "meta", "meta_lead"),
    (ABC, "Tarun Das",   "+91 90390 77777", "tarun.das@gmail.com",  "Kicks",  "Bengaluru-East",  "walkin","walk_in"),
    # --- XYZ Nissan (2 distinct customers). NOTE: first one reuses Rahul's
    #     ABC phone (9880011111) but under a DIFFERENT dealer -> must NOT merge.
    (XYZ, "Different Person", "+91 98800 11111", "newcust@gmail.com", "Magnite", "Anna Nagar", "walkin", "walk_in"),
    (XYZ, "Latha Reddy",      "+91 91234 88888", "latha.r@gmail.com", "X-Trail", "Anna Nagar", "web",    "form_submit"),
]

EXECUTIVES = [
    (ABC, "Anita Rao",     "Bengaluru-South", "SUV"),
    (ABC, "Vikram Shetty", "Bengaluru-North", "Sedan"),
    (ABC, "Priya Nair",    "Bengaluru-East",  "Hatchback"),
    (XYZ, "Latha Manager", "Anna Nagar",      "SUV"),
]

BRONZE = {
 "walkin": "INSERT INTO bronze.walkin_raw (tenant_id,visitor_name,phone,email,model_interest,locality,payload) VALUES (%s,%s,%s,%s,%s,%s,%s)",
 "web":    "INSERT INTO bronze.web_ga4_raw (tenant_id,ga_client_id,event_type,phone,email,model_interest,page_path,payload) VALUES (%s,%s,'form_submit',%s,%s,%s,'/enquiry',%s)",
 "meta":   "INSERT INTO bronze.meta_lead_raw (tenant_id,meta_lead_id,campaign_id,campaign_name,full_name,phone,email,model_interest,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
 "event":  "INSERT INTO bronze.events_raw (tenant_id,event_name,visitor_name,phone,email,model_interest,locality,payload) VALUES (%s,'Auto Expo',%s,%s,%s,%s,%s,%s)",
 "call":   "INSERT INTO bronze.calls_raw (tenant_id,call_id,direction,phone,duration_sec,disposition,model_interest,transcript,payload) VALUES (%s,%s,'inbound',%s,%s,'connected',%s,%s,%s)",
 "oem":    "INSERT INTO bronze.oem_lead_raw (tenant_id,oem_lead_id,full_name,phone,email,model_interest,locality,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
}


def reset(cur):
    cur.execute("""
        TRUNCATE bronze.walkin_raw, bronze.web_ga4_raw, bronze.meta_lead_raw,
                 bronze.events_raw, bronze.calls_raw, bronze.oem_lead_raw RESTART IDENTITY;
        TRUNCATE silver.fact_quotation, silver.fact_test_drive, silver.fact_task,
                 silver.fact_assignment, silver.fact_lead, silver.fact_touchpoint,
                 silver.pii_vault RESTART IDENTITY CASCADE;
        TRUNCATE silver.identity_map;
        TRUNCATE silver.dim_customer CASCADE;
        ALTER SEQUENCE silver.customer_id_seq RESTART WITH 1;
        TRUNCATE silver.dim_sales_executive RESTART IDENTITY CASCADE;
    """)


def land_bronze(cur, ev):
    t, name, phone, email, model, region, source, etype = ev
    pl = json.dumps({"raw_name": name, "raw_phone": phone})
    if source == "walkin":
        cur.execute(BRONZE[source], (t, name, phone, email, model, region, pl))
    elif source == "web":
        cur.execute(BRONZE[source], (t, "ga-"+norm_phone(phone), phone, email, model, pl))
    elif source == "meta":
        cur.execute(BRONZE[source], (t, "ml-"+norm_phone(phone), "C-DIWALI", "Diwali Dhamaka", name, phone, email, model, pl))
    elif source == "event":
        cur.execute(BRONZE[source], (t, name, phone, email, model, region, pl))
    elif source == "call":
        cur.execute(BRONZE[source], (t, "call-"+norm_phone(phone), phone, 180, model, "Interested in "+model, pl))
    elif source == "oem":
        cur.execute(BRONZE[source], (t, "oem-"+norm_phone(phone), name, phone, email, model, region, pl))


def main():
    conn = connect(); cur = conn.cursor()
    reset(cur)

    for t, name, region, expertise in EXECUTIVES:
        cur.execute("INSERT INTO silver.dim_sales_executive (tenant_id,name,region,expertise) VALUES (%s,%s,%s,%s)",
                    (t, name, region, expertise))

    seen_region, seen_source = {}, {}
    for i, ev in enumerate(EVENTS):
        t, name, phone, email, model, region, source, etype = ev
        p, e = norm_phone(phone), norm_email(email)
        land_bronze(cur, ev)
        cur.execute("SELECT silver.resolve_customer(%s,%s,%s)", (t, p, e))   # tenant-scoped
        cid = cur.fetchone()[0]
        seen_source.setdefault(cid, source)
        if region and cid not in seen_region:
            seen_region[cid] = region
        cur.execute("""INSERT INTO silver.pii_vault (customer_id,tenant_id,full_name,phone_enc,email_enc,consent_at,retain_until)
                       VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (customer_id) DO NOTHING""",
                    (cid, t, name, (p or "").encode(), (e or "").encode(), now, (now+timedelta(days=730)).date()))
        cur.execute("""INSERT INTO silver.fact_touchpoint (tenant_id,customer_id,source,event_type,model_interest,campaign_id,occurred_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (t, cid, source, etype, model, "C-DIWALI" if source == "meta" else None, now - timedelta(days=len(EVENTS)-i)))

    for cid, region in seen_region.items():
        cur.execute("UPDATE silver.dim_customer SET region=%s WHERE customer_id=%s", (region, cid))
    for cid, src in seen_source.items():
        cur.execute("UPDATE silver.dim_customer SET source_first=%s WHERE customer_id=%s", (src, cid))

    # Lead Qualification (per customer, tenant carried through)
    cur.execute("""
        SELECT c.tenant_id, c.customer_id, count(*) AS touches,
               bool_or(t.source='walkin' OR t.event_type='walk_in') AS showroom,
               count(distinct t.source) AS channels
        FROM silver.dim_customer c JOIN silver.fact_touchpoint t USING (customer_id)
        GROUP BY c.tenant_id, c.customer_id
    """)
    scored = []
    for tid, cid, touches, showroom, channels in cur.fetchall():
        score = min(100, 25*channels + 15*touches + (25 if showroom else 0))
        status = "Hot" if score >= 70 else "Warm" if score >= 45 else "Cold"
        scored.append((tid, cid, score, status))
        cur.execute("INSERT INTO silver.fact_lead (tenant_id,customer_id,status,lead_score,changed_at) VALUES (%s,%s,%s,%s,%s)",
                    (tid, cid, status, score, now))

    # Lead Assignment - match an executive WITHIN THE SAME TENANT
    cur.execute("SELECT sales_exec_id, tenant_id, region FROM silver.dim_sales_executive ORDER BY sales_exec_id")
    execs = cur.fetchall()
    rr = {}
    for tid, cid, score, status in scored:
        if status == "Cold":
            continue
        cur.execute("SELECT region FROM silver.dim_customer WHERE customer_id=%s", (cid,))
        creg = cur.fetchone()[0]
        tenant_execs = [(eid, ereg) for eid, et, ereg in execs if et == tid]
        if not tenant_execs:
            continue
        match = next((eid for eid, ereg in tenant_execs if ereg == creg), None)
        reason = "location"
        if match is None:
            idx = rr.get(tid, 0); match = tenant_execs[idx % len(tenant_execs)][0]; rr[tid] = idx+1; reason = "workload"
        cur.execute("INSERT INTO silver.fact_assignment (tenant_id,customer_id,sales_exec_id,assigned_at,assignment_reason) VALUES (%s,%s,%s,%s,%s)",
                    (tid, cid, match, now, reason))
        cur.execute("""INSERT INTO silver.fact_task (tenant_id,customer_id,sales_exec_id,task_type,due_at,status,created_at)
                       VALUES (%s,%s,%s,%s,%s,'open',%s)""",
                    (tid, cid, match, "call" if status == "Hot" else "message", now+timedelta(days=1), now))

    # Conversion - test drive + quotation for Hot leads
    for tid, cid, score, status in scored:
        if status != "Hot":
            continue
        cur.execute("SELECT (array_agg(model_interest ORDER BY occurred_at DESC))[1] FROM silver.fact_touchpoint WHERE customer_id=%s", (cid,))
        model = cur.fetchone()[0]
        cur.execute("INSERT INTO silver.fact_test_drive (tenant_id,customer_id,model,scheduled_at,completed,outcome) VALUES (%s,%s,%s,%s,true,'positive')",
                    (tid, cid, model, now+timedelta(days=2)))
        cur.execute("INSERT INTO silver.fact_quotation (tenant_id,customer_id,model,offer_code,quoted_price,quoted_at,accepted) VALUES (%s,%s,%s,'DIWALI10',%s,%s,%s)",
                    (tid, cid, model, 1050000, now+timedelta(days=3), score >= 90))

    conn.commit()
    cur.execute("SELECT tenant_id, count(*) FROM silver.dim_customer GROUP BY tenant_id ORDER BY tenant_id")
    rows = cur.fetchall()
    cur.execute("SELECT count(*) FROM silver.identity_map WHERE match_key='phone:9880011111'")
    shared = cur.fetchone()[0]
    conn.close()
    print("[intake] %d events -> customers per tenant: %s" %
          (len(EVENTS), ", ".join("%s=%d" % (str(t)[:8], n) for t, n in rows)))
    print("[intake] phone 9880011111 maps to %d customers (one per tenant) - "
          "identity did NOT cross dealers." % shared)


if __name__ == "__main__":
    main()
