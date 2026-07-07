"""Bridge loader: silver/gold (pipeline) -> public.* (ADIP spine).

Governing principle: the PLATFORM owns the dimensions; we own the facts.
- READS public.tenants / public.locations / public.users for every dimension reference.
- Skips any silver tenant_id not present in public.tenants (warn, never insert).
- Round-robins customers/leads across the tenant's REAL locations & users.
- Writes pipeline-generated facts into public.customers / leads / lead_events /
  market_signals, tagged so reruns are idempotent without touching UI/agent data.

Connection: via platform_sim.db.connect(), which reads PGHOST/PGPORT/PGUSER/
PGPASSWORD/PGDATABASE from env. Default .env points at the local Supabase
Postgres (port 54322, db postgres). Connecting as `postgres` (DB superuser)
bypasses RLS — the audited system-ingestion path called out in the spec §7.

Run:
    cd data-pipeline
    set -a && . ./.env && set +a
    python -m bridge.load
"""
from __future__ import annotations

import sys
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from platform_sim.db import connect
from bridge.mapping import (
    derive_stage,
    map_event_type,
    map_score,
    map_source,
    severity_for_gap,
)


# ---------------------------------------------------------------------------
# Pass 0 — read the platform's dimension tables (source of truth).
# ---------------------------------------------------------------------------

def load_dimensions(cur) -> Tuple[set, Dict[str, List[str]], Dict[str, List[str]]]:
    """Return (tenant_ids, locations_by_tenant, assignees_by_tenant).

    locations:  active locations per tenant, ordered (created_at, id).
    assignees:  user ids per tenant, preferring sales_executive, falling back
                to dealer_owner, falling back to anyone active.
    Both lists are ordered for deterministic round-robin.
    """
    cur.execute("SELECT id::text FROM public.tenants WHERE status = 'active' ORDER BY id")
    tenants = {row[0] for row in cur.fetchall()}

    cur.execute("""
        SELECT tenant_id::text, id::text
          FROM public.locations
         WHERE status = 'active'
         ORDER BY tenant_id, created_at, id
    """)
    locations: Dict[str, List[str]] = defaultdict(list)
    for tid, lid in cur.fetchall():
        locations[tid].append(lid)

    cur.execute("""
        SELECT tenant_id::text, id::text, role::text
          FROM public.users
         WHERE status = 'active'
         ORDER BY tenant_id, created_at, id
    """)
    by_tenant_role: Dict[Tuple[str, str], List[str]] = defaultdict(list)
    by_tenant_any:  Dict[str, List[str]]            = defaultdict(list)
    for tid, uid, role in cur.fetchall():
        by_tenant_role[(tid, role)].append(uid)
        by_tenant_any[tid].append(uid)

    assignees: Dict[str, List[str]] = {}
    for tid in tenants:
        chosen = (
            by_tenant_role.get((tid, "sales_executive"))
            or by_tenant_role.get((tid, "dealer_owner"))
            or by_tenant_any.get(tid, [])
        )
        assignees[tid] = chosen

    return tenants, locations, assignees


# ---------------------------------------------------------------------------
# Pass 1 — customers.
# ---------------------------------------------------------------------------

def _decode_bytea(b) -> Optional[str]:
    """silver.pii_vault stores phone/email as bytea (b''.encode()). Decode back."""
    if b is None:
        return None
    s = bytes(b).decode("utf-8", errors="ignore").strip()
    return s or None


def load_customers(cur, tenant_id: str, locations: List[str]) -> Dict[int, str]:
    """Resolve every silver customer for this tenant to a spine UUID.

    Returns customer_id_bi -> spine_id (uuid string) for use by later passes.
    """
    cur.execute("""
        SELECT c.customer_id, c.source_first,
               v.full_name, v.phone_enc, v.email_enc,
               (
                 SELECT model_interest FROM silver.fact_touchpoint t
                  WHERE t.customer_id = c.customer_id
                    AND t.model_interest IS NOT NULL
                  ORDER BY t.occurred_at DESC LIMIT 1
               ) AS preferred_vehicle
          FROM silver.dim_customer c
          LEFT JOIN silver.pii_vault v ON v.customer_id = c.customer_id
         WHERE c.tenant_id = %s
         ORDER BY c.customer_id
    """, (tenant_id,))
    silver_customers = cur.fetchall()

    result: Dict[int, str] = {}
    for i, (cid_bi, source_first, full_name, phone_b, email_b, preferred_vehicle) in enumerate(silver_customers):
        phone = _decode_bytea(phone_b)
        email = _decode_bytea(email_b)
        full_name = full_name or "(unknown)"
        location_id = locations[i % len(locations)] if locations else None
        source_channel = source_first  # free-text on public.customers; pipeline tag

        # 1. Reuse mapping if we've seen this silver customer before.
        cur.execute("""
            SELECT spine_id::text FROM silver.spine_customer_map
             WHERE tenant_id = %s AND customer_id_bi = %s
        """, (tenant_id, cid_bi))
        row = cur.fetchone()
        spine_id = row[0] if row else None

        # 2. Else look up public.customers by (tenant_id, phone OR email).
        if spine_id is None and (phone or email):
            cur.execute("""
                SELECT id::text FROM public.customers
                 WHERE tenant_id = %s
                   AND ( (%s IS NOT NULL AND phone = %s)
                      OR (%s IS NOT NULL AND email = %s) )
                 ORDER BY created_at
                 LIMIT 1
            """, (tenant_id, phone, phone, email, email))
            row = cur.fetchone()
            spine_id = row[0] if row else None

        # 3. Else insert.
        if spine_id is None:
            cur.execute("""
                INSERT INTO public.customers
                  (tenant_id, location_id, full_name, phone, email,
                   preferred_vehicle, source_channel)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id::text
            """, (tenant_id, location_id, full_name, phone, email,
                  preferred_vehicle, source_channel))
            spine_id = cur.fetchone()[0]

        # 4. Upsert the sidecar map.
        cur.execute("""
            INSERT INTO silver.spine_customer_map (tenant_id, customer_id_bi, spine_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (tenant_id, customer_id_bi) DO UPDATE SET spine_id = EXCLUDED.spine_id
        """, (tenant_id, cid_bi, spine_id))

        # 5. UPDATE only pipeline-owned fields. Do NOT touch consent or any UI-owned column.
        cur.execute("""
            UPDATE public.customers
               SET full_name         = %s,
                   phone             = %s,
                   email             = %s,
                   preferred_vehicle = %s,
                   source_channel    = %s,
                   location_id       = COALESCE(%s, location_id),
                   updated_at        = now()
             WHERE id = %s
        """, (full_name, phone, email, preferred_vehicle, source_channel,
              location_id, spine_id))

        result[cid_bi] = spine_id

    return result


# ---------------------------------------------------------------------------
# Pass 2 — leads (one per silver customer with at least one touchpoint).
# ---------------------------------------------------------------------------

def load_leads(cur, tenant_id: str, spine_ids: Dict[int, str],
               assignees: List[str]) -> Dict[int, str]:
    """Return customer_id_bi -> lead_id for use when writing lead_events."""
    # First touchpoint source (= channel of origin) + latest model_interest.
    cur.execute("""
        SELECT
          t.customer_id,
          (array_agg(t.source         ORDER BY t.occurred_at ASC ))[1] AS first_source,
          (array_agg(t.model_interest ORDER BY t.occurred_at DESC))[1] AS last_model,
          l.status   AS lead_status,
          l.lead_score AS lead_score,
          EXISTS (SELECT 1 FROM silver.fact_quotation  q WHERE q.customer_id = t.customer_id) AS has_quotation,
          EXISTS (SELECT 1 FROM silver.fact_test_drive d WHERE d.customer_id = t.customer_id) AS has_test_drive,
          c.location_id::text AS spine_location_id
          FROM silver.fact_touchpoint t
          JOIN silver.dim_customer s ON s.customer_id = t.customer_id
          LEFT JOIN silver.fact_lead l ON l.customer_id = t.customer_id
          LEFT JOIN silver.spine_customer_map m ON m.tenant_id = s.tenant_id AND m.customer_id_bi = t.customer_id
          LEFT JOIN public.customers c ON c.id = m.spine_id
         WHERE s.tenant_id = %s
         GROUP BY t.customer_id, l.status, l.lead_score, c.location_id
         ORDER BY t.customer_id
    """, (tenant_id,))
    rows = cur.fetchall()

    leads: Dict[int, str] = {}
    for i, (cid_bi, first_source, last_model, lead_status, lead_score_num,
            has_quotation, has_test_drive, spine_location_id) in enumerate(rows):
        spine_customer_id = spine_ids.get(cid_bi)
        if spine_customer_id is None:
            continue  # customer wasn't mapped (defensive — shouldn't happen)

        source_enum = map_source(first_source)
        stage       = derive_stage(has_quotation, has_test_drive)
        score_enum  = map_score(lead_status) if lead_status else "cold"
        score_value = int(lead_score_num or 0)
        assigned_to = assignees[i % len(assignees)] if assignees else None

        # Upsert by (tenant_id, customer_id, source).
        cur.execute("""
            SELECT id::text FROM public.leads
             WHERE tenant_id = %s AND customer_id = %s AND source = %s::lead_source
             LIMIT 1
        """, (tenant_id, spine_customer_id, source_enum))
        row = cur.fetchone()

        if row:
            lead_id = row[0]
            cur.execute("""
                UPDATE public.leads
                   SET stage            = %s::lead_stage,
                       score            = %s::lead_score,
                       score_value      = %s,
                       vehicle_interest = %s,
                       location_id      = COALESCE(%s, location_id),
                       assigned_to      = COALESCE(%s, assigned_to),
                       last_activity_at = now(),
                       updated_at       = now()
                 WHERE id = %s
            """, (stage, score_enum, score_value, last_model,
                  spine_location_id, assigned_to, lead_id))
        else:
            cur.execute("""
                INSERT INTO public.leads
                  (tenant_id, location_id, customer_id, source, stage, score,
                   score_value, assigned_to, vehicle_interest)
                VALUES (%s, %s, %s, %s::lead_source, %s::lead_stage, %s::lead_score,
                        %s, %s, %s)
                RETURNING id::text
            """, (tenant_id, spine_location_id, spine_customer_id, source_enum,
                  stage, score_enum, score_value, assigned_to, last_model))
            lead_id = cur.fetchone()[0]

        leads[cid_bi] = lead_id

    return leads


# ---------------------------------------------------------------------------
# Pass 3 — lead_events (delete tagged + reinsert).
# ---------------------------------------------------------------------------

def load_lead_events(cur, tenant_id: str, lead_by_cid: Dict[int, str]) -> int:
    # Clear bridge-tagged events for this tenant; never touch UI/agent rows.
    cur.execute("""
        DELETE FROM public.lead_events
         WHERE tenant_id = %s
           AND metadata ->> 'src' = 'pipeline'
    """, (tenant_id,))

    inserts: List[tuple] = []

    # Touchpoints -> note OR call.
    cur.execute("""
        SELECT customer_id, source, event_type, model_interest, occurred_at
          FROM silver.fact_touchpoint
         WHERE tenant_id = %s
         ORDER BY customer_id, occurred_at
    """, (tenant_id,))
    for cid_bi, source, event_type, model, occurred_at in cur.fetchall():
        lead_id = lead_by_cid.get(cid_bi)
        if not lead_id:
            continue
        kind = "call" if source == "call" else "touchpoint"
        et = map_event_type(kind)
        summary = (f"Inbound call about {model}." if kind == "call"
                   else f"Touchpoint via {source}" + (f" — {model}." if model else "."))
        meta = {
            "src": "pipeline",
            "kind": kind,
            "silver_source": source,
            "silver_event_type": event_type,
            "model_interest": model,
        }
        inserts.append((tenant_id, lead_id, et, summary, meta, occurred_at))

    # Test drives -> test_drive event.
    cur.execute("""
        SELECT customer_id, model, scheduled_at, completed, outcome
          FROM silver.fact_test_drive
         WHERE tenant_id = %s
    """, (tenant_id,))
    for cid_bi, model, scheduled_at, completed, outcome in cur.fetchall():
        lead_id = lead_by_cid.get(cid_bi)
        if not lead_id:
            continue
        et = map_event_type("test_drive")
        summary = f"Test drive scheduled for the {model}."
        meta = {"src": "pipeline", "kind": "test_drive", "vehicle": model,
                "completed": bool(completed), "outcome": outcome}
        inserts.append((tenant_id, lead_id, et, summary, meta, scheduled_at))

    # Quotations -> quotation event.
    cur.execute("""
        SELECT customer_id, model, offer_code, quoted_price, quoted_at, accepted
          FROM silver.fact_quotation
         WHERE tenant_id = %s
    """, (tenant_id,))
    for cid_bi, model, offer_code, quoted_price, quoted_at, accepted in cur.fetchall():
        lead_id = lead_by_cid.get(cid_bi)
        if not lead_id:
            continue
        et = map_event_type("quotation")
        price_label = f"₹{int(quoted_price):,}" if quoted_price is not None else "(quoted)"
        summary = f"Quotation shared — {price_label} ({offer_code})."
        meta = {"src": "pipeline", "kind": "quotation", "vehicle": model,
                "offer": offer_code, "amount": float(quoted_price) if quoted_price else None,
                "accepted": bool(accepted)}
        inserts.append((tenant_id, lead_id, et, summary, meta, quoted_at))

    if not inserts:
        return 0

    import json
    args = [(t, lid, et, s, json.dumps(m), ts) for (t, lid, et, s, m, ts) in inserts]
    cur.executemany("""
        INSERT INTO public.lead_events
          (tenant_id, lead_id, type, summary, metadata, created_at)
        VALUES (%s, %s, %s::lead_event_type, %s, %s::jsonb, %s)
    """, args)
    return len(inserts)


# ---------------------------------------------------------------------------
# Pass 4 — market_signals (delete tagged + reinsert).
# ---------------------------------------------------------------------------

def load_market_signals(cur, tenant_id: str, locations: List[str]) -> int:
    """Two emission paths, both source_module='pipeline':
       1) gold.mart_opportunity demand_gap>0 -> 'opportunity' signals.
       2) Top region/model by touchpoints from mart_region_demand -> one 'demand' signal.
    """
    cur.execute("""
        DELETE FROM public.market_signals
         WHERE tenant_id = %s AND source_module = 'pipeline'
    """, (tenant_id,))

    inserts: List[tuple] = []

    # --- (1) Opportunity signals from mart_opportunity ---
    cur.execute("""
        SELECT region, model, demand_signal, stock_on_hand, demand_gap
          FROM gold.mart_opportunity
         WHERE tenant_id = %s AND demand_gap > 0
         ORDER BY demand_gap DESC
         LIMIT 10
    """, (tenant_id,))
    for region, model, demand_signal, stock_on_hand, demand_gap in cur.fetchall():
        title = f"Stock-out risk: {model} in {region}"
        detail = (f"{demand_signal} touchpoints vs only {stock_on_hand} units on hand — "
                  f"demand gap of {demand_gap}. Restock or shift allocation.")
        sev = severity_for_gap(int(demand_gap))
        inserts.append((tenant_id, "opportunity", title, detail,
                        "Demand gap", str(int(demand_gap)), sev, "pipeline"))

    # --- (2) Top region/model demand signal (always emit one if any touchpoints exist) ---
    cur.execute("""
        SELECT region, model_interest, touchpoints
          FROM gold.mart_region_demand
         WHERE tenant_id = %s
         ORDER BY touchpoints DESC
         LIMIT 1
    """, (tenant_id,))
    row = cur.fetchone()
    if row:
        region, model, touchpoints = row
        title = f"{model} demand strong in {region}"
        detail = (f"{model} accounts for the highest touchpoint volume in {region} "
                  f"this period. Prioritise inventory and outreach to capture it.")
        inserts.append((tenant_id, "demand", title, detail,
                        "Touchpoints", str(int(touchpoints)), "medium", "pipeline"))

    if not inserts:
        return 0

    cur.executemany("""
        INSERT INTO public.market_signals
          (tenant_id, kind, title, detail, metric_label, metric_value, severity, source_module)
        VALUES (%s, %s::signal_kind, %s, %s, %s, %s, %s::signal_severity, %s)
    """, inserts)
    return len(inserts)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main() -> int:
    conn = connect()
    conn.autocommit = False
    summary: List[Tuple[str, int, int, int, int]] = []
    try:
        with conn.cursor() as cur:
            tenants, locations, assignees = load_dimensions(cur)
            if not tenants:
                print("[bridge] no active tenants in public.tenants — nothing to load.", file=sys.stderr)
                return 1

            # Which tenants does silver actually have data for?
            cur.execute("SELECT DISTINCT tenant_id::text FROM silver.dim_customer ORDER BY 1")
            silver_tenants = [r[0] for r in cur.fetchall()]

            for tid in silver_tenants:
                if tid not in tenants:
                    print(f"[bridge] WARN tenant {tid} not in public.tenants — skipped.")
                    continue

                t_locations = locations.get(tid, [])
                t_assignees = assignees.get(tid, [])
                if not t_locations:
                    print(f"[bridge] WARN tenant {tid[:8]} has no active locations — leads/customers will have location_id=NULL.")
                if not t_assignees:
                    print(f"[bridge] WARN tenant {tid[:8]} has no active users — leads will have assigned_to=NULL.")

                spine_ids = load_customers(cur, tid, t_locations)
                lead_by_cid = load_leads(cur, tid, spine_ids, t_assignees)
                n_events = load_lead_events(cur, tid, lead_by_cid)
                n_signals = load_market_signals(cur, tid, t_locations)
                summary.append((tid, len(spine_ids), len(lead_by_cid), n_events, n_signals))
                conn.commit()

        print("\n[bridge] load complete:")
        print(f"  {'tenant':<10} {'customers':>10} {'leads':>8} {'events':>8} {'signals':>8}")
        for tid, nc, nl, ne, ns in summary:
            print(f"  {tid[:8]:<10} {nc:>10} {nl:>8} {ne:>8} {ns:>8}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
