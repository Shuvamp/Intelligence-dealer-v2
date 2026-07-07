"""
Scoring knowledge base — loads the framework md files in docs/scoring_agent_md/
and exposes them as a single rubric string for the holistic LLM scoring node.

Two modes:
  - COMPACT (default): pulls the rule-dense slices of each md file so the whole
    rubric fits under Groq's free-tier 12k tokens-per-request limit (~8k tokens).
  - FULL  (SCORING_RUBRIC_FULL=1): sends every rubric file verbatim. Use only on
    a paid Groq tier with a high TPM limit.

Override the docs location with SCORING_RUBRIC_DIR.
"""

import os
import functools
import logging

logger = logging.getLogger(__name__)

# apps/api/agents/scoring/knowledge.py  →  repo root is four levels up.
_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_DOCS = os.path.abspath(os.path.join(_HERE, "..", "..", "..", "..", "docs", "scoring_agent_md"))

# Full set (verbatim) — used only when SCORING_RUBRIC_FULL=1.
RUBRIC_FILES = [
    "lead_scoring_framework.md",
    "llm_scoring_rules.md",
    "buying_signals.md",
    "negative_signals.md",
    "budget_analysis.md",
    "competitor_intelligence.md",
    "customer_journey.md",
    "validation_framework.md",
]

# Compact plan: (file, mode, arg, max_chars)
#   mode "from": keep text starting at the first occurrence of `arg` (a header),
#                so we capture the rules section and drop the preceding narrative
#                and long example tables.
#   mode "head": keep the first `max_chars` characters (rules/overview come first).
# Char budgets keep the assembled rubric near ~13k chars (~3.5k tokens) so the
# whole holistic prompt (rubric + lead + 1k completion) lands UNDER Groq's
# free-tier 6000 tokens-per-minute cap for llama-3.1-8b-instant — otherwise the
# request 413s. The 8-dimension model (the part that actually drives the score)
# keeps the largest budget; the rest are trimmed to their rule headers. The
# NVIDIA fallback (no such tight cap) gets the same prompt, so quality is fine.
_COMPACT_PLAN = [
    ("lead_scoring_framework.md", "from", "## SECTION 3", 6500),   # 8-dimension scoring model + interpretation
    ("llm_scoring_rules.md",      "head", None,            1800),
    ("buying_signals.md",         "head", None,            1500),
    ("negative_signals.md",       "head", None,            1000),
    ("budget_analysis.md",        "head", None,             800),
    ("competitor_intelligence.md","head", None,             600),
    ("customer_journey.md",       "head", None,             500),
    ("validation_framework.md",   "head", None,             800),
]


def _docs_dir() -> str:
    return os.environ.get("SCORING_RUBRIC_DIR", _DEFAULT_DOCS)


def _read(name: str) -> str:
    path = os.path.join(_docs_dir(), name)
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError as e:
        logger.warning("Could not load rubric file %s: %s", path, e)
        return ""


@functools.lru_cache(maxsize=2)
def load_rubric() -> str:
    """Assemble the rubric. Compact by default; full when SCORING_RUBRIC_FULL=1."""
    full = os.environ.get("SCORING_RUBRIC_FULL", "").lower() in ("1", "true", "yes")
    parts = []

    if full:
        for name in RUBRIC_FILES:
            text = _read(name)
            if text:
                parts.append(f"===== {name} =====\n{text}")
    else:
        for name, mode, arg, max_chars in _COMPACT_PLAN:
            text = _read(name)
            if not text:
                continue
            if mode == "from" and arg:
                idx = text.find(arg)
                if idx != -1:
                    text = text[idx:]
            text = text[:max_chars].rstrip()
            parts.append(f"===== {name} (excerpt) =====\n{text}")

    rubric = "\n\n".join(parts)
    logger.info("Loaded scoring rubric (%s): %d files, %d chars",
                "full" if full else "compact", len(parts), len(rubric))
    return rubric


def rubric_available() -> bool:
    return bool(load_rubric().strip())
