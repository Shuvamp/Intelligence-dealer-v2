'use strict'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NODE 4 — ASSIGN          OWNER: KEERTHANA                                  ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  Position : Source ─▶ validate ─▶ normalize ─▶ score ─▶ [ASSIGN] ─▶ DB     ║
 * ║  Reads    : state.normalized, state.scoring                                ║
 * ║  Writes   : { assignment: { assigned_to, assignee_name, reason } }         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Picks which sales rep gets the lead. Has DB access via deps.all to look up
 * the tenant's sales team. Selection is least-loaded: the rep with the fewest
 * currently-open leads wins, so intake spreads evenly across the sales floor
 * and the /assignments dashboard's per-exec counts stay balanced.
 *
 * Contract: see ../pipeline-contracts.js
 */

// Stages that no longer count toward a rep's live workload.
const CLOSED_STAGES = ['won', 'lost', 'delivered']

/**
 * @param {import('../pipeline-contracts').PipelineState} state
 * @param {import('../pipeline-contracts').NodeDeps} deps
 * @returns {Promise<{ assignment: import('../pipeline-contracts').Assignment }>}
 */
async function assignNode(state, deps) {
  // Pull the assignable sales team for this tenant, each with their current
  // open-lead count, fewest first. One query, computed live from the leads
  // table so it always reflects reality (manual reassigns included).
  let team = []
  try {
    const closed = CLOSED_STAGES.map((s) => `'${s}'`).join(', ')
    team = await deps.all(
      `SELECT u.id, u.full_name,
              (SELECT COUNT(*) FROM leads l
                 WHERE l.assigned_to = u.id AND l.stage NOT IN (${closed})) AS load
       FROM users u
       WHERE u.tenant_id = ? AND u.role IN ('sales_executive','dealer_manager','dealer_owner')
       ORDER BY load ASC, u.full_name ASC`,
      [deps.tenantId],
    )
  } catch (err) {
    console.warn('[assign] team lookup failed:', err.message)
  }

  if (!team.length) {
    return { assignment: { assigned_to: null, assignee_name: null, reason: 'no sales team available' } }
  }

  // Least-loaded wins (query is already ordered by load ASC).
  const rep = team[0]
  const load = Number(rep.load ?? 0)

  return {
    assignment: {
      assigned_to: rep.id,
      assignee_name: rep.full_name,
      reason: `least-loaded executive (${load} open lead${load === 1 ? '' : 's'})`,
    },
  }
}

module.exports = { assignNode }
