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
# Facebook Login for Business — a pre-configured Meta "Configuration" (scopes +
# settings bundled server-side) referenced by ID instead of a raw scope list.
# Set up under Meta Developer Console → App → Facebook Login for Business →
# Configurations. Separate redirect URI from Instagram's since it hits its own
# callback path (/api/facebook/callback vs /api/instagram/callback) — both
# must be registered as Valid OAuth Redirect URIs in the Meta app.
FACEBOOK_CONFIG_ID: str = os.getenv("FACEBOOK_CONFIG_ID", "")
FACEBOOK_PAGE_REDIRECT_URI: str = os.getenv(
    "FACEBOOK_PAGE_REDIRECT_URI", "http://localhost:8000/api/facebook/callback"
)
FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")
META_API_VERSION: str = os.getenv("META_API_VERSION", "v20.0")
# This server's own publicly-reachable base URL. Needed because Instagram's
# Graph API /media endpoint fetches the image server-side from a URL — it
# cannot accept raw bytes like Facebook's /photos endpoint does. Relative
# poster/video paths (e.g. "/posters/x.png") are resolved against this.
# On localhost this is NOT reachable by Meta's servers — Instagram publish
# only works once this points at a real public host (deployed, or a tunnel
# like ngrok in dev).
API_PUBLIC_URL: str = os.getenv("API_PUBLIC_URL", "http://localhost:8000")
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
# LinkedIn REST API version header (format YYYYMM) — bump periodically; LinkedIn
# supports each versioned release for ~12 months on a rolling basis.
LINKEDIN_API_VERSION: str = os.getenv("LINKEDIN_API_VERSION", "202606")
# Org-level analytics (impressions/reach/shares/followers growth/profile views)
# require the rw_organization_admin scope, which LinkedIn only grants once the
# Developer App has Marketing Developer Platform (MDP) product access. Requesting
# an unapproved scope breaks the OAuth consent screen entirely, so this stays off
# until the app is actually approved — flip to true then reconnect LinkedIn.
LINKEDIN_ORG_SCOPES_ENABLED: bool = os.getenv("LINKEDIN_ORG_SCOPES_ENABLED", "false").lower() == "true"
LINKEDIN_ANALYTICS_POLL_SECONDS: int = int(os.getenv("LINKEDIN_ANALYTICS_POLL_SECONDS", "1800"))
INSTAGRAM_ANALYTICS_POLL_SECONDS: int = int(os.getenv("INSTAGRAM_ANALYTICS_POLL_SECONDS", "1800"))

# ── YouTube / Google OAuth ─────────────────────────────────────────────────
GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI: str = os.getenv(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/youtube/callback"
)
