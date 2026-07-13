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
    title: str
    detail: str


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
    errors: list[str] = []


@router.post("/plan", response_model=PlanResponse)
async def plan_endpoint(body: PlanRequest) -> PlanResponse:
    if body.user_budget < 0:
        raise HTTPException(status_code=422, detail="user_budget must be non-negative")
    try:
        result = await plan_budget(body.tenant_id, body.context_id, body.user_budget)
    except ContextNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return PlanResponse(**result)
