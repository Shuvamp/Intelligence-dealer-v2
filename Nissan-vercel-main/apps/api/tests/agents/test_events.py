"""Tests for the Phase 7 event bus.

Cover the pure, deterministic surface: subscribe/publish dispatch, the kill-switch
inline path, retry-with-exhaustion, handler-failure isolation, persistence marks,
and the event row round-trip. The store's HTTP layer is faked (no network).
"""
import json

import pytest

import importlib

# `agents.events.__init__` re-exports the singleton instance as `bus`, which
# shadows the submodule attribute — so grab the module via importlib to patch its
# MAX_RETRIES/BACKOFF_MS globals.
bus_module = importlib.import_module("agents.events.bus")
from agents.events.bus import EventBus
from agents.events.types import DomainEvent, EventType


class FakeStore:
    def __init__(self):
        self.saved = []
        self.marks = []

    async def save(self, event):
        self.saved.append(event)

    async def mark(self, event_id, status, attempts=None, error=None):
        self.marks.append((event_id, status, attempts, error))

    async def list_unprocessed(self, limit=100):
        return []


def _bus():
    b = EventBus()
    b._store = FakeStore()
    return b


def _ev(t=EventType.LEAD_ASSIGNED):
    return DomainEvent(type=t, tenant_id="t1", lead_id="l1", payload={"x": 1})


@pytest.mark.asyncio
async def test_publish_inline_calls_handler(monkeypatch):
    monkeypatch.setenv("EVENT_BUS_ENABLED", "0")  # inline dispatch = deterministic
    b = _bus()
    seen = []

    async def h(e):
        seen.append(e.id)

    b.subscribe(EventType.LEAD_ASSIGNED, h)
    ev = _ev()
    assert await b.publish(ev) == ev.id
    assert seen == [ev.id]


@pytest.mark.asyncio
async def test_multiple_subscribers_all_run(monkeypatch):
    monkeypatch.setenv("EVENT_BUS_ENABLED", "0")
    b = _bus()
    calls = []

    async def h1(e):
        calls.append("a")

    async def h2(e):
        calls.append("b")

    b.subscribe(EventType.CALL_COMPLETED, h1)
    b.subscribe(EventType.CALL_COMPLETED, h2)
    await b.publish(_ev(EventType.CALL_COMPLETED))
    assert sorted(calls) == ["a", "b"]


@pytest.mark.asyncio
async def test_handler_exception_does_not_propagate(monkeypatch):
    monkeypatch.setenv("EVENT_BUS_ENABLED", "0")
    monkeypatch.setattr(bus_module, "BACKOFF_MS", 0)
    monkeypatch.setattr(bus_module, "MAX_RETRIES", 1)
    b = _bus()

    async def bad(e):
        raise RuntimeError("boom")

    b.subscribe(EventType.LEAD_RESCORED, bad)
    await b.publish(_ev(EventType.LEAD_RESCORED))  # must not raise


@pytest.mark.asyncio
async def test_retry_until_success(monkeypatch):
    monkeypatch.setattr(bus_module, "MAX_RETRIES", 3)
    monkeypatch.setattr(bus_module, "BACKOFF_MS", 0)
    b = _bus()
    attempts = {"n": 0}

    async def flaky(e):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise RuntimeError("retry me")

    ok, n, err = await b._dispatch_one(_ev(), flaky)
    assert ok is True and attempts["n"] == 3 and n == 3 and err is None


@pytest.mark.asyncio
async def test_retry_exhausted_returns_failure(monkeypatch):
    monkeypatch.setattr(bus_module, "MAX_RETRIES", 2)
    monkeypatch.setattr(bus_module, "BACKOFF_MS", 0)
    b = _bus()

    async def always_bad(e):
        raise ValueError("nope")

    ok, n, err = await b._dispatch_one(_ev(), always_bad)
    assert ok is False and n == 2 and "ValueError" in err


@pytest.mark.asyncio
async def test_dispatch_all_marks_done(monkeypatch):
    monkeypatch.setattr(bus_module, "BACKOFF_MS", 0)
    b = _bus()

    async def h(e):
        return None

    ev = _ev()
    await b._dispatch_all(ev, [h], persist=True)
    assert b._store.marks[-1] == (ev.id, "done", 1, None)


@pytest.mark.asyncio
async def test_dispatch_all_marks_failed(monkeypatch):
    monkeypatch.setattr(bus_module, "MAX_RETRIES", 1)
    monkeypatch.setattr(bus_module, "BACKOFF_MS", 0)
    b = _bus()

    async def bad(e):
        raise RuntimeError("x")

    ev = _ev()
    await b._dispatch_all(ev, [bad], persist=True)
    assert b._store.marks[-1][1] == "failed"


def test_event_row_roundtrip():
    ev = DomainEvent(
        type=EventType.CALL_COMPLETED, tenant_id="t1", lead_id="l1",
        payload={"a": 1}, source="call_intelligence",
    )
    row = ev.to_row()
    assert row["event_type"] == "call_completed"
    assert row["status"] == "pending" and row["attempts"] == 0
    # shim returns jsonb columns as strings — from_row must parse them back
    back = DomainEvent.from_row({**row, "payload": json.dumps(row["payload"])})
    assert back.payload == {"a": 1} and back.type == "call_completed" and back.lead_id == "l1"
