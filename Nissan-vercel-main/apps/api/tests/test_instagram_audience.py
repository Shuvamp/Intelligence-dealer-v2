"""Follower-snapshot → daily growth series (app/routers/instagram.py)."""
from app.routers.instagram import build_audience_series


def snap(captured_at: str, followers: int | None):
    return {"captured_at": captured_at, "followers": followers}


def test_last_snapshot_of_each_day_wins_and_nets_are_deltas():
    series = build_audience_series([
        snap("2026-07-01T02:00:00+00:00", 100),
        snap("2026-07-01T23:00:00+00:00", 110),  # same day, later — wins
        snap("2026-07-02T02:00:00+00:00", 105),  # a drop is a real -5
    ])
    assert series == [
        {"date": "2026-07-01", "followers": 110, "net": None},
        {"date": "2026-07-02", "followers": 105, "net": -5},
    ]


def test_range_filter_keeps_a_real_delta_on_the_first_in_range_point():
    snapshots = [
        snap("2026-07-01T02:00:00+00:00", 100),
        snap("2026-07-02T02:00:00+00:00", 130),
        snap("2026-07-03T02:00:00+00:00", 140),
    ]
    series = build_audience_series(snapshots, date_from="2026-07-02T00:00:00+00:00")
    # +30 is diffed against the out-of-range 07-01 snapshot, not reported as null.
    assert [p["net"] for p in series] == [30, 10]

    assert build_audience_series(snapshots, date_to="2026-07-01T23:59:59+00:00") == [
        {"date": "2026-07-01", "followers": 100, "net": None},
    ]


def test_null_followers_are_skipped_not_treated_as_zero():
    assert build_audience_series([snap("2026-07-01T02:00:00+00:00", None)]) == []
    assert build_audience_series([]) == []
