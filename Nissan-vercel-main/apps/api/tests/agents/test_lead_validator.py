"""Unit tests for the Lead Validator agent (Phase 1 — Validation Agent).

Covers the PHASE_01_VALIDATION_AGENT.md acceptance criteria directly:
duplicate detection (phone or email), enquiry_count updates, invalid leads
rejected, validation persisted (validation_logs on every outcome).

No real Supabase/DuckDB shim is needed — httpx.Client is monkeypatched to a
tiny in-memory fake that mimics just enough of the PostgREST surface
(GET/POST/PATCH with `eq.` filters) for dedup_and_persist to run against.
"""
import pytest

import agents.lead_validator.nodes as nodes_mod
from agents.lead_validator.graph import lead_validator


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


class _FakeStore:
    """Tiny in-memory stand-in for the customers/leads/lead_interactions/
    validation_logs tables this agent reads and writes."""

    def __init__(self):
        self.customers = []
        self.leads = []
        self.lead_interactions = []
        self.validation_logs = []

    def table(self, name):
        return getattr(self, name)


class _FakeClient:
    """Mimics the subset of httpx.Client used by lead_validator/nodes.py."""

    def __init__(self, store, *args, **kwargs):
        self.store = store

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def get(self, path, params=None):
        table = self.store.table(path.rsplit("/", 1)[-1])
        rows = table
        for key, val in (params or {}).items():
            if key in ("select", "limit"):
                continue
            sval = str(val)
            if sval.startswith("eq."):
                want = sval[3:]
                rows = [r for r in rows if str(r.get(key)) == want]
        limit = (params or {}).get("limit")
        if limit:
            rows = rows[: int(limit)]
        return _FakeResponse(rows)

    def post(self, path, json=None, headers=None):
        table = self.store.table(path.rsplit("/", 1)[-1])
        table.append(dict(json or {}))
        return _FakeResponse(json)

    def patch(self, path, json=None, headers=None):
        base, _, qs = path.partition("?")
        table = self.store.table(base.rsplit("/", 1)[-1])
        row_id = None
        for part in qs.split("&"):
            if part.startswith("id=eq."):
                row_id = part[len("id=eq."):]
        for row in table:
            if str(row.get("id")) == row_id:
                row.update(json or {})
        return _FakeResponse(json)


@pytest.fixture
def store(monkeypatch):
    fake_store = _FakeStore()
    monkeypatch.setattr(
        nodes_mod.httpx, "Client", lambda *a, **kw: _FakeClient(fake_store, *a, **kw)
    )
    return fake_store


def _lead(**overrides) -> dict:
    base = {
        "tenant_id": "tenant-1",
        "source": "website",
        "full_name": "Test User",
        "phone": "9876543210",
        "email": "test@example.com",
        "vehicle_interest": "Magnite",
        "city": "Chennai",
        "test_drive_requested": False,
        "budget_range": None,
        "purchase_timeframe": None,
        "preferred_call_time": None,
        "preferred_channel": None,
    }
    base.update(overrides)
    return base


def _run(lead: dict) -> dict:
    initial_state = {
        "lead": lead,
        "errors": [],
        "warnings": [],
        "is_duplicate": False,
        "lead_id": None,
        "customer_id": None,
        "enquiry_count": None,
        "normalized_phone": None,
        "status": "pending",
    }
    return lead_validator.invoke(initial_state)


def test_valid_lead_passes_and_is_persisted(store):
    result = _run(_lead())

    assert result["status"] == "inserted"
    assert not result["errors"]
    assert result["lead_id"] is not None
    assert len(store.customers) == 1
    assert len(store.leads) == 1
    assert store.validation_logs[-1]["status"] == "passed"


def test_missing_phone_is_rejected(store):
    result = _run(_lead(phone=""))

    assert result["status"] == "invalid"
    assert any(e["field"] == "phone" for e in result["errors"])
    assert len(store.leads) == 0
    assert store.validation_logs[-1]["status"] == "rejected"


def test_malformed_phone_is_rejected(store):
    result = _run(_lead(phone="12345"))

    assert result["status"] == "invalid"
    assert len(store.leads) == 0


def test_malformed_email_is_rejected(store):
    result = _run(_lead(email="not-an-email"))

    assert result["status"] == "invalid"
    assert any(e["field"] == "email" for e in result["errors"])
    # dedup_and_persist must never run for a rejected lead.
    assert len(store.leads) == 0
    assert store.validation_logs[-1]["status"] == "rejected"


def test_absent_email_is_not_required(store):
    result = _run(_lead(email=None))

    assert result["status"] == "inserted"


def test_required_field_name_missing_still_persists_with_warning(store):
    # full_name has no hard requirement in this agent today (only phone is
    # hard-required) — absence is a soft warning, not a rejection.
    result = _run(_lead(full_name=""))

    assert result["status"] == "inserted"


def test_duplicate_phone_increments_enquiry_count_and_logs_interaction(store):
    first = _run(_lead())
    assert first["status"] == "inserted"

    second = _run(_lead())

    assert second["status"] == "duplicate"
    assert second["is_duplicate"] is True
    assert second["enquiry_count"] == 2
    assert len(store.leads) == 1  # no second lead row created
    assert len(store.lead_interactions) == 1
    assert store.lead_interactions[0]["lead_id"] == second["lead_id"]
    assert store.validation_logs[-1]["status"] == "duplicate"


def test_duplicate_email_with_different_phone_is_also_caught(store):
    first = _run(_lead(phone="9876543210", email="same@example.com"))
    assert first["status"] == "inserted"

    second = _run(_lead(phone="9123456780", email="same@example.com"))

    assert second["status"] == "duplicate"
    assert second["customer_id"] == first["customer_id"]
    assert len(store.customers) == 1


def test_every_outcome_writes_a_validation_log(store):
    _run(_lead(phone=""))   # rejected
    _run(_lead())            # passed
    _run(_lead())            # duplicate

    statuses = [row["status"] for row in store.validation_logs]
    assert statuses == ["rejected", "passed", "duplicate"]
