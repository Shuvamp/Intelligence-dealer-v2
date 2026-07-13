"""
DuckDB persistence layer for ADIP analytics.
Runs in FastAPI (persistent process) — no Vite HMR, no WAL corruption risk.
One DuckDB connection per thread (thread-local). WAL recovery on corrupt replay.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import duckdb

logger = logging.getLogger(__name__)

# Scheduled posts are authored in dealer-local wall-clock time (India / Tamil
# Nadu). scheduled_at is stored as a naive "YYYY-MM-DDTHH:MM" string in this
# zone, so "is it due?" must compare against the current time in the SAME zone.
# IST has no DST → a fixed UTC+5:30 offset (no tzdata/zoneinfo dependency, which
# Windows lacks by default) is correct and portable.
PUBLISH_TZ = timezone(timedelta(hours=5, minutes=30))


def now_iso() -> str:
    """Current IST wall-clock as 'YYYY-MM-DDTHH:MM' — matches scheduled_at format."""
    return datetime.now(PUBLISH_TZ).strftime("%Y-%m-%dT%H:%M")

# DB lives next to the API process, not inside the web app. On ephemeral hosts
# (Railway/containers) set DUCKDB_DIR to a mounted persistent volume path so the
# marketing store survives redeploys — otherwise it defaults to a local dir that
# is wiped on every deploy.
_DB_DIR = Path(os.getenv("DUCKDB_DIR") or (Path(__file__).resolve().parent.parent.parent / ".duckdb"))
_DB_PATH = _DB_DIR / "analytics.duckdb"

# ONE shared DuckDB connection for the whole process, serialized by a reentrant
# lock. Previously we used a connection per OS thread (threading.local), but
# separate connections to the same file don't reliably see each other's fresh
# commits — so a write on one request thread (e.g. approve-campaign) was invisible
# to a read on another thread (the publishing/planner list), making just-created
# or just-approved items "not show up" until a later reconnect. A single shared
# connection gives every thread the same committed view; the lock keeps DuckDB
# (which is not thread-safe) from concurrent use. Runs under uvicorn --workers 1.
_conn: "duckdb.DuckDBPyConnection | None" = None
_conn_init_lock = threading.Lock()
_db_lock = threading.RLock()


class _LockedConn:
    """Proxy over the shared connection that serializes execute() with _db_lock,
    so direct `get_conn().execute(...)` writes are thread-safe without touching
    every call site. Reads go through _exec, which holds _db_lock across
    execute+fetch (RLock → the nested execute lock here is re-entrant)."""

    def __init__(self, conn: "duckdb.DuckDBPyConnection") -> None:
        self._conn = conn

    def execute(self, sql: str, params: Any = None):
        with _db_lock:
            result = self._conn.execute(sql, params if params is not None else [])
            # Flush writes to the main .duckdb file so they survive container
            # restarts. Without this, recent changes live only in the WAL and can
            # be lost on a Railway redeploy — campaigns/approvals would vanish and
            # the DB would "revert" to an older checkpoint. CHECKPOINT is cheap at
            # this write volume. Reads (SELECT) skip it.
            verb = sql.lstrip()[:7].upper()
            if verb.startswith(("INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "REPLACE")):
                try:
                    self._conn.execute("CHECKPOINT")
                except Exception:
                    pass
            return result

    def __getattr__(self, name: str):
        return getattr(self._conn, name)


# ── Connection lifecycle ───────────────────────────────────────────────────────

def _open_db() -> duckdb.DuckDBPyConnection:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    wal_path = _DB_DIR / (_DB_PATH.name + ".wal")

    for attempt in range(2):
        try:
            conn = duckdb.connect(str(_DB_PATH))
            logger.info("[DuckDB] Connected to %s (attempt %d)", _DB_PATH, attempt + 1)
            _bootstrap(conn)
            return conn
        except Exception as exc:
            if attempt == 0 and any(k in str(exc).lower() for k in ("wal", "replay", "corrupt")):
                logger.error("[DuckDB] WAL replay failed: %s", exc)
                if wal_path.exists():
                    backup = wal_path.with_suffix(".wal.corrupt")
                    wal_path.rename(backup)
                    logger.warning("[DuckDB] Corrupted WAL backed up to %s", backup)
                else:
                    logger.warning("[DuckDB] No WAL found; retrying open")
                continue
            raise


def get_conn() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        with _conn_init_lock:
            if _conn is None:
                _conn = _open_db()
    return _LockedConn(_conn)  # type: ignore[return-value]


def close_all() -> None:
    """Call on FastAPI shutdown to flush the shared connection."""
    global _conn
    with _conn_init_lock:
        if _conn is not None:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = None


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def _bootstrap(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS campaigns (
            campaign_id        VARCHAR NOT NULL,
            tenant_id          VARCHAR NOT NULL,
            name               VARCHAR NOT NULL,
            objective          VARCHAR NOT NULL DEFAULT 'awareness',
            status             VARCHAR NOT NULL DEFAULT 'draft',
            start_date         DATE,
            end_date           DATE,
            post_count         INTEGER NOT NULL DEFAULT 0,
            published_count    INTEGER NOT NULL DEFAULT 0,
            channels           VARCHAR[],
            theme              VARCHAR,
            campaign_color     VARCHAR,
            campaign_hashtags  VARCHAR[],
            posting_time       VARCHAR,
            vehicle            VARCHAR,
            goal               VARCHAR,
            selected_assets    VARCHAR,
            selected_logo      VARCHAR,
            synced_at          TIMESTAMP NOT NULL DEFAULT now(),
            PRIMARY KEY (campaign_id, tenant_id)
        )
    """)
    for col, typ in [
        ("campaign_color", "VARCHAR"),
        ("campaign_hashtags", "VARCHAR[]"),
        ("posting_time", "VARCHAR"),
        ("vehicle", "VARCHAR"),
        ("goal", "VARCHAR"),
        ("selected_assets", "VARCHAR"),
        ("selected_logo", "VARCHAR"),
    ]:
        try:
            conn.execute(f"ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception:
            pass

    conn.execute("""
        CREATE TABLE IF NOT EXISTS campaign_days (
            campaign_id  VARCHAR NOT NULL,
            tenant_id    VARCHAR NOT NULL,
            day_date     DATE NOT NULL,
            day_num      INTEGER NOT NULL,
            theme        VARCHAR NOT NULL,
            vehicle      VARCHAR,
            headline       VARCHAR,
            subheadline    VARCHAR,
            caption        VARCHAR,
            hashtags       VARCHAR[],
            cta            VARCHAR,
            offer          VARCHAR,
            content_status VARCHAR DEFAULT 'pending',
            PRIMARY KEY (campaign_id, tenant_id, day_date)
        )
    """)
    for col, typ in [
        ("vehicle", "VARCHAR"),
        ("headline", "VARCHAR"),
        ("subheadline", "VARCHAR"),
        ("caption", "VARCHAR"),
        ("hashtags", "VARCHAR[]"),
        ("cta", "VARCHAR"),
        ("offer", "VARCHAR"),
        ("content_status", "VARCHAR DEFAULT 'pending'"),
        ("scheduled_at", "VARCHAR"),
        ("publish_status", "VARCHAR DEFAULT 'draft'"),
        ("published_at", "VARCHAR"),
        ("poster_url", "VARCHAR"),
        ("video_url", "VARCHAR"),
        ("channel_status", "VARCHAR"),
    ]:
        try:
            conn.execute(f"ALTER TABLE campaign_days ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception:
            pass

    conn.execute("""
        CREATE TABLE IF NOT EXISTS marketing_assets (
            id           VARCHAR NOT NULL,
            tenant_id    VARCHAR NOT NULL,
            name         VARCHAR NOT NULL,
            asset_type   VARCHAR NOT NULL,
            vehicle      VARCHAR,
            sub_category VARCHAR,
            file_url     VARCHAR NOT NULL,
            file_size    INTEGER,
            metadata     VARCHAR,
            created_at   TIMESTAMP NOT NULL DEFAULT now(),
            PRIMARY KEY (id, tenant_id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS opportunities (
            id          VARCHAR NOT NULL,
            tenant_id   VARCHAR NOT NULL,
            month       INTEGER NOT NULL,
            year        INTEGER NOT NULL,
            date        DATE NOT NULL,
            name        VARCHAR NOT NULL,
            kind        VARCHAR,
            theme       VARCHAR,
            suggestion  VARCHAR,
            headline       VARCHAR,
            subheadline    VARCHAR,
            caption        VARCHAR,
            hashtags       VARCHAR[],
            cta            VARCHAR,
            offer          VARCHAR,
            content_status VARCHAR DEFAULT 'pending',
            synced_at   TIMESTAMP NOT NULL DEFAULT now(),
            PRIMARY KEY (id, tenant_id)
        )
    """)
    for col, typ in [
        ("headline", "VARCHAR"),
        ("subheadline", "VARCHAR"),
        ("caption", "VARCHAR"),
        ("hashtags", "VARCHAR[]"),
        ("cta", "VARCHAR"),
        ("offer", "VARCHAR"),
        ("content_status", "VARCHAR DEFAULT 'pending'"),
        ("scheduled_at", "VARCHAR"),
        ("publish_status", "VARCHAR DEFAULT 'draft'"),
        ("published_at", "VARCHAR"),
        ("poster_url", "VARCHAR"),
        ("video_url", "VARCHAR"),
        ("channel_status", "VARCHAR"),
    ]:
        try:
            conn.execute(f"ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception:
            pass

    logger.info("[DuckDB] Bootstrap complete")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize(v: Any) -> Any:
    """Convert DuckDB native types to JSON-serializable values."""
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def _exec(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    # Hold the lock across execute+fetch so the result set is read atomically on
    # the shared connection (no other thread can execute mid-fetch). _db_lock is
    # reentrant, so the nested lock in _LockedConn.execute is fine.
    with _db_lock:
        conn = get_conn()
        result = conn.execute(sql, params or [])
        cols = [d[0] for d in result.description]
        return [
            {k: _normalize(v) for k, v in zip(cols, row)}
            for row in result.fetchall()
        ]


# ── Campaigns ─────────────────────────────────────────────────────────────────

def upsert_campaign(row: dict[str, Any]) -> None:
    conn = get_conn()
    conn.execute(
        """
        INSERT OR REPLACE INTO campaigns
            (campaign_id, tenant_id, name, objective, status,
             start_date, end_date, post_count, published_count, channels, theme,
             campaign_color, campaign_hashtags, posting_time, vehicle, goal,
             selected_assets, selected_logo, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,now())
        """,
        [
            row.get("campaign_id"),
            row.get("tenant_id"),
            row.get("name"),
            row.get("objective") or "awareness",
            row.get("status") or "draft",
            row.get("start_date"),
            row.get("end_date"),
            int(row.get("post_count") or 0),
            int(row.get("published_count") or 0),
            row.get("channels") or [],
            row.get("theme"),
            row.get("campaign_color"),
            row.get("campaign_hashtags") or [],
            row.get("posting_time"),
            row.get("vehicle"),
            row.get("goal"),
            row.get("selected_assets"),
            row.get("selected_logo"),
        ],
    )
    logger.debug("[DuckDB] upsert_campaign %s", row.get("campaign_id"))


def upsert_campaigns(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        upsert_campaign(row)


def delete_campaign(campaign_id: str, tenant_id: str) -> None:
    conn = get_conn()
    conn.execute(
        "DELETE FROM campaigns WHERE campaign_id = ? AND tenant_id = ?",
        [campaign_id, tenant_id],
    )
    conn.execute(
        "DELETE FROM campaign_days WHERE campaign_id = ? AND tenant_id = ?",
        [campaign_id, tenant_id],
    )


def list_campaigns(tenant_id: str) -> list[dict[str, Any]]:
    return _exec(
        "SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY synced_at DESC",
        [tenant_id],
    )


# ── Campaign Days ─────────────────────────────────────────────────────────────

def upsert_campaign_days(rows: list[dict[str, Any]]) -> None:
    """Upsert structural day fields (theme/vehicle). Preserves any existing
    generated content columns on conflict (content is written by
    update_day_content, not here)."""
    conn = get_conn()
    for row in rows:
        conn.execute(
            """
            INSERT INTO campaign_days
                (campaign_id, tenant_id, day_date, day_num, theme, vehicle)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT (campaign_id, tenant_id, day_date) DO UPDATE SET
                day_num = excluded.day_num,
                theme   = excluded.theme,
                vehicle = excluded.vehicle
            """,
            [
                row.get("campaign_id"),
                row.get("tenant_id"),
                row.get("day_date"),
                int(row.get("day_num") or 0),
                row.get("theme") or "",
                row.get("vehicle"),
            ],
        )


def update_day_content(
    campaign_id: str, tenant_id: str, day_date: str, fields: dict[str, Any]
) -> None:
    """Partial update of a day's generated content columns."""
    allowed = ("headline", "subheadline", "caption", "hashtags", "cta", "offer", "content_status", "poster_url", "video_url")
    sets, params = [], []
    for k in allowed:
        if k in fields:
            sets.append(f"{k} = ?")
            params.append(fields[k])
    if not sets:
        return
    params.extend([campaign_id, tenant_id, day_date])
    get_conn().execute(
        f"UPDATE campaign_days SET {', '.join(sets)} "
        f"WHERE campaign_id = ? AND tenant_id = ? AND day_date = ?",
        params,
    )


def list_all_campaign_days(tenant_id: str) -> list[dict[str, Any]]:
    return _exec(
        """SELECT campaign_id, tenant_id,
                  CAST(day_date AS VARCHAR) AS day_date,
                  day_num, theme, vehicle,
                  headline, subheadline, caption, hashtags, cta, offer, poster_url, video_url,
                  COALESCE(content_status, 'pending') AS content_status
           FROM campaign_days
           WHERE tenant_id = ?
           ORDER BY campaign_id, day_num""",
        [tenant_id],
    )


# ── Opportunities ─────────────────────────────────────────────────────────────

def upsert_opportunities(rows: list[dict[str, Any]]) -> None:
    """Upsert opportunity metadata. Preserves any existing generated content
    columns on conflict (content is written by update_opportunity_content)."""
    conn = get_conn()
    for row in rows:
        conn.execute(
            """
            INSERT INTO opportunities
                (id, tenant_id, month, year, date, name, kind, theme, suggestion, synced_at)
            VALUES (?,?,?,?,?,?,?,?,?,now())
            ON CONFLICT (id, tenant_id) DO UPDATE SET
                month = excluded.month, year = excluded.year, date = excluded.date,
                name = excluded.name, kind = excluded.kind, theme = excluded.theme,
                suggestion = excluded.suggestion, synced_at = now()
            """,
            [
                row.get("id"),
                row.get("tenant_id"),
                int(row.get("month") or 0),
                int(row.get("year") or 0),
                row.get("date"),
                row.get("name") or "",
                row.get("kind"),
                row.get("theme"),
                row.get("suggestion"),
            ],
        )


def update_opportunity_content(opp_id: str, tenant_id: str, fields: dict[str, Any]) -> None:
    """Partial update of an opportunity's generated content columns."""
    allowed = ("headline", "subheadline", "caption", "hashtags", "cta", "offer", "content_status", "poster_url", "video_url")
    sets, params = [], []
    for k in allowed:
        if k in fields:
            sets.append(f"{k} = ?")
            params.append(fields[k])
    if not sets:
        return
    params.extend([opp_id, tenant_id])
    get_conn().execute(
        f"UPDATE opportunities SET {', '.join(sets)} WHERE id = ? AND tenant_id = ?",
        params,
    )


def list_opportunities(tenant_id: str, month: int, year: int) -> list[dict[str, Any]]:
    return _exec(
        """SELECT id, tenant_id, month, year,
                  CAST(date AS VARCHAR) AS date,
                  name, kind, theme, suggestion,
                  headline, subheadline, caption, hashtags, cta, offer, poster_url, video_url,
                  COALESCE(content_status, 'pending') AS content_status
           FROM opportunities
           WHERE tenant_id = ? AND month = ? AND year = ? ORDER BY date""",
        [tenant_id, month, year],
    )


# ── Publishing pipeline ─────────────────────────────────────────────────────

def approve_campaign(campaign_id: str, tenant_id: str, post_time: str) -> None:
    """Approve every day of a campaign and queue it at day_date + post_time."""
    get_conn().execute(
        """UPDATE campaign_days
           SET content_status='approved', publish_status='queued',
               scheduled_at = CAST(day_date AS VARCHAR) || 'T' || ?
           WHERE campaign_id = ? AND tenant_id = ?""",
        [post_time, campaign_id, tenant_id],
    )
    logger.info(
        "[auto-publish] queued campaign=%s tenant=%s at %s (job created)",
        campaign_id, tenant_id, post_time,
    )


def approve_opportunity(opp_id: str, tenant_id: str, post_time: str) -> None:
    get_conn().execute(
        """UPDATE opportunities
           SET content_status='approved', publish_status='queued',
               scheduled_at = CAST(date AS VARCHAR) || 'T' || ?
           WHERE id = ? AND tenant_id = ?""",
        [post_time, opp_id, tenant_id],
    )
    logger.info(
        "[auto-publish] queued event=%s tenant=%s at %s (job created)",
        opp_id, tenant_id, post_time,
    )


def reject_campaign(campaign_id: str, tenant_id: str) -> None:
    get_conn().execute(
        "UPDATE campaign_days SET publish_status='rejected' WHERE campaign_id = ? AND tenant_id = ?",
        [campaign_id, tenant_id],
    )


def reject_opportunity(opp_id: str, tenant_id: str) -> None:
    get_conn().execute(
        "UPDATE opportunities SET publish_status='rejected' WHERE id = ? AND tenant_id = ?",
        [opp_id, tenant_id],
    )


def publish_campaign(campaign_id: str, tenant_id: str, now_iso: str) -> None:
    """Publish only items whose scheduled time has arrived (or has no schedule)."""
    get_conn().execute(
        """UPDATE campaign_days SET publish_status='published', published_at = ?
           WHERE campaign_id = ? AND tenant_id = ? AND publish_status = 'queued'
                 AND (scheduled_at IS NULL OR scheduled_at <= ?)""",
        [now_iso, campaign_id, tenant_id, now_iso],
    )


def publish_opportunity(opp_id: str, tenant_id: str, now_iso: str) -> None:
    """Publish only if scheduled time has arrived (or has no schedule)."""
    get_conn().execute(
        """UPDATE opportunities SET publish_status='published', published_at = ?
           WHERE id = ? AND tenant_id = ? AND publish_status = 'queued'
                 AND (scheduled_at IS NULL OR scheduled_at <= ?)""",
        [now_iso, opp_id, tenant_id, now_iso],
    )


def process_due(tenant_id: str, now_iso: str) -> None:
    """Auto-flip queued items whose scheduled time has passed to published."""
    conn = get_conn()
    conn.execute(
        """UPDATE campaign_days SET publish_status='published', published_at = scheduled_at
           WHERE tenant_id = ? AND publish_status = 'queued'
                 AND scheduled_at IS NOT NULL AND scheduled_at <= ?""",
        [tenant_id, now_iso],
    )
    conn.execute(
        """UPDATE opportunities SET publish_status='published', published_at = scheduled_at
           WHERE tenant_id = ? AND publish_status = 'queued'
                 AND scheduled_at IS NOT NULL AND scheduled_at <= ?""",
        [tenant_id, now_iso],
    )


def list_due_posts(now_iso_str: str) -> list[dict[str, Any]]:
    """Every queued campaign-day + event whose scheduled time has passed, across
    ALL tenants — the work-list the background auto-publisher drains each tick.

    Campaign days carry their campaign's linked `channels`; events target every
    connected channel (channels = None)."""
    days = _exec(
        """SELECT d.tenant_id, d.campaign_id AS group_id,
                  CAST(d.day_date AS VARCHAR) AS day_date, d.day_num,
                  d.headline, d.subheadline, d.caption, d.hashtags, d.cta, d.theme,
                  d.poster_url, d.video_url, d.scheduled_at, c.name AS title, c.channels AS channels
           FROM campaign_days d
           LEFT JOIN campaigns c ON c.campaign_id = d.campaign_id AND c.tenant_id = d.tenant_id
           WHERE d.publish_status = 'queued'
                 AND d.scheduled_at IS NOT NULL AND d.scheduled_at <= ?
           ORDER BY d.scheduled_at, d.day_num""",
        [now_iso_str],
    )
    for d in days:
        d["kind"] = "campaign"
    opps = _exec(
        """SELECT tenant_id, id AS group_id, CAST(date AS VARCHAR) AS day_date,
                  headline, subheadline, caption, hashtags, cta, theme,
                  poster_url, video_url, scheduled_at, name AS title
           FROM opportunities
           WHERE publish_status = 'queued'
                 AND scheduled_at IS NOT NULL AND scheduled_at <= ?
           ORDER BY scheduled_at""",
        [now_iso_str],
    )
    for o in opps:
        o["kind"] = "event"
        o["channels"] = None
    return days + opps


def set_publish_status(
    kind: str,
    group_id: str,
    tenant_id: str,
    status: str,
    day_date: str | None = None,
    published_at: str | None = None,
    channel_status: str | None = None,
) -> None:
    """Transition a single post's publish_status (queued → publishing → published/failed).
    `published_at` is only written when non-NULL (kept across transient states).
    `channel_status` (JSON-encoded per-platform outcome) is likewise only written
    when non-NULL, so the Publishing queue can show why a scheduled post
    succeeded/failed/skipped per channel."""
    conn = get_conn()
    if kind == "campaign":
        if day_date is not None:
            conn.execute(
                """UPDATE campaign_days
                   SET publish_status = ?, published_at = COALESCE(?, published_at),
                       channel_status = COALESCE(?, channel_status)
                   WHERE campaign_id = ? AND tenant_id = ? AND day_date = ?""",
                [status, published_at, channel_status, group_id, tenant_id, day_date],
            )
        else:
            conn.execute(
                """UPDATE campaign_days
                   SET publish_status = ?, published_at = COALESCE(?, published_at),
                       channel_status = COALESCE(?, channel_status)
                   WHERE campaign_id = ? AND tenant_id = ?""",
                [status, published_at, channel_status, group_id, tenant_id],
            )
    else:
        conn.execute(
            """UPDATE opportunities
               SET publish_status = ?, published_at = COALESCE(?, published_at),
                   channel_status = COALESCE(?, channel_status)
               WHERE id = ? AND tenant_id = ?""",
            [status, published_at, channel_status, group_id, tenant_id],
        )


def list_publishing(tenant_id: str) -> list[dict[str, Any]]:
    """Unified queue/published/rejected list — campaign days + events."""
    days = _exec(
        """SELECT d.campaign_id AS group_id, c.name AS title, d.day_num,
                  CAST(d.day_date AS VARCHAR) AS date, d.theme, d.vehicle,
                  d.headline, d.subheadline, d.caption, d.hashtags, d.cta, d.poster_url, d.video_url,
                  d.scheduled_at, COALESCE(d.publish_status,'draft') AS publish_status, d.published_at, d.channel_status
           FROM campaign_days d
           LEFT JOIN campaigns c ON c.campaign_id = d.campaign_id AND c.tenant_id = d.tenant_id
           WHERE d.tenant_id = ? AND COALESCE(d.publish_status,'draft') <> 'draft'
           ORDER BY d.scheduled_at, d.day_num""",
        [tenant_id],
    )
    for d in days:
        d["kind"] = "campaign"
    opps = _exec(
        """SELECT id AS group_id, name AS title, CAST(date AS VARCHAR) AS date,
                  theme, headline, subheadline, caption, hashtags, cta, poster_url, video_url,
                  scheduled_at, COALESCE(publish_status,'draft') AS publish_status, published_at, channel_status, kind AS event_kind
           FROM opportunities
           WHERE tenant_id = ? AND COALESCE(publish_status,'draft') <> 'draft'
           ORDER BY scheduled_at""",
        [tenant_id],
    )
    for o in opps:
        o["kind"] = "event"
    return days + opps


# ── Analytics ─────────────────────────────────────────────────────────────────

def query_objective_breakdown(tenant_id: str) -> list[dict[str, Any]]:
    return _exec(
        """SELECT objective, COUNT(*) AS total, SUM(post_count) AS posts
           FROM campaigns WHERE tenant_id = ?
           GROUP BY objective ORDER BY total DESC""",
        [tenant_id],
    )


# ── Marketing Assets ──────────────────────────────────────────────────────────

def upsert_asset(row: dict[str, Any]) -> None:
    conn = get_conn()
    conn.execute(
        """
        INSERT OR REPLACE INTO marketing_assets
            (id, tenant_id, name, asset_type, vehicle, sub_category,
             file_url, file_size, metadata, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        """,
        [
            row.get("id"),
            row.get("tenant_id"),
            row.get("name"),
            row.get("asset_type"),
            row.get("vehicle"),
            row.get("sub_category"),
            row.get("file_url"),
            row.get("file_size"),
            row.get("metadata"),
            row.get("created_at"),
        ],
    )


def list_assets(
    tenant_id: str,
    asset_type: str | None = None,
    vehicle: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    conditions = ["tenant_id = ?"]
    params: list[Any] = [tenant_id]
    if asset_type:
        conditions.append("asset_type = ?")
        params.append(asset_type)
    if vehicle:
        conditions.append("vehicle = ?")
        params.append(vehicle)
    if search:
        conditions.append("lower(name) LIKE ?")
        params.append(f"%{search.lower()}%")
    return _exec(
        f"SELECT * FROM marketing_assets WHERE {' AND '.join(conditions)} ORDER BY created_at DESC",
        params,
    )


def delete_asset(asset_id: str, tenant_id: str) -> None:
    conn = get_conn()
    conn.execute(
        "DELETE FROM marketing_assets WHERE id = ? AND tenant_id = ?",
        [asset_id, tenant_id],
    )
