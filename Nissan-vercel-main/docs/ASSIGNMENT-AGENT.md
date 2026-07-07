# Assignment Agent — Complete Implementation Guide

## Overview
A multi-tenant, intelligent lead assignment system for ADIP (Nissan CRM). Automatically assigns scored leads to sales executives with:
- **Least-loaded assignment** — picks the executive with lowest current load
- **Round-robin tiebreaking** — distributes evenly when load is equal
- **Capacity limits** — respects max_lead_limit per executive
- **Tenant isolation** — all data filtered by tenant_id via JWT
- **Webhook notifications** — real-time events on lead assignments/completions
- **Dashboard UI** — visualize assignments, executive load, and notifications

---

## Architecture

### Database Tables (DuckDB)

#### `sales_executives`
```sql
id VARCHAR PRIMARY KEY           -- UUID
tenant_id VARCHAR                -- multi-tenant key
name VARCHAR
status VARCHAR DEFAULT 'active'  -- 'active' or 'inactive'
current_lead_count INTEGER DEFAULT 0
max_lead_limit INTEGER DEFAULT 10
```

#### `lead_assignments`
```sql
assignment_id VARCHAR PRIMARY KEY
tenant_id VARCHAR
lead_id VARCHAR
executive_id VARCHAR
score VARCHAR                     -- 'hot', 'warm', 'cold'
assigned_at VARCHAR DEFAULT CURRENT_TIMESTAMP
```

#### `lead_completions`
```sql
completion_id VARCHAR PRIMARY KEY
tenant_id VARCHAR
lead_id VARCHAR
executive_id VARCHAR
completed_at VARCHAR DEFAULT CURRENT_TIMESTAMP
```

#### `assignment_notifications`
```sql
notification_id VARCHAR PRIMARY KEY
tenant_id VARCHAR
lead_id VARCHAR
executive_id VARCHAR
event_type VARCHAR                -- 'lead_assigned', 'lead_completed', etc.
message VARCHAR
is_read BOOLEAN DEFAULT FALSE
created_at VARCHAR
```

---

## Backend API

### Routes
All routes require Bearer token in Authorization header. Tenant ID is extracted from JWT.

#### POST /api/assign-lead
Assign a scored lead to an available executive.
```bash
curl -X POST http://localhost:54321/api/assign-lead \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
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
  "current_load": "1/10"
}
```

#### POST /api/complete-lead
Mark a lead as completed and reduce executive load.
```bash
curl -X POST http://localhost:54321/api/complete-lead \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"lead_id": "lead-123", "executive_id": "uuid-xxx"}'
```

#### POST /api/deactivate-executive
Deactivate an executive and reassign their pending leads.
```bash
curl -X POST http://localhost:54321/api/deactivate-executive \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"executive_id": "uuid-xxx"}'
```

#### GET /api/executives
Get all executives for the authenticated tenant.
```bash
curl http://localhost:54321/api/executives \
  -H "Authorization: Bearer <token>"
```

#### GET /api/assignment-history
Get assignment history (default: 50 records, limit via `?limit=100`).
```bash
curl "http://localhost:54321/api/assignment-history?limit=10" \
  -H "Authorization: Bearer <token>"
```

#### GET /api/notifications
Get notifications for the tenant (default: 20 records).
```bash
curl "http://localhost:54321/api/notifications?unread=true&limit=10" \
  -H "Authorization: Bearer <token>"
```

#### POST /api/notifications/:id/read
Mark a notification as read.

#### GET /api/dashboard/stats
Get dashboard stats: utilization, capacity, exec counts, etc.
```bash
curl http://localhost:54321/api/dashboard/stats \
  -H "Authorization: Bearer <token>"
```

---

## Frontend Components

### Location: `apps/web/src/components/assignments/`

#### ExecutiveCard.tsx
Displays individual executive card with load bar and status.
- Shows name, status (active/inactive)
- Color-coded load bar (green: safe, amber: at capacity, red: over)
- Current load / max limit display

#### AssignmentHistory.tsx
List of recent assignments with score badges and timestamps.
- Displays lead ID, assigned executive, score
- Time since assignment

#### NotificationsList.tsx
Real-time notifications for lead assignments/completions.
- Event-specific icons and labels
- Mark as read button
- Unread count indicator

#### AssignmentDashboard.tsx
Main dashboard component combining all UI.
- Stats cards (execs, utilization, load, unread notifications)
- Grid of executive cards
- Recent assignments list
- Notifications sidebar with auto-refresh toggle

### Page Route: `apps/web/src/routes/_authed/assignments.tsx`
Main page component wrapping the dashboard.

### Navigation Link
Added to `apps/web/src/components/shell/nav-items.ts`:
```
Assignments → /assignments (available to all plans)
```

---

## API Client Library

### Location: `apps/web/src/lib/assignments.ts`

Server-side functions for calling the assignment API:
```typescript
fetchExecutives()                            -- Get all execs
fetchDashboardStats()                        -- Get dashboard stats
fetchAssignmentHistory(limit?: number)       -- Get assignment history
fetchNotifications(unreadOnly?, limit?)      -- Get notifications
assignLead(lead_id, score)                   -- Assign a lead
completeLead(lead_id, executive_id)          -- Complete a lead
deactivateExecutive(executive_id)            -- Deactivate an exec
```

All functions extract the Bearer token from the session automatically.

---

## Key Features

### 1. Tenant Isolation
- Every table has `tenant_id` column
- API extracts tenant from JWT and filters all queries
- No data leakage between tenants

### 2. Least-Loaded Assignment
- Fetches all active executives
- Filters out those at/over capacity
- Picks the one with lowest current_lead_count
- Round-robin tiebreaking ensures even distribution

### 3. Notifications
- Events emitted on: assignment, completion, deactivation, failure
- Stored in `assignment_notifications` table
- Real-time updates via dashboard auto-refresh
- Mark as read functionality

### 4. Load Balancing
- Current lead count tracks outstanding assignments
- Max limit prevents overloading
- Completion decreases count (never below 0)
- Deactivation reassigns all pending leads

### 5. Real-Time Dashboard
- Auto-refresh every 3-5 seconds
- Shows utilization percentage
- Color-coded executive cards
- Recent history and notifications

---

## Example Workflow

### Step 1: ABC Nissan owner logs in
- JWT contains `tenant_id: 11111111-1111-1111-1111-111111111111`
- API routes use this for filtering

### Step 2: A hot lead arrives
```bash
POST /api/assign-lead
{"lead_id": "customer-123", "score": "hot"}
```

### Step 3: System assigns intelligently
- Looks up 5 ABC execs: Ravi (2), Priya (3), Karthik (2), Divya (4), Arjun (1)
- Picks Arjun (lowest: 1)
- Increments Arjun's count to 2
- Inserts record into `lead_assignments`
- Emits notification: "Lead customer-123 (hot) assigned to Arjun"

### Step 4: Executive completes the lead
```bash
POST /api/complete-lead
{"lead_id": "customer-123", "executive_id": "arjun-uuid"}
```

### Step 5: System updates
- Inserts record into `lead_completions`
- Decrements Arjun's count to 1
- Emits notification: "Lead customer-123 completed by Arjun"

### Step 6: Dashboard updates
- Auto-refresh fetches new stats
- Shows Arjun's load: 1/10
- Displays completion notification

---

## Testing

Run the comprehensive test suite:
```bash
node apps/local-api/agents/assignmentAgent.test.js
```

Tests 6 scenarios:
1. Basic round-robin (5 leads → 5 execs)
2. Least-loaded logic
3. Capacity limits (skip at-capacity execs)
4. Lead completion (decreases load)
5. Executive deactivation (reassignment)
6. All at capacity (graceful failure)

---

## Files Created/Modified

### Backend
- `apps/local-api/server.js` — Added tables, routes, DB connection to agent
- `apps/local-api/agents/assignmentAgent.js` — Core assignment logic + notifications
- `apps/local-api/agents/assignmentAgent.test.js` — Test suite

### Frontend
- `apps/web/src/lib/assignments.ts` — API client functions
- `apps/web/src/components/assignments/ExecutiveCard.tsx` — Executive display
- `apps/web/src/components/assignments/AssignmentHistory.tsx` — History list
- `apps/web/src/components/assignments/NotificationsList.tsx` — Notifications
- `apps/web/src/components/assignments/AssignmentDashboard.tsx` — Main dashboard
- `apps/web/src/routes/_authed/assignments.tsx` — Page route
- `apps/web/src/components/shell/nav-items.ts` — Added nav link

---

## Next Steps

1. **Integrate with Lead Management** — Auto-assign new hot leads
2. **Performance Alerts** — Notify when execs at 80%+ capacity
3. **Skill-based Routing** — Assign based on vehicle/customer preferences
4. **Analytics** — Track exec performance (conversion rate, avg lead value)
5. **Bulk Operations** — Reassign multiple leads at once

---

## Troubleshooting

### API returns "Unauthorized"
- Check Bearer token is valid (JWT exp not passed)
- Ensure tenant_id is in JWT claims

### No executives showing
- Verify sales_executives table has records for the tenant
- Check tenant_id matches the one in JWT

### Notifications not updating
- Enable auto-refresh toggle in dashboard
- Check browser console for fetch errors
- Verify API is returning notifications

### Lead not assigning
- Check all execs not at capacity
- Verify lead_id is valid (string, not empty)
- Check score is 'hot', 'warm', or 'cold'
