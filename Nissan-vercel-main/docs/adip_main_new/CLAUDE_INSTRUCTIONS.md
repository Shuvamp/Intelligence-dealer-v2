# Claude Instructions

Always read:

- ADIP_MASTER_PLAN.md
- ARCHITECTURE_RULES.md

Development Rules:

1. Never rewrite working code.
2. Modify only required files.
3. Keep backward compatibility.
4. Use existing project patterns.
5. Prefer small focused changes.
6. Produce implementation plan before coding.
7. Never implement future phases.
8. Add tests for every feature.
9. Add database migrations.
10. Update documentation.
11. Follow existing LangGraph architecture.
12. Follow existing FastAPI patterns.
13. Use DuckDB locally.
14. Design for Supabase compatibility.
15. All agent actions must be persisted.
16. All failures must be logged.
17. Every phase must be independently deployable.

Output Format:

1. Analysis
2. Files Impacted
3. Implementation Plan
4. Risks
5. Code Changes
6. Test Plan