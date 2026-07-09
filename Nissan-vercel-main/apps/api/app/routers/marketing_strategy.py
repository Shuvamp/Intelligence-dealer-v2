"""Marketing Strategy Advisor API — a Context Planner sub-module.

Stateless: given a context_id, reads that context's most recent analysis
(company summary + generated report) read-only and returns a Groq-generated
(deterministic-fallback) list of growth/marketing strategies. One bounded LLM
call, so POST is synchronous — no polling, no persistence.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents.marketing_strategy.service import ContextNotFound, suggest_strategies

router = APIRouter()


class SuggestRequest(BaseModel):
    tenant_id: str
    context_id: str


class Strategy(BaseModel):
    title: str
    category: str
    description: str
    reason: str
    expected_impact: str
    priority: str


class SuggestResponse(BaseModel):
    context_id: str
    status: str
    engine: str | None = None
    strategies: list[Strategy] = []
    errors: list[str] = []


@router.post("/suggest", response_model=SuggestResponse)
async def suggest_endpoint(body: SuggestRequest) -> SuggestResponse:
    try:
        result = await suggest_strategies(body.tenant_id, body.context_id)
    except ContextNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return SuggestResponse(**result)
