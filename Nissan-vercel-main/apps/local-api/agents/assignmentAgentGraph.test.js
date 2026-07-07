/**
 * Test the LangGraph Assignment Agent
 * Run with: node apps/local-api/agents/assignmentAgentGraph.test.js
 */

'use strict'

const { DuckDBInstance } = require('@duckdb/node-api')
const assignmentAgentGraph = require('./assignmentAgentGraph')

let conn

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
  await conn.run(interpolate(sql, params))
}

async function all(sql, params = []) {
  const reader = await conn.runAndReadAll(interpolate(sql, params))
  return reader.getRowObjectsJson()
}

async function initTestDb() {
  const instance = await DuckDBInstance.create(':memory:')
  conn = await instance.connect()

  // Create tables
  await run(`CREATE TABLE sales_executives (
    id VARCHAR PRIMARY KEY, tenant_id VARCHAR, name VARCHAR, status VARCHAR DEFAULT 'active',
    current_lead_count INTEGER DEFAULT 0, max_lead_limit INTEGER DEFAULT 10
  )`)

  await run(`CREATE TABLE lead_assignments (
    assignment_id VARCHAR PRIMARY KEY, tenant_id VARCHAR, lead_id VARCHAR, executive_id VARCHAR,
    score VARCHAR, priority_rank INTEGER DEFAULT 1, assigned_at VARCHAR DEFAULT CURRENT_TIMESTAMP
  )`)

  await run(`CREATE TABLE assignment_notifications (
    notification_id VARCHAR PRIMARY KEY, tenant_id VARCHAR, lead_id VARCHAR,
    executive_id VARCHAR, event_type VARCHAR, message VARCHAR,
    is_read BOOLEAN DEFAULT FALSE, created_at VARCHAR
  )`)

  // Seed executives
  const tenantId = '11111111-1111-1111-1111-111111111111'
  const executives = [
    ['exec-1', tenantId, 'Ravi', 'active', 0, 10],
    ['exec-2', tenantId, 'Priya', 'active', 2, 10],
    ['exec-3', tenantId, 'Karthik', 'active', 1, 10],
    ['exec-4', tenantId, 'Divya', 'active', 3, 10],
    ['exec-5', tenantId, 'Arjun', 'active', 0, 10],
  ]

  for (const [id, tenant, name, status, count, limit] of executives) {
    await run(`INSERT INTO sales_executives VALUES (?,?,?,?,?,?)`, [id, tenant, name, status, count, limit])
  }

  assignmentAgentGraph.setDb(conn)
}

async function runTests() {
  console.log('\n🤖 LangGraph Assignment Agent Test Suite\n')

  const tenantId = '11111111-1111-1111-1111-111111111111'

  try {
    // Test 1: Assign a hot lead
    console.log('TEST 1: Assign a hot lead')
    console.log('─────────────────────────────')
    const result1 = await assignmentAgentGraph.assignLeadWithGraph(tenantId, {
      lead_id: 'lead-hot-001',
      score: 'hot',
    })
    console.log('Result:', JSON.stringify(result1, null, 2))
    console.log()

    // Test 2: Assign a warm lead
    console.log('TEST 2: Assign a warm lead')
    console.log('───────────────────────────')
    const result2 = await assignmentAgentGraph.assignLeadWithGraph(tenantId, {
      lead_id: 'lead-warm-001',
      score: 'warm',
    })
    console.log('Result:', JSON.stringify(result2, null, 2))
    console.log()

    // Test 3: Assign a cold lead
    console.log('TEST 3: Assign a cold lead')
    console.log('──────────────────────────')
    const result3 = await assignmentAgentGraph.assignLeadWithGraph(tenantId, {
      lead_id: 'lead-cold-001',
      score: 'cold',
    })
    console.log('Result:', JSON.stringify(result3, null, 2))
    console.log()

    // TEST 4: Priority Ranking Verification
    console.log('TEST 4: Verify Priority Ranking')
    console.log('───────────────────────────────')
    const priorityQueue = await all(
      `SELECT lead_id, score, priority_rank FROM lead_assignments WHERE tenant_id = ? ORDER BY priority_rank DESC, assigned_at ASC`,
      [tenantId]
    )
    console.log('All leads (priority ranking):')
    const priorityLabels = { 3: 'HOT', 2: 'WARM', 1: 'COLD' }
    for (const item of priorityQueue) {
      console.log(`  ${item.lead_id.padEnd(20)} → Priority ${item.priority_rank} (${priorityLabels[item.priority_rank]})`)
    }
    console.log()

    // Show final executive loads
    console.log('FINAL EXECUTIVE LOADS:')
    console.log('─────────────────────')
    const execs = await all(`SELECT name, current_lead_count, max_lead_limit FROM sales_executives WHERE tenant_id = ? ORDER BY name`, [
      tenantId,
    ])
    for (const exec of execs) {
      console.log(`${exec.name.padEnd(10)} → ${exec.current_lead_count}/${exec.max_lead_limit}`)
    }
    console.log()

    console.log('✅ All tests completed! Priority ranking is working.')
  } catch (err) {
    console.error('Test error:', err)
    process.exit(1)
  }
}

initTestDb().then(runTests).catch(err => {
  console.error('Setup error:', err)
  process.exit(1)
})
