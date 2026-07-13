"""
Local SQLite store for social channel connections.

Why local SQLite instead of Supabase?
  Local dev has no Docker / no cloud service key, so the Supabase write path
  (create_client with service key) crashes. This store keeps the same data
  shape as the `social_channel_connections` table but persists to a local
  SQLite file — zero external dependencies (sqlite3 is in the stdlib).

  Mirrors the DuckDB campaign store pattern (apps/web/src/lib/analytics.duckdb.ts).

Table shape matches supabase/migrations/0015 + 0016 + 0036 + 0037:
  tenant_id, channel, handle, instagram_id, linkedin_id, page_id, page_name,
  access_token, token_type, status, last_sync, created_at, updated_at,
  linkedin_org_urn, linkedin_org_name, youtube_channel_id, youtube_channel_name,
  refresh_token, token_expires_at
Unique key: (tenant_id, channel)

Published LinkedIn post URNs and their metrics are NOT stored here — see
app/services/linkedin_analytics_store.py, which persists to Supabase/the DuckDB
shim (needed so the background analytics poller can scan across tenants).
"""
import os
import sqlite3
from datetime import datetime, timezone

_DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".localdb")
_DB_PATH = os.path.join(_DB_DIR, "channels.sqlite")

_COLUMNS = [
    "tenant_id", "channel", "handle", "instagram_id", "linkedin_id",
    "page_id", "page_name", "email", "picture", "profile_url", "access_token",
    "token_type", "status", "last_sync", "created_at", "updated_at",
    "linkedin_org_urn", "linkedin_org_name",
    "youtube_channel_id", "youtube_channel_name", "refresh_token", "token_expires_at",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _conn() -> sqlite3.Connection:
    os.makedirs(_DB_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS social_channel_connections (
            tenant_id    TEXT NOT NULL,
            channel      TEXT NOT NULL,
            handle       TEXT,
            instagram_id TEXT,
            linkedin_id  TEXT,
            page_id      TEXT,
            page_name    TEXT,
            email        TEXT,
            picture      TEXT,
            access_token TEXT NOT NULL DEFAULT '',
            token_type   TEXT NOT NULL DEFAULT 'long_lived',
            status       TEXT NOT NULL DEFAULT 'connected',
            last_sync    TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            PRIMARY KEY (tenant_id, channel)
        )
        """
    )
    # Idempotent column adds for pre-existing DB files (swallow "duplicate column")
    for col in (
        "email", "picture", "profile_url", "linkedin_org_urn", "linkedin_org_name",
        "youtube_channel_id", "youtube_channel_name", "refresh_token", "token_expires_at",
    ):
        try:
            conn.execute(f"ALTER TABLE social_channel_connections ADD COLUMN {col} TEXT")
        except sqlite3.OperationalError:
            pass
    conn.commit()


def upsert(tenant_id: str, channel: str, **fields) -> None:
    """Insert or replace a connection row, preserving created_at on update."""
    now = _now()
    with _conn() as conn:
        _init(conn)
        existing = conn.execute(
            "SELECT created_at FROM social_channel_connections WHERE tenant_id=? AND channel=?",
            (tenant_id, channel),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        row = {c: None for c in _COLUMNS}
        row.update({
            "tenant_id": tenant_id,
            "channel": channel,
            "access_token": "",
            "token_type": "long_lived",
            "status": "connected",
            "last_sync": now,
            "created_at": created_at,
            "updated_at": now,
        })
        row.update({k: v for k, v in fields.items() if k in _COLUMNS})

        placeholders = ",".join("?" for _ in _COLUMNS)
        conn.execute(
            f"INSERT OR REPLACE INTO social_channel_connections ({','.join(_COLUMNS)}) "
            f"VALUES ({placeholders})",
            tuple(row[c] for c in _COLUMNS),
        )
        conn.commit()


def get(tenant_id: str, channel: str) -> dict | None:
    with _conn() as conn:
        _init(conn)
        r = conn.execute(
            "SELECT * FROM social_channel_connections WHERE tenant_id=? AND channel=?",
            (tenant_id, channel),
        ).fetchone()
        return dict(r) if r else None


def list_for_tenant(tenant_id: str) -> list[dict]:
    with _conn() as conn:
        _init(conn)
        rows = conn.execute(
            "SELECT * FROM social_channel_connections WHERE tenant_id=?",
            (tenant_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def list_connected(channel: str) -> list[dict]:
    """All tenants with a currently-connected row for one channel — used by
    background jobs (e.g. the LinkedIn analytics poller) that scan across
    tenants rather than operating within a single request's tenant scope."""
    with _conn() as conn:
        _init(conn)
        rows = conn.execute(
            "SELECT * FROM social_channel_connections WHERE channel=? AND status='connected' AND access_token != ''",
            (channel,),
        ).fetchall()
        return [dict(r) for r in rows]


def update(tenant_id: str, channel: str, **fields) -> bool:
    """Update specific fields. Returns False if the row does not exist."""
    allowed = {k: v for k, v in fields.items() if k in _COLUMNS}
    allowed["updated_at"] = _now()
    with _conn() as conn:
        _init(conn)
        exists = conn.execute(
            "SELECT 1 FROM social_channel_connections WHERE tenant_id=? AND channel=?",
            (tenant_id, channel),
        ).fetchone()
        if not exists:
            return False
        set_clause = ",".join(f"{k}=?" for k in allowed)
        conn.execute(
            f"UPDATE social_channel_connections SET {set_clause} WHERE tenant_id=? AND channel=?",
            (*allowed.values(), tenant_id, channel),
        )
        conn.commit()
        return True
