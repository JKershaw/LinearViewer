// =============================================================================
// Periodicals registry (LIN-341 / parent LIN-315 / LIN-344 / LIN-354 / LIN-369 / LIN-453 / LIN-371)
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
// NOTE (LIN-700): the shared Stage-1 scaffold is now factored into
// buildPeriodicalScaffold({…}) + the periodicalBullet.* vocabulary below; each
// builder passes only its remit-specific parts (title, reviewKind, orient
// surfaces, the "Run the review" body, and any freeform bullets). The generic
// contract text lives in one place so it can no longer drift across the eleven
// prompts. (Previously each builder repeated the scaffold verbatim, per LIN-354,
// until the contract stabilised.)
//
// ADDING A NEW PERIODICAL (LIN-369; checklist for the next template):
//
//   1. Write `generate<Name>Prompt()` as a thin call to
//      buildPeriodicalScaffold({…}) (see NOTE above). Pass the bespoke parts —
//      title/reviewKind/orientSurfaces, the "Run the review" body, and any
//      extra contract bullets the review needs (e.g. the trend framing below);
//      reuse periodicalBullet.* for the shared contract bullets.
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

// =============================================================================
// Shared Stage-1 scaffold (LIN-700). `buildPeriodicalScaffold` owns the generic
// prompt frame — heading, opening dispatch-framing, the orient block, the
// "Write a Linear task…" connector, and the closing line — with per-remit parts
// threaded in. `periodicalBullet.*` is the bullet vocabulary: the contract
// bullets shared byte-for-byte across builders live here once; each builder's
// bespoke bodies (the "Run the review" finding-class list, freeform altitude /
// fold-in / trend bullets) are passed in. Centralizing this is the whole point
// of LIN-700 — a contract change now lands in one place instead of eleven.
// =============================================================================

/**
 * Assemble a full periodical prompt from its generic frame + per-remit parts.
 *
 * @param {Object} opts
 * @param {string} opts.title - Display title (e.g. 'Documentation Review')
 * @param {string} opts.reviewKind - Fills "…will drive {reviewKind} — then stop."
 * @param {string} [opts.deliverableNoun='review'] - 'review' | 'report'
 * @param {string} [opts.openingInsert=''] - Extra sentence(s) in the opening ¶
 * @param {string} [opts.leadIn=''] - Framing ¶(s) between opening and orient block
 * @param {string} [opts.groundNoun='code'] - 'code' | 'history' | 'product' (closing line)
 * @param {string} [opts.orientSurfaces] - Per-remit clause in the standard orient ¶
 * @param {string} [opts.orientExtra=''] - Extra sentence after the reports-recorded clause
 * @param {string} [opts.orientOverride=''] - Full orient ¶ (for non-standard shapes)
 * @param {string[]} opts.bullets - Ordered rendered bullet lines
 * @param {string} [opts.trailing=''] - Content after the bullets, before the closing line
 * @returns {string}
 */
function buildPeriodicalScaffold({
  title,
  reviewKind,
  deliverableNoun = 'review',
  openingInsert = '',
  leadIn = '',
  groundNoun = 'code',
  orientSurfaces,
  orientExtra = '',
  orientOverride = '',
  bullets,
  trailing = ''
}) {
  const opening = `# Periodical: ${title}

You are dispatching the **${title}** periodical. Your job is to research this codebase and mint **one** well-scoped, project-specific Linear task that will drive ${reviewKind} — then stop.${openingInsert} This periodical's deliverable is that task, not the ${deliverableNoun} itself: another agent (autopilot or a human) later picks the task off the stack and runs it, and *that* run produces the report. So the task description must carry the full review contract.`;

  // LIN-700 wording (1): the orient block is a discovery-first *scope-formation*
  // step (research, don't recall), grounded in three actively-searched sources.
  // The ${orientSurfaces} slot and the trailing "Use what you find…" sentence are
  // preserved verbatim; ${orientExtra} keeps its position after the
  // reports-recorded clause.
  const orient = orientOverride || `First, research the repo as it stands today to **form this review's scope from what you discover, not from what a review of this kind is assumed to cover** — ${orientSurfaces}, the branch/PR conventions, and where periodical reports are recorded (look for the convention rather than assuming one).${orientExtra} Ground that scope in three sources you actively search: the **prior reports in this series** (read the most recent to seed what was flagged, deferred, or never reached); the **sibling reviews' remits and the seams between them** (a surface no single review owns is still in this one's scope); and the **repo's known-issues surfaces** — its agent-guidance and contributor docs, open tickets, inline markers, and configuration. Use what you find to ground the task in this codebase rather than leaving it generic.`;

  const closing = `Keep the task general enough that its executor re-grounds against the live ${groundNoun}, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`;

  // LIN-700 wordings (3)+(4): every minted task opens with the gap-audit + the
  // coverage-theater guard, prepended uniformly across all builders.
  const allBullets = [periodicalBullet.gapAudit(), ...bullets];

  return `${opening}${leadIn}

${orient}

Write a Linear task whose description directs whoever runs it to:

${allBullets.join('\n')}${trailing}

${closing}`;
}

/**
 * The shared bullet vocabulary. Each function returns one rendered `- **…**`
 * bullet line. The generic contract text is centralized here; per-remit bodies
 * are passed in as arguments.
 */
const periodicalBullet = {
  // LIN-700 wordings (3)+(4): the Stage-2 gap-audit opener (widen the handed
  // scope to what is in-remit but unlisted) closed by the coverage-theater guard
  // (broad in discovery, bounded in output). Mode-agnostic — no hard-coded ~3,
  // so it holds for corrective reviews (bound = the ~3 cap) and advisory ones
  // (bound = zero). Prepended as the FIRST bullet by buildPeriodicalScaffold.
  gapAudit() {
    return `- **Audit the scope before executing.** Treat the scope you were handed as a starting point to extend, not a checklist to stay inside: before running the review, look for what is *in-remit but unlisted* — surfaces this review should cover that the scope did not name — and fold them in. A scope you could only shrink is suspect; the expected move is to widen it to what the remit actually reaches. Stay **broad in discovery but bounded in output.** This widened scope changes only *what you examine* — it must not inflate *what you report*: the report itself stays uncapped and severity-ranked (a clean, near-empty result is a genuine outcome), and whatever follow-up work this review mints stays within its existing bound. Breadth belongs in the search, not in padded output.`;
  },
  priorRuns() {
    return `- **Read prior runs first.** Find and read this review's earlier reports, and focus on what is still open or was never reached — build on them rather than re-deriving the same report or re-flagging what's already handled.`;
  },
  priorRunsTrend({ unit = 'finding', insert = '' } = {}) {
    return `- **Read prior runs first — this review is trend-aware.** Find and read this review's earlier reports (discover where they are recorded rather than assuming a place), then frame every ${unit} as a delta against the previous run — new, unchanged, improved, worsened, or resolved — never as a point-in-time snapshot.${insert} If no prior run exists, say so plainly and write the report as the baseline the next run will measure against.`;
  },
  // LIN-700 wording (2): each builder's finding-class list is a floor, not a
  // ceiling — the executor discovers the complete set for the remit. The wrap
  // trails every "Run the review" body across all 11 builders.
  runReview(body, { header = 'Run the review.' } = {}) {
    return `- **${header}** ${body} The finding-classes above are **examples, not a limit — discover the complete set for this remit from the repo; a class list is a floor to build on, never a ceiling to stay inside.**`;
  },
  uncappedReport({ ground = 'the source at HEAD', groundExtra = '' } = {}) {
    return `- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against ${ground}, not prior prose${groundExtra}. Record the report wherever the convention you found puts it.`;
  },
  uncappedReportTrend({ ground = 'the source at HEAD', cleanQual = '', ledgerUnit = 'finding', ledgerExtra = '' } = {}) {
    return `- **Write an uncapped, trend-framed report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean${cleanQual} result is a genuine outcome. Ground each finding against ${ground}, not prior prose. Close the report with a compact trend ledger — each ${ledgerUnit} under a stable, descriptive name, with its severity and its delta against the previous run${ledgerExtra} — so the next run can compare mechanically wherever the report lives. Record the report wherever the convention you found puts it.`;
  },
  mint() {
    return `- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.`;
  },
  mintObjectiveBreakage() {
    return `- **Mint a bounded set of follow-up tasks — objective breakage only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), and mint a fix-task **only for objective breakage** — a contrast failure, a mobile overflow, a broken or unusable layout — never for a subjective design-direction call. Each task is well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.`;
  },
  reportBackNoFollowUps(body) {
    return `- **Report back for a human decision — mint NO follow-up tasks.** ${body}`;
  },
  conclude() {
    return `- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.`;
  },
  concludeAdvisory() {
    return `- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. This review hands its decision to the human through that summary; its own job ends once the report is written and reported.`;
  },
  reviewOnly({ changes = 'no code, docs, config, or secrets', extra = '' } = {}) {
    return `- **Stay review-only.** Producing the report changes ${changes}${extra}. Linear access and reporting come from the harness — don't restate them.`;
  }
};

/**
 * Documentation Review (LIN-341/349, broadened under LIN-354 to README quality,
 * inline comments, and API documentation alongside drift + subtractive quality).
 * @returns {string} Prompt text
 */
function generateDocumentationReviewPrompt() {
  return buildPeriodicalScaffold({
    title: 'Documentation Review',
    reviewKind: 'a documentation review',
    orientSurfaces: 'the doc surfaces that actually matter',
    bullets: [
      periodicalBullet.priorRuns(),
      periodicalBullet.runReview(`Assess the docs for an audience of both developers and AI agents, **drift first**. *Accuracy/drift* is foundational: treat each doc claim as a hypothesis — locate the concrete thing it asserts (a path, export, route, CLI flag, env var, request/response shape, selector) and verify it against the source at HEAD before trusting it; disagreement on wording is a drift finding, disagreement on intent is a human-decision flag. Then *README & entry-point quality* (does a newcomer get oriented fast, without drowning?), *inline comments* (do they explain **why** rather than restate **what** — flag both non-obvious code missing rationale and stale/misleading comments), *API & interface documentation* (are the contracts this project exposes — endpoints, commands, exports — documented and current: inputs, outputs, errors, auth/scope?), and *quality assessed subtractively* (redundancy, organisation, discoverability, readability — fixed by consolidate / tighten / relocate / delete, not net-new prose). Treat unjustified doc growth (inflation) as a finding in its own right, not a sign of thoroughness.`),
      periodicalBullet.uncappedReport(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly()
    ]
  });
}

/**
 * Test Coverage Gap Review (LIN-351).
 * @returns {string} Prompt text
 */
function generateTestCoverageGapPrompt() {
  return buildPeriodicalScaffold({
    title: 'Test Coverage Gap Review',
    reviewKind: "a review of the test suite's **coverage AND reliability**",
    openingInsert: ' The remit is both dimensions, not coverage percentage alone: where the suite has gaps, *and* where the suite it does have is itself unreliable.',
    orientSurfaces: 'how tests are invoked and where they live',
    bullets: [
      periodicalBullet.priorRuns(),
      periodicalBullet.runReview(`Run the native coverage report as objective ground truth — \`node --test --experimental-test-coverage\` (find the exact invocation; introduce no new coverage dependency) — and read the per-file **uncovered-line** detail, not just summary percentages. Weight gaps by how costly an untested defect would be: error/failure handling, auth/token boundaries, quota/money/rate-limit logic, data integrity. Two grounding traps: a module with **zero** coverage is absent from the table entirely (cross-check the module list against the source tree), and a low percentage can mean a *different* suite (e.g. end-to-end) exercises it (a unit-only report undercounts), while full line coverage can still hide an unasserted branch — confirm each gap against the actual uncovered lines and what they do. Distinguish a real gap from coverage-theater: any fix proposed must demand **behavioral** tests that assert real outcomes (return values, thrown errors, observable state) and forbid assertion-free or test-the-mock tests — the win is a defect the tests would catch, never a higher number.`),
      `- **Fold in reliability signal — capability-gated, discovery-style.** Coverage says what the suite *touches*; reliability says whether the suite you have can be *trusted*. If the project's continuous-integration history/output is reachable, discover what reliability signal it exposes about the test suite and fold those findings into the review alongside the coverage gaps. Let what is actually exposed drive this — describe and mine whatever the history surfaces rather than assuming a fixed shape; discoverable examples (not an exhaustive list, and not a promise any of them exists in structured form) include flaky specs that pass and fail without a code change, re-run / retry patterns, and other concentrations of failure in particular specs or areas. Do not overstate a structured per-test surface: read whatever granularity the project genuinely exposes and no finer. This is capability-gated: **if CI/CD history is not reachable, say so explicitly in the report and continue with coverage-only findings** — its absence is a valid, stated outcome, never a blocker. A reliability finding is held to the same behavioral bar as a coverage one: it must name a concrete way the suite misleads (a defect a flaky pass would let through, a failure the suite hides), never a raw metric or a tooling inventory.`,
      `- **Mind the altitude — do not double-flag the siblings' territory.** This review reads the *test suite's own* coverage and reliability. Keep CI signal here scoped to what the suite exposes about itself, and do not re-attribute what other periodicals own: project-wide **rate-of-change / churn convergence** belongs to the **Stability Review**; recent **delivery-drag** — defect-escape clustering by subsystem, rework and fix-on-fix — belongs to **Recent Headwinds**; and dependency / supply-chain risk belongs to the **Dependency & Supply-Chain Review**. Cite a CI observation only where it is evidence about the *test suite's* trustworthiness, not as a re-flag of those homes.`,
      periodicalBullet.uncappedReport(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly()
    ]
  });
}

/**
 * Security Review (LIN-354) — broad, OWASP-style security review that
 * consolidates the former standalone Secrets & Credential Scan and
 * Prompt-Injection Surface Review periodicals into one.
 * @returns {string} Prompt text
 */
function generateSecurityReviewPrompt() {
  return buildPeriodicalScaffold({
    title: 'Security Review',
    reviewKind: 'a security review',
    orientSurfaces: 'the providers and token formats this codebase uses, the request-handling and trust boundaries it has',
    bullets: [
      periodicalBullet.priorRuns(),
      periodicalBullet.runReview(`Walk the security surface this repo actually exposes, grounding every finding against real handlers at HEAD rather than a generic checklist. Cover at least: *exposed credentials* — scan the git-tracked surface, the working tree **and** its history, for high-confidence secret literals using only built-in \`git\` (\`git grep\` over the tree, \`git log -p\` over history; introduce no scanner dependency), deriving the pattern set at run time from the token formats this repo uses plus generic \`KEY=\` / \`SECRET=\` / \`PASSWORD=\` assignments and known cloud-provider prefixes (trap: a working-tree-only or HEAD-only scan misses a live secret sitting in a past commit; a confirmed live secret is only neutralised by removing it from tracked content **and** rotating/revoking it at source, with any history-rewrite flagged as a human decision — never by suppress / allowlist / delete-from-tree-only); *injection & trust boundaries* — trace untrusted, externally-influenceable input (request bodies, query params, externally-sourced content, and on a codebase where agents execute externally-authored content, that content itself) to the sinks where it crosses into a trusted channel (shell/command execution, query construction, HTML output, any prompt assembled for an AI worker), and flag where one boundary carries input as **data** while a parallel path interpolates it as code — an instruction telling a model or consumer to behave is an aspirational guard, not a technical boundary; and *the broad classes* — broken access control and tenant/workspace isolation, authentication and session handling, sensitive-data exposure, server-side request forgery / unsafe outbound requests, security misconfiguration, and dependency risk. Severity-rank by blast radius: a vector reaching command execution or cross-tenant data outranks a low-scope, already-mitigated, or theoretical one.`),
      periodicalBullet.uncappedReport(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly({ extra: ' — and never copy a real secret value into the report, the task, or a branch' })
    ]
  });
}

/**
 * API Quality Review (LIN-354) — design, validation, and error-handling
 * quality of whatever API surface the repo exposes.
 * @returns {string} Prompt text
 */
function generateApiQualityPrompt() {
  return buildPeriodicalScaffold({
    title: 'API Quality Review',
    reviewKind: 'an API-quality review',
    orientSurfaces: 'the API surface it presents to callers (HTTP routes, CLI commands, library exports — whatever it exposes)',
    bullets: [
      periodicalBullet.priorRuns(),
      periodicalBullet.runReview(`Identify the API surface this repo presents to callers by grounding in the code, then assess: *design consistency* (naming, resource/verb shapes, pluralisation, status-code use, pagination, the error envelope) against the repo's **own dominant convention** as the reference — flag the outliers that diverge from it rather than imposing an imported ideal; *input validation* (do endpoints validate and constrain inputs — types, required fields, bounds, auth/scope — before acting, especially those that mutate state or cross a trust/tenant boundary?); *error handling* (consistent status codes, a uniform error shape, no leaked internals or stack traces, a correct client-4xx / server-5xx split, no silently swallowed failures); and *contract robustness* (backwards-compatible response shapes, sane defaults, idempotency/retry-safety where it matters, documented auth/scope per endpoint). A finding is a concrete inconsistency or robustness gap a real caller could hit, not a style preference — and a proposed fix aligns an outlier to the established pattern rather than introducing a new one.`),
      periodicalBullet.uncappedReport(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly()
    ]
  });
}

/**
 * Code Quality Review (LIN-354) — complexity, duplication, and
 * maintainability against the repo's own conventions.
 * @returns {string} Prompt text
 */
function generateCodeQualityPrompt() {
  return buildPeriodicalScaffold({
    title: 'Code Quality Review',
    reviewKind: 'a code-quality review',
    orientSurfaces: 'its established structure and conventions',
    bullets: [
      periodicalBullet.priorRuns(),
      periodicalBullet.runReview(`Use the repo's own established structure and style as the primary reference — read a sample of its well-factored modules first — alongside general maintainability principles, not an external rulebook; introduce no new tooling, reasoning from the source and lightweight built-in signals (file/function length, nesting depth, fan-out) rather than a metrics tool. Assess: *complexity hotspots* (deep nesting, long functions, tangled control flow, too many responsibilities — where a future change is most likely to introduce a bug); *duplication* (the same decision implemented in several places that should be factored, distinguished from coincidental similarity that's fine to leave); and *maintainability & convention drift* (dead or unreachable code, leaky or missing abstractions, inconsistent error/async handling, divergences from the conventions the rest of the codebase follows). Weight by risk × churn — a complex hotspot on a critical path or in often-changed code outranks an ugly-but-stable corner — and require each finding to name a concrete maintainability cost (where a change would be risky or a bug likely), not a subjective "this could be prettier". Avoid the theater of mass cosmetic churn (sweeping renames or reformatting) that moves a metric without reducing real complexity.`),
      periodicalBullet.uncappedReport(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly()
    ]
  });
}

/**
 * Drift & Coherence Review (LIN-369) — cross-cutting coherence: duplication,
 * convention fragmentation, and dependency-direction violations. The first
 * trend-aware periodical: findings are framed as deltas against this review's
 * own prior reports, not as a point-in-time snapshot.
 * @returns {string} Prompt text
 */
function generateDriftCoherencePrompt() {
  return buildPeriodicalScaffold({
    title: 'Drift & Coherence Review',
    reviewKind: 'a drift-and-coherence review',
    orientSurfaces: 'the architectural layers it establishes and the direction dependencies are meant to flow, the conventions it treats as canonical (error handling, shared utilities, client/server idioms)',
    bullets: [
      periodicalBullet.priorRunsTrend(),
      periodicalBullet.runReview(`This review works at the cross-cutting altitude — where each piece is locally right but the whole is drifting apart — distinct from the per-module Code Quality Review (complexity hotspots weighted by risk × churn); do not re-flag what that review owns. Use the repo's own structure and conventions as the reference, introducing no new tooling. Assess: *duplication* (the same utility or decision re-implemented in several places where one shared implementation is canonical — so a defect or change there must be fixed N times instead of once — distinguished from coincidental similarity that's fine to leave); *convention fragmentation* (several competing patterns where the codebase has one canonical way — error envelopes, shared helpers, data access, fetch-and-display idioms — flag the outliers against the dominant convention rather than imposing an imported ideal); and *dependency direction* (imports that flow against the layering the repo itself establishes — e.g. a core/library module reaching into a route/controller or presentation layer — coupling layers and risking cycles). Each finding must name the concrete cost a real change or caller would hit (an N-place fix, divergent behavior across parallel paths, a coupling that blocks reuse), not a style preference — and avoid the theater of mass cosmetic churn: a proposed fix consolidates outliers toward the existing canonical pattern, never sweeps the codebase for uniformity's own sake.`),
      periodicalBullet.uncappedReportTrend(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly()
    ]
  });
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
  return buildPeriodicalScaffold({
    title: 'Comprehension-Debt Review',
    reviewKind: 'a comprehension-debt review',
    orientSurfaces: 'which modules carry non-obvious or load-bearing behavior, where the project records design rationale (in-code constraint-comments, nearby docs, or only offsite in tickets/PRs)',
    bullets: [
      periodicalBullet.priorRuns(),
      periodicalBullet.runReview(`This review works at the **module/system altitude** — can a cold reader reconstruct *why a module is shaped the way it is* — distinct from the Documentation Review, which works at the per-comment/doc-surface altitude (is *this* comment present, accurate, why-not-what); do not re-flag a single missing why-comment that review owns. Comprehension debt is code that works but whose load-bearing rationale no human (or future agent) can recover from the code and its nearby docs alone. Walk the non-obvious modules and flag where: *behavior is non-obvious and no constraint-comment explains **why*** (a comment that restates **what** the code does is not rationale — and is itself a finding, never a fix); *the only explanation lives offsite* — in a closed ticket or a merged PR body rather than near the code, so a bare ticket/PR reference beside non-obvious code is the debt signal (a reference that already paraphrases its constraint in-code is **not** debt); and *a newcomer could not safely modify the module* — apply the cold-hand-off standard: could a cold reader change this module without silently breaking an unstated constraint? If they can, there is no debt — a clean, legible module is a genuine result. Weight by risk: rationale debt on a critical path, a tricky invariant, or an often-changed module outranks a quiet, stable corner. The fix a finding implies is **capturing the missing rationale as a minimal constraint-note next to the code** — never net-new prose. Treat manufactured explanation for self-evident code (rationale-inflation) as a finding in its own right, not a sign of thoroughness; do not flag a module a cold reader can already safely modify.`),
      periodicalBullet.uncappedReport(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly()
    ]
  });
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
  return buildPeriodicalScaffold({
    title: 'Stability Review',
    reviewKind: 'a stability review',
    groundNoun: 'history',
    leadIn: `

This review is **advisory, not corrective**: unlike the code-surface reviews that mint fix-tasks, its job is to read the project's *trajectory* and hand a human a decision. A project has a rate of change — healthy early development churns hard (the 0→1 phase), a maturing project finds a cadence, and the goal is an eventual settled state, as opposed to a constantly increasing, or persistently high, level of instability. This periodical is a high-level brake/governor: it exists to catch a rapidly developing project that is spiralling rather than converging, before it does.`,
    orientSurfaces: '**what change-history signal this project actually exposes** (the version-control history is the likely objective surface; any tracker signal — task age, cycle time, completion cadence — is secondary)',
    orientExtra: ' Discover what trajectory data is available rather than assuming a source.',
    bullets: [
      periodicalBullet.priorRunsTrend({ insert: ' Stability is a *trajectory*: a single snapshot cannot tell convergence from a spiral, so the comparison against prior runs is the whole point.' }),
      periodicalBullet.runReview(`Assess whether the project's rate of change is **converging toward a settled state or failing to settle**, grounding in whatever change-history data you found available and introducing no new tooling (reason from built-in version-control history and lightweight signals, not a metrics product). Measure change in **relative** terms — normalised to the size and age of what changed — never absolute counts: a raw churn number says nothing, churn relative to the size and age of what it touches is the signal. Look at: *churn hotspots* (the areas re-touched far more than the rest, weighted by how much of them changes each time); *trend over time* (is a hot area's churn settling as it matures, or flat-high / still climbing?); *change-coupling* (areas that keep changing together, a sign their boundary has not settled); and *the overall convergence shape* (is the project's rate of change trending toward an asymptote, or not?). Distinguish the cases that matter: healthy early-stage churn (expected, not a finding) and healthy stabilisation (a maturing area going quiet) versus runaway instability (churn that should have settled but is flat-high or rising) and its opposite, stagnation (an area gone silent that should still be evolving). The discriminator is always the *trajectory of the relative rate*, judged against this project's own history, not an absolute threshold imported from elsewhere.`),
      `- **Mind the altitude — do not double-flag.** This review works at the **project-trajectory / rate-of-change** altitude: is the whole project converging over time? That is distinct from the per-module Code Quality Review (complexity hotspots weighted by risk × churn at a point in time) and the cross-cutting Drift & Coherence Review (is the code's structure drifting apart). Do not re-flag what those own — a single complex module or a single duplication is theirs; your finding is a *pattern in the rate of change over time*.`,
      periodicalBullet.uncappedReportTrend({ cleanQual: ' "still converging"', ground: 'the change history at HEAD', ledgerUnit: 'signal' }),
      periodicalBullet.reportBackNoFollowUps(`This review is the governor: its conclusion is an *assessment a human acts on*, not auto-generated work. Do NOT create follow-up tasks. Instead, end the report with a plain-language read of the trajectory — where the project is converging, where it is spiralling or stagnating, and the options a maintainer might weigh (consolidate or freeze a thrashing area, slow the rate of new change, or investigate why an area will not settle) — and leave the decision to them. A brake that spawned more work would be adding throttle, not braking.`),
      periodicalBullet.concludeAdvisory(),
      periodicalBullet.reviewOnly()
    ],
    trailing: `

A grounding caveat to carry into the task: the trajectory research that informs this review (relative change predicting instability, change-history decay indices, hotspot/trend analysis, reliability-growth convergence) comes overwhelmingly from human-team, long-lived systems, where change is slow and expensive. An agent-driven project churns far faster and differently, so do not import absolute thresholds from that work — fold in the *shape* of the idea (relative change, trend over time, convergence toward a settled state) and calibrate every judgement against this project's own history.`
  });
}

/**
 * Dependency & Supply-Chain Review (LIN-371, origin LIN-367) — a corrective,
 * trend-aware review at the supply-chain/provenance altitude: known CVEs (cheap
 * built-in audit first, no new scanner dependency), lockfile integrity/drift,
 * the provenance of newly-introduced packages (registry age, download volume,
 * name-proximity/slopsquatting), dependency-tree growth, and — defending the
 * repo's deliberately minimal runtime — any new runtime dependency flagged as a
 * finding to justify. Carves out its altitude vs the broad Security Review
 * (which lists dependency risk among its general classes) so CVEs are not
 * double-flagged. Trend framing mirrors the Drift & Coherence / Stability
 * reviews because new-packages and tree-growth are inherently deltas over time.
 * @returns {string} Prompt text
 */
function generateDependencySupplyChainPrompt() {
  return buildPeriodicalScaffold({
    title: 'Dependency & Supply-Chain Review',
    reviewKind: 'a dependency-and-supply-chain review',
    orientSurfaces: 'the package manager and ecosystem it uses, where its dependency manifest and committed lockfile live, which dependencies are runtime versus development and which client libraries are deliberately vendored rather than pulled at run time',
    bullets: [
      periodicalBullet.priorRunsTrend({ insert: ' Several of these checks (newly-introduced packages, dependency-tree growth) are inherently deltas over time, so the comparison against prior runs is the whole point.' }),
      periodicalBullet.runReview(`Work the supply-chain surface this repo actually exposes, grounding every finding in the live manifest, committed lockfile, and resolved dependency tree at HEAD. Start with the cheapest instrument the ecosystem already provides — for an npm project that is \`npm audit\` — and introduce no new scanner dependency. Cover: *known CVEs in the dependency tree* (run the built-in audit first as the objective baseline, then triage by whether the vulnerable path is actually reachable from this project's own usage, not by raw count); *lockfile integrity and unexpected diffs* (does the committed lockfile resolve cleanly and match the manifest; are there drifted, duplicated, or hand-edited entries a normal clean install would not produce); *newly-introduced packages since the last review* — for each, weigh provenance signals: registry creation date / age, download volume, and name-proximity to a popular package (typosquatting and slopsquatting — plausible hallucinated names an attacker pre-registers); and *dependency-tree growth rate* (is the transitive surface expanding faster than the project's needs, and where is the growth concentrated).`),
      `- **Defend the minimal-runtime posture.** This repo is deliberately minimal — a curated runtime set and vendored client libraries rather than a sprawling tree. Treat any **newly-introduced runtime dependency as a finding that must be justified** — named, with its provenance and why a built-in or vendored alternative would not do — never a silent addition. A new development-only dependency is lower stakes but still noted; a new runtime one always earns a line in the report, because silent erosion of this property is exactly the drift this review exists to catch.`,
      `- **Mind the altitude — do not double-flag.** This review works at the **supply-chain / provenance** altitude: where dependencies come from, whether the lockfile can be trusted, how the tree is growing, and whether new packages are who they claim to be. That is distinct from the broad Security Review, which already lists dependency risk among its general classes. Do not re-list the Security Review's CVE scope as your headline — your audit pass is the cheap baseline that *frames* the provenance work, and the findings that are yours alone are lockfile drift, name-proximity/slopsquatting, tree-growth trend, and unjustified runtime additions.`,
      periodicalBullet.uncappedReportTrend({ ground: 'the live manifest, lockfile, and dependency tree at HEAD', ledgerExtra: ', plus the running totals this review tracks (dependency count, new packages this cycle, open CVE count)' }),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly({ changes: 'no code, dependencies, config, or secrets', extra: ' — do not run any auto-fix that rewrites the manifest or lockfile; a remediation is a finding for a follow-up task, not an edit this review makes' })
    ]
  });
}

/**
 * Recent Headwinds (LIN-542) — the second 'advisory' periodical and the
 * delivery-trajectory sibling of the Stability Review: it reads what has been
 * happening recently and whether it is dragging progress toward the project's
 * stated direction (its north star), across nested relative windows, and hands a
 * human a ranked list of remediable headwinds with remediation options rather
 * than minting follow-up work. Trend-aware like the Drift & Coherence and
 * Stability reviews. Subsumes the two canceled execution-measurement tickets —
 * defect-escape & rework (LIN-374) and cross-task drift (LIN-291) — as taxonomy
 * categories rather than standalone periodicals. Reads a deterministic
 * velocity/roadmap layer's existing outputs when the workspace exposes one
 * (discovered at run time, never named), and falls back to version-control and
 * tracker history otherwise.
 * @returns {string} Prompt text
 */
function generateRecentHeadwindsPrompt() {
  return buildPeriodicalScaffold({
    title: 'Recent Headwinds',
    reviewKind: 'a recent-headwinds report',
    deliverableNoun: 'report',
    groundNoun: 'history',
    leadIn: `

This review is **advisory, not corrective**: like the Stability Review, its job is to read the project's recent *trajectory* and hand a human a decision, not to mint fix-work. A "headwind" is anything that has been dragging recent progress toward the project's stated direction (its north star) — slowing velocity, mounting rework, escaping defects, distraction, sluggish flow, or drift away from intent. These are judgement calls a maintainer weighs, not discrete fix-tasks; auto-minting "you got distracted" follow-ups is exactly the queue-swamping this system guards against. The deliverable is a **ranked list of remediable headwinds, each with remediation options**, handed to a human.`,
    // Full orient override (this review's orient block has a non-standard
    // "Also note…" shape, so it bypasses the generic scaffold orient). LIN-700
    // wording (1) is woven in by hand here: the discovery-first scope-formation
    // framing + the three-source grounding sentence, matching the generic block.
    orientOverride: `First, research the repo as it stands today to **form this review's scope from what you discover, not from what a review of this kind is assumed to cover** — **what trajectory signal this project actually exposes**. Prefer a deterministic velocity/roadmap layer if the workspace exposes one: when present, consume its already-computed outputs (velocity trend, recent-versus-prior shift, cycle time, stale in-progress work, blockers and critical path, overdue/unassigned/unestimated risk, and any north-star alignment classification) as the headwind substrate rather than re-deriving them. Discover that instrument at run time — do not assume it exists. Where it is thin or absent, fall back to version-control history and tracker history (re-touched areas and reverts, bug inflow and reopened work, canceled or abandoned tasks, cycle time and overdue/stale work). Also note the branch/PR conventions and where periodical reports are recorded (look for the convention rather than assuming one). Ground that scope in three sources you actively search: the **prior reports in this series** (read the most recent to seed what was flagged, deferred, or never reached); the **sibling reviews' remits and the seams between them** (a surface no single review owns is still in this one's scope); and the **repo's known-issues surfaces** — its agent-guidance and contributor docs, open tickets, inline markers, and configuration. Use what you find to ground the task in this codebase rather than leaving it generic.`,
    bullets: [
      periodicalBullet.priorRunsTrend({ unit: 'headwind', insert: ' A headwind is a *trajectory*: a single snapshot cannot tell a passing squall from a worsening drag, so the comparison against prior runs is the whole point.' }),
      periodicalBullet.runReview(`Assess what has been dragging recent progress, grounding in whatever trajectory data you found available and introducing no new tooling. Read each of these classes: *velocity / throughput* (a declining or volatile completion rate); *rework & churn* (areas re-touched repeatedly, reverts, fix-on-fix); *bugs / defect-escape* (defect inflow and reopened work — but do not stop at a raw count: **cluster the defects by subsystem**, because several bugs concentrated in one area is a headwind even when each is individually small and already closed. In a fix-forward project defects rarely *reopen* — they escape as a *new, adjacent bug filed against the same subsystem*, so treat same-area re-filing as the defect-escape signal, not only a literal reopen; and generalise the cluster scan across the whole codebase rather than re-checking only wherever the previous run's cluster happened to be); *distractions / scope drift* (canceled or abandoned tasks, context-switching away from the plan); *timeliness / flow* (cycle time, stale in-progress, blocked, overdue); and *direction drift* (the share of recent work pulling away from the stated direction rather than toward it — consume the alignment classification the trajectory layer already provides, and never re-derive or rewrite the north star itself. **Alignment is not the same as forward progress: a reliability fix to a subsystem that is itself north-star-aligned is rework, not forward delivery — do not credit bug-fixing on a just-built mechanism as "forward" merely because the mechanism points the right way**).`, { header: 'Run the review across the headwind taxonomy.' }),
      `- **Look for the fix-induced-adjacent-bug (whack-a-mole) pattern — it spans classes.** The single sharpest marker of an unstable, recently-built mechanism is a fix that induces the *next* bug in the same subsystem: a mechanism ships, a defect surfaces inside what was just built, the patch exposes an adjacent gap, and so on. This pattern is simultaneously *bugs / defect-escape*, *rework & churn (fix-on-fix)*, and often *direction*, so a class-by-class scan misses it unless you look for it deliberately. When you see a run of same-subsystem bugs closing fast in a tight window, ask whether each fix caused the next; if so, name the cluster as **one** headwind (not N healthy fast fixes) and rank it by the pattern, not the individual items.`,
      `- **Break each headwind across nested, relative windows.** Report every headwind over nested windows — an immediate window (the last few days), a recent window (the last couple of weeks), and a baseline window (about the last quarter) — so the read is "the last few days went to X; before that Y, which was tech-debt from Z." Windows are always relative to now, never hard-coded dates, and each headwind carries a per-window trajectory: worsening, steady, or easing — plus **unproven / watch** for a mechanism whose defects are all closed but whose fixes are too fresh to have shown it is actually stable. A closed-but-just-shipped mechanism is not the same as a resolved one; do not default it to "eased" merely because nothing is currently broken.`,
      `- **Mind the altitude — do not double-flag.** This review reads *what has been happening recently and whether it is dragging progress toward the north star* — a delivery/execution-drag read spanning bugs, distractions, timeliness, and alignment, oriented to intent and broken across windows. That is distinct from the **Stability Review**, which asks the narrower question *is the project's rate of change converging* (pure version-control churn convergence): you may cite churn as one drag among several, but the convergence-trajectory analysis is the Stability Review's to own — do not double-flag it. It is also distinct from the code-surface reviews (Drift & Coherence, Code Quality), which read structure rather than delivery; and from the direction analyzer whose alignment classification you *consume* but never re-derive.`,
      `- **Write an uncapped, trend-framed report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean "no real headwinds" result is a genuine outcome. Rank the remediable headwinds by severity — and **aggregate before you rank**: a concentration of individually-small, individually-closed items in one subsystem can be a larger headwind than any single one, so grade the pattern, not the parts. Trend-framing is the whole point, but do not let a prior-run diff bury a *new* headwind that has no prior row to compare against: **before writing the ledger, scan explicitly for headwinds that did not exist last run** — a new cluster, a new subsystem under strain — and give them the same scrutiny as the carried-forward names, because the un-forecasted headwind is exactly the one a diff-first method is most likely to miss. Give each headwind one or more concrete remediation options for a human to weigh. Ground each finding against the live history at HEAD, not prior prose. Close the report with a compact trend ledger — each headwind under a stable, descriptive name, with its severity and its delta against the previous run — so the next run can compare mechanically wherever the report lives. Record the report wherever the convention you found puts it.`,
      periodicalBullet.reportBackNoFollowUps(`This review is advisory: its conclusion is an *assessment a human acts on*, not auto-generated work. Do NOT create follow-up tasks. End the report with a plain-language read of the headwinds and the remediation options a maintainer might weigh, and leave the decision to them. Minting "remedy your distraction" tasks would add to the very drag this review exists to surface.`),
      periodicalBullet.concludeAdvisory(),
      periodicalBullet.reviewOnly()
    ]
  });
}

/**
 * Design & Interface Review (LIN-520) — the first periodical whose evidence is
 * the *rendered* product rather than source or history. It reviews the running
 * app's visual design, user experience, and interface: it directs the executor
 * to regenerate fresh desktop+mobile renders of every surface (never trusting
 * stale committed baselines), measure them against the design system the app
 * ships, run an accessibility/performance pass, and produce a high-level UI/UX
 * report with a *required* first-experience section. Beyond catching breakage it
 * assesses how the UI actually *looks* (LIN-567) — visual hierarchy/emphasis,
 * layout/spacing/alignment rhythm, typography, palette-as-design, visual polish,
 * and aesthetic coherence — as first-class design-quality finding classes judged
 * within the minimal CLI/terminal aesthetic, and renders its advisory tail as a
 * ranked before→after shortlist of the highest-impact visual improvements a human
 * can approve. A 'corrective' review with an advisory tail: it mints fix-tasks
 * only for objective breakage (contrast failures, mobile overflow, broken layout)
 * and keeps subjective design direction advisory and human-gated. Owns the rendered product —
 * defers code/CSS structure to Code Quality, contracts to API Quality, and prose
 * to Documentation so it does not double-flag their territory.
 * @returns {string} Prompt text
 */
function generateDesignReviewPrompt() {
  return buildPeriodicalScaffold({
    title: 'Design & Interface Review',
    reviewKind: 'a design, user-experience, and interface review',
    groundNoun: 'product',
    leadIn: `

This is the first periodical whose evidence is the **rendered product**, not source or history: every other review reads the code, but a design review must look at what a user actually sees on screen. The repo already carries the machinery to render and inspect itself — no new tooling is needed.`,
    orientSurfaces: 'the user-facing surfaces it presents (public and first-run pages, the everyday views, and the flagged or experimental ones), the visual-capture mechanism it already ships for rendering those surfaces at desktop and mobile sizes, the design-system reference page it commits as its visual baseline',
    bullets: [
      periodicalBullet.priorRuns(),
      `- **Render, don't read — gather fresh visual evidence.** This review's evidence is the *rendered* product, not the source. Discover and run the repo's own visual-capture mechanism to produce fresh full-page renders of every user-facing surface at both desktop and mobile widths, authenticating through whatever test or mock-session seam the repo provides for the views that need a session, and add an accessibility and performance pass using the browser tooling available. Regenerate everything at run time and **never trust any committed reference renders** — treat them as stale, because they lag the live UI. Measure what you see against the design system the app itself ships as a committed reference page, as the baseline for a "does the UI actually consume its own system?" check. Name these capabilities conceptually; you are looking at the running product, not citing a file.`,
      `- **Include a required first-experience section.** Every run must devote an explicit, required section to a cold visitor's first experience: is it clear *what* the product is and *how* it works; what do onboarding and first-run feel like; how do empty states read; and does the single primary call-to-action have the affordance it deserves, or is it disguised among lower-stakes chrome? This is also where the **aesthetic coherence and first-impression** verdict lands: in the first ~5 seconds, does the surface look trustworthy, polished, and intentional, and does the CLI/terminal aesthetic read as a deliberate, well-executed design language rather than an accidental default? Keep this section even when the rest of the report is short — it is the part a human most wants each cycle.`,
      periodicalBullet.runReview(`Assess: *visual consistency vs the design system* (do pages consume the shared tokens — colour, spacing, type, state indicators — or drift into hardcoded one-offs); *accessibility* (contrast, focus order, keyboard reachability, alt text, ARIA/semantics); *responsive and mobile* (layout integrity and overflow across the desktop and mobile renders); *affordance and discoverability* (can a user tell what is interactive — treat systemic low-affordance, especially on first-run surfaces, as a first-class concern, while weighing it honestly against any deliberate minimal aesthetic the project has chosen); *information hierarchy* (does each page lead with what matters); and *copy and labeling* (is each destination named consistently across the app).`, { header: 'Run the review across the interface finding classes.' }),
      `- **Then assess how the UI actually looks — the design-quality finding classes.** The classes above mostly catch breakage and reading order; this set is a first-class, proactive read on visual craft — *how to make the UI look better* — judged *within* the project's deliberate minimal CLI/terminal aesthetic, never as a push toward generic chrome. Assess: *visual hierarchy and emphasis (the eye-path)* (does each screen establish a clear first / second / third read, and is the single primary action visually dominant, or does everything carry the same visual weight — a real risk in a flat monospace design — with size, weight, and colour used to *rank* content; this is the highest-leverage "looks better" dimension); *layout, spacing and alignment rhythm* (a consistent spacing scale and grid, elements aligned to shared edges, whitespace used deliberately to group the related and separate the unrelated rather than ad hoc, density versus breathing room); *typography* (a real type-scale ramp rather than random sizes, comfortable line length/measure for prose, line-height, and weight/size/case doing hierarchy work — in a monospace-first design, typographic rhythm and restraint carry most of the polish); *colour and palette as design* (palette cohesion and restraint, and consistent *semantic* use of accent and state colour — the done/in-progress/todo indicators — rather than one-off drift, beyond the accessibility contrast check); *visual polish and craft details* (consistency of borders, dividers, the box-drawing rules, and indicator sizing, plus the presence and quality of interactive states — hover, focus, active — and transitions: the small stuff that separates "intentional" from "unfinished"); and *aesthetic coherence and first-impression quality* (does the product read as a deliberate, well-executed design language — fold the first-impression verdict into the required first-experience section above). These are design-quality judgements: they feed the advisory tail, never the corrective minting half.`,
      `- **Mind the altitude — do not double-flag.** This review owns the **rendered product** — what the user sees and does. Defer code and stylesheet structure to the Code Quality Review, HTTP and interface contracts to the API Quality Review, and documentation prose to the Documentation Review; cite them only where a visible defect traces back to their territory, and let them own the fix.`,
      periodicalBullet.uncappedReport({ ground: 'the freshly rendered product', groundExtra: ' or a stale render' }),
      periodicalBullet.mintObjectiveBreakage(),
      `- **Keep subjective design direction advisory — but make the advisory tail actionable.** Subjective design-direction calls — overall aesthetic, tone, layout taste, the minimalism-versus-discoverability tension, and everything the design-quality finding classes surface (visual hierarchy, layout/spacing rhythm, typography, palette, polish, coherence) — belong in the report as an advisory tail for a human to weigh, never as a minted fix-task. Do not let this tail stay loose taste notes: render it as a **ranked shortlist of the highest-impact visual improvements**, each a concrete *before → after* proposed *within* the minimal CLI/terminal idiom and measured against the design-system reference page the app ships as its committed visual baseline, ordered so a maintainer can read the top item first, say yes, and promote it into an implementation task by choice. Keep it honest about the aesthetic: "this surface already looks good as-is / the minimalism is working here" is a valid, explicit conclusion, and every improvement is proposed within the idiom, never as a push toward generic chrome. The corrective half still mints work only for objective breakage under the same hard cap; the advisory half hands these judgement calls to a maintainer and mints nothing.`,
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly({ extra: ' — capturing fresh renders and running an accessibility/performance pass is inspection, not a change to ship' })
    ]
  });
}

/**
 * The registry of periodical templates: the LIN-354 set — Documentation
 * Review, Test Coverage Gap Review, the consolidated broad Security Review
 * (absorbing the former Secrets & Credential Scan + Prompt-Injection Surface
 * Review), API Quality and Code Quality reviews — plus the trend-aware Drift &
 * Coherence Review (LIN-369) and the Comprehension-Debt Review (LIN-370) — plus
 * the advisory Stability Review (LIN-453), a trajectory governor that reports an
 * assessment for a human to act on rather than minting follow-up tasks — plus
 * the corrective, trend-aware Dependency & Supply-Chain Review (LIN-371) at the
 * supply-chain/provenance altitude — plus the advisory Recent Headwinds report
 * (LIN-542), the delivery-trajectory sibling of the Stability Review that reads
 * what has been dragging recent progress toward the north star across nested
 * windows and hands a human a ranked list of remediable headwinds — plus the
 * Design & Interface Review (LIN-520), the first periodical whose evidence is the
 * *rendered* product: it regenerates fresh renders of every surface, runs an
 * accessibility/performance pass, carries a required first-experience section,
 * assesses how the UI looks across design-quality finding classes (LIN-567), and
 * mints fix-tasks for objective breakage only while keeping subjective design
 * direction advisory as a ranked before→after shortlist. Each is a Stage-1 task-generation prompt that mints
 * a review task carrying the report contract.
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
  },
  {
    id: 'dependency-supply-chain',
    title: 'Dependency & Supply-Chain Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateDependencySupplyChainPrompt
  },
  {
    id: 'recent-headwinds',
    title: 'Recent Headwinds',
    mode: 'advisory',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateRecentHeadwindsPrompt
  },
  {
    id: 'design-review',
    title: 'Design & Interface Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateDesignReviewPrompt
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
