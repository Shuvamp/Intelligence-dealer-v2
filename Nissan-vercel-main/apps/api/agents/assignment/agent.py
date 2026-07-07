"""LangGraph-based Assignment Agent (Python) — OWNER: KEERTHANA.

Assigns a scored lead to the best-available sales executive:
  fetch_executives → select_executive → assign_lead → prioritize_queue → notify

Selection is least-loaded with capacity limits; uses Claude when
ANTHROPIC_API_KEY is set, otherwise a deterministic least-loaded fallback.
See docs/ASSIGNMENT-AGENT.md.
"""

import json
from typing import Optional, Dict, Any
from uuid import uuid4
from datetime import datetime

from langgraph.graph import StateGraph, START, END
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from pydantic import BaseModel, Field

try:
    import anthropic
except Exception:  # anthropic is optional — fallback path doesn't need it
    anthropic = None

from .database import Database


# ─── State Schema ──────────────────────────────────────────────────────────

class AssignmentState(BaseModel):
    """State for assignment workflow."""

    tenant_id: str
    lead_id: str
    score: str  # hot, warm, cold
    available_executives: Optional[list] = None
    selected_executive: Optional[Dict[str, Any]] = None
    assignment_id: Optional[str] = None
    status: str = "pending"  # pending, fetching, selecting, assigning, completed, failed
    error: Optional[str] = None
    messages: list = Field(default_factory=list)

    class Config:
        arbitrary_types_allowed = True


# ─── Agent ────────────────────────────────────────────────────────────────

class AssignmentAgent:
    """LangGraph-based assignment agent."""

    def __init__(self, db: Database, anthropic_api_key: Optional[str] = None):
        self.db = db
        self.client = (
            anthropic.Anthropic(api_key=anthropic_api_key)
            if (anthropic and anthropic_api_key)
            else None
        )
        self.graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(AssignmentState)

        graph.add_node("fetch_executives", self._fetch_executives_node)
        graph.add_node("select_executive", self._select_executive_node)
        graph.add_node("assign_lead", self._assign_lead_node)
        graph.add_node("prioritize_queue", self._prioritize_queue_node)
        graph.add_node("notify", self._notify_node)

        graph.add_edge(START, "fetch_executives")
        graph.add_edge("fetch_executives", "select_executive")
        graph.add_edge("select_executive", "assign_lead")
        graph.add_edge("assign_lead", "prioritize_queue")
        graph.add_edge("prioritize_queue", "notify")
        graph.add_edge("notify", END)

        return graph.compile()

    async def _fetch_executives_node(self, state: AssignmentState) -> AssignmentState:
        sql = """
            SELECT id, name, current_lead_count, max_lead_limit
            FROM sales_executives
            WHERE tenant_id = ? AND status = 'active'
            ORDER BY current_lead_count ASC
        """
        executives = await self.db.fetch_all(sql, (state.tenant_id,))

        if not executives:
            return AssignmentState(
                **state.model_dump(),
                status="failed",
                error="No active executives found",
            )

        return AssignmentState(
            **{k: v for k, v in state.model_dump().items() if k not in ("available_executives", "status")},
            available_executives=executives,
            status="selecting",
        )

    async def _select_executive_node(self, state: AssignmentState) -> AssignmentState:
        selection = None

        if self.client:
            try:
                prompt = f"""You are an assignment agent. Assign a lead to the best sales executive.

Lead Details:
- Lead ID: {state.lead_id}
- Score: {state.score} (hot = high priority, warm = medium, cold = low)

Available Executives:
{chr(10).join(
    f"- {e['name']}: {e['current_lead_count']}/{e['max_lead_limit']} leads "
    f"({round((e['current_lead_count'] / e['max_lead_limit']) * 100)}% utilized)"
    for e in state.available_executives
)}

Rules for assignment:
1. DO NOT assign to executives at or over their limit
2. Prefer executives with lowest current load
3. For hot leads, consider slightly higher load (they close faster)
4. Provide reasoning for your choice

Respond with JSON: {{"executive_id": "uuid", "executive_name": "name", "reasoning": "why"}}"""

                message = self.client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=200,
                    messages=[{"role": "user", "content": prompt}],
                )
                selection = json.loads(message.content[0].text)
            except Exception as err:
                print(f"Claude API error, falling back: {err}")
                selection = None

        # Fallback: least-loaded under capacity
        if not selection:
            available = [
                e for e in state.available_executives
                if e["current_lead_count"] < e["max_lead_limit"]
            ]
            if not available:
                return AssignmentState(
                    **{k: v for k, v in state.model_dump().items() if k not in ("status", "error")},
                    status="failed",
                    error="No available executives (all at capacity)",
                )
            selected = available[0]
            selection = {
                "executive_id": selected["id"],
                "executive_name": selected["name"],
                "reasoning": f"Least-loaded fallback: {selected['current_lead_count']}/{selected['max_lead_limit']}",
            }

        selected_exec = next(
            (e for e in state.available_executives if e["id"] == selection["executive_id"]),
            None,
        )
        if not selected_exec:
            return AssignmentState(
                **{k: v for k, v in state.model_dump().items() if k not in ("status", "error")},
                status="failed",
                error=f"Executive not found: {selection['executive_id']}",
            )

        return AssignmentState(
            **{k: v for k, v in state.model_dump().items() if k not in ("selected_executive", "status")},
            selected_executive={
                "id": selection["executive_id"],
                "name": selection["executive_name"],
                "current_load": f"{selected_exec['current_lead_count'] + 1}/{selected_exec['max_lead_limit']}",
                "reasoning": selection["reasoning"],
            },
            status="assigning",
        )

    async def _assign_lead_node(self, state: AssignmentState) -> AssignmentState:
        if not state.selected_executive:
            return AssignmentState(
                **{k: v for k, v in state.model_dump().items() if k != "status"},
                status="failed",
            )
        try:
            assignment_id = str(uuid4())
            now = datetime.utcnow().isoformat() + "Z"
            priority = {"hot": 3, "warm": 2, "cold": 1}.get(state.score, 1)

            await self.db.execute(
                "INSERT INTO lead_assignments VALUES (?, ?, ?, ?, ?, ?, ?)",
                (assignment_id, state.tenant_id, state.lead_id,
                 state.selected_executive["id"], state.score, priority, now),
            )
            await self.db.execute(
                "UPDATE sales_executives SET current_lead_count = current_lead_count + 1 WHERE id = ?",
                (state.selected_executive["id"],),
            )
            return AssignmentState(
                **{k: v for k, v in state.model_dump().items() if k not in ("assignment_id", "status")},
                assignment_id=assignment_id,
                status="assigning",
            )
        except Exception as err:
            return AssignmentState(
                **{k: v for k, v in state.model_dump().items() if k not in ("status", "error")},
                status="failed",
                error=str(err),
            )

    async def _prioritize_queue_node(self, state: AssignmentState) -> AssignmentState:
        if state.status != "assigning":
            return state
        try:
            priority = {"hot": 3, "warm": 2, "cold": 1}.get(state.score, 1)
            await self.db.execute(
                "UPDATE lead_assignments SET priority_rank = ? WHERE assignment_id = ?",
                (priority, state.assignment_id),
            )
        except Exception as err:
            print(f"Non-critical priority error: {err}")
        return AssignmentState(
            **{k: v for k, v in state.model_dump().items() if k != "status"},
            status="completed",
        )

    async def _notify_node(self, state: AssignmentState) -> AssignmentState:
        if state.status != "completed":
            return state
        try:
            notification_id = str(uuid4())
            now = datetime.utcnow().isoformat() + "Z"
            await self.db.execute(
                "INSERT INTO assignment_notifications VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (notification_id, state.tenant_id, state.lead_id,
                 state.selected_executive["id"], "lead_assigned",
                 f"Lead {state.lead_id} ({state.score}) assigned to {state.selected_executive['name']}",
                 False, now),
            )
        except Exception as err:
            print(f"Notification error: {err}")
        return state

    async def assign_lead_with_graph(self, tenant_id: str, lead: Dict[str, str]) -> Dict[str, Any]:
        """Execute assignment workflow and return result."""
        initial_state = AssignmentState(
            tenant_id=tenant_id,
            lead_id=lead["lead_id"],
            score=lead["score"],
            status="pending",
        )
        final_state = await self.graph.ainvoke(initial_state)
        # langgraph returns a dict-like; normalize access
        sel = final_state["selected_executive"] if isinstance(final_state, dict) else final_state.selected_executive
        status = final_state["status"] if isinstance(final_state, dict) else final_state.status
        assignment_id = final_state["assignment_id"] if isinstance(final_state, dict) else final_state.assignment_id
        error = final_state["error"] if isinstance(final_state, dict) else final_state.error
        return {
            "success": status == "completed",
            "lead_id": lead["lead_id"],
            "assigned_to": sel.get("name") if sel else None,
            "executive_id": sel.get("id") if sel else None,
            "score": lead["score"],
            "current_load": sel.get("current_load") if sel else None,
            "assignment_id": assignment_id,
            "error": error,
            "reasoning": sel.get("reasoning") if sel else None,
        }
