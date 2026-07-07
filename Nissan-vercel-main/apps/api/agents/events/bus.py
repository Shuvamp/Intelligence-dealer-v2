"""In-process async event bus (Phase 7).

Decouples agents: producers call `await bus.publish(event)`, subscribers register
with `bus.subscribe(type, handler)`. The bus persists each event, dispatches to
every subscriber as a background task, retries failing handlers with backoff, and
records the outcome. Handler failures are isolated and logged — one failing
subscriber never blocks the producer or other subscribers (rule #13).

Kill-switch: `EVENT_BUS_ENABLED=0` makes `publish()` dispatch handlers **inline**
(awaited, no persistence/retry) — i.e. it degrades to the pre–Phase-7 direct-call
behaviour through the same subscription registry, so producers need no fallback
branch and the change is instantly reversible.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Awaitable, Callable

from .store import EventStore
from .types import DomainEvent

logger = logging.getLogger(__name__)

Handler = Callable[[DomainEvent], Awaitable[None]]

MAX_RETRIES = int(os.getenv("EVENT_MAX_RETRIES", "3"))
BACKOFF_MS = int(os.getenv("EVENT_RETRY_BACKOFF_MS", "500"))


def _enabled() -> bool:
    return os.getenv("EVENT_BUS_ENABLED", "1") != "0"


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[Handler]] = {}
        self._store = EventStore()

    # ── subscription ──────────────────────────────────────────────────────────
    def subscribe(self, event_type: str, handler: Handler) -> None:
        self._subs.setdefault(event_type, []).append(handler)
        logger.info("event subscriber registered: %s → %s", event_type, getattr(handler, "__name__", handler))

    def subscribers(self, event_type: str) -> list[Handler]:
        return list(self._subs.get(event_type, []))

    # ── publish ────────────────────────────────────────────────────────────────
    async def publish(self, event: DomainEvent) -> str:
        """Emit an event. Returns its id immediately — handler execution is
        backgrounded so the producer is never blocked."""
        handlers = self._subs.get(event.type, [])

        if not _enabled():
            # Kill-switch: inline dispatch, no persistence/retry (legacy-like).
            await self._dispatch_all(event, handlers, persist=False)
            return event.id

        await self._store.save(event)
        if not handlers:
            await self._store.mark(event.id, "done", attempts=0)
            return event.id
        asyncio.create_task(self._dispatch_all(event, handlers, persist=True))
        return event.id

    # ── dispatch + retry ────────────────────────────────────────────────────────
    async def _dispatch_all(self, event: DomainEvent, handlers: list[Handler], persist: bool) -> None:
        if not handlers:
            return
        results = await asyncio.gather(*[self._dispatch_one(event, h) for h in handlers])
        if not persist:
            return
        ok = all(r[0] for r in results)
        attempts = max((r[1] for r in results), default=0)
        if ok:
            await self._store.mark(event.id, "done", attempts=attempts)
        else:
            errs = "; ".join(r[2] for r in results if r[2])
            await self._store.mark(event.id, "failed", attempts=attempts, error=errs)

    async def _dispatch_one(self, event: DomainEvent, handler: Handler) -> tuple[bool, int, str | None]:
        last_err: str | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                await handler(event)
                return (True, attempt, None)
            except Exception as exc:  # noqa: BLE001
                last_err = f"{type(exc).__name__}: {exc}"
                logger.exception(
                    "event handler failed: type=%s id=%s handler=%s attempt=%d/%d",
                    event.type, event.id, getattr(handler, "__name__", handler), attempt, MAX_RETRIES,
                )
                if attempt < MAX_RETRIES and BACKOFF_MS > 0:
                    await asyncio.sleep((BACKOFF_MS / 1000) * attempt)
        return (False, MAX_RETRIES, last_err)

    # ── recovery ──────────────────────────────────────────────────────────────
    async def replay(self) -> int:
        """Re-dispatch persisted events not yet `done` (pending/failed). Called on
        startup and via POST /events/replay — gives the in-process bus
        recoverability across restarts."""
        pending = await self._store.list_unprocessed()
        for ev in pending:
            handlers = self._subs.get(ev.type, [])
            if handlers:
                await self._dispatch_all(ev, handlers, persist=True)
            else:
                await self._store.mark(ev.id, "done", attempts=0)
        if pending:
            logger.info("event replay processed %d unprocessed event(s)", len(pending))
        return len(pending)


# Module-level singleton — imported by producers and by main.py's handler wiring.
bus = EventBus()
