"""Context Planner nodes (Phase 1).

validate_url|validate_manual → normalize_url (url path only) → create_context
→ store_context → track_status → END

Every submission — valid or invalid — flows all the way through to
store_context, so invalid submissions are still persisted (status="invalid")
for audit/history rather than silently dropped; only an actual storage
failure (status="failed") never lands a row, since there's nothing to write.

Every node follows the codebase-wide "never break the platform" convention:
a node never raises — a validation or storage failure degrades to a safe
status and is recorded in `errors`, never an unhandled exception.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from .data import ContextPlannerData
from .state import ContextPlannerState

logger = logging.getLogger(__name__)
_data = ContextPlannerData()

_HOSTNAME_RE = re.compile(r"^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$")
_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "ref", "igshid",
}

# Manual entry: minimum fields needed for later phases (Company Summary,
# SEO/AEO) to have any narrative to work from, given Phase 1 does no crawling.
_MANUAL_REQUIRED = ("company_name", "industry", "description")


def _default_scheme(raw: str) -> str:
    return raw if "://" in raw else f"https://{raw}"


def is_valid_url(raw: str | None) -> tuple[bool, str | None]:
    """Returns (is_valid, error_message)."""
    if not raw or not raw.strip():
        return False, "url is required"
    raw = raw.strip()
    if len(raw) > 2048:
        return False, "url is too long"

    candidate = _default_scheme(raw)
    try:
        parts = urlsplit(candidate)
    except ValueError:
        return False, "url could not be parsed"

    if parts.scheme not in ("http", "https"):
        return False, "url must use http or https"
    if "@" in (parts.netloc or ""):
        return False, "url must not contain embedded credentials"
    hostname = parts.hostname or ""
    if not hostname or not _HOSTNAME_RE.match(hostname.lower()):
        return False, "url must have a valid domain name"

    return True, None


def normalize_url(raw: str) -> str:
    """Deterministic, pure normalization — no I/O.

    scheme+host lowercased, default port stripped, root path collapsed,
    fragment dropped, known tracking params stripped, remaining query
    params sorted for a canonical form.
    """
    candidate = _default_scheme(raw.strip())
    parts = urlsplit(candidate)

    scheme = parts.scheme.lower()
    hostname = (parts.hostname or "").lower()
    port = parts.port
    default_port = {"http": 80, "https": 443}.get(scheme)
    netloc = hostname if port is None or port == default_port else f"{hostname}:{port}"

    path = parts.path or ""
    if path in ("", "/"):
        path = ""
    elif path.endswith("/"):
        path = path[:-1]

    query_pairs = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    query = urlencode(sorted(query_pairs))

    return urlunsplit((scheme, netloc, path, query, ""))


def validate_url_node(state: ContextPlannerState) -> dict:
    ok, err = is_valid_url(state.get("raw_url"))
    if ok:
        return {}
    return {"errors": [*state.get("errors", []), err or "invalid url"]}


def validate_manual_node(state: ContextPlannerState) -> dict:
    manual = state.get("manual") or {}
    errors = list(state.get("errors", []))

    for field in _MANUAL_REQUIRED:
        value = manual.get(field)
        value = value.strip() if isinstance(value, str) else value
        if not value:
            errors.append(f"{field} is required")

    company_name = (manual.get("company_name") or "").strip()
    if company_name and not (2 <= len(company_name) <= 200):
        errors.append("company_name must be between 2 and 200 characters")

    industry = (manual.get("industry") or "").strip()
    if industry and not (2 <= len(industry) <= 100):
        errors.append("industry must be between 2 and 100 characters")

    description = (manual.get("description") or "").strip()
    if description and not (10 <= len(description) <= 2000):
        errors.append("description must be between 10 and 2000 characters")

    website = manual.get("website")
    if website:
        ok, err = is_valid_url(website)
        if not ok:
            errors.append(f"website: {err}")

    return {"errors": errors}


def normalize_url_node(state: ContextPlannerState) -> dict:
    # If validation already failed, don't attempt to normalize a malformed
    # URL — leave normalized_url/website unset for this submission.
    if state.get("errors"):
        return {}
    try:
        normalized = normalize_url(state["raw_url"])
    except Exception:  # noqa: BLE001
        logger.exception("context_planner.normalize_url_failed context_id=%s", state.get("context_id"))
        return {"errors": [*state.get("errors", []), "url normalization failed"]}
    return {"normalized_url": normalized, "website": normalized}


def create_context_node(state: ContextPlannerState) -> dict:
    """Assembles the flattened output fields and computes the pre-store
    status from validation errors. Runs for every submission (valid or
    invalid) so invalid submissions still get a full record to persist."""
    now = datetime.now(timezone.utc).isoformat()
    manual = state.get("manual") or {}

    if state["input_type"] == "manual":
        fields = {
            "company_name": manual.get("company_name"),
            "website": manual.get("website"),
            "region": manual.get("region"),
            "industry": manual.get("industry"),
            "products": manual.get("products"),
            "services": manual.get("services"),
            "description": manual.get("description"),
        }
    else:
        # URL-only path: company details are unknown until Phase 2/3 extract
        # them — only `website` (the normalized URL, if normalization ran) is
        # known today.
        fields = {
            "company_name": None,
            "website": state.get("website"),
            "region": None,
            "industry": None,
            "products": None,
            "services": None,
            "description": None,
        }

    # Optimistically "ready" pre-store — store_context_node downgrades to
    # "failed" only if the write itself throws. "pending" (state.py's third
    # lifecycle value) is never actually persisted: it's the transient
    # in-memory value before this node runs.
    status = "invalid" if state.get("errors") else "ready"
    return {**fields, "status": status, "created_at": now, "updated_at": now}


async def store_context_node(state: ContextPlannerState) -> dict:
    record = {
        "id": state["context_id"],
        "tenant_id": state["tenant_id"],
        "input_type": state["input_type"],
        "url": state.get("raw_url"),
        "normalized_url": state.get("normalized_url"),
        "company_name": state.get("company_name"),
        "website": state.get("website"),
        "region": state.get("region"),
        "industry": state.get("industry"),
        "products": state.get("products"),
        "services": state.get("services"),
        "description": state.get("description"),
        "status": state.get("status"),
        "errors": state.get("errors", []),
        "created_at": state.get("created_at"),
        "updated_at": state.get("updated_at"),
    }
    try:
        await _data.insert_context(record)
        return {"stored": True}
    except Exception as exc:  # noqa: BLE001
        logger.exception("context_planner.store_failed context_id=%s", state.get("context_id"))
        return {
            "stored": False,
            "status": "failed",
            "errors": [*state.get("errors", []), f"store_failed: {exc}"],
        }


def track_status_node(state: ContextPlannerState) -> dict:
    """Final node — status was already decided (create_context/store_context);
    this node's job is the "status tracking" observability responsibility:
    one structured log line per submission."""
    logger.info(
        "context_planner.status context_id=%s tenant_id=%s status=%s errors=%s",
        state.get("context_id"), state.get("tenant_id"), state.get("status"), state.get("errors"),
    )
    return {}
