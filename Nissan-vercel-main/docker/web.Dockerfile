# ── ADIP Web — TanStack Start (React SSR) ─────────────────────────────────────
# Multi-stage: install → build → run.
# VITE_* env vars are baked into the client bundle at build time.
# Pass them as build-args (compose does this via args:) — they are NOT secrets.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-slim AS deps

WORKDIR /app

# Copy web package files with lockfile for reproducible install
COPY apps/web/package.json apps/web/
COPY apps/web/package-lock.json* apps/web/
RUN npm ci --prefix apps/web --ignore-scripts

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app

COPY apps/web/ apps/web/

# Build args — Vite bakes these into the client bundle at build time.
# They point at the public-facing URLs the browser will use. No defaults —
# the hosted Supabase project's URL/anon key must be passed in at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_AGENT_API_URL=http://localhost:8000

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_AGENT_API_URL=$VITE_AGENT_API_URL

RUN npm run build --prefix apps/web

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# TanStack Start outputs a Node.js server in .output/
COPY --from=builder /app/apps/web/.output/ .output/
COPY --from=builder /app/apps/web/package.json .

# Non-root user
RUN adduser --disabled-password --gecos "" adip && \
    chown -R adip:adip /app
USER adip

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", ".output/server/index.mjs"]
