#!/usr/bin/env python3
"""Seed demo auth users + their public.users rows for the local stack.

Run after `supabase db reset` (which wipes auth.users). Idempotent.
Reads API_URL / PUBLISHABLE_KEY / SECRET_KEY from `supabase status -o env`,
so it needs no hardcoded keys. HTTP-only (admin API + PostgREST) — no docker.

  python3 scripts/seed_demo_users.py
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# (email, password, tenant_id, full_name, role)
ABC = "11111111-1111-1111-1111-111111111111"
XYZ = "22222222-2222-2222-2222-222222222222"
PASSWORD = "Passw0rd!23"
DEMO_USERS = [
    ("owner@abcnissan.test",   PASSWORD, ABC, "Demo Owner (ABC)",   "dealer_owner"),
    ("manager@abcnissan.test", PASSWORD, ABC, "Demo Manager (ABC)", "dealer_manager"),
    ("sales@xyznissan.test",   PASSWORD, XYZ, "Demo Sales (XYZ)",   "sales_executive"),
]


def status_env():
    out = subprocess.check_output(["supabase", "status", "-o", "env"], text=True)
    env = {}
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    return env


def req(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def main():
    env = status_env()
    api = env["API_URL"]
    sec = env["SECRET_KEY"]
    admin_h = {"apikey": sec, "Authorization": f"Bearer {sec}", "Content-Type": "application/json"}

    # Build an email->id map of existing auth users (paginated list).
    existing = {}
    page = 1
    while True:
        st, data = req("GET", f"{api}/auth/v1/admin/users?page={page}&per_page=200", admin_h)
        users = (data or {}).get("users", []) if isinstance(data, dict) else []
        if not users:
            break
        for u in users:
            existing[u["email"]] = u["id"]
        page += 1

    ok = True
    for email, pw, tenant, name, role in DEMO_USERS:
        uid = existing.get(email)
        if not uid:
            st, data = req("POST", f"{api}/auth/v1/admin/users", admin_h,
                           {"email": email, "password": pw, "email_confirm": True})
            if st not in (200, 201) or not isinstance(data, dict) or "id" not in data:
                print(f"  ! create failed for {email}: {st} {data}")
                ok = False
                continue
            uid = data["id"]
        existing[email] = uid  # keep the map current for later seeding (assignees, activity)
        # Upsert the public.users row (service key bypasses RLS).
        rest_h = {**admin_h, "Prefer": "resolution=merge-duplicates,return=minimal"}
        st, data = req("POST", f"{api}/rest/v1/users", rest_h,
                       {"id": uid, "tenant_id": tenant, "full_name": name, "email": email, "role": role})
        if st not in (200, 201, 204):
            print(f"  ! link failed for {email}: {st} {data}")
            ok = False
            continue
        print(f"  ✓ {email}  ->  tenant {tenant[:8]}…  role {role}")

    # Seed liveliness: notifications + audit_logs for the ABC owner so the
    # dashboard's Upcoming Tasks and Recent Activity panels show REAL rows.
    abc_owner = existing.get("owner@abcnissan.test")
    if abc_owner:
        seed_activity(api, admin_h, abc_owner)
        print("  ✓ seeded notifications + audit_logs for ABC owner")

    seed_leads(api, admin_h, existing)
    seed_marketing(api, admin_h, existing)
    seed_copilot(api, admin_h, existing)

    print(f"\nDemo password for all users: {PASSWORD}")
    sys.exit(0 if ok else 1)


def seed_copilot(api, admin_h, existing):
    rest_h = {**admin_h, "Prefer": "return=representation"}
    owner = existing.get("owner@abcnissan.test")
    if not owner:
        return
    req("DELETE", f"{api}/rest/v1/copilot_conversations?tenant_id=eq.{ABC}", admin_h)
    st, rows = req("POST", f"{api}/rest/v1/copilot_conversations", rest_h, {
        "tenant_id": ABC, "user_id": owner, "title": "Which leads should I call today?"})
    if not rows:
        return
    cid = rows[0]["id"]
    msgs = [
        ("user", "Which leads should I call today?", []),
        ("assistant",
         "Call these 4 hot leads first — they're high-intent and waiting longest: Ravi Kumar, Karthik Raja, Deepa Nair, Vimal Chandran. Lead with a test-drive offer for their vehicle of interest.",
         [{"kind": "lead", "label": "Ravi Kumar · Magnite"}, {"kind": "lead", "label": "Karthik Raja · Kicks"}]),
    ]
    for i, (role, content, cites) in enumerate(msgs):
        req("POST", f"{api}/rest/v1/copilot_messages", admin_h, {
            "tenant_id": ABC, "conversation_id": cid, "role": role, "content": content,
            "citations": cites, "created_at": iso(20 - i)})
    print("  ✓ seeded copilot: 1 ABC conversation")


ABC_LOC1 = "aaaaaaaa-0000-0000-0000-000000000001"
XYZ_LOC1 = "bbbbbbbb-0000-0000-0000-000000000001"


def seed_marketing(api, admin_h, existing):
    rest_h = {**admin_h, "Prefer": "return=representation"}
    owner = existing.get("owner@abcnissan.test")
    xyz = existing.get("sales@xyznissan.test")

    for t in (ABC, XYZ):
        req("DELETE", f"{api}/rest/v1/campaign_posts?tenant_id=eq.{t}", admin_h)
        req("DELETE", f"{api}/rest/v1/campaign_insights?tenant_id=eq.{t}", admin_h)
        req("DELETE", f"{api}/rest/v1/campaigns?tenant_id=eq.{t}", admin_h)

    def campaign(tenant, loc, who, name, theme, objective, status, channels):
        st, rows = req("POST", f"{api}/rest/v1/campaigns", rest_h, {
            "tenant_id": tenant, "location_id": loc, "name": name, "theme": theme,
            "objective": objective, "status": status, "channels": channels, "created_by": who,
        })
        return rows[0]["id"] if rows else None

    def post(tenant, cid, who, vehicle, channel, status, **kw):
        body = {"tenant_id": tenant, "campaign_id": cid, "created_by": who, "vehicle": vehicle,
                "channel": channel, "status": status,
                "title": kw.get("title"), "caption": kw.get("caption"),
                "cta": kw.get("cta", "Book a Test Drive"), "hashtags": kw.get("hashtags", []),
                "compliance": kw.get("compliance", "unchecked"), "offer": kw.get("offer"),
                "poster_prompt": kw.get("poster_prompt"),
                "scheduled_at": kw.get("scheduled_at"), "published_at": kw.get("published_at")}
        req("POST", f"{api}/rest/v1/campaign_posts", admin_h, body)

    def insight(tenant, cid, reach, eng, leads, conv, spend):
        cpl = round(spend / leads) if leads else 0
        cr = round((conv / leads) * 100, 1) if leads else 0
        req("POST", f"{api}/rest/v1/campaign_insights", admin_h, {
            "tenant_id": tenant, "campaign_id": cid, "reach": reach, "impressions": int(reach * 1.8),
            "engagement": eng, "leads_generated": leads, "conversions": conv, "spend": spend,
            "cost_per_lead": cpl, "conversion_rate": cr})

    tags = ["#Nissan", "#NissanMagnite", "#TestDrive", "#DriveNissan"]
    # ABC — 4 campaigns spanning the workflow
    c1 = campaign(ABC, ABC_LOC1, owner, "Independence Day SUV Drive", "Freedom to Drive", "festival", "active", ["instagram", "facebook"])
    post(ABC, c1, owner, "Magnite", "instagram", "published", title="Magnite — Freedom to Drive",
         caption="🇮🇳 Freedom to drive your dream. The Nissan Magnite with special Independence Day offers. Book your test drive today!",
         hashtags=tags + ["#IndependenceDay"], compliance="approved", published_at=iso(4320),
         poster_prompt="Premium Magnite hero shot with patriotic accents, Nissan red branding.")
    post(ABC, c1, owner, "X-Trail", "facebook", "published", title="X-Trail — Freedom to Drive",
         caption="Conquer every road this Independence Day. Nissan X-Trail — now with festive finance.",
         hashtags=tags + ["#XTrail", "#IndependenceDay"], compliance="approved", published_at=iso(5760))
    insight(ABC, c1, 84000, 6200, 142, 23, 180000)

    c2 = campaign(ABC, ABC_LOC1, owner, "Magnite Monsoon Offer", "Monsoon-Ready", "offer", "active", ["instagram", "google_business"])
    post(ABC, c2, owner, "Magnite", "instagram", "scheduled", title="Monsoon Magnite",
         caption="☔ Monsoon-ready Magnite with ₹50k cashback. Limited period. Enquire now!",
         hashtags=tags + ["#MonsoonOffer"], offer="₹50k cashback", compliance="approved", scheduled_at=iso(-2880))
    post(ABC, c2, owner, "Magnite", "google_business", "pending_approval", title="Magnite Service Camp",
         caption="Free monsoon check-up with every Magnite booking this week.",
         hashtags=tags, offer="Free check-up", compliance="unchecked")
    insight(ABC, c2, 52000, 4100, 96, 14, 96000)

    c3 = campaign(ABC, ABC_LOC1, owner, "Diwali Festive Bonanza", "Light Up Your Driveway", "festival", "scheduled", ["instagram", "facebook", "google_business"])
    post(ABC, c3, owner, "X-Trail", "instagram", "pending_approval", title="Diwali X-Trail",
         caption="✨ Light up your Diwali with the Nissan X-Trail. Festive offers inside.",
         hashtags=tags + ["#Diwali", "#XTrail"], compliance="flagged")
    post(ABC, c3, owner, "Kicks", "facebook", "draft", title="Diwali Kicks",
         caption="The Nissan Kicks — your festive companion.", hashtags=tags + ["#Diwali"])

    campaign(ABC, ABC_LOC1, owner, "Weekend Test Drive Event", "Feel the Drive", "lead_gen", "draft", ["instagram"])

    # XYZ — isolation
    cx = campaign(XYZ, XYZ_LOC1, xyz, "Kicks Launch Teaser", "Arriving Soon", "launch", "active", ["instagram"])
    post(XYZ, cx, xyz, "Kicks", "instagram", "published", title="Kicks is coming",
         caption="Something bold is arriving at XYZ Nissan. #Kicks", hashtags=["#Nissan", "#Kicks"],
         compliance="approved", published_at=iso(2880))
    insight(XYZ, cx, 21000, 1500, 38, 5, 42000)
    print("  ✓ seeded marketing: ABC 4 campaigns + posts + insights, XYZ 1 (with scorecards)")


def band(v):
    return "hot" if v >= 70 else ("warm" if v >= 40 else "cold")


def seed_leads(api, admin_h, existing):
    rest_h = {**admin_h, "Prefer": "return=representation"}
    abc_owner = existing.get("owner@abcnissan.test")
    abc_mgr = existing.get("manager@abcnissan.test")
    xyz_sales = existing.get("sales@xyznissan.test")

    def customers_for(tenant):
        st, data = req("GET", f"{api}/rest/v1/customers?tenant_id=eq.{tenant}&select=id,full_name,preferred_vehicle,location_id,source_channel&order=created_at", admin_h)
        return data if isinstance(data, list) else []

    # Clear any prior demo leads (events cascade) so re-runs stay idempotent.
    for t in (ABC, XYZ):
        req("DELETE", f"{api}/rest/v1/leads?tenant_id=eq.{t}", admin_h)

    src_map = {"walk-in": "walkin", "walkin": "walkin", "instagram": "instagram", "facebook": "facebook",
               "website": "website", "oem": "oem", "phone": "phone", "referral": "referral", "event": "event"}

    # (stage, score_value, assignee_key, budget)
    abc_plan = [
        ("won", 95, "owner", 1100000), ("negotiation", 86, "mgr", 3200000),
        ("quotation", 80, "owner", 1400000), ("test_drive", 74, "mgr", 1050000),
        ("qualified", 62, "owner", 1300000), ("contacted", 52, "mgr", 3100000),
        ("contacted", 45, "owner", 1000000), ("new", 33, "mgr", 1350000),
        ("new", 28, "owner", 900000), ("lost", 30, "mgr", 3000000),
    ]
    xyz_plan = [("qualified", 60, "sales", 1100000), ("new", 30, "sales", 1400000)]
    assignees = {"owner": abc_owner, "mgr": abc_mgr, "sales": xyz_sales}

    def make(tenant, custs, plan, idx):
        n = 0
        for cust, (stage, sv, akey, budget) in zip(custs, plan):
            src = src_map.get(cust.get("source_channel") or "website", "website")
            st, rows = req("POST", f"{api}/rest/v1/leads", rest_h, {
                "tenant_id": tenant, "location_id": cust.get("location_id"),
                "customer_id": cust["id"], "source": src, "stage": stage,
                "score": band(sv), "score_value": sv, "assigned_to": assignees.get(akey),
                "vehicle_interest": cust.get("preferred_vehicle"), "budget": budget,
                "notes": f"Interested in {cust.get('preferred_vehicle')}.",
                "last_activity_at": iso(30 + idx * 17),
            })
            if st not in (200, 201) or not rows:
                continue
            lid = rows[0]["id"]
            ev = [("note", f"Lead created from {src}.", {}, 600)]
            if stage not in ("new",):
                ev.append(("call", "Spoke with customer about pricing & availability.", {}, 360))
            if stage in ("test_drive", "quotation", "negotiation", "won"):
                ev.append(("test_drive", f"Test drive scheduled for the {cust.get('preferred_vehicle')}.",
                           {"scheduled_at": iso(-1440), "vehicle": cust.get("preferred_vehicle")}, 240))
            if stage in ("quotation", "negotiation", "won"):
                ev.append(("quotation", f"Quotation shared — ₹{budget:,}.", {"amount": budget}, 120))
            if stage not in ("new",):
                ev.append(("stage_change", f"Moved to {stage.replace('_', ' ')}.", {"to_stage": stage}, 60))
            for et, summary, meta, mins in ev:
                req("POST", f"{api}/rest/v1/lead_events", admin_h, {
                    "tenant_id": tenant, "lead_id": lid, "type": et, "summary": summary,
                    "metadata": meta, "created_by": assignees.get(akey), "created_at": iso(mins),
                })
            n += 1
        return n

    abc_n = make(ABC, customers_for(ABC), abc_plan, 0)
    xyz_n = make(XYZ, customers_for(XYZ), xyz_plan, 3)
    print(f"  ✓ seeded leads: ABC {abc_n}, XYZ {xyz_n} (with timelines)")


def iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def seed_activity(api, admin_h, owner_id):
    rest_h = {**admin_h, "Prefer": "resolution=merge-duplicates,return=minimal"}

    notifications = [
        ("10000000-0000-0000-0000-000000000001", "Hot lead needs a call", "Ravi Kumar (Magnite) has been waiting 2 days for follow-up.", "unread", 35),
        ("10000000-0000-0000-0000-000000000002", "Test drive today · 4:30 PM", "Priya S — X-Trail test drive at the Velachery showroom.", "unread", 120),
        ("10000000-0000-0000-0000-000000000003", "Campaign approved", "Weekend SUV campaign is approved and scheduled for Saturday.", "read", 360),
    ]
    for nid, title, message, status, mins in notifications:
        req("POST", f"{api}/rest/v1/notifications", rest_h, {
            "id": nid, "tenant_id": ABC, "user_id": owner_id,
            "title": title, "message": message, "status": status, "created_at": iso(mins),
        })

    audits = [
        ("20000000-0000-0000-0000-000000000001", "lead.created", "lead", {"actor": "Website", "summary": "new enquiry for Magnite from Velachery"}, 18),
        ("20000000-0000-0000-0000-000000000002", "campaign.approved", "campaign", {"actor": "Demo Owner", "summary": "approved the Weekend SUV campaign"}, 95),
        ("20000000-0000-0000-0000-000000000003", "lead.assigned", "lead", {"actor": "Lead Assignment", "summary": "routed 6 leads to sales executives"}, 240),
        ("20000000-0000-0000-0000-000000000004", "customer.updated", "customer", {"actor": "Demo Owner", "summary": "updated Priya S — preferred vehicle X-Trail"}, 520),
    ]
    for aid, action, entity, meta, mins in audits:
        req("POST", f"{api}/rest/v1/audit_logs", rest_h, {
            "id": aid, "tenant_id": ABC, "user_id": owner_id,
            "action": action, "entity_type": entity, "metadata": meta, "created_at": iso(mins),
        })


if __name__ == "__main__":
    main()
