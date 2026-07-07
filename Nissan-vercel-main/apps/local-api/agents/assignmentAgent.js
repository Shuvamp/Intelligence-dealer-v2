/**
 * Assignment Agent v2 — Tenant-isolated, with webhook notifications
 * Features: least-loaded, round-robin, capacity limits, reassignment, notifications.
 */

'use strict'

const { v4: uuidv4 } = require('uuid')

let lastAssignedIndex = {}
let dbConn = null
let notificationCallbacks = []

function setDb(conn) {
  dbConn = conn
}

// Register webhook callback for notifications
function onAssignmentNotification(callback) {
  notificationCallbacks.push(callback)
}

async function emitNotification(tenantId, leadId, executiveId, eventType, message) {
  const notification = {
    notification_id: uuidv4(),
    tenant_id: tenantId,
    lead_id: leadId,
    executive_id: executiveId,
    event_type: eventType,
    message,
    is_read: false,
    created_at: new Date().toISOString(),
  }

  // Insert into DB
  await run(
    `INSERT INTO assignment_notifications VALUES (?,?,?,?,?,?,?,?)`,
    [
      notification.notification_id,
      notification.tenant_id,
      notification.lead_id,
      notification.executive_id,
      notification.event_type,
      notification.message,
      notification.is_read,
      notification.created_at,
    ]
  )

  // Emit webhook callbacks
  for (const callback of notificationCallbacks) {
    try {
      callback(notification)
    } catch (err) {
      console.error('Notification callback error:', err.message)
    }
  }
}

async function run(sql, params = []) {
  await dbConn.run(interpolate(sql, params))
}

async function all(sql, params = []) {
  const reader = await dbConn.runAndReadAll(interpolate(sql, params))
  return reader.getRowObjectsJson()
}

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

/**
 * FUNCTION 1: assignLead(tenantId, lead)
 * Assigns a lead to the most available executive for a tenant.
 */
async function assignLead(tenantId, lead) {
  try {
    const { lead_id, score } = lead

    // Fetch all active executives for this tenant
    const executives = await all(
      `SELECT * FROM sales_executives WHERE tenant_id = ? AND status = 'active' ORDER BY id`,
      [tenantId]
    )

    // Filter by capacity
    const available = executives.filter(e => e.current_lead_count < e.max_lead_limit)

    if (available.length === 0) {
      await emitNotification(
        tenantId,
        lead_id,
        null,
        'assignment_failed',
        `Lead ${lead_id} could not be assigned. All executives are at capacity.`
      )
      return {
        success: false,
        message: 'No available executives. All at capacity.',
      }
    }

    // Find executive with lowest load
    let selected = available[0]
    for (const exec of available) {
      if (exec.current_lead_count < selected.current_lead_count) {
        selected = exec
      }
    }

    // Round-robin tiebreaking
    const tiedExecs = available.filter(e => e.current_lead_count === selected.current_lead_count)
    if (tiedExecs.length > 1) {
      if (!lastAssignedIndex[tenantId]) lastAssignedIndex[tenantId] = -1
      lastAssignedIndex[tenantId] = (lastAssignedIndex[tenantId] + 1) % tiedExecs.length
      selected = tiedExecs[lastAssignedIndex[tenantId]]
    }

    // Insert assignment
    const assignmentId = uuidv4()
    const now = new Date().toISOString()
    await run(
      `INSERT INTO lead_assignments VALUES (?,?,?,?,?,?)`,
      [assignmentId, tenantId, lead_id, selected.id, score, now]
    )

    // Increment executive load
    await run(
      `UPDATE sales_executives SET current_lead_count = current_lead_count + 1 WHERE id = ?`,
      [selected.id]
    )

    // Emit notification
    await emitNotification(
      tenantId,
      lead_id,
      selected.id,
      'lead_assigned',
      `Lead ${lead_id} (${score}) assigned to ${selected.name}`
    )

    return {
      success: true,
      lead_id,
      assigned_to: selected.name,
      executive_id: selected.id,
      score,
      current_load: `${selected.current_lead_count + 1}/${selected.max_lead_limit}`,
    }
  } catch (err) {
    console.error('assignLead error:', err)
    return {
      success: false,
      message: `Assignment failed: ${err.message}`,
    }
  }
}

/**
 * FUNCTION 2: completeLead(tenantId, lead_id, executive_id)
 * Marks a lead as completed.
 */
async function completeLead(tenantId, lead_id, executive_id) {
  try {
    const completionId = uuidv4()
    const now = new Date().toISOString()

    await run(
      `INSERT INTO lead_completions VALUES (?,?,?,?,?)`,
      [completionId, tenantId, lead_id, executive_id, now]
    )

    // Decrement load
    await run(
      `UPDATE sales_executives SET current_lead_count = GREATEST(0, current_lead_count - 1) WHERE id = ?`,
      [executive_id]
    )

    // Get executive name for notification
    const exec = await all(`SELECT name FROM sales_executives WHERE id = ?`, [executive_id])
    const execName = exec[0]?.name || 'Unknown'

    await emitNotification(
      tenantId,
      lead_id,
      executive_id,
      'lead_completed',
      `Lead ${lead_id} completed by ${execName}`
    )

    return {
      success: true,
      message: 'Lead completed. Executive load updated.',
    }
  } catch (err) {
    console.error('completeLead error:', err)
    return {
      success: false,
      message: `Completion failed: ${err.message}`,
    }
  }
}

/**
 * FUNCTION 3: deactivateExecutive(tenantId, executive_id)
 * Deactivates an executive and reassigns their pending leads.
 */
async function deactivateExecutive(tenantId, executive_id) {
  try {
    // Mark as inactive
    await run(`UPDATE sales_executives SET status = 'inactive' WHERE id = ?`, [executive_id])

    // Get executive name
    const exec = await all(`SELECT name FROM sales_executives WHERE id = ?`, [executive_id])
    const execName = exec[0]?.name || 'Unknown'

    // Find unfinished leads
    const unfinishedLeads = await all(
      `SELECT la.lead_id, la.score FROM lead_assignments la
       LEFT JOIN lead_completions lc ON la.lead_id = lc.lead_id AND la.tenant_id = lc.tenant_id
       WHERE la.tenant_id = ? AND la.executive_id = ? AND lc.completion_id IS NULL`,
      [tenantId, executive_id]
    )

    // Reset their load
    await run(`UPDATE sales_executives SET current_lead_count = 0 WHERE id = ?`, [executive_id])

    // Reassign each lead
    const reassignedLeads = []
    for (const ul of unfinishedLeads) {
      const result = await assignLead(tenantId, ul)
      if (result.success) {
        reassignedLeads.push({
          lead_id: ul.lead_id,
          new_executive: result.assigned_to,
        })
      }
    }

    await emitNotification(
      tenantId,
      null,
      executive_id,
      'executive_deactivated',
      `${execName} deactivated. ${reassignedLeads.length} leads reassigned.`
    )

    return {
      success: true,
      message: 'Executive deactivated',
      reassigned_leads: reassignedLeads,
    }
  } catch (err) {
    console.error('deactivateExecutive error:', err)
    return {
      success: false,
      message: `Deactivation failed: ${err.message}`,
    }
  }
}

// The assignable sales floor = these roles. Capacity isn't modelled on the
// users table, so every exec gets the same nominal limit for the load gauge.
const ASSIGNABLE_ROLES = "('sales_executive','dealer_manager','dealer_owner')"
const CLOSED_STAGES = "('won','lost','delivered')"
const DEFAULT_LEAD_LIMIT = 15

/**
 * FUNCTION 4: getExecutives(tenantId)
 * The real sales team for a tenant, each with their live open-lead count.
 * Derived from users + leads so the dashboard mirrors actual assignments
 * (auto-routed at intake and manual reassigns alike).
 */
async function getExecutives(tenantId) {
  try {
    const executives = await all(
      `SELECT u.id,
              u.full_name AS name,
              'active' AS status,
              (SELECT COUNT(*) FROM leads l
                 WHERE l.assigned_to = u.id AND l.stage NOT IN ${CLOSED_STAGES}) AS current_lead_count,
              ${DEFAULT_LEAD_LIMIT} AS max_lead_limit
       FROM users u
       WHERE u.tenant_id = ? AND u.role IN ${ASSIGNABLE_ROLES}
       ORDER BY u.full_name`,
      [tenantId]
    )
    // DuckDB returns COUNT as BigInt-ish; coerce to plain numbers for the UI.
    return executives.map((e) => ({
      ...e,
      current_lead_count: Number(e.current_lead_count ?? 0),
      max_lead_limit: Number(e.max_lead_limit ?? DEFAULT_LEAD_LIMIT),
    }))
  } catch (err) {
    console.error('getExecutives error:', err)
    return []
  }
}

/**
 * FUNCTION 5: getAssignmentHistory(tenantId, limit=50)
 * Get assignment history for a tenant.
 */
async function getAssignmentHistory(tenantId, limit = 50) {
  try {
    // Recent real assignments, newest first: every assigned lead joined to its
    // owner (users) and customer. lead_id shows the customer name (friendlier
    // than a UUID); score is normalised to the hot/warm/cold bands the UI knows.
    const history = await all(
      `SELECT
         l.id AS assignment_id,
         COALESCE(c.full_name, l.id) AS lead_id,
         u.full_name AS executive_name,
         u.id AS executive_id,
         CASE
           WHEN l.score IN ('hot', 'hot+') THEN 'hot'
           WHEN l.score = 'dead' THEN 'cold'
           WHEN l.score IN ('warm', 'cold') THEN l.score
           ELSE 'warm'
         END AS score,
         COALESCE(l.last_activity_at, l.updated_at, l.created_at) AS assigned_at
       FROM leads l
       JOIN users u ON l.assigned_to = u.id
       LEFT JOIN customers c ON l.customer_id = c.id
       WHERE l.tenant_id = ? AND l.assigned_to IS NOT NULL
       ORDER BY assigned_at DESC
       LIMIT ?`,
      [tenantId, limit]
    )
    return history
  } catch (err) {
    console.error('getAssignmentHistory error:', err)
    return []
  }
}

/**
 * FUNCTION 6: getNotifications(tenantId, unreadOnly=false, limit=20)
 * Get notifications for a tenant.
 */
async function getNotifications(tenantId, unreadOnly = false, limit = 20) {
  try {
    // The real intake flow writes assignment notices to the general
    // `notifications` table ("New <source> lead (<score>) · assigned to <rep>"),
    // so read from there and shape it to what the dashboard list expects.
    let sql = `SELECT id AS notification_id,
                      NULL AS lead_id,
                      NULL AS executive_id,
                      'lead_assigned' AS event_type,
                      COALESCE(title || ' — ' || message, message, title) AS message,
                      (status = 'read') AS is_read,
                      created_at
               FROM notifications
               WHERE tenant_id = ?`
    const params = [tenantId]

    if (unreadOnly) {
      sql += ` AND status != 'read'`
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`
    params.push(limit)

    const notifications = await all(sql, params)
    return notifications.map((n) => ({ ...n, is_read: Boolean(n.is_read) }))
  } catch (err) {
    console.error('getNotifications error:', err)
    return []
  }
}

/**
 * FUNCTION 7: markNotificationRead(notificationId)
 * Mark a notification as read (general notifications table).
 */
async function markNotificationRead(notificationId) {
  try {
    await run(`UPDATE notifications SET status = 'read' WHERE id = ?`, [notificationId])
    return { success: true }
  } catch (err) {
    console.error('markNotificationRead error:', err)
    return { success: false }
  }
}

/**
 * FUNCTION 8: getDashboardStats(tenantId)
 * Get dashboard stats for a tenant.
 */
async function getDashboardStats(tenantId) {
  try {
    const executives = await getExecutives(tenantId)
    // total_assignments  = every lead that currently has an owner
    // total_completions  = leads that reached a closed/won stage
    const assignments = await all(
      `SELECT COUNT(*) as count FROM leads WHERE tenant_id = ? AND assigned_to IS NOT NULL`,
      [tenantId]
    )
    const completions = await all(
      `SELECT COUNT(*) as count FROM leads WHERE tenant_id = ? AND stage IN ('won','delivered')`,
      [tenantId]
    )
    const unreadNotifications = await all(
      `SELECT COUNT(*) as count FROM notifications WHERE tenant_id = ? AND status != 'read'`,
      [tenantId]
    )

    const totalCapacity = executives.reduce((sum, e) => sum + e.max_lead_limit, 0)
    const totalLoad = executives.reduce((sum, e) => sum + e.current_lead_count, 0)
    const utilizationPercent = totalCapacity > 0 ? Math.round((totalLoad / totalCapacity) * 100) : 0

    return {
      total_executives: executives.length,
      total_capacity: totalCapacity,
      current_load: totalLoad,
      utilization_percent: utilizationPercent,
      total_assignments: Number(assignments[0]?.count || 0),
      total_completions: Number(completions[0]?.count || 0),
      unread_notifications: Number(unreadNotifications[0]?.count || 0),
      executives,
    }
  } catch (err) {
    console.error('getDashboardStats error:', err)
    return null
  }
}

module.exports = {
  setDb,
  onAssignmentNotification,
  assignLead,
  completeLead,
  deactivateExecutive,
  getExecutives,
  getAssignmentHistory,
  getNotifications,
  markNotificationRead,
  getDashboardStats,
}
