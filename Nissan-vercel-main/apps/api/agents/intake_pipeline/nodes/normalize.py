"""
NODE 2 — NORMALIZE    OWNER: PARTHA ✅ (done)
Position: Source → validate → [NORMALIZE] → score → assign → DB
Reads   : state["raw_lead"], state["source"]
Writes  : { "normalized": NormalizedLead }
"""
import os
import json
import logging
from typing import Optional
from ..contracts import PipelineState, NodeDeps, NormalizedLead

logger = logging.getLogger(__name__)

NORMALIZE_PROMPT = """You are a lead data normalization agent for a car dealership CRM.
Normalize the following raw lead data into a standard format.
Return ONLY a valid JSON object — no markdown, no explanation.

Raw lead data (JSON): {raw_data}
Source channel: {source}

Return exactly this JSON structure:
{{
  "name": "full name, properly capitalized",
  "phone": "digits and leading + only",
  "email": "lowercase email or null",
  "vehicle": "vehicle model of interest or null",
  "city": "city name or null"
}}"""


def _to_num(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        n = float(v)
        return n if not (n != n) else None  # isnan check
    except (ValueError, TypeError):
        return None


def _to_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.lower().strip() in ("yes", "true", "1", "y")
    return bool(v)


def static_normalize(raw_lead: dict, source: str) -> NormalizedLead:
    """Deterministic fallback — no LLM required. Always works in local dev."""
    return {
        "name": str(raw_lead.get("name") or "").strip(),
        "phone": str(raw_lead.get("phone") or "").strip(),
        "email": (str(raw_lead.get("email") or "").lower().strip() or None),
        "vehicle": raw_lead.get("vehicle") or raw_lead.get("vehicle_interest") or None,
        "city": raw_lead.get("city") or None,
        "test_drive_required": _to_bool(raw_lead.get("test_drive") or raw_lead.get("test_drive_required")),
        "budget": _to_num(raw_lead.get("budget")),
        "buy_timeline_days": int(_to_num(raw_lead.get("buy_timeline_days")) or 0) or None,
        "callback_days": int(_to_num(raw_lead.get("callback_days")) or 0) or None,
        "contact_medium": str(raw_lead.get("contact_medium") or "").strip() or None,
        "source": source,
        "status": "New",
    }


async def normalize_node(state: PipelineState, deps: NodeDeps) -> dict:
    base = static_normalize(state["raw_lead"], state["source"])
    api_key = deps.get("anthropic_key") or os.getenv("ANTHROPIC_API_KEY")

    if api_key:
        try:
            from langchain_anthropic import ChatAnthropic
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_core.output_parsers import JsonOutputParser

            model = ChatAnthropic(model="claude-haiku-4-5-20251001", temperature=0, max_tokens=256, anthropic_api_key=api_key)
            chain = ChatPromptTemplate.from_template(NORMALIZE_PROMPT) | model | JsonOutputParser()
            result = await chain.ainvoke({
                "raw_data": json.dumps(state["raw_lead"], indent=2),
                "source": state["source"],
            })
            # Claude cleans identity fields; keep our coerced preference fields
            return {"normalized": {**base, **result, "source": state["source"], "status": "New"}}
        except Exception as err:
            logger.warning("[normalize] Claude failed, static fallback: %s", err)

    return {"normalized": base}
