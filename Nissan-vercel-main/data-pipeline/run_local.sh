#!/usr/bin/env bash
# One-shot local run: DDL -> simulators -> SQL marts -> demo.
# Prereqs: pip install psycopg2-binary  (no Python-version constraint)
# Configure connection via .env (copy from .env.example) then:  ./run_local.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then set -a && . ./.env && set +a; fi

# Make sure psql is reachable (Windows installs to Program Files; PATH edits
# don't persist across Git Bash windows, so locate it ourselves).
if ! command -v psql >/dev/null 2>&1; then
  for d in "/c/Program Files/PostgreSQL"/*/bin "/c/Program Files (x86)/PostgreSQL"/*/bin; do
    if [ -x "$d/psql.exe" ] || [ -x "$d/psql" ]; then PATH="$PATH:$d"; break; fi
  done
fi
command -v psql >/dev/null 2>&1 || { echo "ERROR: psql not found. Add PostgreSQL's bin to PATH."; exit 1; }

echo "==> 1/5  Applying core DDL"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f sql/01_core_ddl.sql

echo "==> 2/5  Real-time intake simulator (Team 2)"
python -m platform_sim.intake

echo "==> 3/5  Marketing simulator (Team 1 + channel metrics)"
python -m platform_sim.marketing

echo "==> 4/5  SQL build  -  staging -> marts -> serving views"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f sql/03_build_marts.sql

echo "==> 5/5  Full-slice demo"
python demo.py
