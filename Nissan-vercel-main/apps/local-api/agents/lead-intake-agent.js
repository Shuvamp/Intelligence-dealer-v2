'use strict'

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LEAD INTAKE PIPELINE — ORCHESTRATOR        OWNER: PARTHA
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   Source ─▶ validate ─▶ normalize ─▶ score ─▶ assign ─▶ (return) ─▶ DB
 *             (Amirtha)   (Partha)     (Csriram) (Keerthana)
 *
 * Each stage is a plain async node in ./nodes/*.node.js. This file just WIRES
 * them together. Teammates edit only their node file — never this one.
 *
 * Two execution modes (both run the exact same node functions):
 *   • LangGraph mode  — when @langchain/langgraph is installed AND
 *                       ANTHROPIC_API_KEY is set. Builds a real StateGraph.
 *   • Sequential mode — zero-config local dev. Calls the nodes in order.
 *
 * Contract for every node: ./pipeline-contracts.js   ← read this first.
 */

const { emptyState } = require('./pipeline-contracts')
const { validateNode } = require('./nodes/validate.node')
const { normalizeNode, NORMALIZE_TEMPLATE } = require('./nodes/normalize.node')
const { scoreNode } = require('./nodes/score.node')
const { assignNode } = require('./nodes/assign.node')

let StateGraph, Annotation, END, START
let ChatAnthropic, ChatPromptTemplate, JsonOutputParser
try {
  ;({ StateGraph, Annotation, END, START } = require('@langchain/langgraph'))
  ;({ ChatAnthropic } = require('@langchain/anthropic'))
  ;({ ChatPromptTemplate } = require('@langchain/core/prompts'))
  ;({ JsonOutputParser } = require('@langchain/core/output_parsers'))
} catch {
  // not installed — sequential mode handles everything
}

class LeadIntakeAgent {
  /**
   * @param {Object} options
   * @param {Function} options.all       DB SELECT  (sql, params) => rows
   * @param {Function} options.run       DB write   (sql, params) => void
   * @param {string}   options.tenantId  tenant all intake leads belong to
   */
  constructor({ all, run, tenantId } = {}) {
    this.graph = null

    // Optional Claude model + normalize chain, shared with nodes via deps.
    this._model = null
    this._chain = null
    if (ChatAnthropic && process.env.ANTHROPIC_API_KEY) {
      try {
        this._model = new ChatAnthropic({ model: 'claude-haiku-4-5-20251001', temperature: 0, maxTokens: 256 })
        this._chain = ChatPromptTemplate.fromTemplate(NORMALIZE_TEMPLATE).pipe(this._model).pipe(new JsonOutputParser())
      } catch (err) {
        console.warn('[LeadIntakeAgent] Claude init failed:', err.message)
      }
    }

    // `deps` is handed to every node. This is the only integration surface.
    this.deps = {
      all: all ?? (async () => []),
      run: run ?? (async () => {}),
      tenantId,
      getModel: () => this._model,
      chain: this._chain,
    }

    // Build a real StateGraph only when both langgraph + a model are present.
    if (StateGraph && this._model) {
      try {
        this.graph = this._buildGraph()
        console.log('[LeadIntakeAgent] LangGraph StateGraph active — validate→normalize→score→assign (Claude)')
      } catch (err) {
        console.warn('[LeadIntakeAgent] LangGraph build failed, sequential mode:', err.message)
      }
    }
    if (!this.graph) {
      console.log('[LeadIntakeAgent] Sequential mode — validate→normalize→score→assign (static, zero-config)')
    }
  }

  _buildGraph() {
    const deps = this.deps
    const S = Annotation.Root({
      rawLead:    Annotation({ reducer: (x, y) => y ?? x }),
      source:     Annotation({ reducer: (x, y) => y ?? x }),
      errors:     Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
      normalized: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
      scoring:    Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
      assignment: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
    })

    return new StateGraph(S)
      .addNode('validate',  (s) => validateNode(s, deps))
      .addNode('normalize', (s) => normalizeNode(s, deps))
      .addNode('score',     (s) => scoreNode(s, deps))
      .addNode('assign',    (s) => assignNode(s, deps))
      .addEdge(START, 'validate')
      .addConditionalEdges('validate', (s) => (s.errors.length > 0 ? END : 'normalize'))
      .addEdge('normalize', 'score')
      .addEdge('score', 'assign')
      .addEdge('assign', END)
      .compile()
  }

  /**
   * Run a raw lead through the full pipeline.
   * @returns {Promise<{ normalized, scoring, assignment }>}
   * @throws if validation fails (caller turns this into HTTP 400)
   */
  async process(rawLead, source) {
    if (this.graph) {
      const out = await this.graph.invoke(emptyState(rawLead, source))
      if (out.errors?.length) throw new Error('Lead validation failed: ' + out.errors.join(', '))
      return { normalized: out.normalized, scoring: out.scoring, assignment: out.assignment }
    }

    // ── Sequential mode — same nodes, called in order ───────────────────────
    const state = emptyState(rawLead, source)

    Object.assign(state, await validateNode(state, this.deps))
    if (state.errors.length) throw new Error('Lead validation failed: ' + state.errors.join(', '))

    Object.assign(state, await normalizeNode(state, this.deps))
    Object.assign(state, await scoreNode(state, this.deps))
    Object.assign(state, await assignNode(state, this.deps))

    return { normalized: state.normalized, scoring: state.scoring, assignment: state.assignment }
  }
}

module.exports = { LeadIntakeAgent }
