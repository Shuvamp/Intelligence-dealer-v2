# Lead Intake Pipeline — Team Guide

> **Stack:** FastAPI (Python) + LangGraph (Python). All agent nodes are Python async functions.
> Node.js pipeline (`apps/local-api/agents/`) is the old implementation — superseded by this Python version.

**Read this first.** It tells you exactly where your agent plugs in, what it
receives, what it must return, and how to test it without touching anyone else's code.

---

## The pipeline

Every lead — from the **Website form**, **Facebook demo**, or **Instagram demo** —
flows through ONE pipeline of 4 agent nodes, in this exact order:

```
                          POST /intake/leads  (FastAPI :8000)
                                  │
   Source ─▶  ┌──────────┐  ┌───────────┐  ┌────────┐  ┌────────┐
  (web/fb/ig) │ validate │─▶│ normalize │─▶│ score  │─▶│ assign │─▶ DuckDB
              └──────────┘  └───────────┘  └────────┘  └────────┘   (customers,
               AMIRTHA       PARTHA ✅    CSRIRAM    KEERTHANA      leads,
                  │                                                  notifications)
                  └─ errors? ─▶ STOP (HTTP 400, lead rejected)            │
                                                                          ▼
                                                          SSE broadcast → browser
                                                          (toast + board refresh)
```

Source: `apps/api/agents/intake_pipeline/`

- **One lead → one pipeline run.** No lead reaches the DB without passing through all nodes.
- A node only ever **adds** to the shared state; it never rewrites another node's output.
- If `validate` returns errors, the pipeline stops and the API responds `400`.

---

## Who owns what

| Node | Owner | File | Status |
|------|-------|------|--------|
| `validate`  | Amirtha   | `apps/api/agents/intake_pipeline/nodes/validate.py`  | stub (works) |
| `normalize` | Partha    | `apps/api/agents/intake_pipeline/nodes/normalize.py` | ✅ done |
| `score`     | Csriram   | `apps/api/agents/intake_pipeline/nodes/score.py`     | stub (works) |
| `assign`    | Keerthana | `apps/api/agents/intake_pipeline/nodes/assign.py`    | stub (works) |
| orchestrator | Partha   | `apps/api/agents/intake_pipeline/graph.py`           | ✅ — do not edit |
| contract     | shared    | `apps/api/agents/intake_pipeline/contracts.py`       | ✅ — read-only |

> **You edit only your one node file.** That is why 4 people can work in parallel
> with zero merge conflicts. The orchestrator and contract are shared — don't touch them.

The pipeline already runs end-to-end **today** because every node ships with a
working baseline stub. You replace the `TODO(YOUR NAME)` block with your real agent.

---

## Your node's contract

Every node is a plain async function — **no LangGraph knowledge needed**:

```python
async def my_node(state: PipelineState, deps: NodeDeps) -> dict:
    # read from state
    # return ONLY your slice
    return { "scoring": { ... } }
```

### What you can read from `state`

| field | type | produced by |
|-------|------|-------------|
| `state.rawLead` | object | the source (raw form/demo data) |
| `state.source` | string | `'website' \| 'facebook' \| 'instagram'` |
| `state.normalized` | object | normalize node |
| `state.scoring` | object | score node |
| `state.assignment` | object | assign node |

### Fields captured from the source (on `rawLead`, cleaned onto `normalized`)

Every source — website form, Facebook & Instagram demos — now sends these. They
are stored on the `leads` row and are great scoring/assignment signals:

| raw field | normalized field | DB column | example values |
|-----------|------------------|-----------|----------------|
| `name` *(req)* | `name` | `customers.full_name` | "Ravi Kumar" |
| `phone` *(req)* | `phone` | `customers.phone` | "+91 99999 99999" |
| `email` | `email` | `customers.email` | "ravi@x.com" |
| `vehicle` | `vehicle` | `leads.vehicle_interest` | "Nissan Magnite" |
| `city` | `city` | — | "Chennai" |
| `test_drive` | `test_drive_required` | `leads.test_drive_required` | `true` / `false` |
| `budget` | `budget` | `leads.budget` | `700000` … `2800000` |
| `buy_timeline_days` | `buy_timeline_days` | `leads.purchase_timeline_days` | `7` (week) … `365` (exploring) |
| `callback_days` | `callback_days` | `leads.callback_within_days` | `1` (today) … `14` (no rush) |
| `contact_medium` | `contact_medium` | `leads.contact_medium` | "WhatsApp" / "Phone call" / "Email" / "SMS" |

> You only see what runs **before** you. `score` sees `normalized`; `assign` sees
> `normalized` + `scoring`; `validate` sees only `rawLead` + `source`.

### What your node must return

| Owner | Node | Must return |
|-------|------|-------------|
| Amirtha  | validate  | `{ errors: string[] }` — `[]` = pass, `['...']` = reject |
| Csriram  | score     | `{ scoring: { score, score_value, reasons } }` |
| Keerthana| assign    | `{ assignment: { assigned_to, assignee_name, reason } }` |

Exact field shapes (`NormalizedLead`, `Scoring`, `Assignment`) are documented in
`apps/api/agents/intake_pipeline/contracts.py`. **Do not rename fields** — the DB layer reads them by name.

### `deps` — what's injected into every node

```python
deps.supabase_url       # the hosted Supabase project's URL (from apps/api/.env)
deps.tenant_id          # the ABC tenant id (all intake leads belong here)
deps.anthropic_key      # ANTHROPIC_API_KEY, or None if not set
```

If you use Claude, **always provide a deterministic fallback** for when
`deps.anthropic_key` is `None` — local dev must work with zero config.

---

## How to test (3 levels)

### 1. Test YOUR node alone (fastest — no server needed)

```bash
cd apps/api
python -c "
import asyncio
from agents.intake_pipeline.nodes.score import score_node
from agents.intake_pipeline.contracts import NodeDeps

async def test():
    state = {'normalized': {'name':'Test','vehicle':'Magnite','email':'a@b.com','city':'Chennai','source':'website'}}
    deps = NodeDeps(supabase_url='<hosted project URL from apps/api/.env>', tenant_id='abc', anthropic_key=None)
    print(await score_node(state, deps))

asyncio.run(test())
"
```

### 2. Test the WHOLE pipeline in memory (all 4 nodes, no HTTP)

```bash
cd apps/api
python -c "
import asyncio
from agents.intake_pipeline.graph import intake_pipeline

async def test():
    result = await intake_pipeline.ainvoke({
        'raw_lead': {'name':'Ravi','phone':'9876543210','vehicle':'Magnite','city':'Chennai'},
        'source': 'website', 'errors': [], 'normalized': None, 'scoring': None, 'assignment': None
    })
    print(result)

asyncio.run(test())
"
```

### 3. Test the LIVE endpoint (full stack, exactly like production)

```bash
# start servers
cd apps/api && uvicorn main:app --port 8000
# submit lead
curl -X POST http://localhost:8000/intake/leads \
  -H "Content-Type: application/json" \
  -d '{"source":"website","name":"Test","phone":"9876543210","vehicle":"Magnite","city":"Chennai"}'
```

Then open **http://localhost:3000/login** (`owner@abcnissan.test` / `Passw0rd!23`)
→ go to **Leads**. Your lead appears with the score + assignee your node produced,
plus a toast. Facebook/Instagram demo leads arrive automatically every ~15–30s.

---

## Endpoint reference

| Method | Path | Server | Purpose |
|--------|------|--------|---------|
| POST | `/intake/leads` | FastAPI :8000 | Submit lead → pipeline → DB |
| GET  | `/intake/stream` | FastAPI :8000 | SSE stream — new_lead events |
| POST | `/validate-lead` | FastAPI :8000 | Amirtha's standalone validator |
| Web  | `/book-test-drive` | TanStack :3000 | Public form |

---

## Git workflow for teammates

```bash
git pull origin lead-management
cd apps/api
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload   # run it
# edit ONLY your node file: apps/api/agents/intake_pipeline/nodes/<your_node>.py
# test with levels above
git add apps/api/agents/intake_pipeline/nodes/<your_node>.py
git commit -m "feat(pipeline): real <your> agent"
```

**Rules**
1. Edit only your own `nodes/<your_node>.py` file.
2. Never change `contracts.py` or `graph.py` — if a contract
   needs to change, raise it with Partha so all 4 nodes stay in sync.
3. Keep the baseline behavior working (deterministic fallback, no hard crash) so
   the pipeline never breaks for the rest of the team.
