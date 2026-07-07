"""DuckDB connection + query wrapper for the assignment agent (KEERTHANA).

Self-contained (no external config import). Defaults to an in-process
in-memory DuckDB, which is all the assignment agent needs to track executive
load, assignments, completions, and notifications during a pipeline run.
"""

import os
from typing import Optional, List, Dict, Any

import duckdb


class Database:
    """DuckDB connection and query wrapper."""

    def __init__(self, database_url: str | None = None):
        self.db_url = database_url or os.getenv("ASSIGNMENT_DB_URL", ":memory:")
        self.conn: Optional[duckdb.DuckDBPyConnection] = None

    def connect(self) -> duckdb.DuckDBPyConnection:
        if self.conn is None:
            self.conn = duckdb.connect(self.db_url)
        return self.conn

    async def execute(self, sql: str, params: tuple = ()) -> None:
        conn = self.connect()
        if params:
            conn.execute(sql, params)
        else:
            conn.execute(sql)

    async def fetch_one(self, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        conn = self.connect()
        result = conn.execute(sql, params).fetchall() if params else conn.execute(sql).fetchall()
        if not result:
            return None
        columns = [desc[0] for desc in conn.description]
        return dict(zip(columns, result[0]))

    async def fetch_all(self, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        conn = self.connect()
        result = conn.execute(sql, params).fetchall() if params else conn.execute(sql).fetchall()
        if not result:
            return []
        columns = [desc[0] for desc in conn.description]
        return [dict(zip(columns, row)) for row in result]

    async def close(self) -> None:
        if self.conn:
            self.conn.close()
            self.conn = None
