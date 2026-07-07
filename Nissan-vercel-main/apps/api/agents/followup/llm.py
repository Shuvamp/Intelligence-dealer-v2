"""LLM client for the Follow-up Agent.

PRIMARY: Claude (Anthropic Messages API, claude-sonnet-4-6 by default).
FALLBACK: Groq (llama-3.1-8b-instant). If both are unavailable (no key, rate
limit, parse error) `complete_json` raises GroqCallError so the calling node can
fall back to a deterministic rule. No key required for local dev — the
deterministic fallback handles a fully offline run.

The public surface (`get_groq_client`, `GroqCallError`, `complete_json`) is kept
stable because graph.py imports it; the name says "groq" for history only.
"""
from __future__ import annotations

import asyncio
import json
import os
import re

try:
    from groq import Groq
except Exception:  # pragma: no cover - groq optional at import time
    Groq = None  # type: ignore

try:
    from anthropic import Anthropic
except Exception:  # pragma: no cover - anthropic optional at import time
    Anthropic = None  # type: ignore

MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")


class GroqCallError(Exception):
    """Raised when no LLM (Claude or Groq) could carry the call, so nodes fall
    back deterministically. Name kept for backwards-compatible imports."""


def _extract_json(text: str) -> dict:
    """Parse a JSON object from model output, tolerating prose/markdown fences."""
    text = (text or "").strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    # Grab the first {...} block as a fallback (Claude may add a sentence around it).
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError("no JSON object found in LLM response")


class _LLMClient:
    """Claude-first JSON client with a Groq fallback."""

    def __init__(self) -> None:
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
        self._anthropic = (
            Anthropic(api_key=anthropic_key, max_retries=0, timeout=30.0)
            if (anthropic_key and Anthropic is not None) else None
        )

        groq_key = os.environ.get("GROQ_API_KEY")
        # Fail fast: no SDK retry/backoff on 429s, short timeout — a rate-limited
        # key falls straight through to the deterministic fallback rather than
        # blocking ~10s per call on retries.
        self._groq = (
            Groq(api_key=groq_key, max_retries=0, timeout=12.0)
            if (groq_key and Groq is not None) else None
        )

    async def complete_json(
        self,
        node: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> tuple[dict, dict]:
        if self._anthropic is None and self._groq is None:
            raise GroqCallError("no LLM key configured (ANTHROPIC_API_KEY / GROQ_API_KEY)")

        loop = asyncio.get_event_loop()
        last_exc: Exception | None = None

        # ── PRIMARY: Claude ───────────────────────────────────────────────────
        if self._anthropic is not None:
            def _call_anthropic():
                # Anthropic has no JSON-mode flag; instruct it and parse defensively.
                # Speed: thinking off + low effort keeps sonnet-4-6 fast for the demo.
                resp = self._anthropic.messages.create(
                    model=ANTHROPIC_MODEL,
                    max_tokens=1024,
                    thinking={"type": "disabled"},
                    system=system_prompt + "\n\nRespond with a single JSON object and nothing else.",
                    messages=[{"role": "user", "content": user_prompt}],
                    extra_body={"output_config": {"effort": "low"}},
                )
                parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
                return "".join(parts)

            try:
                content = await loop.run_in_executor(None, _call_anthropic)
                return _extract_json(content), {"node": node, "provider": "anthropic", "model": ANTHROPIC_MODEL}
            except Exception as exc:  # noqa: BLE001 - fall through to Groq
                last_exc = exc

        # ── FALLBACK: Groq ────────────────────────────────────────────────────
        if self._groq is not None:
            def _call_groq():
                return self._groq.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=temperature,
                    response_format={"type": "json_object"},
                )

            try:
                resp = await loop.run_in_executor(None, _call_groq)
                content = resp.choices[0].message.content or "{}"
                return json.loads(content), {"node": node, "provider": "groq", "model": MODEL}
            except Exception as exc:  # noqa: BLE001 - normalize to one error type
                last_exc = exc

        raise GroqCallError(str(last_exc) if last_exc else "all LLM providers failed")


_singleton: _LLMClient | None = None


def get_groq_client() -> _LLMClient:
    global _singleton
    if _singleton is None:
        _singleton = _LLMClient()
    return _singleton
