#!/usr/bin/env bash
# Smoke-test demo — clean, paced terminal output for screen recording.
# Prereqs: pip install psycopg2-binary  (no Python-version constraint)
# Configure .env (copy from .env.example), then:  ./run_demo.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
[ -f .env ] && { set -a; . ./.env; set +a; }

if ! command -v psql >/dev/null 2>&1; then
  for d in "/c/Program Files/PostgreSQL"/*/bin "/c/Program Files (x86)/PostgreSQL"/*/bin; do
    if [ -x "$d/psql.exe" ] || [ -x "$d/psql" ]; then PATH="$PATH:$d"; break; fi
  done
fi

B="\033[1m"; C="\033[36m"; G="\033[32m"; D="\033[2m"; R="\033[0m"
step(){ printf "\n${C}${B}>> %s${R}\n" "$1"; sleep 1.2; }

clear
printf "${B}${C}"
cat <<'BANNER'
  ============================================================
   NISSAN  .  DEALER INTELLIGENCE PLATFORM
   Data Pipeline  -  Smoke Test (first-round build)
  ============================================================
BANNER
printf "${R}${D}  PostgreSQL + Python + psql    Bronze -> Silver -> Gold${R}\n"
sleep 2

step "1/5  Reset + apply schema (DDL)"
PGOPTIONS="-c client_min_messages=warning" \
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
       -q -c "DROP SCHEMA IF EXISTS bronze,silver,gold,agent CASCADE;"
PGOPTIONS="-c client_min_messages=warning" \
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
       -q -v ON_ERROR_STOP=1 -f sql/01_core_ddl.sql
printf "${G}  OK  schemas + tables + resolve_customer() created${R}\n"; sleep 1

step "2/5  Real-time intake  -  6 lead sources -> identity resolution"
python -m platform_sim.intake
sleep 1

step "3/5  Marketing pipeline  -  plan -> content -> compliance -> publish"
python -m platform_sim.marketing
sleep 1

step "4/5  SQL build  -  staging -> marts -> serving views"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
     -v ON_ERROR_STOP=1 -f sql/03_build_marts.sql
sleep 1

step "5/5  Full-slice demo  -  what the agents actually read"
python demo.py

printf "\n${G}${B}  ============================================================${R}\n"
printf "${G}${B}   SMOKE TEST PASSED  -  first-round pipeline working end to end${R}\n"
printf "${G}${B}  ============================================================${R}\n\n"
