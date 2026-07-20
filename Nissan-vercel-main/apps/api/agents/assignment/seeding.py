"""Schema + demo data for the assignment agent (KEERTHANA).

Seeds active sales executives per tenant into the real Supabase
sales_executives table (schema already created by migration 0025 — the
CREATE TABLE statements below are no-ops against Supabase). Tenant ids match
the rest of ADIP.
"""

import os

from .database import Database

# Tenant leads are assigned under — must exist in Supabase (FK) and match the
# intake tenant in main.py. Env-driven so each deploy targets its own tenant.
ABC_TENANT_ID = os.getenv("INTAKE_TENANT_ID", "11111111-1111-1111-1111-111111111111")


async def init_assignment_schema(db: Database) -> None:
    await db.execute("""
        CREATE TABLE IF NOT EXISTS sales_executives (
            id VARCHAR PRIMARY KEY,
            tenant_id VARCHAR,
            name VARCHAR,
            status VARCHAR DEFAULT 'active',
            current_lead_count INTEGER DEFAULT 0,
            max_lead_limit INTEGER DEFAULT 10
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS lead_assignments (
            assignment_id VARCHAR PRIMARY KEY,
            tenant_id VARCHAR,
            lead_id VARCHAR,
            executive_id VARCHAR,
            score VARCHAR,
            priority_rank INTEGER,
            assigned_at VARCHAR
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS lead_completions (
            completion_id VARCHAR PRIMARY KEY,
            tenant_id VARCHAR,
            lead_id VARCHAR,
            executive_id VARCHAR,
            completed_at VARCHAR
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS assignment_notifications (
            notification_id VARCHAR PRIMARY KEY,
            tenant_id VARCHAR,
            lead_id VARCHAR,
            executive_id VARCHAR,
            event_type VARCHAR,
            message VARCHAR,
            is_read BOOLEAN DEFAULT FALSE,
            created_at VARCHAR
        )
    """)


async def seed_executives(db: Database) -> None:
    existing = await db.fetch_one("SELECT COUNT(*) AS count FROM sales_executives")
    if existing and existing.get("count"):
        return

    # Fixed UUIDs — sales_executives.id is a real `uuid` column on Supabase.
    # Names first-name-match the public.users sales_executive rows so
    # _resolve_assignee (main.py) can map the agent's pick to a real user id.
    execs = [
        ("a1111111-0000-0000-0000-0000000000a1", ABC_TENANT_ID, "Ravi", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a2", ABC_TENANT_ID, "Priya", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a3", ABC_TENANT_ID, "Karthik", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a4", ABC_TENANT_ID, "Divya", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a5", ABC_TENANT_ID, "Arjun", "active", 0, 10),
    ]
    for ex in execs:
        await db.execute("INSERT INTO sales_executives VALUES (?, ?, ?, ?, ?, ?)", ex)


async def init_demo_data(db: Database) -> None:
    await init_assignment_schema(db)
    await seed_executives(db)
