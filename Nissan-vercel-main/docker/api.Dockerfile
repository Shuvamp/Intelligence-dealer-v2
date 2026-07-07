# ── ADIP API — FastAPI + all agents ──────────────────────────────────────────
# Multi-stage: deps layer (cached) + source layer (rebuilt on code changes).
# Agents run in-process; event bus is in-process (Phase 9 adds Redis/workers).
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS base

# ffmpeg — needed by faster-whisper to decode mp3/m4a; wav works without it
# but mp3 uploads fail at transcription time without it.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# uv — same package manager used in dev (setup:agent script)
RUN pip install --no-cache-dir uv

WORKDIR /app

# ── deps layer (cache-friendly: only re-runs when requirements.txt changes) ──
COPY apps/api/requirements.txt .
RUN uv venv /app/.venv && \
    uv pip install --python /app/.venv/bin/python --no-cache -r requirements.txt

# ── source layer ─────────────────────────────────────────────────────────────
COPY apps/api/ .

# Uploads directory — bind-mounted as a volume in dev; Supabase Storage in prod
RUN mkdir -p /app/.uploads

# Non-root user for runtime security
RUN adduser --disabled-password --gecos "" adip && \
    chown -R adip:adip /app
USER adip

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
