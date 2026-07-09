"""AI Marketing Budget Planner — a Context Planner sub-module.

Stateless: given a context_id + the user's monthly budget, reads that context's
most recent stored analysis (company summary + generated report) read-only, then
produces a marketing BUDGET plan in INR:

  1. Derives a recommended monthly budget from the SEO/AEO scores + business category.
  2. Allocates it across digital-marketing activities (sums to the recommended budget).
  3. Optimizes the plan to fit the user's budget (included / deferred / excluded).
  4. Emits a comparison table + an executable task list + strategic recommendations.

The numbers are computed DETERMINISTICALLY (guaranteeing the allocation sums and the
"never exceed the user budget" rule); Groq only refines the narrative prose. So the
feature works locally with no API key. It performs NO SEO/AEO analysis and recalculates
NO scores — it consumes the stored analysis only.
"""
