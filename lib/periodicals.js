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
 * mints one well-scoped Linear task and stops. It specifies the *contract* the
 * minted task must carry so a fresh agent can run it cold off the stack — scope,
 * grounding method, bounding, definition of done, and hand-off — but it still
 * leaves the concrete doc surfaces and verify commands to be discovered by
 * grounding against the live repo at dispatch time rather than hard-coded here
 * (which would over-fit the template to today's codebase). Linear access and final
 * reporting come from the appended `+proxy` guide and the runner's Stop hook, so
 * the prompt deliberately does not restate them. The review itself is left for
 * whoever picks the task off the stack. (Contract shape grounded in LIN-343.)
 *
 * @returns {string} Prompt text
 */
function generateDocumentationReviewPrompt() {
  return `# Periodical: Documentation Review

You are dispatching the **Documentation Review** periodical. Your job is to mint one
well-scoped Linear task for a documentation review of this codebase — then stop. You do
not do the review yourself; another agent picks the task off the stack and runs it cold,
with only the task description plus repo access to go on. So the description has to carry
everything that agent needs.

First, briefly orient yourself in the repo as it stands today — the doc surfaces that
actually matter, the test/verify commands, the branch and PR conventions — so the task is
grounded in what's here rather than a fixed assumption about it. Then write a Linear task
whose description spells out:

- **Scope & method.** Find and fix where the docs have drifted from the code. Treat every
  doc claim as a hypothesis: locate the concrete thing it asserts (a path, export, route,
  CLI flag, env var, request/response shape, DOM selector), verify it against the source at
  HEAD before trusting it, then fix minimally — or, where code and doc disagree about intent
  rather than wording, flag it instead of guessing. \`git log\`/\`diff\` is a lead, not proof;
  and a fix must not introduce a new unverified claim.
- **Surfaces & bounding.** Point the executor at the doc surfaces that genuinely matter in
  this repo (you just saw them while orienting) as a starting map, not a fixed list — let it
  rediscover the details. Bound the effort: one breadth-first pass weighted by drift risk,
  fixing high-impact/low-effort drift first rather than chasing every surface to exhaustion.
- **Definition of done.** Drift corrected with minimal, source-traceable edits, plus a short
  summary of what was checked, what drifted, and anything where a code/doc disagreement needs
  a human decision rather than a silent edit. A clean review — nothing drifted — is a valid,
  reportable outcome, not a failure.
- **Hand-off.** Doc-only: don't edit code, secrets, or config to make a doc true. Land fixes
  via the repo's normal branch→PR flow; put the summary and any human-decision items in the
  PR body (and/or a comment on the task). Include the repo's real verify commands (the ones
  you noted while orienting) so the executor can confirm the build and tests are unaffected.
  Linear access and final reporting are supplied by the harness — don't restate them.
- **Optional.** Note, but don't fix, any feature you find that is wholly undocumented — a
  lead for a future review, outside this corrective pass.

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
