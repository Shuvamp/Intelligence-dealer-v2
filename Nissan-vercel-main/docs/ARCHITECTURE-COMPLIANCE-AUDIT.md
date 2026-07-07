# Architecture Compliance Audit: Assignment Agent

**Date:** 2026-06-09  
**Audit Status:** ⚠️ **NON-COMPLIANT**  
**Severity:** High — Foundation Architecture Mismatch

---

## Executive Summary

The Assignment Agent implementation **DOES NOT comply** with the Nissan Project team standard architecture. Critical components are built in the wrong technology stack.

| Component | Standard | Current | Status |
|-----------|----------|---------|--------|
| **Frontend** | TanStack Start (React) | TanStack Start (React) | ✅ PASS |
| **Backend API** | FastAPI (Python) | Node.js Express | ❌ FAIL |
| **AI/Agents** | LangGraph (Python) | LangGraph.js (Node.js) | ❌ FAIL |
| **Dev DB** | DuckDB | DuckDB | ✅ PASS |
| **Prod DB** | Supabase PostgreSQL | Supabase PostgreSQL | ✅ PASS |

**Compliance Score: 60% (3/5 components)**

---

## Detailed Findings

### ❌ BACKEND API — NON-COMPLIANT

**Standard:** FastAPI (Python)  
**Current:** Node.js Express (JavaScript)

#### Issues

1. **Wrong Framework**
   - Using `Express.js` instead of `FastAPI`
   - Location: `apps/local-api/server.js`
   - Issue: Violates architecture specification

2. **Wrong Language**
   - Using JavaScript instead of Python
   - Incompatible with Python-based team stack
   - Makes Python agent integration awkward

3. **Missing Directory Structure**
   - Using `apps/local-api` instead of `apps/api`
   - Should follow FastAPI convention in `apps/api`
   - Violates CLAUDE.md specification

4. **API Routes**
   - POST /api/assign-lead
   - GET /api/executives
   - GET /api/executives/:id/queue
   - POST /api/complete-lead
   - etc.
   
   All implemented in Node.js instead of Python/FastAPI

---

### ❌ AI/AGENTS — NON-COMPLIANT

**Standard:** LangGraph (Python)  
**Current:** LangGraph.js (JavaScript)

#### Issues

1. **Wrong LangGraph Implementation**
   - Using `@langchain/langgraph` (JavaScript)
   - Should use `langchain` (Python)
   - Location: `apps/local-api/agents/assignmentAgentGraph.js`

2. **Agent Integration Problem**
   - Python FastAPI backend cannot directly call JavaScript agents
   - Requires HTTP/IPC bridge (architectural smell)
   - Violates co-location principle

3. **Technology Fragmentation**
   - AI team writes Python agents
   - Backend team writes Node.js APIs
   - Creates maintenance and testing burden

---

### ✅ FRONTEND — COMPLIANT

**Status:** ✅ PASS

- Using TanStack Start (React) as specified
- No business logic in frontend
- Properly delegates to backend API

---

### ✅ DATABASES — COMPLIANT

**Status:** ✅ PASS

- Development: DuckDB
- Production: Supabase PostgreSQL
- Schema: Multi-tenant with `tenant_id`

---

## Impact Analysis

### Current State (Non-Compliant)

```
Frontend (React)
    ↓ HTTP
Node.js Express (local-api/server.js)
    ├─ DuckDB (in-process)
    └─ LangGraph.js (in-process)
```

**Problems:**
- Cannot scale: agents need to be in separate service
- Cannot scale: JavaScript event loop limits concurrent assignments
- Cannot integrate with Python-based validate/scoring agents
- Maintenance nightmare: multiple languages in single stack

---

### Target State (Compliant)

```
Frontend (React)
    ↓ HTTP
FastAPI Backend (apps/api/main.py)
    ├─ DuckDB (local-dev) / Supabase (prod)
    ├─ LangGraph Assignment Agent (Python)
    ├─ LangGraph Validate Agent (Python)
    └─ LangGraph Scoring Agent (Python)
```

**Benefits:**
- Scalable: Python agents can run in separate service
- Unified stack: all agents in Python
- Easy integration: validate → score → assign workflow
- Standard ecosystem: FastAPI, Pydantic, LangChain all Python

---

## Migration Requirements

### Phase 1: Create FastAPI Backend

**Effort:** 3-4 days  
**Scope:**
- Create `apps/api/` directory structure
- Set up FastAPI with Pydantic models
- Implement all endpoints currently in Node.js
- Mirror DuckDB connection logic

**Files to Create:**
```
apps/api/
├── main.py                 (FastAPI app)
├── requirements.txt        (Python deps)
├── config.py              (settings, env)
├── database.py            (DuckDB connection)
├── auth.py                (JWT validation)
├── routers/
│   └── assignments.py     (all assignment endpoints)
├── models/
│   └── assignment.py      (Pydantic models)
└── tests/
    └── test_assignments.py
```

---

### Phase 2: Migrate LangGraph to Python

**Effort:** 2-3 days  
**Scope:**
- Rewrite `assignmentAgentGraph.js` in Python
- Use `langchain.langgraph` (Python)
- Port all tool definitions
- Port state schema

**Files to Create:**
```
apps/api/agents/
├── __init__.py
├── assignment_agent.py    (LangGraph in Python)
└── test_assignment.py
```

**Python LangGraph Equivalent:**

```python
from langgraph.graph import StateGraph, START, END
from langchain.tools import tool
from anthropic import Anthropic

class AssignmentAgentGraph:
    def __init__(self, db_conn):
        self.db = db_conn
        self.client = Anthropic()
    
    def build_graph(self):
        graph = StateGraph(AssignmentState)
        graph.add_node("fetch_executives", self.fetch_executives_node)
        graph.add_node("select_executive", self.select_executive_node)
        graph.add_node("assign_lead", self.assign_lead_node)
        graph.add_node("prioritize_queue", self.prioritize_queue_node)
        graph.add_node("notify", self.notify_node)
        
        graph.add_edge(START, "fetch_executives")
        graph.add_edge("fetch_executives", "select_executive")
        graph.add_edge("select_executive", "assign_lead")
        graph.add_edge("assign_lead", "prioritize_queue")
        graph.add_edge("prioritize_queue", "notify")
        graph.add_edge("notify", END)
        
        return graph.compile()
```

---

### Phase 3: Deprecate Node.js Backend

**Effort:** 1 day  
**Scope:**
- Remove `apps/local-api`
- Update environment configs
- Update documentation

---

## Migration Path

### Option A: Quick Migration (Recommended)

1. **Week 1:** Create FastAPI app with all endpoints (1:1 port from Node.js)
2. **Week 2:** Migrate LangGraph to Python
3. **Week 3:** Test integration with Amirtha's validate agent + Sriram's scoring agent
4. **Week 4:** Deprecate Node.js backend

**Total:** ~2 weeks  
**Risk:** Low (parallel development, easy rollback)

---

### Option B: Gradual Migration

1. Keep Node.js for now
2. Create `apps/api` skeleton with one endpoint
3. Migrate incrementally (one endpoint/agent per day)
4. Cut over when 80% done

**Total:** ~3 weeks  
**Risk:** Medium (long transition period, dual maintenance)

---

## Specific Gaps to Address

### 1. Backend API Endpoints

**Current (Node.js):**
```javascript
app.post('/api/assign-lead', async (req, res) => { ... })
app.get('/api/executives', async (req, res) => { ... })
app.get('/api/executives/:id/queue', async (req, res) => { ... })
```

**Target (FastAPI):**
```python
@router.post("/assign-lead")
async def assign_lead(lead: AssignLeadRequest, token: str = Depends(verify_jwt)) -> AssignmentResponse:
    ...

@router.get("/executives")
async def get_executives(token: str = Depends(verify_jwt)) -> List[Executive]:
    ...

@router.get("/executives/{id}/queue")
async def get_executive_queue(id: str, token: str = Depends(verify_jwt)) -> List[QueuedLead]:
    ...
```

---

### 2. Agent Invocation

**Current (in-process JavaScript):**
```javascript
const result = await assignmentAgentGraph.assignLeadWithGraph(tenantId, lead)
```

**Target (Python):**
```python
from agents.assignment_agent import AssignmentAgent

agent = AssignmentAgent(db_conn)
result = await agent.assign_lead_with_graph(tenant_id, lead)
```

---

### 3. Testing

**Current (JavaScript):**
```javascript
node apps/local-api/agents/assignmentAgentGraph.test.js
```

**Target (Python):**
```bash
pytest apps/api/agents/test_assignment_agent.py
# or
python -m pytest apps/api/tests/ -v
```

---

## Risk Assessment

### High Risk (If Not Migrated)

1. **Scaling Bottleneck**
   - Node.js single thread cannot handle multiple concurrent assignments
   - Python agents (Amirtha's validate, Sriram's scoring) will be blocked

2. **Integration Nightmare**
   - Validate Agent (Python) → Assignment Agent (JavaScript) mismatch
   - Requires network calls instead of direct function calls
   - Performance degradation

3. **Maintenance Burden**
   - Three teammates on different stacks:
     - Amirtha: Python (validate)
     - Sriram: Python (scoring)
     - You: JavaScript (assignment)
   - No code reuse between agents
   - Testing requires mocking across language boundaries

4. **Team Velocity**
   - Each bug fix touches multiple languages
   - Onboarding new team members harder
   - Code review requires multiple language experts

---

### Effort to Migrate

| Task | Effort | Blocker |
|------|--------|---------|
| FastAPI skeleton | 1 day | No |
| Port API endpoints | 2 days | No |
| Migrate LangGraph | 2 days | No |
| Integration testing | 1 day | No |
| Deprecate Node.js | 0.5 day | No |
| **TOTAL** | **~6-7 days** | **No** |

---

## Recommendations

### ✅ IMMEDIATE (Required for Compliance)

1. **Create `apps/api/` directory** — Start FastAPI project
2. **Port all endpoints** — Move from Node.js to FastAPI
3. **Migrate LangGraph** — Rewrite agent in Python
4. **Integration test** — Verify works with validate + scoring agents

### Timeline

- **By end of Week 1:** FastAPI skeleton + endpoints
- **By end of Week 2:** LangGraph migration + testing
- **Week 3:** Full integration with other agents

---

## Files That Need to be Created/Modified

### New Files (FastAPI)

```
apps/api/
├── main.py
├── requirements.txt
├── config.py
├── database.py
├── auth.py
├── routers/assignments.py
├── models/assignment.py
├── models/lead.py
├── models/executive.py
├── agents/assignment_agent.py
├── agents/__init__.py
└── tests/test_assignment_agent.py
```

### Files to Deprecate

```
apps/local-api/          ← REMOVE ENTIRELY
  └── agents/assignmentAgent.js
  └── agents/assignmentAgentGraph.js
  └── server.js
  └── package.json
```

### Files to Update

```
apps/web/.env.local      ← Point to FastAPI instead
apps/web/src/lib/assignments.ts  ← No changes needed (API-agnostic)
CLAUDE.md                ← Already specifies FastAPI
```

---

## Compliance Checklist

- [ ] `apps/api/` directory created
- [ ] FastAPI `main.py` with all endpoints
- [ ] Python `requirements.txt` with FastAPI, LangGraph, Anthropic SDK
- [ ] DuckDB connection in Python
- [ ] JWT validation in Python
- [ ] All assignment endpoints ported
- [ ] LangGraph agent rewritten in Python
- [ ] Tests passing (pytest)
- [ ] Integration with validate agent verified
- [ ] Integration with scoring agent verified
- [ ] `apps/local-api` deprecated/removed
- [ ] Documentation updated

---

## Conclusion

**Status:** ⚠️ Non-Compliant (Architecture Mismatch)

**Action Required:** Migrate to FastAPI + Python LangGraph

**Effort:** 6-7 days of focused work

**Timeline:** Complete by end of next sprint

**Blocker for:** Integration with Amirtha's validate agent and Sriram's scoring agent

**Recommendation:** Start FastAPI migration immediately to unblock multi-agent workflow orchestration.

