# Lead Priority Ranking Feature

## Overview

The Assignment Agent now supports **lead priority ranking** within each assigned sales executive's workload. After a lead is assigned to an executive, it's automatically prioritized based on its score (HOT, WARM, COLD) so high-value leads appear first in the work queue.

---

## Architecture

### Priority Ranking System

**Priority Mapping:**
```
HOT   = Priority 3 (highest)
WARM  = Priority 2 (medium)
COLD  = Priority 1 (lowest)
```

### Workflow (5-Node Graph)

```
START
  ↓
fetch_executives
  ↓
select_executive
  ↓
assign_lead         (Insert with priority value)
  ↓
prioritize_queue    (NEW: Reorder queue by priority)
  ↓
notify
  ↓
END
```

---

## Implementation Details

### 1. Database Schema Update

**Table: lead_assignments**

```sql
CREATE TABLE lead_assignments (
  assignment_id VARCHAR PRIMARY KEY,
  tenant_id VARCHAR,
  lead_id VARCHAR,
  executive_id VARCHAR,
  score VARCHAR,                    -- 'hot', 'warm', 'cold'
  priority_rank INTEGER DEFAULT 1,  -- NEW: 3=HOT, 2=WARM, 1=COLD
  assigned_at VARCHAR DEFAULT CURRENT_TIMESTAMP
)
```

**Migration:** Added `priority_rank` column to `lead_assignments` table.

---

### 2. LangGraph Nodes

#### Node: assign_lead
- Inserts assignment with `priority_rank` mapped from score
- Score to priority mapping done in `AssignLeadTool`
- Updated status to `'assigning'` (instead of `'completed'`)

```javascript
const priorityMap = { 'hot': 3, 'warm': 2, 'cold': 1 }
const priority = priorityMap[score] || 1

await run(
  `INSERT INTO lead_assignments VALUES (?,?,?,?,?,?,?)`,
  [assignmentId, tenantId, leadId, executiveId, score, priority, now]
)
```

#### Node: prioritize_queue (NEW)
- Executes after assignment
- Verifies priority rank was set correctly
- Query database sorted by `priority_rank DESC, assigned_at ASC`
- Non-critical: errors don't fail the workflow

```javascript
async function prioritizeQueueNode(state) {
  const scorePriority = { 'hot': 3, 'warm': 2, 'cold': 1 }
  const priority = scorePriority[state.score] || 1
  
  // Update newly assigned lead with priority
  await run(
    `UPDATE lead_assignments SET priority_rank = ? WHERE assignment_id = ?`,
    [priority, state.assignment_id]
  )
  
  // Returns status: 'completed'
}
```

---

### 3. API Endpoint (NEW)

**GET /api/executives/:id/queue**

Returns prioritized lead queue for a specific executive.

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:54321/api/executives/{exec_id}/queue
```

**Response:**
```json
[
  {
    "assignment_id": "uuid-001",
    "lead_id": "lead-hot-001",
    "score": "hot",
    "priority_rank": 3,
    "assigned_at": "2026-06-09T10:30:00Z",
    "position": 1,
    "priority_label": "hot"
  },
  {
    "assignment_id": "uuid-002",
    "lead_id": "lead-warm-001",
    "score": "warm",
    "priority_rank": 2,
    "assigned_at": "2026-06-09T10:25:00Z",
    "position": 2,
    "priority_label": "warm"
  },
  {
    "assignment_id": "uuid-003",
    "lead_id": "lead-cold-001",
    "score": "cold",
    "priority_rank": 1,
    "assigned_at": "2026-06-09T10:20:00Z",
    "position": 3,
    "priority_label": "cold"
  }
]
```

---

## Execution Flow Example

### Scenario: Building an Executive's Queue

**Initial State (Ravi's Queue):**
```
- Lead A (COLD)
- Lead B (WARM)
- Lead C (COLD)
```

**Action:** Assign Lead D (HOT) to Ravi

**Step 1: fetch_executives**
- Query active executives for tenant
- Return: Ravi, Priya, Karthik, Divya, Arjun

**Step 2: select_executive**
- Claude or fallback picks Ravi (least loaded)

**Step 3: assign_lead**
- Insert into lead_assignments:
  - lead_id: "D"
  - executive_id: Ravi
  - score: "hot"
  - **priority_rank: 3** ← Set here
- Update Ravi's load: 3→4

**Step 4: prioritize_queue** (NEW)
- Verify priority_rank = 3 for Lead D
- Return status: 'completed'

**Step 5: notify**
- Create notification: "Lead D (hot) assigned to Ravi"

**Final State (Ravi's Queue - Sorted by Priority):**
```
Query: SELECT * FROM lead_assignments 
       WHERE executive_id = Ravi 
       ORDER BY priority_rank DESC, assigned_at ASC

Result:
- Lead D (HOT)       ← Priority 3 (newest, highest)
- Lead B (WARM)      ← Priority 2
- Lead A (COLD)      ← Priority 1
- Lead C (COLD)      ← Priority 1
```

---

## Key Design Decisions

### 1. Priority as Data, Not Logic

**Why:** Store priority in database, not recalculate on every query.
- Fast lookups: O(1) vs O(n)
- Persistence: survives across queries
- Sortable: can order in SQL directly

### 2. Separate Concerns

**Assignment Logic:** Unchanged
- Still assigns to least-loaded executive
- Round-robin on ties
- Respects capacity limits

**Priority Logic:** Isolated in `prioritize_queue` node
- Doesn't affect assignment decision
- Non-critical: errors don't fail workflow
- Easy to remove/modify later

### 3. Non-Critical Node

**Why prioritize_queue is graceful:**
```javascript
try {
  // Priority logic
} catch (err) {
  console.warn('Non-critical priority error')
  return { status: 'completed' }
}
```
- Assignment succeeds even if priority fails
- Prevents cascading failures
- Observability via logging

---

## Testing

### Run Test Suite

```bash
node apps/local-api/agents/assignmentAgentGraph.test.js
```

### Test Results

**Test 1: Assign HOT Lead**
- ✅ Success
- ✅ Priority rank = 3

**Test 2: Assign WARM Lead**
- ✅ Success
- ✅ Priority rank = 2

**Test 3: Assign COLD Lead**
- ✅ Success
- ✅ Priority rank = 1

**Test 4: Verify Queue Order**
- ✅ All leads sorted by priority_rank DESC
- ✅ HOT appears first, COLD appears last

---

## Frontend Integration (Optional)

### ExecutiveCard Component Enhancement

```typescript
// Show priority indicator
<div className={`priority-${lead.priority_label}`}>
  {lead.priority_label.toUpperCase()} • Position {lead.position}
</div>
```

### AssignmentHistory Enhancement

```typescript
// Sort by priority within executive's queue
leads.sort((a, b) => b.priority_rank - a.priority_rank)
```

---

## Migration Guide

### For Existing Installations

1. Add column to `lead_assignments`:
   ```sql
   ALTER TABLE lead_assignments ADD COLUMN priority_rank INTEGER DEFAULT 1
   ```

2. Backfill existing leads:
   ```sql
   UPDATE lead_assignments 
   SET priority_rank = CASE 
       WHEN score = 'hot' THEN 3
       WHEN score = 'warm' THEN 2
       ELSE 1
     END
   ```

3. Redeploy LangGraph agent

---

## Performance Considerations

### Query Optimization

**Single SELECT by priority:**
```sql
SELECT * FROM lead_assignments 
WHERE executive_id = ? 
ORDER BY priority_rank DESC, assigned_at ASC
```
- **Time:** O(n log n) sort
- **Index:** Can add `(executive_id, priority_rank DESC)` for O(log n) lookup

**Current:** No index needed for local dev, add for production:
```sql
CREATE INDEX idx_exec_priority ON lead_assignments(executive_id, priority_rank DESC)
```

---

## Future Enhancements

1. **Dynamic Priority Adjustment**
   - Boost priority if lead responds to messages
   - Decrease if not engaged for 48 hours

2. **Weighted Scoring**
   - Hot + High Budget = Priority 3.5
   - Warm + Cold leads from hot source = Priority 2.5

3. **Executive Preferences**
   - Ravi prefers vehicle leads, auto-boost those
   - Priya avoids cold leads, skip for her

4. **SLA Tracking**
   - HOT leads must be contacted within 2 hours
   - Dashboard shows SLA compliance by priority

---

## Files Modified

- `apps/local-api/server.js` — Added priority_rank column, new API endpoint
- `apps/local-api/agents/assignmentAgentGraph.js` — New prioritize_queue node, updated AssignLeadTool
- `apps/local-api/agents/assignmentAgentGraph.test.js` — Tests for priority ranking

---

## Summary

✅ Lead priority ranking implemented and tested  
✅ HOT > WARM > COLD ordering enforced  
✅ Assignment logic unchanged  
✅ Priority as separate, non-critical concern  
✅ New API endpoint for queue visualization  
✅ Ready for frontend integration
