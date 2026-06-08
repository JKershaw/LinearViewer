// =============================================================================
// Periodicals registry (LIN-341 / parent LIN-315)
// =============================================================================
//
// Periodicals are recurring, workspace-scoped maintenance tasks rendered as a
// synthetic "Periodicals" group on the main workspace view (behind the
// `periodicals` workspace flag from LIN-340). Each entry is a template:
//
//   { id, title, mode: 'corrective'|'advisory', cadence?, lastRunAt?, generatePrompt() }
//
// v1 ships exactly one corrective template (Documentation Review). The `mode`,
// `cadence`, and `lastRunAt` fields are carried on every template even though
// only `corrective` is wired and nothing consumes cadence/lastRunAt yet
// (advisory mode + autopilot scheduling are deliberately deferred — see the
// out-of-scope notes on LIN-341).
//
// IMPORTANT: templates live in app storage only and are NEVER written to Linear.
// Dispatching a periodical is a *task-generation* step: a worker grounds the
// template against the current repo and mints one well-scoped Linear task, then
// stops. The actual work is done later by whoever picks that task off the stack
// via the normal pipeline — the periodical never executes the work itself.
// =============================================================================

/**
 * @typedef {Object} PeriodicalTemplate
 * @property {string} id - Stable template id (also used as the synthetic node id)
 * @property {string} title - Display title for the row
 * @property {'corrective'|'advisory'} mode - Corrective generates a task that fixes
 *   drift; advisory (deferred) would generate an analysis/proposal task. Only
 *   `corrective` is wired in v1.
 * @property {string} [cadence] - Suggested run cadence (carried, not yet consumed)
 * @property {string|null} [lastRunAt] - ISO timestamp of last run (carried, not yet consumed)
 * @property {() => string} generatePrompt - Produce the dispatchable prompt text
 */

/**
 * Build the Documentation Review prompt.
 *
 * This is a *task-generation* prompt, not a do-the-work prompt: dispatching it
 * mints one well-scoped Linear task and stops. It stays deliberately general —
 * the proxy mechanics come from the appended `+proxy` guide, and the specific doc
 * surfaces are discovered by grounding against the live repo at dispatch time
 * rather than hard-coded here (which would over-fit the template to today's
 * codebase). The review itself is left for whoever picks the task off the stack.
 *
 * @returns {string} Prompt text
 */
function generateDocumentationReviewPrompt() {
  return `# Periodical: Documentation Review

You are dispatching the **Documentation Review** periodical. Your job is to create
one well-scoped Linear task for a documentation review of this codebase — then stop.
You do not do the review yourself; an agent will pick the task up off the stack.

Briefly orient yourself in the repo as it stands today, so the task is grounded in
what's actually here rather than a fixed assumption about it. Then create a Linear
task whose description asks its executor to find and fix where the documentation has
drifted from the code — treating every doc claim as a hypothesis and re-reading the
real source before trusting it. Point it at the doc surfaces that genuinely matter
in this repo (you just saw them while orienting), but let it rediscover the details
itself — don't pre-bake the findings.

Leave the task on the stack in its default state and report its identifier and URL.`
}

/**
 * The registry of periodical templates. v1 seeds exactly one entry.
 * @type {PeriodicalTemplate[]}
 */
export const PERIODICALS = [
  {
    id: 'documentation-review',
    title: 'Documentation Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateDocumentationReviewPrompt
  }
]

/**
 * Get all periodical templates (returns the live registry array).
 * @returns {PeriodicalTemplate[]}
 */
export function getPeriodicals() {
  return PERIODICALS
}

/**
 * Build forest-shaped tree nodes for the synthetic Periodicals group, suitable
 * for `forest.set(PERIODICALS_PROJECT_ID, { roots: buildPeriodicalNodes() })`.
 *
 * Each node mirrors the tree-node shape consumed by the renderer: a synthetic
 * issue-like object (no Linear url/identifier — these are app-only rows) plus
 * the rendered dispatch prompt and the periodical's mode, which the renderer
 * uses to draw a dispatch affordance instead of issue prompt buttons.
 *
 * @returns {Array<{issue: Object, children: [], depth: number, periodical: Object}>}
 */
export function buildPeriodicalNodes() {
  return PERIODICALS.map(template => ({
    issue: {
      id: template.id,
      identifier: null,
      title: template.title,
      // No url/description/assignee/labels: a periodical is not a Linear issue.
      state: { name: 'Periodical', type: 'unstarted' }
    },
    children: [],
    depth: 0,
    // Carried for the renderer (see lib/render.js renderProject periodicals branch).
    periodical: {
      id: template.id,
      title: template.title,
      mode: template.mode,
      prompt: template.generatePrompt()
    }
  }))
}
