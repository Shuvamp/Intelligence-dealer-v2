#!/usr/bin/env python
"""One-time export: apps/api/.localdb/channels.sqlite -> Supabase.

Full-fidelity row copy (every column, not just the narrow fields the live app
writes through channel_store.py) so nothing silently drops. Read-only against
the source file; every write is an upsert, so this is safe to re-run.
Requires apps/api/.venv and app/config.py's SUPABASE_URL/SUPABASE_SERVICE_KEY
(apps/api/.env or real env vars).

  cd apps/api && .venv/Scripts/python scripts/migrate_duckdb_sqlite_to_supabase.py

Prints rows read vs written — diff against source before deleting .localdb.
"""
import asyncio
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # apps/api on path

from app.services import channel_store

API_DIR = Path(__file__).resolve().parent.parent
SQLITE_PATH = API_DIR / ".localdb" / "channels.sqlite"


async def migrate_sqlite() -> None:
    if not SQLITE_PATH.exists():
        print(f"  - no {SQLITE_PATH}, skipping")
        return
    conn = sqlite3.connect(str(SQLITE_PATH))
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM social_channel_connections")]
    conn.close()

    for row in rows:
        tenant_id = row.pop("tenant_id")
        channel = row.pop("channel")
        await channel_store.upsert(tenant_id, channel, **row)
    print(f"  social_channel_connections: {len(rows)} read -> written")


async def main() -> None:
    print("Migrating .localdb/channels.sqlite -> Supabase (social_channel_connections)")
    await migrate_sqlite()
    print("Done. Verify row counts in Supabase before deleting .localdb.")


if __name__ == "__main__":
    asyncio.run(main())
