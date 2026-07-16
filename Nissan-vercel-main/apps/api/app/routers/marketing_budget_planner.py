"""Marketing Budget Planner API — a Context Planner sub-module.

Stateless: given a context_id + the user's monthly budget, reads that context's
most recent analysis (company summary + generated report) read-only and returns a
marketing BUDGET plan in INR — a derived recommended budget, its allocation, an
optimized allocation that fits the user's budget, a comparison table, an executable
task list, and strategic recommendations. Numbers are computed deterministically;
Groq only refines prose. One bounded LLM call, so POST is synchronous.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents.marketing_budget_planner.service import ContextNotFound, plan_budget

router = APIRouter()


class PlanRequest(BaseModel):
    tenant_id: str
    context_id: str
    user_budget: int
    objective: str | None = None                    # lead_generation | vehicle_sales | brand_awareness | website_traffic | customer_engagement
    campaign_duration_days: int | None = None
    target_audience: str | None = None
    vehicle_category: str | None = None
    preferred_channels: list[str] | None = None
    region: str | None = None                        # overrides the analyzed website's region for this plan
    skip_llm: bool = False                           # true for What-If scenario comparisons — numbers only, no Groq call


class BudgetSummary(BaseModel):
    currency: str = "INR"
    recommended_budget: int
    user_budget: int
    recommended_budget_display: str
    user_budget_display: str
    optimized_total: int
    optimized_total_display: str
    fits_recommended: bool
    explanation: str
    optimization_note: str


class BudgetLine(BaseModel):
    activity: str
    amount: int
    amount_display: str
    share_pct: float
    priority: str
    rationale: str


class OptimizedLine(BaseModel):
    activity: str
    amount: int
    amount_display: str
    priority: str
    status: str  # included | deferred | excluded
    note: str


class ComparisonRow(BaseModel):
    metric: str
    recommended: str
    optimized: str


class ExecutionTask(BaseModel):
    task_name: str
    category: str
    priority: str
    estimated_cost: int
    estimated_cost_display: str
    expected_impact: str


class RecommendationNote(BaseModel):
    category: str  # best_channel | optimization | growth | risk | tip
    title: str
    detail: str


class BusinessImpact(BaseModel):
    expected_leads: int
    expected_leads_display: str
    website_traffic: int
    website_traffic_display: str
    test_drive_bookings: int
    test_drive_bookings_display: str
    customer_enquiries: int
    customer_enquiries_display: str
    vehicle_sales: int
    vehicle_sales_display: str
    estimated_roi_pct: int
    estimated_roi_display: str
    reach: int
    reach_display: str
    impressions: int
    impressions_display: str


class BusinessImpactBlock(BaseModel):
    recommended: BusinessImpact
    optimized: BusinessImpact


class PlanResponse(BaseModel):
    context_id: str
    status: str
    engine: str | None = None
    currency: str = "INR"
    recommended_budget: int = 0
    user_budget: int = 0
    budget_summary: BudgetSummary | None = None
    recommended_budget_breakdown: list[BudgetLine] = []
    optimized_budget_breakdown: list[OptimizedLine] = []
    comparison_table: list[ComparisonRow] = []
    execution_plan: list[ExecutionTask] = []
    recommendations: list[RecommendationNote] = []
    business_impact: BusinessImpactBlock | None = None
    errors: list[str] = []


@router.post("/plan", response_model=PlanResponse)
async def plan_endpoint(body: PlanRequest) -> PlanResponse:
    if body.user_budget < 0:
        raise HTTPException(status_code=422, detail="user_budget must be non-negative")
    try:
        result = await plan_budget(
            body.tenant_id, body.context_id, body.user_budget,
            objective=body.objective,
            campaign_duration_days=body.campaign_duration_days,
            target_audience=body.target_audience,
            vehicle_category=body.vehicle_category,
            preferred_channels=body.preferred_channels,
            region=body.region,
            skip_llm=body.skip_llm,
        )
    except ContextNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return PlanResponse(**result)
