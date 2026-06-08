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

- **Scope & method.** Assess the docs along two dimensions, drift first. **Drift/accuracy** is
  foundational: treat every doc claim as a hypothesis — locate the concrete thing it asserts (a
  path, export, route, CLI flag, env var, request/response shape, DOM selector), verify it against
  the source at HEAD before trusting it, then fix minimally — or, where code and doc disagree about
  intent rather than wording, flag it instead of guessing. \`git log\`/\`diff\` is a lead, not proof;
  a fix must not introduce a new unverified claim. Then **quality**, fixed *subtractively* —
  consolidate / tighten / relocate / delete, never net-new docs: brevity/redundancy (one fact in
  several places, or verbose where terse works → consolidate, delete duplicates); organisation /
  single-purpose (one doc mixing reference, tutorial, and explanation, or content in the wrong file
  → split, merge, relocate); discoverability (content that exists but a reader can't reach —
  orphaned, unlinked from where they'd look → add a cross-reference, relocate); readability for an
  agent + dev audience (scannable structure, literal copy-pasteable commands not "run the CLI",
  jargon defined — not prose-grade reading-level metrics).
- **Surfaces & bounding.** Point the executor at the doc surfaces that genuinely matter in
  this repo (you just saw them while orienting) as a starting map, not a fixed list — let it
  rediscover the details. Bound the effort: one breadth-first pass weighted by drift risk,
  fixing high-impact/low-effort drift first rather than chasing every surface to exhaustion.
- **Definition of done.** Drift corrected and quality defects fixed with minimal, source-traceable
  edits, plus a short summary of what was checked, what changed, and anything where a code/doc
  disagreement needs a human decision rather than a silent edit. Report the net doc line/file delta:
  a good pass is net-neutral-to-negative, and any growth must be justified. A clean review — nothing
  to fix — and a change that deletes or merges docs are both valid, reportable wins, not failures.
- **Hand-off.** Doc-only: don't edit code, secrets, or config to make a doc true. Land fixes
  via the repo's normal branch→PR flow; put the summary and any human-decision items in the
  PR body (and/or a comment on the task). Include the repo's real verify commands (the ones
  you noted while orienting) so the executor can confirm the build and tests are unaffected.
  Linear access and final reporting are supplied by the harness — don't restate them.
- **Optional.** Note, but don't fix, any wholly undocumented feature or other completeness gap —
  adding net-new docs is a lead for a future review, outside this corrective pass.

Leave the task on the stack in its default state and report its identifier and URL.`
}

/**
 * Build the Test Coverage Gap Review prompt.
 *
 * Like Documentation Review, this is a *task-generation* prompt, not a do-the-work
 * prompt: dispatching it grounds against the live repo's coverage report and mints
 * one well-scoped Linear task, then stops. It specifies the *contract* the minted
 * task must carry — scope, the objective grounding source (Node's native coverage),
 * bounding, definition of done, and hand-off — but leaves the concrete untested
 * surfaces to be discovered from the coverage report at dispatch time rather than
 * hard-coded here (which would over-fit the template to today's gaps). Linear access
 * and final reporting come from the appended `+proxy` guide and the runner's Stop
 * hook, so the prompt deliberately does not restate them. The tests themselves are
 * left for whoever picks the task off the stack. (Mirrors the Documentation Review
 * discipline grounded in LIN-343/349.)
 *
 * @returns {string} Prompt text
 */
function generateTestCoverageGapPrompt() {
  return `# Periodical: Test Coverage Gap Review

You are dispatching the **Test Coverage Gap Review** periodical. Your job is to mint one
well-scoped Linear task to close the single highest-value test-coverage gap in this
codebase — then stop. You do not write the tests yourself; another agent picks the task
off the stack and runs it cold, with only the task description plus repo access to go on.
So the description has to carry everything that agent needs.

First, briefly orient yourself in the repo as it stands today — how tests are invoked and
where they live, the branch and PR conventions — then run the native coverage report as
your objective ground truth: \`node --test --experimental-test-coverage\` over the repo's
test files (orient to find the exact invocation; do not introduce a new coverage
dependency). Read the per-file uncovered-line report, not just the summary percentages.
Then write a Linear task whose description spells out:

- **Scope & method.** Read the coverage report as evidence, then pick the *one* highest-value
  gap — weighted toward paths where an untested defect is most costly: error/failure handling,
  auth/token boundaries, quota/money/rate-limit logic, and data-integrity (storage, parsing,
  state transitions). Two grounding traps to avoid: (1) the report only lists modules that some
  test actually loads, so a module with *zero* coverage is absent from the table entirely, not
  shown at 0% — the worst gaps can be invisible. Cross-check the module list against the source
  tree and treat a critical module that never appears as a top candidate. (2) A low percentage is
  a lead, not proof: a file can read as poorly covered because a *different* suite exercises it
  (e.g. route/server paths driven by E2E rather than unit tests), so a unit-only report
  *undercounts* it; conversely full line coverage can still hide an unasserted branch. Before
  committing to a target, verify the gap is real against the actual uncovered lines and what they do.
- **Surfaces & bounding.** Point the executor at the gap you found (the file and the specific
  untested paths — you just saw them in the report) as a starting map, not a fixed list — let it
  re-read the source and rediscover the details. Bound the effort to one coherent, reviewable
  unit of new tests for that single gap, not a sweep of the whole report.
- **Quality bar — meaningful coverage, no theater.** The task must demand *behavioral* tests that
  assert on real outcomes (return values, thrown errors, persisted/observable state), and must
  explicitly forbid coverage-theater: no assertion-free tests, no tests so heavily mocked they only
  re-assert the mocks, no tests that merely execute lines to move the percentage without verifying
  behavior. Prefer exercising the real unit over structural stand-ins; mock only true external
  boundaries (network, clock, randomness). The win is a defect that the new tests would now catch,
  not a higher number.
- **Definition of done.** Meaningful behavioral tests added for the chosen gap, green against the
  repo's real test command, plus a short summary of which paths are now covered and what defect
  class each test guards against. Report the before/after coverage for the touched file as
  supporting evidence — but the percentage is corroboration, not the goal.
- **Hand-off.** Test-only by default: don't change production behavior to make a test pass; if a
  path is untestable without a refactor or looks genuinely dead, flag it for a human decision
  rather than forcing a test around it. Land the tests via the repo's normal branch→PR flow; put
  the summary in the PR body (and/or a comment on the task). Include the repo's real test command
  so the executor can confirm the suite is green. Linear access and final reporting are supplied by
  the harness — don't restate them.
- **Clean result.** If the critical paths (error handling, auth/token, quota/money, data integrity)
  are already meaningfully covered and the remaining gaps are low-value, that is a valid, reportable
  win: mint no task, and report what you checked and why no gap warranted one. Do not invent
  make-work to chase 100%.

Leave the task on the stack in its default state and report its identifier and URL.`
}

/**
 * The registry of periodical templates. Seeds the corrective templates broken out
 * one at a time under LIN-344 (Documentation Review, then Test Coverage Gap Review).
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
  },
  {
    id: 'test-coverage-gap',
    title: 'Test Coverage Gap Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateTestCoverageGapPrompt
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
