"""Schema + demo data for the assignment agent (KEERTHANA).

Creates the four assignment tables and seeds active sales executives per
tenant in the agent's in-process DuckDB. Tenant ids match the rest of ADIP.
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

    abc_execs = [
        ("exec-abc-ravi", ABC_TENANT_ID, "Ravi", "active", 0, 10),
        ("exec-abc-priya", ABC_TENANT_ID, "Priya", "active", 0, 10),
        ("exec-abc-karthik", ABC_TENANT_ID, "Karthik", "active", 0, 10),
        ("exec-abc-divya", ABC_TENANT_ID, "Divya", "active", 0, 10),
        ("exec-abc-arjun", ABC_TENANT_ID, "Arjun", "active", 0, 10),
    ]
    xyz_execs = [
        ("exec-xyz-vignesh", XYZ_TENANT_ID, "Vignesh", "active", 0, 10),
        ("exec-xyz-meera", XYZ_TENANT_ID, "Meera", "active", 0, 10),
    ]
    for ex in abc_execs + xyz_execs:
        await db.execute("INSERT INTO sales_executives VALUES (?, ?, ?, ?, ?, ?)", ex)


async def init_demo_data(db: Database) -> None:
    await init_assignment_schema(db)
    await seed_executives(db)
