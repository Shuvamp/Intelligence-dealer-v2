"""Marketing Strategy Advisor (Context Planner sub-module).

Reads a context's most recent analysis (company summary + generated report)
read-only and asks Groq for a prioritized list of growth/marketing strategies
— events, influencer/celebrity collaborations, campaigns, partnerships,
sponsorships, content, local promotions, and so on. Stateless: nothing is
persisted; suggestions are generated on demand, mirroring how the report
narratives are produced (Groq → deterministic fallback, never raises).
"""
