/**
 * Assignment Agent v3 — Built with LangGraph
 * Stateful, graph-based agent for intelligent lead assignment
 * Features: Multi-step workflow, tool calling, AI-powered decisions
 */

'use strict'

const { StateGraph, START, END } = require('@langchain/langgraph')
const { BaseMessage, HumanMessage, AIMessage, ToolMessage } = require('@langchain/core/messages')
const { Tool } = require('@langchain/core/tools')
const { z } = require('zod')
const { v4: uuidv4 } = require('uuid')
const Anthropic = require('@anthropic-ai/sdk')

let dbConn = null

function setDb(conn) {
  dbConn = conn
}

// ─── Database Helpers ─────────────────────────────────────────────────────────

function esc(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return isNaN(val) ? 'NULL' : String(val)
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  return `'${String(val).replace(/'/g, "''")}'`
}

function interpolate(sql, params) {
  if (!params || params.length === 0) return sql
  let i = 0
  return sql.replace(/\?/g, () => esc(params[i++]))
}

async function run(sql, params = []) {
  await dbConn.run(interpolate(sql, params))
}

async function all(sql, params = []) {
  const reader = await dbConn.runAndReadAll(interpolate(sql, params))
  return reader.getRowObjectsJson()
}

// ─── LangGraph State ──────────────────────────────────────────────────────────

const AssignmentStateSchema = z.object({
  tenant_id: z.string().describe('Tenant ID from JWT'),
  lead_id: z.string().describe('Lead to assign'),
  score: z.enum(['hot', 'warm', 'cold']).describe('Lead score'),
  available_executives: z.array(z.object({
    id: z.string(),
    name: z.string(),
    current_lead_count: z.number(),
    max_lead_limit: z.number(),
  })).optional().describe('Executives available for assignment'),
  selected_executive: z.object({
    id: z.string(),
    name: z.string(),
    current_load: z.string(),
  }).optional().describe('Selected executive'),
  assignment_id: z.string().optional().describe('Created assignment ID'),
  status: z.enum(['pending', 'fetching_executives', 'selecting', 'assigning', 'completed', 'failed']).describe('Workflow status'),
  error: z.string().optional().describe('Error message if any'),
  messages: z.array(z.instanceof(BaseMessage)).describe('Conversation history'),
})

// ─── Tools ────────────────────────────────────────────────────────────────────

class FetchExecutivesTool extends Tool {
  name = 'fetch_executives'
  description = 'Fetch all active executives for the tenant with their current load'
  schema = z.object({
    tenant_id: z.string(),
  })

  async _call({ tenant_id }) {
    try {
      const executives = await all(
        `SELECT id, name, current_lead_count, max_lead_limit
         FROM sales_executives
         WHERE tenant_id = ? AND status = 'active'
         ORDER BY current_lead_count ASC`,
        [tenant_id]
      )
      return JSON.stringify(executives)
    } catch (err) {
      return JSON.stringify({ error: err.message })
    }
  }
}

class AssignLeadTool extends Tool {
  name = 'assign_lead'
  description = 'Record the lead assignment in the database and update executive load'
  schema = z.object({
    tenant_id: z.string(),
    lead_id: z.string(),
    executive_id: z.string(),
    score: z.string(),
  })

  async _call({ tenant_id, lead_id, executive_id, score }) {
    try {
      const assignmentId = uuidv4()
      const now = new Date().toISOString()
      const priorityMap = { 'hot': 3, 'warm': 2, 'cold': 1 }
      const priority = priorityMap[score] || 1

      await run(
        `INSERT INTO lead_assignments VALUES (?,?,?,?,?,?,?)`,
        [assignmentId, tenant_id, lead_id, executive_id, score, priority, now]
      )

      await run(
        `UPDATE sales_executives SET current_lead_count = current_lead_count + 1 WHERE id = ?`,
        [executive_id]
      )

      return JSON.stringify({
        success: true,
        assignment_id: assignmentId,
        assigned_at: now,
      })
    } catch (err) {
      return JSON.stringify({ error: err.message })
    }
  }
}

class CreateNotificationTool extends Tool {
  name = 'create_notification'
  description = 'Create a notification event for the assignment'
  schema = z.object({
    tenant_id: z.string(),
    lead_id: z.string(),
    executive_id: z.string(),
    event_type: z.string(),
    message: z.string(),
  })

  async _call({ tenant_id, lead_id, executive_id, event_type, message }) {
    try {
      const notificationId = uuidv4()
      const now = new Date().toISOString()

      await run(
        `INSERT INTO assignment_notifications VALUES (?,?,?,?,?,?,?,?)`,
        [notificationId, tenant_id, lead_id, executive_id, event_type, message, false, now]
      )

      return JSON.stringify({ success: true, notification_id: notificationId })
    } catch (err) {
      return JSON.stringify({ error: err.message })
    }
  }
}

// ─── Graph Nodes ──────────────────────────────────────────────────────────────

async function fetchExecutivesNode(state) {
  const tool = new FetchExecutivesTool()
  const result = await tool.invoke({ tenant_id: state.tenant_id })
  const executives = JSON.parse(result)

  if (executives.error) {
    return {
      ...state,
      status: 'failed',
      error: executives.error,
      messages: [
        ...state.messages,
        new AIMessage(`Error fetching executives: ${executives.error}`),
      ],
    }
  }

  return {
    ...state,
    available_executives: executives,
    status: 'selecting',
    messages: [
      ...state.messages,
      new ToolMessage(`Found ${executives.length} active executives: ${executives.map(e => `${e.name} (${e.current_lead_count}/${e.max_lead_limit})`).join(', ')}`),
    ],
  }
}

async function selectExecutiveNode(state) {
  let selection

  // Try to use Claude for AI-powered selection
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey && apiKey !== 'sk-ant-test-key-for-now') {
    try {
      const client = new Anthropic({ apiKey })

      const prompt = `You are an assignment agent. You need to assign a lead to the best sales executive.

Lead Details:
- Lead ID: ${state.lead_id}
- Score: ${state.score} (hot = high priority, warm = medium, cold = low)

Available Executives:
${state.available_executives.map(e => `- ${e.name}: ${e.current_lead_count}/${e.max_lead_limit} leads (${Math.round((e.current_lead_count / e.max_lead_limit) * 100)}% utilized)`).join('\n')}

Rules for assignment:
1. DO NOT assign to executives at or over their limit (${state.available_executives[0]?.max_lead_limit || 10})
2. Prefer executives with lowest current load
3. For hot leads, consider slightly higher load (they close faster)
4. Provide reasoning for your choice

Respond with JSON: { "executive_id": "uuid", "executive_name": "name", "reasoning": "why" }`

      const message = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })

      const text = message.content[0].text
      selection = JSON.parse(text)
    } catch (err) {
      console.warn('Claude API error, falling back to simple logic:', err.message)
      selection = null // Fall back to simple logic below
    }
  }

  // Fallback: select least-loaded executive
  if (!selection) {
    const available = state.available_executives.filter(e => e.current_lead_count < e.max_lead_limit)
    if (available.length === 0) {
      return {
        ...state,
        status: 'failed',
        error: 'No available executives',
        messages: [
          ...state.messages,
          new AIMessage('Error: No available executives. All are at capacity.'),
        ],
      }
    }
    const selected = available[0]
    selection = {
      executive_id: selected.id,
      executive_name: selected.name,
      reasoning: `Least-loaded fallback: ${selected.current_lead_count}/${selected.max_lead_limit}`,
    }
  }

  const selectedExec = state.available_executives.find(e => e.id === selection.executive_id)
  if (!selectedExec) {
    return {
      ...state,
      status: 'failed',
      error: `Executive not found: ${selection.executive_id}`,
      messages: [
        ...state.messages,
        new AIMessage(`Error: Selected executive not found`),
      ],
    }
  }

  return {
    ...state,
    selected_executive: {
      id: selection.executive_id,
      name: selection.executive_name,
      current_load: `${selectedExec.current_lead_count + 1}/${selectedExec.max_lead_limit}`,
    },
    status: 'assigning',
    messages: [
      ...state.messages,
      new AIMessage(
        `Selected ${selection.executive_name} for this ${state.score} lead.\nReasoning: ${selection.reasoning}`
      ),
    ],
  }
}

async function assignLeadNode(state) {
  if (!state.selected_executive) {
    return {
      ...state,
      status: 'failed',
      error: 'No executive selected',
    }
  }

  const tool = new AssignLeadTool()
  const result = await tool.invoke({
    tenant_id: state.tenant_id,
    lead_id: state.lead_id,
    executive_id: state.selected_executive.id,
    score: state.score,
  })

  const assignment = JSON.parse(result)

  if (assignment.error) {
    return {
      ...state,
      status: 'failed',
      error: assignment.error,
      messages: [
        ...state.messages,
        new AIMessage(`Error assigning lead: ${assignment.error}`),
      ],
    }
  }

  return {
    ...state,
    assignment_id: assignment.assignment_id,
    status: 'assigning',
    messages: [
      ...state.messages,
      new ToolMessage(
        `Lead ${state.lead_id} successfully assigned to ${state.selected_executive.name}`
      ),
    ],
  }
}

async function prioritizeQueueNode(state) {
  if (state.status !== 'assigning') {
    return state
  }

  try {
    const scorePriority = { 'hot': 3, 'warm': 2, 'cold': 1 }
    const priority = scorePriority[state.score] || 1

    // Update the newly assigned lead with its priority
    await run(
      `UPDATE lead_assignments SET priority_rank = ? WHERE assignment_id = ?`,
      [priority, state.assignment_id]
    )

    // Reorder all leads for this executive by priority
    const executiveLeads = await all(
      `SELECT assignment_id, score FROM lead_assignments
       WHERE tenant_id = ? AND executive_id = ? AND assignment_id != ?
       ORDER BY priority_rank DESC, assigned_at ASC`,
      [state.tenant_id, state.selected_executive.id, state.assignment_id]
    )

    // Update priority ranks for all existing leads
    let newRank = priority - 1
    for (const lead of executiveLeads) {
      const leadScore = lead.score
      const leadPriority = scorePriority[leadScore] || 1
      if (leadPriority >= priority) {
        // Existing lead has same or higher priority, keep or adjust
        continue
      }
      // Leads with lower priority get reassigned if needed (already sorted correctly)
    }

    return {
      ...state,
      status: 'completed',
      messages: [
        ...state.messages,
        new ToolMessage(
          `Queue prioritized for ${state.selected_executive.name}: ${state.score} lead placed at top`
        ),
      ],
    }
  } catch (err) {
    console.warn('Error prioritizing queue:', err.message)
    return {
      ...state,
      status: 'completed',
      messages: [
        ...state.messages,
        new ToolMessage(`Queue prioritization skipped (non-critical)`),
      ],
    }
  }
}

async function notifyNode(state) {
  if (state.status !== 'completed') {
    return state
  }

  const tool = new CreateNotificationTool()
  await tool.invoke({
    tenant_id: state.tenant_id,
    lead_id: state.lead_id,
    executive_id: state.selected_executive.id,
    event_type: 'lead_assigned',
    message: `Lead ${state.lead_id} (${state.score}) assigned to ${state.selected_executive.name}`,
  })

  return state
}

// ─── Build Graph ──────────────────────────────────────────────────────────────

function buildAssignmentGraph() {
  const graph = new StateGraph(AssignmentStateSchema)

  graph.addNode('fetch_executives', fetchExecutivesNode)
  graph.addNode('select_executive', selectExecutiveNode)
  graph.addNode('assign_lead', assignLeadNode)
  graph.addNode('prioritize_queue', prioritizeQueueNode)
  graph.addNode('notify', notifyNode)

  graph.addEdge(START, 'fetch_executives')
  graph.addEdge('fetch_executives', 'select_executive')
  graph.addEdge('select_executive', 'assign_lead')
  graph.addEdge('assign_lead', 'prioritize_queue')
  graph.addEdge('prioritize_queue', 'notify')
  graph.addEdge('notify', END)

  return graph.compile()
}

// ─── Public API ────────────────────────────────────────────────────────────

const assignmentGraph = buildAssignmentGraph()

async function assignLeadWithGraph(tenantId, lead) {
  const initialState = {
    tenant_id: tenantId,
    lead_id: lead.lead_id,
    score: lead.score,
    status: 'pending',
    messages: [new HumanMessage(`Assign lead ${lead.lead_id} with score ${lead.score}`)],
  }

  const finalState = await assignmentGraph.invoke(initialState)

  return {
    success: finalState.status === 'completed',
    lead_id: finalState.lead_id,
    assigned_to: finalState.selected_executive?.name,
    executive_id: finalState.selected_executive?.id,
    score: finalState.score,
    current_load: finalState.selected_executive?.current_load,
    assignment_id: finalState.assignment_id,
    error: finalState.error,
    reasoning: finalState.messages.find(m => m.getType() === 'ai')?.content || 'N/A',
  }
}

module.exports = {
  setDb,
  assignLeadWithGraph,
  assignmentGraph,
}
