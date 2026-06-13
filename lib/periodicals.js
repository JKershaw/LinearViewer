// =============================================================================
// Periodicals registry (LIN-341 / parent LIN-315 / LIN-344 / LIN-354 / LIN-369 / LIN-453)
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
//   one, or several — the report itself is uncapped), then SELF-CONCLUDES:
//   it mints a *bounded* set of follow-up tasks for the highest-severity
//   findings (a hard cap so the queue is paced, not swamped; every finding —
//   promoted or not — is recorded in the report so the trend-aware next run
//   can pick up the rest), posts a summary of the report as a Linear comment,
//   and closes itself. Concluding is the point: a review task left In Progress
//   is re-recommended for `review` forever and never resolves (LIN-386). The
//   minted follow-up tasks carry the actionable work forward through the normal
//   recommend/loop. (Autopilot is not yet wired to dispatch periodicals; that
//   comes after these are tested.)
//
// So the whole report/uncapped-findings/bounded-follow-up-creation/self-close
// contract is written by the periodical INTO the minted task's description —
// Stage 1 just mints the task. Templates leave the project specifics (which surfaces, which
// commands, where reports live) to be discovered by grounding against the repo
// at dispatch time, so the same template is broadly valuable to any codebase.
// Templates live in app storage only and are never written to Linear; the
// minted task and its report do.
//
// `mode` only drives a cosmetic badge in the renderer. The corrective/advisory
// taxonomy predates the LIN-354 reframe: the seven code-surface reviews are
// 'corrective' (they mint fix-tasks). The Stability Review (LIN-453) is the
// first 'advisory' entry — a trajectory governor that reports an assessment for
// a human to act on and mints NO follow-up tasks (see its builder below), so
// the badge now signals that behavioural difference rather than being a no-op.
// `cadence`/`lastRunAt` are carried but not yet consumed (autopilot scheduling
// remains deferred).
//
// NOTE: the six prompt builders below intentionally repeat the shared Stage-1
// scaffold rather than sharing a helper — keeping each prompt a single, fully
// readable string while these are still being tuned (LIN-354). Factor a helper
// later if the contract stabilises.
//
// ADDING A NEW PERIODICAL (LIN-369; checklist for the next template):
//
//   1. Write `generate<Name>Prompt()` repeating the shared Stage-1 scaffold
//      verbatim (see NOTE above). The only bespoke parts are the
//      orient-yourself sentence, the "Run the review" bullet, and any extra
//      contract bullets the review needs (e.g. the trend framing below).
//   2. Add the registry entry: { id, title, mode, cadence, lastRunAt: null,
//      generatePrompt }.
//   3. Keep the prompt implementation-agnostic: prescribe WHAT to find and how
//      to FRAME the report (severity ranking, ledgers), never WHERE things
//      live — locations (report convention, prior runs, source surfaces) are
//      discovered by the executing agent at run time. The shared-contract test
//      in tests/unit/periodicals.test.js enforces this (no file literals, no
//      proxy mechanics, no baked-in report location).
//   4. Name the altitude difference vs. the existing reviews inside the prompt
//      so two periodicals don't double-flag the same findings.
//   5. Update tests/unit/periodicals.test.js: the registry count and the
//      expected id/title map. The shared-contract describe loop covers the new
//      entry automatically; add a "specifics" block only for bespoke contract
//      language.
//   6. Spot-check the repo first to confirm the review's finding classes exist,
//      so the template's first run produces a real baseline, not a no-op.
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
- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.
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
- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.
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
- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.
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
- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.
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
- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * Drift & Coherence Review (LIN-369) — cross-cutting coherence: duplication,
 * convention fragmentation, and dependency-direction violations. The first
 * trend-aware periodical: findings are framed as deltas against this review's
 * own prior reports, not as a point-in-time snapshot.
 * @returns {string} Prompt text
 */
function generateDriftCoherencePrompt() {
  return `# Periodical: Drift & Coherence Review

You are dispatching the **Drift & Coherence Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive a drift-and-coherence review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

First, briefly orient yourself in the repo as it stands today — the architectural layers it establishes and the direction dependencies are meant to flow, the conventions it treats as canonical (error handling, shared utilities, client/server idioms), the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first — this review is trend-aware.** Find and read this review's earlier reports (discover where they are recorded rather than assuming a place), then frame every finding as a delta against the previous run — new, unchanged, improved, worsened, or resolved — never as a point-in-time snapshot. If no prior run exists, say so plainly and write the report as the baseline the next run will measure against.
- **Run the review.** This review works at the cross-cutting altitude — where each piece is locally right but the whole is drifting apart — distinct from the per-module Code Quality Review (complexity hotspots weighted by risk × churn); do not re-flag what that review owns. Use the repo's own structure and conventions as the reference, introducing no new tooling. Assess: *duplication* (the same utility or decision re-implemented in several places where one shared implementation is canonical — so a defect or change there must be fixed N times instead of once — distinguished from coincidental similarity that's fine to leave); *convention fragmentation* (several competing patterns where the codebase has one canonical way — error envelopes, shared helpers, data access, fetch-and-display idioms — flag the outliers against the dominant convention rather than imposing an imported ideal); and *dependency direction* (imports that flow against the layering the repo itself establishes — e.g. a core/library module reaching into a route/controller or presentation layer — coupling layers and risking cycles). Each finding must name the concrete cost a real change or caller would hit (an N-place fix, divergent behavior across parallel paths, a coupling that blocks reuse), not a style preference — and avoid the theater of mass cosmetic churn: a proposed fix consolidates outliers toward the existing canonical pattern, never sweeps the codebase for uniformity's own sake.
- **Write an uncapped, trend-framed report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against the source at HEAD, not prior prose. Close the report with a compact trend ledger — each finding under a stable, descriptive name, with its severity and its delta against the previous run — so the next run can compare mechanically wherever the report lives. Record the report wherever the convention you found puts it.
- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * Comprehension-Debt Review (LIN-370, origin LIN-367) — module/system-altitude
 * rationale debt: modules that work but whose *why* no cold reader can
 * reconstruct because the explanation lives offsite (closed tickets, PR bodies)
 * rather than near the code. The module-altitude sibling of the Documentation
 * Review's per-comment hygiene; carries the same anti-inflation discipline.
 * @returns {string} Prompt text
 */
function generateComprehensionDebtPrompt() {
  return `# Periodical: Comprehension-Debt Review

You are dispatching the **Comprehension-Debt Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive a comprehension-debt review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

First, briefly orient yourself in the repo as it stands today — which modules carry non-obvious or load-bearing behavior, where the project records design rationale (in-code constraint-comments, nearby docs, or only offsite in tickets/PRs), the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first.** Find and read this review's earlier reports, and focus on what is still open or was never reached — build on them rather than re-deriving the same report or re-flagging what's already handled.
- **Run the review.** This review works at the **module/system altitude** — can a cold reader reconstruct *why a module is shaped the way it is* — distinct from the Documentation Review, which works at the per-comment/doc-surface altitude (is *this* comment present, accurate, why-not-what); do not re-flag a single missing why-comment that review owns. Comprehension debt is code that works but whose load-bearing rationale no human (or future agent) can recover from the code and its nearby docs alone. Walk the non-obvious modules and flag where: *behavior is non-obvious and no constraint-comment explains **why*** (a comment that restates **what** the code does is not rationale — and is itself a finding, never a fix); *the only explanation lives offsite* — in a closed ticket or a merged PR body rather than near the code, so a bare ticket/PR reference beside non-obvious code is the debt signal (a reference that already paraphrases its constraint in-code is **not** debt); and *a newcomer could not safely modify the module* — apply the cold-hand-off standard: could a cold reader change this module without silently breaking an unstated constraint? If they can, there is no debt — a clean, legible module is a genuine result. Weight by risk: rationale debt on a critical path, a tricky invariant, or an often-changed module outranks a quiet, stable corner. The fix a finding implies is **capturing the missing rationale as a minimal constraint-note next to the code** — never net-new prose. Treat manufactured explanation for self-evident code (rationale-inflation) as a finding in its own right, not a sign of thoroughness; do not flag a module a cold reader can already safely modify.
- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against the source at HEAD, not prior prose. Record the report wherever the convention you found puts it.
- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

Keep the task general enough that its executor re-grounds against the live code, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * Stability Review (LIN-453) — the first 'advisory' periodical and a trajectory
 * governor: it assesses whether the project's *rate of change* is converging on
 * a settled state or failing to settle (spiralling / stagnating), and hands the
 * read to a human rather than minting follow-up work. Trend-aware like the Drift
 * & Coherence Review, but at a higher altitude: not "is the code coherent" but
 * "is the project's rate of change converging". Grounded in software-evolution
 * research (Lehman's laws, relative code churn, code-decay indices, behavioural
 * hotspot/trend analysis, reliability-growth convergence) — folding in the
 * *shape* of that work, not the human-team absolute thresholds it measured.
 * @returns {string} Prompt text
 */
function generateStabilityReviewPrompt() {
  return `# Periodical: Stability Review

You are dispatching the **Stability Review** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive a stability review — then stop. This periodical's deliverable is that task, not the review itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.

This review is **advisory, not corrective**: unlike the code-surface reviews that mint fix-tasks, its job is to read the project's *trajectory* and hand a human a decision. A project has a rate of change — healthy early development churns hard (the 0→1 phase), a maturing project finds a cadence, and the goal is an eventual settled state, as opposed to a constantly increasing, or persistently high, level of instability. This periodical is a high-level brake/governor: it exists to catch a rapidly developing project that is spiralling rather than converging, before it does.

First, briefly orient yourself in the repo as it stands today — **what change-history signal this project actually exposes** (the version-control history is the likely objective surface; any tracker signal — task age, cycle time, completion cadence — is secondary), the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one). Discover what trajectory data is available rather than assuming a source. Use what you find to ground the task in this codebase rather than leaving it generic.

Write a Linear task whose description directs whoever runs it to:

- **Read prior runs first — this review is trend-aware.** Find and read this review's earlier reports (discover where they are recorded rather than assuming a place), then frame every finding as a delta against the previous run — new, unchanged, improved, worsened, or resolved — never as a point-in-time snapshot. Stability is a *trajectory*: a single snapshot cannot tell convergence from a spiral, so the comparison against prior runs is the whole point. If no prior run exists, say so plainly and write the report as the baseline the next run will measure against.
- **Run the review.** Assess whether the project's rate of change is **converging toward a settled state or failing to settle**, grounding in whatever change-history data you found available and introducing no new tooling (reason from built-in version-control history and lightweight signals, not a metrics product). Measure change in **relative** terms — normalised to the size and age of what changed — never absolute counts: a raw churn number says nothing, churn relative to the size and age of what it touches is the signal. Look at: *churn hotspots* (the areas re-touched far more than the rest, weighted by how much of them changes each time); *trend over time* (is a hot area's churn settling as it matures, or flat-high / still climbing?); *change-coupling* (areas that keep changing together, a sign their boundary has not settled); and *the overall convergence shape* (is the project's rate of change trending toward an asymptote, or not?). Distinguish the cases that matter: healthy early-stage churn (expected, not a finding) and healthy stabilisation (a maturing area going quiet) versus runaway instability (churn that should have settled but is flat-high or rising) and its opposite, stagnation (an area gone silent that should still be evolving). The discriminator is always the *trajectory of the relative rate*, judged against this project's own history, not an absolute threshold imported from elsewhere.
- **Mind the altitude — do not double-flag.** This review works at the **project-trajectory / rate-of-change** altitude: is the whole project converging over time? That is distinct from the per-module Code Quality Review (complexity hotspots weighted by risk × churn at a point in time) and the cross-cutting Drift & Coherence Review (is the code's structure drifting apart). Do not re-flag what those own — a single complex module or a single duplication is theirs; your finding is a *pattern in the rate of change over time*.
- **Write an uncapped, trend-framed report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean "still converging" result is a genuine outcome. Ground each finding against the change history at HEAD, not prior prose. Close the report with a compact trend ledger — each signal under a stable, descriptive name, with its severity and its delta against the previous run — so the next run can compare mechanically wherever the report lives. Record the report wherever the convention you found puts it.
- **Report back for a human decision — mint NO follow-up tasks.** This review is the governor: its conclusion is an *assessment a human acts on*, not auto-generated work. Do NOT create follow-up tasks. Instead, end the report with a plain-language read of the trajectory — where the project is converging, where it is spiralling or stagnating, and the options a maintainer might weigh (consolidate or freeze a thrashing area, slow the rate of new change, or investigate why an area will not settle) — and leave the decision to them. A brake that spawned more work would be adding throttle, not braking.
- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. This review hands its decision to the human through that summary; its own job ends once the report is written and reported.
- **Stay review-only.** Producing the report changes no code, docs, config, or secrets. Linear access and reporting come from the harness — don't restate them.

A grounding caveat to carry into the task: the trajectory research that informs this review (relative change predicting instability, change-history decay indices, hotspot/trend analysis, reliability-growth convergence) comes overwhelmingly from human-team, long-lived systems, where change is slow and expensive. An agent-driven project churns far faster and differently, so do not import absolute thresholds from that work — fold in the *shape* of the idea (relative change, trend over time, convergence toward a settled state) and calibrate every judgement against this project's own history.

Keep the task general enough that its executor re-grounds against the live history, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`
}

/**
 * The registry of periodical templates: the LIN-354 set — Documentation
 * Review, Test Coverage Gap Review, the consolidated broad Security Review
 * (absorbing the former Secrets & Credential Scan + Prompt-Injection Surface
 * Review), API Quality and Code Quality reviews — plus the trend-aware Drift &
 * Coherence Review (LIN-369) and the Comprehension-Debt Review (LIN-370) — plus
 * the advisory Stability Review (LIN-453), a trajectory governor that reports an
 * assessment for a human to act on rather than minting follow-up tasks. Each
 * is a Stage-1 task-generation prompt that mints a review task carrying the
 * report contract.
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
  },
  {
    id: 'drift-coherence',
    title: 'Drift & Coherence Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateDriftCoherencePrompt
  },
  {
    id: 'comprehension-debt',
    title: 'Comprehension-Debt Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateComprehensionDebtPrompt
  },
  {
    id: 'stability-review',
    title: 'Stability Review',
    mode: 'advisory',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateStabilityReviewPrompt
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
