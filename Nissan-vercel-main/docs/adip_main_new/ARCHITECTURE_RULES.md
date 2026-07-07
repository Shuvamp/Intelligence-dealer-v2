# Architecture Rules

1. Frontend contains no business logic.
2. FastAPI owns all business logic.
3. LangGraph owns orchestration.
4. Agents communicate through events.
5. Every agent must have fallback logic.
6. Every action must be persisted.
7. Every failure must be logged.
8. DuckDB local, Supabase production.
9. Frontend never accesses database directly.
10. APIs must be OpenAPI documented.
11. All lead actions must be auditable.
12. Every agent execution must create timeline events.
13. Agent failures must not stop the platform.
14. Retry mechanisms required for external integrations.
15. Communication history must be retained.
16. Call transcripts must be retained.
17. Score history must be retained.
18. Assignment history must be retained.
19. Follow-up recommendations must be stored.
20. System must be fully dockerized.
