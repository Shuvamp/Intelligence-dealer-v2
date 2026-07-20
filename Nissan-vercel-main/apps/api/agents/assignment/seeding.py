"""Schema + demo data for the assignment agent (KEERTHANA).

Seeds active sales executives per tenant into the real Supabase
sales_executives table (schema already created by migration 0025 — the
CREATE TABLE statements below are no-ops against Supabase). Tenant ids match
the rest of ADIP.
"""

from .database import Database

ABC_TENANT_ID = "11111111-1111-1111-1111-111111111111"
XYZ_TENANT_ID = "22222222-2222-2222-2222-222222222222"


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
    abc_execs = [
        ("a1111111-0000-0000-0000-0000000000a1", ABC_TENANT_ID, "Ravi", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a2", ABC_TENANT_ID, "Priya", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a3", ABC_TENANT_ID, "Karthik", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a4", ABC_TENANT_ID, "Divya", "active", 0, 10),
        ("a1111111-0000-0000-0000-0000000000a5", ABC_TENANT_ID, "Arjun", "active", 0, 10),
    ]
    xyz_execs = [
        ("a2222222-0000-0000-0000-0000000000b1", XYZ_TENANT_ID, "Vignesh", "active", 0, 10),
        ("a2222222-0000-0000-0000-0000000000b2", XYZ_TENANT_ID, "Meera", "active", 0, 10),
    ]
    for ex in abc_execs + xyz_execs:
        await db.execute("INSERT INTO sales_executives VALUES (?, ?, ?, ?, ?, ?)", ex)


async def init_demo_data(db: Database) -> None:
    await init_assignment_schema(db)
    await seed_executives(db)
