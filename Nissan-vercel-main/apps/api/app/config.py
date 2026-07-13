import os
from pathlib import Path

from dotenv import load_dotenv

# Load apps/api/.env by ABSOLUTE path (config.py lives at apps/api/app/config.py,
# so parent.parent is apps/api). A bare load_dotenv() searches upward from the
# process CWD — which is the repo root under `npm run dev`, where there is no
# .env — so keys (GROQ_API_KEY, etc.) silently came back empty. Explicit path
# makes env loading independent of the working directory.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "http://localhost:54321")
SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
CALENDARIFIC_API_KEY: str = os.getenv("CALENDARIFIC_API_KEY", "")
PAGESPEED_API_KEY: str = os.getenv("PAGESPEED_API_KEY", "")
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_IMAGE_MODEL: str = os.getenv("GEMINI_IMAGE_MODEL", "gemini-3-pro-image")
NVIDIA_API_KEY: str = os.getenv("NVIDIA_API_KEY", "")

# ── Text LLM: Claude (primary) + Grok (fallback) ──────────────────────────
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-8")
GROK_API_KEY: str = os.getenv("GROQ_API_KEYS", os.getenv("GROQ_API_KEY", ""))
GROK_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# ── Facebook / Meta OAuth ─────────────────────────────────────────────────
# Env vars use FACEBOOK_* prefix; META_* kept as fallbacks for compatibility.
FACEBOOK_APP_ID: str = os.getenv("FACEBOOK_APP_ID", os.getenv("META_APP_ID", ""))
FACEBOOK_APP_SECRET: str = os.getenv("FACEBOOK_APP_SECRET", os.getenv("META_APP_SECRET", ""))
FACEBOOK_REDIRECT_URI: str = os.getenv(
    "FACEBOOK_REDIRECT_URI",
    os.getenv("META_REDIRECT_URI", "http://localhost:8000/api/instagram/callback"),
)
FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")
META_API_VERSION: str = os.getenv("META_API_VERSION", "v20.0")
# Redirect URI for the /auth/instagram/* flow (separate from legacy /api/instagram/*)
AUTH_REDIRECT_URI: str = os.getenv(
    "AUTH_REDIRECT_URI", "http://localhost:8000/auth/instagram/callback"
)

# ── LinkedIn OAuth ─────────────────────────────────────────────────────────
LINKEDIN_CLIENT_ID: str = os.getenv("LINKEDIN_CLIENT_ID", "")
LINKEDIN_CLIENT_SECRET: str = os.getenv("LINKEDIN_CLIENT_SECRET", "")
LINKEDIN_REDIRECT_URI: str = os.getenv(
    "LINKEDIN_REDIRECT_URI", "http://localhost:8000/auth/linkedin/callback"
)
