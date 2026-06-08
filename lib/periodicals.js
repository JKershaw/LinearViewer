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
 * Build the Secrets & Credential Scan prompt.
 *
 * Like the other correctives, this is a *task-generation* prompt, not a do-the-work
 * prompt: dispatching it grounds against the repo's tracked surface and mints one
 * well-scoped Linear task, then stops. It specifies the *contract* the minted task
 * must carry — scope, the objective grounding source (`git grep` over the tree +
 * `git log -p` over history, against patterns derived at run time from the repo's
 * own token formats), bounding, the anti-report-cleaning-theater remediation bar,
 * definition of done, and hand-off — but it deliberately bakes in no pattern set,
 * no secret literals, and no scanner dependency (that would over-fit the template
 * and violate the repo's no-new-deps principle). The dispatched periodical derives
 * the concrete patterns from the live code at dispatch time. Linear access and final
 * reporting come from the appended `+proxy` guide and the runner's Stop hook, so the
 * prompt does not restate them. The remediation itself is left for whoever picks the
 * task off the stack. (Mirrors the Documentation Review / Test Coverage Gap discipline
 * grounded in LIN-343/349/351.)
 *
 * @returns {string} Prompt text
 */
function generateSecretsScanPrompt() {
  return `# Periodical: Secrets & Credential Scan

You are dispatching the **Secrets & Credential Scan** periodical. Your job is to mint one
well-scoped Linear task to neutralise the single highest-severity exposed credential in this
codebase — then stop. You do not do the remediation yourself; another agent picks the task off
the stack and runs it cold, with only the task description plus repo access to go on. So the
description has to carry everything that agent needs.

First, briefly orient yourself in the repo as it stands today — the branch and PR conventions, and
which providers and token formats this codebase actually uses (you will need those formats in a
moment). Then run the **objective reference**: scan the git-tracked surface — the working tree *and*
its history — for high-confidence secret literals, using only built-in \`git\` (introduce no scanner
dependency — a third-party secret scanner would add a dependency this repo deliberately avoids):

- Derive the concrete pattern set at run time from the token formats this repo really uses — the
  provider key prefixes you just saw while orienting (the auth keys and bearer tokens this app issues
  and consumes), plus generic high-entropy \`KEY=\` / \`SECRET=\` / \`PASSWORD=\` assignments and
  well-known cloud-provider key prefixes. Do not assume today's set is complete; rebuild it from
  what is in the code now rather than from a fixed list.
- Search the **working tree** with \`git grep\` and the **history** with \`git log -p\` (or an
  equivalent full-history walk) against that pattern set.
- Verify the secret-bearing files (\`.env\` and any equivalents) are gitignored and untracked — only
  \`.env.example\` should be tracked, and it must hold placeholders, not real values.

**Name the grounding trap.** A working-tree-only scan can report "clean" while a live credential sits
in a past commit: a secret committed earlier and later deleted from the tree is gone from \`HEAD\` but
still recoverable from history. So scanning only the tree (or only \`HEAD\`) is the trap — you must
scan history too. A hit anywhere in tracked content, tree or history, is a real finding until proven
a placeholder.

Triage every hit: a concrete live credential is a real finding; a value that is genuinely a
placeholder, example, test fixture, or an intentional, documented non-secret default (e.g. a
labelled local-development fallback, not a real third-party credential) is a true negative — do
not mint a task for those. Severity-rank the real findings (a live
credential with broad scope or write access, or one still valid, outranks a low-scope or
already-revoked one). Then write a Linear task for the **single highest-severity** finding whose
description spells out:

- **Scope & method.** Restate the one finding — where it surfaced (working tree, history, or both)
  and what kind of credential it is, *without copying the secret value into the task* — and direct the
  executor to confirm it is live, not a placeholder, before acting.
- **Remediation contract — no report-cleaning theater.** The task must explicitly forbid making the
  finding *disappear from the report* instead of neutralising the exposure: no suppressing it, no
  allowlisting / ignore-listing it, no deleting it from the working tree only. Each of those hides
  the finding while the credential stays live and, if it was ever committed, still sits in history.
  The only valid resolution for a confirmed live secret is BOTH of: (1) **remove it from tracked
  content** — and because history is part of the tracked surface, when the secret is in past commits,
  flag history-rewrite / secret-purge as a **human-decision item** rather than rewriting shared
  history unilaterally — **and (2) rotate / revoke** the credential at its source, so the exposed
  value is dead even if a copy lingers somewhere. A finding may be closed as a non-issue only if it
  is genuinely a placeholder / example / test fixture / documented non-secret default (a true
  negative) — never by suppression.
- **Bounding.** One finding, one coherent remediation. Do not turn this into a sweep of every hit;
  note the rest as leads for the next run.
- **Definition of done.** The credential removed from tracked content *and* rotated/revoked at the
  source (or, if it proves a true placeholder on inspection, that documented with evidence), plus a
  short summary of what was exposed, on which surface (tree/history), how it was neutralised, and any
  history-rewrite left as a human decision. Removing the value from the tree without rotating it is
  *not* done — the leaked credential is still live.
- **Hand-off.** Land the change via the repo's normal branch→PR flow; put the summary and any
  human-decision items in the PR body (and/or a comment on the task). Never paste a real secret into
  the task, the branch, or the PR while fixing it. Linear access and final reporting are supplied by
  the harness — don't restate them.

**Clean result.** If no tracked content — neither the working tree nor history — carries a live
credential, and the only hits are placeholders (e.g. in \`.env.example\`), that is a valid, reportable
win: mint no task, and report which pattern set and which surface (tree + history) you checked and why
nothing warranted a task. Do not invent make-work.

Leave the task on the stack in its default state and report its identifier and URL.`
}

/**
 * Build the Prompt-Injection Surface Review prompt.
 *
 * Like the other correctives, this is a *task-generation* prompt, not a do-the-work
 * prompt: dispatching it traces, at run time, how attacker-influenceable Linear ticket
 * content flows into the prompts handed to AI workers, picks the single highest-severity
 * injection vector, and mints one well-scoped Linear task to add a real data/code
 * boundary there — then stops. It specifies the *contract* the minted task must carry —
 * scope, the trace-it-yourself grounding method, the don't-rely-on-a-model-instruction
 * bar, bounding, definition of done, and hand-off — but it deliberately bakes in no file
 * paths, no symbol names, and no line numbers (that would over-fit the template to today's
 * call sites and rot as the code moves). The dispatched periodical rediscovers the concrete
 * seam from the live code. Linear access and final reporting come from the appended
 * `+proxy` guide and the runner's Stop hook, so the prompt does not restate them. The
 * mitigation itself is left for whoever picks the task off the stack. (Mirrors the
 * Documentation Review / Test Coverage Gap / Secrets Scan discipline grounded in
 * LIN-343/349/351/352.)
 *
 * @returns {string} Prompt text
 */
function generatePromptInjectionReviewPrompt() {
  return `# Periodical: Prompt-Injection Surface Review

You are dispatching the **Prompt-Injection Surface Review** periodical. Your job is to mint one
well-scoped Linear task to close the single highest-severity prompt-injection vector in this
codebase — then stop. You do not build the mitigation yourself; another agent picks the task off
the stack and runs it cold, with only the task description plus repo access to go on. So the
description has to carry everything that agent needs.

This repo's defining trait is that AI agents pull Linear tickets and *execute* their content. That
content — ticket titles, descriptions, comment bodies — is **attacker-influenceable**: anyone who
can file or comment on a ticket can put text in it, and that text is later assembled into the prompt
handed to a worker that runs commands. So the question this review answers is: where does untrusted
ticket content cross into a trusted instruction channel with no boundary between the two?

First, briefly orient yourself in the repo as it stands today — the branch and PR conventions — then
**trace the path yourself**, at HEAD, rather than trusting any prior description of it: follow
attacker-influenceable content from where it enters (the ticket/comment fields the app reads back
from the provider) through the context-assembly seam where it is formatted into prompt text, to the
worker prompts that go to the model. As you trace, look for the asymmetry: this codebase already
enforces a real **data/code split** at the shell-execution boundary — untrusted data is passed as
data and never interpolated into the command as code — so use that as your reference for what a
genuine boundary looks like, and check whether the prompt-assembly path has an equivalent. Note
where the *only* thing standing between untrusted content and the model is an instruction *to* the
model to behave; that is an aspirational guard, not a technical boundary, and it does not count as
one. Then write a Linear task whose description spells out:

- **Scope & method.** Restate the one highest-severity vector you found — the concrete seam where
  attacker-influenceable content enters a prompt with no data/code separation — and direct the
  executor to re-trace that path itself against the source at HEAD (not to trust the line/symbol
  references in the task, which are a starting map, not ground truth) before changing anything.
  Severity-rank by blast radius: a vector whose output reaches a worker that *executes commands*
  outranks one that only reaches a read-only summary.
- **Mitigation contract — a real boundary, not a stronger instruction.** The task must add an actual
  technical data/code boundary at the seam, mirroring the discipline the shell path already has:
  treat untrusted ticket content as *data, not instructions* — for example, isolate it behind an
  explicit delimiting envelope and label it as untrusted at the formatting step — rather than merely
  adding or strengthening a please-ignore-injected-instructions note in the prompt. A model
  instruction alone is explicitly **not** an acceptable resolution, because it is guidance the model
  may disregard, not a guarantee. Forbid the theater move of declaring the gap closed by editing the
  meta-prompt wording while the raw content still flows in unbounded.
- **Both prompt paths.** If the repo assembles worker prompts along more than one path (e.g. a
  deterministic template path and an LLM-generated path), the mitigation must cover the seam on every
  path that carries untrusted content, not just the first one found — name each path the chosen
  vector touches so the executor cannot silently fix one and leave the other open.
- **Bounding.** One vector, one coherent mitigation at one seam. Do not turn this into a sweep of
  every place untrusted content is read; note the rest as leads for the next run.
- **Definition of done.** A real data/code boundary in place at the chosen seam so injected
  instructions in ticket content are carried as inert data, verified by the repo's normal test
  command staying green, plus a short summary of the vector, the boundary added, and which prompt
  paths it covers. Strengthening a model instruction without adding a technical boundary is *not*
  done.
- **Hand-off.** Land the change via the repo's normal branch→PR flow; put the summary and any
  human-decision items in the PR body (and/or a comment on the task). Linear access and final
  reporting are supplied by the harness — don't restate them.

**Clean result.** If every path that carries attacker-influenceable content into a worker prompt
already enforces a genuine data/code boundary — not just a model instruction — that is a valid,
reportable win: mint no task, and report which paths you traced and why none warranted one. Do not
invent make-work.

Leave the task on the stack in its default state and report its identifier and URL.`
}

/**
 * The registry of periodical templates. Seeds the corrective templates broken out
 * one at a time under LIN-344 (Documentation Review, Test Coverage Gap Review,
 * Secrets & Credential Scan, then Prompt-Injection Surface Review).
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
  },
  {
    id: 'secrets-scan',
    title: 'Secrets & Credential Scan',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateSecretsScanPrompt
  },
  {
    id: 'prompt-injection-review',
    title: 'Prompt-Injection Surface Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generatePromptInjectionReviewPrompt
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
