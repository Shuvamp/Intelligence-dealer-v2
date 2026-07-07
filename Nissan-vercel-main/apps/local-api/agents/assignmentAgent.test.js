/**
 * Assignment Agent Test Suite
 * Tests all assignment logic: round-robin, least-loaded, capacity, completion, deactivation.
 */

'use strict'

const { DuckDBInstance } = require('@duckdb/node-api')
const assignmentAgent = require('./assignmentAgent')

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
    id INTEGER PRIMARY KEY, name VARCHAR, status VARCHAR DEFAULT 'active',
    current_lead_count INTEGER DEFAULT 0, max_lead_limit INTEGER DEFAULT 10
  )`)

  await run(`CREATE TABLE lead_assignments (
    assignment_id INTEGER PRIMARY KEY, lead_id INTEGER, executive_id INTEGER,
    score VARCHAR, assigned_at VARCHAR DEFAULT CURRENT_TIMESTAMP
  )`)

  await run(`CREATE TABLE lead_completions (
    completion_id INTEGER PRIMARY KEY, lead_id INTEGER, executive_id INTEGER,
    completed_at VARCHAR DEFAULT CURRENT_TIMESTAMP
  )`)

  // Seed executives
  const executives = [
    [1, 'Ravi',    'active', 0, 10],
    [2, 'Priya',   'active', 0, 10],
    [3, 'Karthik', 'active', 0, 10],
    [4, 'Divya',   'active', 0, 10],
    [5, 'Arjun',   'active', 0, 10],
  ]
  for (const [id, name, status, count, limit] of executives) {
    await run(`INSERT INTO sales_executives VALUES (?,?,?,?,?)`, [id, name, status, count, limit])
  }

  // Set up the agent with the connection
  assignmentAgent.setDb(conn)
}

function printTestHeader(testNum, testName) {
  console.log('\n----------------------------------')
  console.log(`TEST ${testNum}: ${testName}`)
  console.log('----------------------------------')
}

async function printLeadAssignment(lead, result) {
  if (result.success) {
    console.log(`Lead ${result.lead_id} (score: ${result.score}) → Assigned to: ${result.assigned_to}`)
    console.log(`Load: ${result.current_load}`)
  } else {
    console.log(`Lead ${lead.lead_id} (score: ${lead.score}) → FAILED: ${result.message}`)
  }
}

async function printExecutivesTable() {
  const executives = await assignmentAgent.getExecutives()
  console.log('\n| Executive | Status   | Load        |')
  console.log('|-----------|----------|-------------|')
  for (const exec of executives) {
    const status = exec.status === 'active' ? 'active  ' : 'inactive'
    const load = `${exec.current_lead_count}/${exec.max_lead_limit}`
    console.log(`| ${exec.name.padEnd(9)} | ${status} | ${load.padEnd(11)} |`)
  }
}

async function runTests() {
  console.log('🧪 Assignment Agent Test Suite\n')

  // TEST 1: Basic round-robin
  printTestHeader(1, 'Basic round-robin')
  const test1Leads = [
    { lead_id: 1, score: 'hot' },
    { lead_id: 2, score: 'warm' },
    { lead_id: 3, score: 'cold' },
    { lead_id: 4, score: 'hot' },
    { lead_id: 5, score: 'warm' },
  ]
  for (const lead of test1Leads) {
    const result = await assignmentAgent.assignLead(lead)
    await printLeadAssignment(lead, result)
  }

  // TEST 2: Least-loaded logic
  printTestHeader(2, 'Least-loaded logic')
  // Manually set Priya's count to 1 (simulating she finished some leads)
  await run(`UPDATE sales_executives SET current_lead_count = 1 WHERE id = 2`)
  const result2 = await assignmentAgent.assignLead({ lead_id: 6, score: 'hot' })
  await printLeadAssignment({ lead_id: 6, score: 'hot' }, result2)
  console.log(`Expected: goes to Priya (lowest count = 1)`)

  // TEST 3: Cap limit
  printTestHeader(3, 'Cap limit')
  // Manually set Ravi's count to 10 (at max)
  await run(`UPDATE sales_executives SET current_lead_count = 10 WHERE id = 1`)
  const result3 = await assignmentAgent.assignLead({ lead_id: 7, score: 'cold' })
  await printLeadAssignment({ lead_id: 7, score: 'cold' }, result3)
  console.log(`Expected: Ravi is SKIPPED, goes to next available exec`)

  // TEST 4: Complete a lead
  printTestHeader(4, 'Complete a lead')
  const result4 = await assignmentAgent.completeLead(3, 3)
  console.log(`Completed lead 3 for Karthik (id: 3)`)
  console.log(`Result: ${result4.message}`)

  // TEST 5: Deactivate an executive
  printTestHeader(5, 'Deactivate an executive')
  const result5 = await assignmentAgent.deactivateExecutive(4)
  console.log(`Deactivated Divya (id: 4)`)
  if (result5.success) {
    console.log(`Reassigned leads: ${JSON.stringify(result5.reassigned_leads)}`)
  } else {
    console.log(`Result: ${result5.message}`)
  }

  // TEST 6: All executives at capacity
  printTestHeader(6, 'All executives at capacity')
  // Manually set ALL active executives to max capacity
  await run(`UPDATE sales_executives SET current_lead_count = 10 WHERE status = 'active'`)
  const result6 = await assignmentAgent.assignLead({ lead_id: 8, score: 'hot' })
  await printLeadAssignment({ lead_id: 8, score: 'hot' }, result6)
  console.log(`Expected: { success: false, message: "No available executives..." }`)

  // Final summary
  console.log('\n\n===== FINAL SUMMARY =====')
  await printExecutivesTable()

  // Print assignment history
  console.log('\n\n===== ASSIGNMENT HISTORY =====')
  const history = await assignmentAgent.getAssignmentHistory()
  console.log('| Assignment ID | Lead ID | Executive   | Score | Assigned At          |')
  console.log('|---------------|---------|-------------|-------|----------------------|')
  for (const rec of history) {
    const assignId = String(rec.assignment_id).padEnd(13)
    const leadId = String(rec.lead_id).padEnd(7)
    const execName = String(rec.executive_name).padEnd(11)
    const score = String(rec.score).padEnd(5)
    const timestamp = rec.assigned_at?.substring(0, 19) || 'N/A'
    console.log(`| ${assignId} | ${leadId} | ${execName} | ${score} | ${timestamp} |`)
  }

  console.log('\n✅ All tests completed!')
}

// Run tests
initTestDb().then(runTests).catch(err => {
  console.error('Test error:', err)
  process.exit(1)
})
