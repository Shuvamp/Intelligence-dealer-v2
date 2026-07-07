# ── ADIP DuckDB Shim — dev profile only ──────────────────────────────────────
# Express + DuckDB in-process. NOT used in production.
# Production uses real Supabase (Postgres + Auth + RLS).
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-slim

WORKDIR /app

COPY apps/local-api/package.json .
RUN npm ci --ignore-scripts

COPY apps/local-api/ .

# Persist DuckDB to a named volume so data survives container restart in dev
RUN mkdir -p /data

ENV PORT=54321 \
    DUCKDB_PATH=/data/dev.db

EXPOSE 54321

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:54321/rest/v1/leads?limit=1',r=>{process.exit(r.statusCode===200||r.statusCode===404?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
