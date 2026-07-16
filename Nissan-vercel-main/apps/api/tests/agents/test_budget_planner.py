"""Unit tests for the Marketing Budget Planner's deterministic maths
(budget.py). Covers the two hard invariants (allocation sums exactly to the
recommended budget; optimized total never exceeds the user's budget) under
the new objective/preferred-channel tilts, plus predict_impact()'s shape and
build_plan()'s business_impact block.
"""
from agents.marketing_budget_planner import budget


def test_allocate_sums_to_recommended_with_objective_and_preferred_channels():
    recommended = 205_000
    lines = budget.allocate(recommended, seo=45, aeo=50, objective="lead_generation", preferred_channels=["YouTube Ads", "SEO"])
    assert sum(line["amount"] for line in lines) == recommended


def test_allocate_sums_to_recommended_with_no_objective():
    recommended = 150_000
    lines = budget.allocate(recommended, seo=None, aeo=None)
    assert sum(line["amount"] for line in lines) == recommended


def test_optimize_never_exceeds_user_budget():
    recommended = 300_000
    lines = budget.allocate(recommended, seo=30, aeo=35, objective="brand_awareness")
    for user_budget in (0, 50_000, 120_000, recommended, recommended * 2):
        opt = budget.optimize(lines, user_budget)
        assert opt["total"] <= user_budget


def test_channel_alias_normalization():
    assert budget._normalize_channels(["YouTube Ads", "Google Search Ads", "unknown-channel"]) == {
        "Video Content", "Google Ads",
    }


def test_predict_impact_shape_and_non_negative():
    result = budget.predict_impact(150_000, seo=40, aeo=45, category="Automotive Dealership", duration_days=30)
    for key in (
        "expected_leads", "website_traffic", "test_drive_bookings",
        "customer_enquiries", "vehicle_sales", "estimated_roi_pct", "reach", "impressions",
    ):
        assert key in result
        assert isinstance(result[key], int)
    assert result["expected_leads"] >= 0
    assert result["vehicle_sales"] >= 0


def test_predict_impact_scales_with_duration():
    short = budget.predict_impact(150_000, seo=40, aeo=45, category="Automotive Dealership", duration_days=30)
    long = budget.predict_impact(150_000, seo=40, aeo=45, category="Automotive Dealership", duration_days=90)
    assert long["expected_leads"] > short["expected_leads"]


def test_build_plan_includes_business_impact_for_both_variants():
    payload = {
        "business": {"company_name": "ABC Nissan", "industry": "Automotive Dealership", "region": "Chennai"},
        "analysis": {"combined_score": 60, "seo_score": 55, "aeo_score": 50},
        "recommended_budget": 200_000,
        "user_budget": 100_000,
        "campaign": {
            "objective": "vehicle_sales",
            "campaign_duration_days": 60,
            "target_audience": "First-time SUV buyers",
            "vehicle_category": "SUV",
            "preferred_channels": ["Meta Ads"],
        },
    }
    plan = budget.build_plan(payload)
    assert "business_impact" in plan
    assert set(plan["business_impact"]) == {"recommended", "optimized"}
    assert plan["business_impact"]["recommended"]["expected_leads"] >= 0

    recs = plan["recommendations"]
    assert [r["category"] for r in recs] == ["best_channel", "optimization", "growth", "risk", "tip"]
    optimization = next(r for r in recs if r["category"] == "optimization")
    assert optimization["title"] == budget._OBJECTIVE_TIPS["vehicle_sales"][0]
