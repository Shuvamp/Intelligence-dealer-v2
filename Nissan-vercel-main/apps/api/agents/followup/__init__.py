"""Follow-up Agent (Csriram/team) — decides the next best action for a lead,
drafts an outreach message, logs an NBA event, and notifies the assignee.

Adapted to this branch: data access is over Supabase/PostgREST and the LLM is
Groq with a deterministic fallback — matching how the scoring and intake
agents work here.
"""
from .graph import run_followup_agent

__all__ = ["run_followup_agent"]
