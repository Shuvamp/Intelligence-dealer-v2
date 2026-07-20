"""
Shared text LLM client: Claude (primary) → Groq (fallback).

Gemini is intentionally excluded here — it is used ONLY for poster image
generation (gemini_image() in gemini.py). Every other AI call routes through
this module.

Public interface:
  has_llm()   → bool   — True if at least one key is configured
  llm_text()  → str | None
  llm_json()  → dict | None

Both functions try Claude first. If Claude returns None (missing key, HTTP
error, empty response), Groq is attempted. None is returned only when both
providers fail or no key is set. Template fallbacks live in the callers.
"""
from __future__ import annotations

import json
import logging

import httpx

from app.config import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    GROK_API_KEY,
    GROK_MODEL,
)

logger = logging.getLogger("app.llm")

_CLAUDE_BASE = "https://api.anthropic.com/v1"
_GROK_BASE   = "https://api.groq.com/openai/v1"


# ─────────────────────────────────────────────────────────────────────────────
# Availability check
# ─────────────────────────────────────────────────────────────────────────────

def has_llm() -> bool:
    """True if at least one text-LLM key is configured."""
    return bool(ANTHROPIC_API_KEY or GROK_API_KEY)


# ─────────────────────────────────────────────────────────────────────────────
# Internal: per-provider calls
# ─────────────────────────────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    return text


def _extract_json_object(text: str) -> str:
    """Grab the first {...} span — some providers prefix JSON with prose."""
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    return text


def _claude(
    user_prompt: str,
    system: str | None,
    temperature: float,
    max_tokens: int,
) -> str | None:
    if not ANTHROPIC_API_KEY:
        return None
    body: dict = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    if system:
        body["system"] = system
    try:
        resp = httpx.post(
            f"{_CLAUDE_BASE}/messages",
            json=body,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            timeout=60.0,
        )
        if resp.status_code != 200:
            logger.warning("[claude] HTTP %s: %s", resp.status_code, resp.text[:300])
            return None
        for block in resp.json().get("content", []):
            if block.get("type") == "text":
                return block["text"].strip()
        logger.warning("[claude] no text block in response")
        return None
    except Exception:
        logger.exception("[claude] request failed")
        return None


def _grok(
    user_prompt: str,
    system: str | None,
    temperature: float,
    max_tokens: int,
) -> str | None:
    if not GROK_API_KEY:
        return None
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user_prompt})
    try:
        resp = httpx.post(
            f"{_GROK_BASE}/chat/completions",
            json={
                "model": GROK_MODEL,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "messages": messages,
            },
            headers={
                "Authorization": f"Bearer {GROK_API_KEY}",
                "content-type": "application/json",
            },
            timeout=60.0,
        )
        if resp.status_code != 200:
            logger.warning("[grok] HTTP %s: %s", resp.status_code, resp.text[:300])
            return None
        choices = resp.json().get("choices", [])
        if choices:
            return choices[0]["message"]["content"].strip()
        logger.warning("[grok] no choices in response")
        return None
    except Exception:
        logger.exception("[grok] request failed")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def llm_text(
    user_prompt: str,
    system: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str | None = None,  # unused — kept for call-site compatibility
) -> str | None:
    """Raw text: Claude → Grok fallback. None if both fail or no key configured."""
    result = _claude(user_prompt, system, temperature, max_tokens)
    if result is None:
        logger.info("[llm] Claude unavailable/failed — trying Grok fallback")
        result = _grok(user_prompt, system, temperature, max_tokens)
    return result


def llm_json(
    user_prompt: str,
    system: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    model: str | None = None,  # unused — kept for call-site compatibility
) -> dict | None:
    """Parsed JSON: Claude → Grok fallback. Strips ```json fences. None on failure."""
    text = llm_text(user_prompt, system, temperature, max_tokens)
    if not text:
        return None
    try:
        return json.loads(_extract_json_object(_strip_fences(text)))
    except Exception:
        logger.warning("[llm] JSON parse failed — text=%r", text[:300])
        return None
