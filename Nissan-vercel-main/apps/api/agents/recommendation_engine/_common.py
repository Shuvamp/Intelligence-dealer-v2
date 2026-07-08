"""Shared helpers for consolidating SEO + AEO recommendations into the
unified 10-field `RecommendationItem` shape: severity derivation, the
Category taxonomy, estimated-time bucketing, score-grade banding, and the
sort key used to order the merged list.

Deliberately has no dependency on `agents.seo_agent` / `agents.aeo_agent` —
`CATEGORY_MAP`'s keys are a plain literal duplicate of those packages'
`DIMENSION_NAMES` / `AGENT_NAMES` (mirrors this codebase's established
per-phase decoupling convention, where `data.py` duplicates read-only
queries rather than importing the upstream package). Completeness against
the live `DIMENSION_NAMES`/`AGENT_NAMES` lists is enforced by a unit test,
not a runtime import.
"""
from __future__ import annotations

Level = str  # "high" | "medium" | "low" — kept as plain str (validated later by schema.py)


# ── Severity ─────────────────────────────────────────────────────────────────

# status x level -> Severity. Honest: built only from signal the source
# reports already asserted (status + priority/impact), never invented.
_SEVERITY_MATRIX = {
    ("FAIL", "high"): "Critical",
    ("FAIL", "medium"): "High",
    ("FAIL", "low"): "Medium",
    ("WARNING", "high"): "High",
    ("WARNING", "medium"): "Medium",
    ("WARNING", "low"): "Low",
}


def derive_severity(status: str, level: str) -> str:
    """PASS-time caveat recommendations (status=="PASS") are informational,
    not actionable defects, so they always land as "Low" severity."""
    if status == "PASS":
        return "Low"
    return _SEVERITY_MATRIX.get((status, level), "Medium")


_SEVERITY_RANK = {"Critical": 3, "High": 2, "Medium": 1, "Low": 0}
_PRIORITY_RANK = {"high": 2, "medium": 1, "low": 0}


def sort_key(item: dict) -> tuple[int, int]:
    """Sort key for the merged list: severity desc, then priority desc."""
    return (
        -_SEVERITY_RANK.get(item.get("severity"), 0),
        -_PRIORITY_RANK.get(item.get("priority"), 0),
    )


# ── Estimated Time ───────────────────────────────────────────────────────────

_TIME_BY_DIFFICULTY = {
    "low": "1-2 hours",
    "medium": "1-3 days",
    "high": "1-2 weeks",
    "unknown": "Unscoped — no difficulty signal available",
}


def estimated_time_for(difficulty: str) -> str:
    return _TIME_BY_DIFFICULTY.get(difficulty, _TIME_BY_DIFFICULTY["unknown"])


# ── Category taxonomy ────────────────────────────────────────────────────────

# Maps every SEO dimension name (docs/planner/04_SEO_AGENT.md) and every AEO
# agent name (docs/planner/05_AEO_AGENT.md) into one of 9 shared categories,
# so filtering by category surfaces matching SEO+AEO issues together (e.g.
# SEO "Trust" and AEO "Trust Analysis" both land in "Trust & Authority") —
# genuine cross-report consolidation, confirmed with the user over the
# simpler pass-through-the-source-name alternative.
CATEGORY_MAP: dict[str, str] = {
    # Business Identity & Local Presence
    "Website Information": "Business Identity & Local Presence",
    "Company Information": "Business Identity & Local Presence",
    "Contact Information": "Business Identity & Local Presence",
    "Local SEO": "Business Identity & Local Presence",
    "Entity Detection": "Business Identity & Local Presence",
    "Brand Context": "Business Identity & Local Presence",
    # Products & Services
    "Products": "Products & Services",
    "Services": "Products & Services",
    # Content & Messaging
    "Content Analysis": "Content & Messaging",
    "Blog": "Content & Messaging",
    "Page Analysis": "Content & Messaging",
    "Answer Quality": "Content & Messaging",
    "Content Chunking": "Content & Messaging",
    # FAQ & Structured Q&A
    "FAQ": "FAQ & Structured Q&A",
    "Question Detection": "FAQ & Structured Q&A",
    "FAQ Analysis": "FAQ & Structured Q&A",
    # Technical & Structured Data
    "Technical SEO": "Technical & Structured Data",
    "Schema": "Technical & Structured Data",
    "Schema Analysis": "Technical & Structured Data",
    "AI Readability": "Technical & Structured Data",
    "LLM Readability": "Technical & Structured Data",
    # Trust & Authority
    "Trust": "Trust & Authority",
    "Brand Authority": "Trust & Authority",
    "Trust Analysis": "Trust & Authority",
    "Citation Analysis": "Trust & Authority",
    # Media & Links
    "Internal Links": "Media & Links",
    "External Links": "Media & Links",
    "Images": "Media & Links",
    "Videos": "Media & Links",
    # Performance & Accessibility
    "Performance": "Performance & Accessibility",
    "Core Web Vitals": "Performance & Accessibility",
    "Accessibility": "Performance & Accessibility",
    "Security": "Performance & Accessibility",
    # Discovery & Conversion
    "Keyword Analysis": "Discovery & Conversion",
    "Conversion Optimization": "Discovery & Conversion",
}


def category_for(name: str) -> str:
    return CATEGORY_MAP.get(name, "Other")


# ── Score grade banding (reused from seo_agent/nodes/build.py's precedent) ──

def grade_for(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 40:
        return "D"
    return "F"
