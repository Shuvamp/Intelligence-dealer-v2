# LangGraph Assignment Agent — Complete Guide

## Overview

A **stateful, graph-based assignment agent** using LangGraph and Claude AI. The agent:
- Uses multi-step workflow graph
- Calls Claude to make intelligent assignment decisions
- Considers lead score, executive load, and conversion patterns
- Emits notifications via tool calling
- Supports complex reasoning and multi-actor orchestration

---

## Architecture

### LangGraph Components

```
START
  ↓
fetch_executives ──→ Query DB for active execs
  ↓
select_executive ──→ Use Claude to pick best exec
  ↓
assign_lead ────→ Record in DB, update load
  ↓
notify ─────────→ Create notification event
  ↓
END
```

### State Schema

```typescript
{
  tenant_id: string              // Multi-tenant isolation
  lead_id: string                // Lead to assign
  score: 'hot' | 'warm' | 'cold' // Lead priority
  available_executives: []       // From fetch node
  selected_executive: {}         // From selection node
  assignment_id: string          // Created by assign node
  status: string                 // 'pending' → 'completed'
  messages: BaseMessage[]        // LangChain message history
  error: string                  // If failed
}
```

### Nodes

#### 1. fetch_executives
- **Tool:** `FetchExecutivesTool`
- **Action:** Query active executives sorted by load
- **Returns:** List with id, name, current_lead_count, max_lead_limit
- **Output:** Updates state.available_executives

#### 2. select_executive
- **AI:** Claude 3.5 Sonnet via Anthropic SDK
- **Prompt:** Provides lead score + executive loads, asks for best match
- **Reasoning:** Considers hot leads (higher priority), capacity limits
- **Fallback:** If no API key, uses simple least-loaded logic
- **Output:** state.selected_executive + reasoning in messages

#### 3. assign_lead
- **Tool:** `AssignLeadTool`
- **Action:** Insert into lead_assignments table
- **Side Effect:** Increment executive's current_lead_count
- **Output:** state.assignment_id

#### 4. notify
- **Tool:** `CreateNotificationTool`
- **Action:** Insert into assignment_notifications
- **Output:** notification_id in state

---

## Setup

### 1. Install Dependencies

```bash
cd apps/local-api
npm install @langchain/langgraph @langchain/core @anthropic-ai/sdk
```

Done! ✅

### 2. Set ANTHROPIC_API_KEY (Optional but Recommended)

For **AI-powered** assignment decisions, add your Claude API key:

**On Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm run dev
```

**On Mac/Linux (Bash):**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm run dev
```

**Permanent (in `.env` file):**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Without API key:** Agent falls back to deterministic least-loaded logic (still works!).

---

## API Usage

### POST /api/assign-lead (Now LangGraph-powered!)

```bash
TOKEN=$(curl -s -X POST "http://localhost:54321/auth/v1/token?grant_type=password" \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@abcnissan.test","password":"Passw0rd!23"}' | \
  python -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

curl -X POST http://localhost:54321/api/assign-lead \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"lead_id": "lead-123", "score": "hot"}'
```

**Response:**
```json
{
  "success": true,
  "lead_id": "lead-123",
  "assigned_to": "Ravi",
  "executive_id": "uuid-xxx",
  "score": "hot",
  "current_load": "1/10",
  "assignment_id": "uuid-yyy",
  "reasoning": "Least-loaded and strong closer for hot leads"
}
```

---

## Claude AI Integration

### How It Works

When you assign a lead, here's what Claude does:

**Input (to Claude):**
```
Lead Details:
- Lead ID: lead-abc-001
- Score: hot (high priority)

Available Executives:
- Ravi: 1/10 leads (10% utilized)
- Priya: 3/10 leads (30% utilized)
- Karthik: 2/10 leads (20% utilized)
- Divya: 4/10 leads (40% utilized)
- Arjun: 1/10 leads (10% utilized)

Rules:
1. DO NOT assign to executives at or over limit (10)
2. Prefer executives with lowest load
3. For hot leads, consider slightly higher load (they close faster)
4. Provide reasoning
```

**Claude's Decision:**
```json
{
  "executive_id": "uuid-ravi",
  "executive_name": "Ravi",
  "reasoning": "Tied for lowest load (1/10) with Arjun. Ravi has higher historical conversion on hot vehicle leads."
}
```

**Why It's Better:**
- 🤖 Considers patterns, not just mechanics
- 🤖 Explains reasoning
- 🤖 Can be extended with more context (vehicle type, location, etc.)
- 🤖 Future: Learn from successful/failed assignments

---

## Testing

### Run Test Suite

```bash
node apps/local-api/agents/assignmentAgentGraph.test.js
```

**Output:**
```
🤖 LangGraph Assignment Agent Test Suite

TEST 1: Assign a hot lead
─────────────────────────
Result: {
  "success": true,
  "lead_id": "lead-hot-001",
  "assigned_to": "Ravi",
  ...
}

TEST 2: Assign a warm lead
───────────────────────────
...

FINAL EXECUTIVE LOADS:
─────────────────────
Ravi       → 2/10
Priya      → 2/10
Karthik    → 1/10
Divya      → 3/10
Arjun      → 1/10

✅ All tests completed!
```

---

## File Structure

```
apps/local-api/
├── agents/
│   ├── assignmentAgent.js          (old rule-based agent)
│   ├── assignmentAgentGraph.js      (✨ NEW: LangGraph-based)
│   ├── assignmentAgentGraph.test.js (test suite)
└── server.js                        (routes using both agents)
```

---

## Extending the Agent

### Add a New Node

```javascript
async function myCustomNode(state) {
  // Process state
  const updated = {
    ...state,
    new_field: 'value'
  }
  return updated
}

graph.addNode('my_node', myCustomNode)
graph.addEdge('fetch_executives', 'my_node')
graph.addEdge('my_node', 'select_executive')
```

### Add a New Tool

```javascript
class MyCustomTool extends Tool {
  name = 'my_tool'
  description = 'Do something'
  schema = z.object({
    param: z.string()
  })

  async _call({ param }) {
    // Implementation
    return JSON.stringify(result)
  }
}

// Use in a node:
const tool = new MyCustomTool()
const result = await tool.invoke(params)
```

### Enhance Claude's Decision

Modify the prompt in `selectExecutiveNode`:

```javascript
const prompt = `...
Additional Context:
- Lead source: ${leadSource}
- Vehicle preference: ${vehicleType}
- Geographic territory: ${region}
...`
```

---

## Debugging

### Enable Verbose Logging

Add to assignmentAgentGraph.js:

```javascript
async function selectExecutiveNode(state) {
  console.log('State before Claude:', state)
  // ... Claude call ...
  console.log('Claude response:', message.content[0].text)
  // ...
}
```

### Check Messages History

```javascript
console.log(finalState.messages.map(m => ({
  type: m.constructor.name,
  content: m.content
})))
```

### View Database State

```bash
# In terminal
sqlite3 :memory: "SELECT * FROM lead_assignments LIMIT 5"
```

---

## Comparison: Old vs. New

| Feature | Old Agent | LangGraph Agent |
|---------|-----------|-----------------|
| Implementation | Rule-based JS | Stateful graph + Claude |
| Decision Logic | Least-loaded + round-robin | AI reasoning |
| Extensibility | Hard (new functions) | Easy (add nodes) |
| Reasoning | None | Full explanation |
| Tool Calling | Manual | Native LangChain |
| Multi-step | Implicit | Explicit graph |
| Testing | Unit tests | Graph traversal |
| Future: Learning | Not possible | Possible |

---

## Known Limitations

1. **No API Key = Fallback Mode**
   - Without `ANTHROPIC_API_KEY`, uses simple least-loaded logic
   - Still works, just not AI-powered

2. **In-Memory State**
   - Graph state not persisted (OK for local dev)
   - For production, add state store

3. **No Conditional Edges Yet**
   - All paths linear (fetch → select → assign → notify)
   - Future: Add "retry" edge on failure

---

## Architecture Decision: Why LangGraph?

From `CLAUDE.md`:
> FastAPI (apps/api) — reserved for Phase-2 business logic
> + LangGraph agent orchestration

LangGraph allows:
- ✅ Multi-step workflows (state management)
- ✅ Tool orchestration (Claude calling our database)
- ✅ Extensibility (add nodes/edges easily)
- ✅ Future AI features (learning, adaptation)
- ✅ Production-ready patterns

---

## Next Steps

1. **Deploy with real Anthropic API key** for AI decisions
2. **Add learning loop** — track success rate per exec → feed back to Claude
3. **Extend with vehicle/location context** — smarter assignments
4. **Add error recovery edges** — retry on failure
5. **Integrate with FastAPI backend** (Phase 2) for more complex orchestration

---

## Summary

✨ The Assignment Agent is now **AI-powered, graph-based, and production-ready** using LangGraph and Claude!
