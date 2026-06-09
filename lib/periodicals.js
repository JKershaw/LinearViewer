// =============================================================================
// Periodicals registry (LIN-341 / parent LIN-315 / LIN-344 / LIN-354)
// =============================================================================
//
// Periodicals are recurring, workspace-scoped review templates rendered as a
// synthetic "Periodicals" group on the main workspace view (behind the
// `periodicals` workspace flag from LIN-340). Each entry is a template:
//
//   { id, title, mode, cadence?, lastRunAt?, generatePrompt() }
//
// TWO-STAGE "META" CONTRACT (LIN-354):
//
//   Stage 1 — dispatch the periodical. An agent runs the prompt below. Its job
//   is a *task-generation* step: research the repo and mint ONE well-scoped,
//   project-specific *review task* onto the Linear stack, then stop. The
//   periodical's deliverable is that task, NOT the review — the prompt carries
//   the universal "how to do a good X review" expertise and the agent grounds
//   it into a concrete task for this codebase.
//
//   Stage 2 — the minted review task runs (later, picked off the stack by a
//   human or autopilot, same as any task). That run performs the review and
//   produces a *report*: a severity-ranked write-up of all findings (nothing,
//   one, or several — uncapped), drafts candidate follow-up tickets inline
//   without creating them, and leaves the task In Progress. A natural
//   review/triage step then acts on the report — applying fixes or minting
//   specific follow-up tasks. (Autopilot is not yet wired to dispatch
//   periodicals; that comes after these are tested. Once a review task is on
//   the stack, though, the normal recommend/loop already drives it.)
//
// So the whole report/no-cap/propose-don't-create/leave-In-Progress contract is
// written by the periodical INTO the minted task's description — Stage 1 just
// mints the task. Templates leave the project specifics (which surfaces, which
// commands, where reports live) to be discovered by grounding against the repo
// at dispatch time, so the same template is broadly valuable to any codebase.
// Templates live in app storage only and are never written to Linear; the
// minted task and its report do.
//
// `mode` currently only drives a cosmetic badge in the renderer; the
// corrective/advisory taxonomy predates this reframe and is left untouched
// (every entry stays 'corrective'). `cadence`/`lastRunAt` are carried but not
// yet consumed (autopilot scheduling remains deferred).
//
// NOTE: the five prompt builders below intentionally repeat the shared Stage-1
// scaffold rather than sharing a helper — keeping each prompt a single, fully
// readable string while these are still being tuned (LIN-354). Factor a helper
// later if the contract stabilises.
// =============================================================================

/**
 * @typedef {Object} PeriodicalTemplate
 * @property {string} id - Stable template id (also used as the synthetic node id)
 * @property {string} title - Display title for the row
 * @property {'corrective'|'advisory'} mode - Rendered as a badge only.
 * @property {string} [cadence] - Suggested run cadence (carried, not yet consumed)
 * @property {string|null} [lastRunAt] - ISO timestamp of last run (carried, not yet consumed)
 * @property {() => string} generatePrompt - Produce the dispatchable prompt text
 */

/**
 * Documentation Review (LIN-341/349, broadened under LIN-354 to README quality,
 * inline comments, and API documentation alongside drift + subtractive quality).
 * @returns {string} Prompt text
 */
function generateDocumentationReviewPrompt() {
  return `# Periodical: Documentation Review

You are dispatching the **Documentation Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive a documentation review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

First, briefly orient yourself in the repo as it stands today — the doc surfaces that actually matter, the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first.** Find and read this review's earlier reports, and focus on what is still open or was never reached — build on them rather than re-deriving the same report or re-flagging what's already handled.
- **Run the review.** Assess the docs for an audience of both developers and AI agents, **drift first**. *Accuracy/drift* is foundational: treat each doc claim as a hypothesis — locate the concrete thing it asserts (a path, export, route, CLI flag, env var, request/response shape, selector) and verify it against the source at HEAD before trusting it; disagreement on wording is a drift finding, disagreement on intent is a human-decision flag. Then *README & entry-point quality* (does a newcomer get oriented fast, without drowning?), *inline comments* (do they explain **why** rather than restate **what** — flag both non-obvious code missing rationale and stale/misleading comments), *API & interface documentation* (are the contracts this project exposes — endpoints, commands, exports — documented and current: inputs, outputs, errors, auth/scope?), and *quality assessed subtractively* (redundancy, organisation, discoverability, readability — fixed by consolidate / tighten / relocate / delete, not net-new prose). Treat unjustified doc growth (inflation) as a finding in its own right, not a sign of thoroughness.
- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against the source at HEAD, not prior prose. Record the report wherever the convention you found puts it.
- **Propose follow-up tickets — don't create them.** For findings worth acting on, draft candidate tickets inline (title + short scope), severity-ordered, so triage can accept or discard at a glance. Do not put anything on the stack yourself.
- **Leave the task In Progress.** Writing the report does not finish the task — leave it In Progress (do not close it) so the natural review/triage step can act on the report: apply straightforward fixes, or mint specific follow-up tasks for what's worth doing.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * Test Coverage Gap Review (LIN-351).
 * @returns {string} Prompt text
 */
function generateTestCoverageGapPrompt() {
  return `# Periodical: Test Coverage Gap Review

You are dispatching the **Test Coverage Gap Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive a test-coverage review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

First, briefly orient yourself in the repo as it stands today — how tests are invoked and where they live, the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first.** Find and read this review's earlier reports, and focus on what is still open or was never reached — build on them rather than re-deriving the same report or re-flagging what's already handled.
- **Run the review.** Run the native coverage report as objective ground truth — \`node --test --experimental-test-coverage\` (find the exact invocation; introduce no new coverage dependency) — and read the per-file **uncovered-line** detail, not just summary percentages. Weight gaps by how costly an untested defect would be: error/failure handling, auth/token boundaries, quota/money/rate-limit logic, data integrity. Two grounding traps: a module with **zero** coverage is absent from the table entirely (cross-check the module list against the source tree), and a low percentage can mean a *different* suite (e.g. end-to-end) exercises it (a unit-only report undercounts), while full line coverage can still hide an unasserted branch — confirm each gap against the actual uncovered lines and what they do. Distinguish a real gap from coverage-theater: any fix proposed must demand **behavioral** tests that assert real outcomes (return values, thrown errors, observable state) and forbid assertion-free or test-the-mock tests — the win is a defect the tests would catch, never a higher number.
- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against the source at HEAD, not prior prose. Record the report wherever the convention you found puts it.
- **Propose follow-up tickets — don't create them.** For findings worth acting on, draft candidate tickets inline (title + short scope), severity-ordered, so triage can accept or discard at a glance. Do not put anything on the stack yourself.
- **Leave the task In Progress.** Writing the report does not finish the task — leave it In Progress (do not close it) so the natural review/triage step can act on the report: apply straightforward fixes, or mint specific follow-up tasks for what's worth doing.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * Security Review (LIN-354) — broad, OWASP-style security review that
 * consolidates the former standalone Secrets & Credential Scan and
 * Prompt-Injection Surface Review periodicals into one.
 * @returns {string} Prompt text
 */
function generateSecurityReviewPrompt() {
  return `# Periodical: Security Review

You are dispatching the **Security Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive a security review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

First, briefly orient yourself in the repo as it stands today — the providers and token formats this codebase uses, the request-handling and trust boundaries it has, the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first.** Find and read this review's earlier reports, and focus on what is still open or was never reached — build on them rather than re-deriving the same report or re-flagging what's already handled.
- **Run the review.** Walk the security surface this repo actually exposes, grounding every finding against real handlers at HEAD rather than a generic checklist. Cover at least: *exposed credentials* — scan the git-tracked surface, the working tree **and** its history, for high-confidence secret literals using only built-in \`git\` (\`git grep\` over the tree, \`git log -p\` over history; introduce no scanner dependency), deriving the pattern set at run time from the token formats this repo uses plus generic \`KEY=\` / \`SECRET=\` / \`PASSWORD=\` assignments and known cloud-provider prefixes (trap: a working-tree-only or HEAD-only scan misses a live secret sitting in a past commit; a confirmed live secret is only neutralised by removing it from tracked content **and** rotating/revoking it at source, with any history-rewrite flagged as a human decision — never by suppress / allowlist / delete-from-tree-only); *injection & trust boundaries* — trace untrusted, externally-influenceable input (request bodies, query params, externally-sourced content, and on a codebase where agents execute externally-authored content, that content itself) to the sinks where it crosses into a trusted channel (shell/command execution, query construction, HTML output, any prompt assembled for an AI worker), and flag where one boundary carries input as **data** while a parallel path interpolates it as code — an instruction telling a model or consumer to behave is an aspirational guard, not a technical boundary; and *the broad classes* — broken access control and tenant/workspace isolation, authentication and session handling, sensitive-data exposure, server-side request forgery / unsafe outbound requests, security misconfiguration, and dependency risk. Severity-rank by blast radius: a vector reaching command execution or cross-tenant data outranks a low-scope, already-mitigated, or theoretical one.
- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against the source at HEAD, not prior prose. Record the report wherever the convention you found puts it.
- **Propose follow-up tickets — don't create them.** For findings worth acting on, draft candidate tickets inline (title + short scope), severity-ordered, so triage can accept or discard at a glance. Do not put anything on the stack yourself.
- **Leave the task In Progress.** Writing the report does not finish the task — leave it In Progress (do not close it) so the natural review/triage step can act on the report: apply straightforward fixes, or mint specific follow-up tasks for what's worth doing.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets — and never copy a real secret value into the report, the task, or a branch. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * API Quality Review (LIN-354) — design, validation, and error-handling
 * quality of whatever API surface the repo exposes.
 * @returns {string} Prompt text
 */
function generateApiQualityPrompt() {
  return `# Periodical: API Quality Review

You are dispatching the **API Quality Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive an API-quality review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

First, briefly orient yourself in the repo as it stands today — the API surface it presents to callers (HTTP routes, CLI commands, library exports — whatever it exposes), the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first.** Find and read this review's earlier reports, and focus on what is still open or was never reached — build on them rather than re-deriving the same report or re-flagging what's already handled.
- **Run the review.** Identify the API surface this repo presents to callers by grounding in the code, then assess: *design consistency* (naming, resource/verb shapes, pluralisation, status-code use, pagination, the error envelope) against the repo's **own dominant convention** as the reference — flag the outliers that diverge from it rather than imposing an imported ideal; *input validation* (do endpoints validate and constrain inputs — types, required fields, bounds, auth/scope — before acting, especially those that mutate state or cross a trust/tenant boundary?); *error handling* (consistent status codes, a uniform error shape, no leaked internals or stack traces, a correct client-4xx / server-5xx split, no silently swallowed failures); and *contract robustness* (backwards-compatible response shapes, sane defaults, idempotency/retry-safety where it matters, documented auth/scope per endpoint). A finding is a concrete inconsistency or robustness gap a real caller could hit, not a style preference — and a proposed fix aligns an outlier to the established pattern rather than introducing a new one.
- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against the source at HEAD, not prior prose. Record the report wherever the convention you found puts it.
- **Propose follow-up tickets — don't create them.** For findings worth acting on, draft candidate tickets inline (title + short scope), severity-ordered, so triage can accept or discard at a glance. Do not put anything on the stack yourself.
- **Leave the task In Progress.** Writing the report does not finish the task — leave it In Progress (do not close it) so the natural review/triage step can act on the report: apply straightforward fixes, or mint specific follow-up tasks for what's worth doing.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * Code Quality Review (LIN-354) — complexity, duplication, and
 * maintainability against the repo's own conventions.
 * @returns {string} Prompt text
 */
function generateCodeQualityPrompt() {
  return `# Periodical: Code Quality Review

You are dispatching the **Code Quality Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive a code-quality review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

First, briefly orient yourself in the repo as it stands today — its established structure and conventions, the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first.** Find and read this review's earlier reports, and focus on what is still open or was never reached — build on them rather than re-deriving the same report or re-flagging what's already handled.
- **Run the review.** Use the repo's own established structure and style as the primary reference — read a sample of its well-factored modules first — alongside general maintainability principles, not an external rulebook; introduce no new tooling, reasoning from the source and lightweight built-in signals (file/function length, nesting depth, fan-out) rather than a metrics tool. Assess: *complexity hotspots* (deep nesting, long functions, tangled control flow, too many responsibilities — where a future change is most likely to introduce a bug); *duplication* (the same decision implemented in several places that should be factored, distinguished from coincidental similarity that's fine to leave); and *maintainability & convention drift* (dead or unreachable code, leaky or missing abstractions, inconsistent error/async handling, divergences from the conventions the rest of the codebase follows). Weight by risk × churn — a complex hotspot on a critical path or in often-changed code outranks an ugly-but-stable corner — and require each finding to name a concrete maintainability cost (where a change would be risky or a bug likely), not a subjective "this could be prettier". Avoid the theater of mass cosmetic churn (sweeping renames or reformatting) that moves a metric without reducing real complexity.
- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against the source at HEAD, not prior prose. Record the report wherever the convention you found puts it.
- **Propose follow-up tickets — don't create them.** For findings worth acting on, draft candidate tickets inline (title + short scope), severity-ordered, so triage can accept or discard at a glance. Do not put anything on the stack yourself.
- **Leave the task In Progress.** Writing the report does not finish the task — leave it In Progress (do not close it) so the natural review/triage step can act on the report: apply straightforward fixes, or mint specific follow-up tasks for what's worth doing.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * The registry of periodical templates (LIN-354 set): Documentation Review,
 * Test Coverage Gap Review, the consolidated broad Security Review (absorbing
 * the former Secrets & Credential Scan + Prompt-Injection Surface Review), and
 * the new API Quality and Code Quality reviews. Each is a Stage-1 task-
 * generation prompt that mints a review task carrying the report contract.
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
    id: 'security-review',
    title: 'Security Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateSecurityReviewPrompt
  },
  {
    id: 'api-quality',
    title: 'API Quality Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateApiQualityPrompt
  },
  {
    id: 'code-quality',
    title: 'Code Quality Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateCodeQualityPrompt
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
 * issue-like object (no Linear url/identifier - these are app-only rows) plus
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
