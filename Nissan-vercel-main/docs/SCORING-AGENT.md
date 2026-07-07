# Scoring Agent — Holistic, md-rubric driven (CSRIRAM, node 3)

> **For the merging agent:** this branch (`sriram`) upgrades the **score** stage of the
> lead intake pipeline. Read this before merging — it lists exactly which files changed,
> which are *owner-only* (safe) vs *shared* (need a careful merge), and how to run it.

## What changed in one line

The score node now delegates to a **Python LangGraph scoring agent** (`apps/api`) that makes
**one Groq LLM call** scored against the **md framework files** in `docs/scoring_agent_md/`,
returning the full 8-dimension breakdown + category (**HOT+/HOT/WARM/COLD/DEAD**). The JS
pipeline is untouched in structure; the score node just HTTP-calls the agent and maps the
result to the team contract, with a deterministic fallback so the pipeline never breaks.

## ⭐ MERGE GUIDE — merging `sriram` INTO `lead-management`

> Partha merges with **base = `lead-management`**, **incoming = `sriram`**. The goal is to
> plug this real scoring agent into the Python intake pipeline `lead-management` already has,
> whose node 3 (`agents/intake_pipeline/nodes/score.py`) is currently a `TODO(CSRIRAM)` stub.

### Step 1 — Resolve the ONE conflict: `apps/api/main.py`
Everything else auto-merges. `main.py` conflicts because both branches added endpoints.

**Keep `lead-management`'s `main.py`** — it has the production intake path (`/intake/leads`,
`/intake/stream` SSE, Supabase persist) that `sriram` does not. You do **not** need `sriram`'s
`main.py` (its `/score` HTTP endpoint is unnecessary once the pipeline calls the agent
in-process — see Step 2). From the repo root during the merge:

```bash
git checkout --ours apps/api/main.py      # keep lead-management's main.py
git add apps/api/main.py
```

*(Optional)* if you also want HTTP access to the agent, additionally copy `sriram`'s
`/score` and `/validate-and-score` handlers into that file — they don't clash with the
intake endpoints.

### Step 2 — Plug the agent into the pipeline (the actual integration)
Replace the stub body of `apps/api/agents/intake_pipeline/nodes/score.py` with a call to the
ready-made integration surface `agents/scoring/service.py` (added on this branch):

```python
# apps/api/agents/intake_pipeline/nodes/score.py
import asyncio
from agents.scoring.service import score_normalized_lead

async def score_node(state, deps):
    normalized = state.get("normalized") or {}
    # lead_scorer.invoke is sync; off-load so the Groq call doesn't block the loop
    scoring = await asyncio.get_event_loop().run_in_executor(
        None, score_normalized_lead, normalized
    )
    return {"scoring": scoring}
```

`score_normalized_lead(normalized)` → `{ score, score_value, reasons, detail }`. It bridges the
`NormalizedLead` (shapes already match), runs the holistic agent, and **never raises** (safe
default on failure), so the pipeline can't break. This gives ONE scoring implementation.

### Step 3 — Allow the `dead` band (small, optional but recommended)
`lead-management`'s `agents/intake_pipeline/contracts.py` types `Scoring.score` as
`Literal["hot","warm","cold"]` and `bucket_for` only returns those three. The agent can now
return `"dead"`. Add `"dead"` to that Literal (and, if you like, a `<15 → "dead"` branch in
`bucket_for`). The `leads.score` column is `VARCHAR`, so the DB already accepts it, and the web
UI on this branch already renders `dead`.

### Step 4 — `requirements.txt`
`sriram` adds `groq` to `apps/api/requirements.txt`. If the merge flags it, keep both lines
(append `groq`). Run `pip install -r apps/api/requirements.txt`.

### Step 5 — `CLAUDE.md` pointer (do it here, not on `sriram`)
`lead-management` also edits `CLAUDE.md`, so this branch deliberately left `CLAUDE.md` untouched
to avoid a second conflict. While resolving, add one line under the Lead Intake Pipeline section:
`- Scoring agent (node 3): see docs/SCORING-AGENT.md (holistic Groq + md rubric).`

### Files: clean vs. conflict
- **Auto-merge (additions, no conflict):** all of `apps/api/agents/scoring/` (incl. `service.py`,
  `knowledge.py`), `apps/api/agents/scoring_bridge.py`, `apps/local-api/agents/nodes/score.node.js`,
  the 3 web files, `docs/scoring_agent_md/`, this doc.
- **Conflict:** `apps/api/main.py` only (Step 1).
- **Manual integration after merge:** `intake_pipeline/nodes/score.py` (Step 2), `contracts.py` (Step 3).

---

## Flow

```
book-test-drive form / FB / IG
   → POST /intake/leads            (apps/local-api shim :54321)
   → JS pipeline: validate → normalize → SCORE → assign → DuckDB → SSE → board
                                       │
                                       └─ HTTP ─▶ Python /score (:8000)
                                                  LangGraph agent:
                                                  ingest_and_validate
                                                    → score_dimensions  ← ONE Groq call,
                                                                          compact md rubric
                                                    → aggregate_classify (caps + thresholds)
                                                    → (reasoning if needed)
                                                    → format_output (master JSON)
```

If Groq is unavailable / rate-limited / no key, `score_dimensions` falls back to the
deterministic per-dimension nodes (each with its own heuristic), so scoring always works
with zero config. The output field `scored_by` is `"groq_holistic"` or `"deterministic"`.

## Files changed on this branch

### Owner-only (CSRIRAM) — safe, no cross-team conflict
| File | Change |
|------|--------|
| `apps/api/agents/scoring/knowledge.py` | **NEW.** Loads the md rubric from `docs/scoring_agent_md/`. Compact by default (~8k tokens, fits Groq free-tier 12k/request); set `SCORING_RUBRIC_FULL=1` for the full rubric on a paid tier. |
| `apps/api/agents/scoring/nodes.py` | Added `score_dimensions` (holistic Groq call) + deterministic fallbacks for the LLM nodes (intent/sentiment/reasoning) so the agent runs without a key. `_llm` returns `None` instead of raising. |
| `apps/api/agents/scoring/graph.py` | Graph is now `ingest_and_validate → score_dimensions → aggregate_classify → (reasoning) → format_output`. |
| `apps/api/agents/scoring/state.py` | Added `scored_by`. |
| `apps/api/agents/scoring_bridge.py` | Added `validated_lead_to_scoring_input()` — maps the **lead_validator** categorical lead (`budget_range`, `purchase_timeframe`, …) into the agent's interaction notes (the existing `normalized_to_scoring_input` for the JS NormalizedLead is unchanged). |
| `apps/api/main.py` | Added `POST /validate-and-score` (chains lead_validator → scoring agent). `/score` and `/validate-lead` unchanged. |
| `apps/local-api/agents/nodes/score.node.js` | **CSRIRAM's node.** `categoryToBucket` now returns `dead` for DEAD (was collapsed into cold). Timeout raised 8s → 30s (holistic call is slower). |

### Shared — ⚠️ MERGE CAREFULLY (touched to surface the new `dead` band in the UI)
| File | Change | Merge note |
|------|--------|-----------|
| `apps/web/src/lib/types.ts` | `LeadScoreBand` now includes `'dead'`. | One-line union edit. |
| `apps/web/src/components/leads/lead-ui.tsx` | `SCORE_META` has a `dead` entry (gray skull badge) + a safe fallback in `ScoreBadge`. | If Partha's branch also edits `lead-ui.tsx`, keep both the `dead` meta and the fallback. |
| `apps/web/src/components/leads/BoardToolbar.tsx` | Added a **Dead** option to the score filter. | One-line array edit. |

### NOT touched (the locked files stay locked)
`apps/local-api/agents/lead-intake-agent.js` and `apps/local-api/agents/pipeline-contracts.js`
are unchanged. The score node still returns the exact contract `{ score, score_value, reasons }`
(full agent output preserved under `scoring.detail`).

### Also added
`docs/scoring_agent_md/` (11 md files) — the scoring framework. **These are loaded at runtime**
by `knowledge.py`, so they must be committed for holistic scoring to have a rubric.

## How to run

```bash
# 1. Python scoring agent (needs apps/api/.env with GROQ_API_KEY — see .env.example)
cd apps/api
pip install -r requirements.txt
python -m uvicorn main:app --port 8000

# 2. shim + web (from repo root)
npm run dev          # or: npm run dev:api   /   npm run dev:web
```

- Submit at `http://localhost:3000/book-test-drive`; view on **Leads** (`owner@abcnissan.test` / `Passw0rd!23`).
- Score band shows Hot / Warm / Cold / **Dead** from the agent's `category`.

## Environment variables (apps/api/.env)

| Var | Purpose | Default |
|-----|---------|---------|
| `GROQ_API_KEY` | Groq key for the LLM nodes. Without it → deterministic fallback. | — |
| `SCORING_RUBRIC_FULL` | `1` = send the entire md rubric per call (paid tier only; ~46k tokens). | off (compact ~8k) |
| `SCORING_RUBRIC_DIR` | Override the rubric folder. | `docs/scoring_agent_md` |
| `SCORING_API_URL` (shim side) | Where score.node.js calls the agent. | `http://localhost:8000` |

## Known limits (Groq free tier)

- **12,000 tokens / request** → the *full* rubric (~46k) can't run; the **compact** rubric (~8k) does. Keep `SCORING_RUBRIC_FULL` off unless on a paid tier.
- **~12k tokens / minute** and **100k / day** → roughly 1 holistic lead/min and ~10/day before calls fall back to `deterministic`. The fallback is silent and safe.
