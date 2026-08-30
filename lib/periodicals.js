import { buildPeriodicalGateMarker } from './periodical-report-gate.js';

// =============================================================================
// Periodicals registry (LIN-341 / parent LIN-315 / LIN-344 / LIN-354 / LIN-369 / LIN-453 / LIN-371)
// =============================================================================
//
// Periodicals are recurring, workspace-wide review templates rendered as a
// synthetic "Periodicals" group on the main workspace view (behind the
// `periodicals` workspace flag from LIN-340). Each entry is a template:
//
//   { id, title, mode, scope, cadence?, generatePrompt() }
//
// SCOPE: each entry also carries `scope: 'repo' | 'workspace'` — what a run
// reads to do its job: a codebase (`repo`) or this workspace's own tracker/
// delivery history (`workspace`). Unrelated to 'workspace-wide' above, which
// describes how the whole periodicals programme surfaces, not what any one
// template reads.
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
// taxonomy predates the LIN-354 reframe: today the registry is 12 corrective
// reviews (they mint fix-tasks) and 3 advisory ones — the Stability Review
// (LIN-453), Recent Headwinds (LIN-542), and Integration & Surface Maturity
// (LIN-1336) — trajectory or portfolio governors that report an assessment for
// a human to act on and mint NO follow-up tasks (see each builder below), so
// the badge signals that behavioural difference rather than being a no-op.
// `cadence` is a fallback floor for LIN-1629, not a trigger.
//
// NOTE (LIN-700): the shared Stage-1 scaffold is now factored into
// buildPeriodicalScaffold({…}) + the periodicalBullet.* vocabulary below; each
// builder passes only its remit-specific parts (title, reviewKind, orient
// surfaces, the "Run the review" body, and any freeform bullets). The generic
// contract text lives in one place so it can no longer drift across the fifteen
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
//   2. Add the registry entry: { id, title, mode, scope, cadence, generatePrompt }.
//      Classify `scope` from the prompt's own evidence (what it directs the
//      agent to ground against) — never infer it from the `mode` badge, and
//      never assume `mode === 'advisory'` implies `scope === 'workspace'`.
//   3. Keep the prompt implementation-agnostic: prescribe WHAT to find and how
//      to FRAME the report (severity ranking, ledgers), never WHERE things
//      live — locations (report convention, prior runs, source surfaces) are
//      discovered by the executing agent at run time. The shared-contract test
//      in tests/unit/periodicals.test.js enforces this (no file literals, no
//      proxy mechanics, no baked-in report location).
//   4. Name the altitude difference vs. the existing reviews inside the prompt
//      so two periodicals don't double-flag the same findings.
//   5. Update tests/unit/periodicals.test.js: the registry count, the
//      expected id/title/mode/scope map, and the closed-union scope guard.
//      The shared-contract describe loop covers the new entry automatically;
//      add a "specifics" block only for bespoke contract language.
//   6. Spot-check the repo first to confirm the review's finding classes exist,
//      so the template's first run produces a real baseline, not a no-op.
// =============================================================================

/**
 * @typedef {Object} PeriodicalTemplate
 * @property {string} id - Stable template id (also used as the synthetic node id)
 * @property {string} title - Display title for the row
 * @property {'corrective'|'advisory'} mode - Rendered as a badge only.
 * @property {'repo'|'workspace'} scope - What a run reads: a codebase (repo) or this
 *   workspace's own tracker/delivery history (workspace). See the header note above for
 *   the unrelated "workspace-wide" sense.
 * @property {string} [cadence] - Suggested run cadence. Carried through by foldPeriodicalRuns
 *   (lib/periodical-runs.js) to compute due/recent/never/unknown state and republished at
 *   GET /api/proxy/periodicals (LIN-1827/LIN-1829) — a fallback floor for LIN-1629's
 *   still-unbuilt dispatch decision, not a trigger itself (see the header note above).
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
// of LIN-700 — a contract change now lands in one place instead of fifteen.
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

  // LIN-694: a stable, invisible-to-a-reader marker the minted task must carry
  // so Harbour's engine can recognise it as a periodical review task at
  // Done-transition time (routes/proxy.js's report-persistence gate) — a
  // structural identifier, not a report location, so it does not weaken the
  // location-agnostic discovery contract above.
  const gateMarker = buildPeriodicalGateMarker(title);
  const closing = `Include this exact line as the very first line of the new task's description — an internal marker Harbour's engine uses to require report-persistence evidence before this task can be marked done: \`${gateMarker}\`. Keep the task general enough that its executor re-grounds against the live ${groundNoun}, yet specific enough to this codebase to run cold. Leave the new task on the stack in its default state and report its identifier and URL.`;

  // LIN-700 wordings (3)+(4): every minted task opens with the gap-audit + the
  // coverage-theater guard, prepended uniformly across all builders. LIN-2323:
  // every minted task also closes with the adversarial-second-read directive,
  // appended uniformly — one edit reaches all 15 templates, same precedent.
  const allBullets = [periodicalBullet.gapAudit(), ...bullets, periodicalBullet.adversarialRead()];

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
  // trails every "Run the review" body across all 15 builders.
  runReview(body, { header = 'Run the review.' } = {}) {
    return `- **${header}** ${body} The finding-classes above are **examples, not a limit — discover the complete set for this remit from the repo; a class list is a floor to build on, never a ceiling to stay inside.**`;
  },
  uncappedReport({ ground = 'the source at HEAD', groundExtra = '' } = {}) {
    return `- **Write an uncapped report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean result is a genuine outcome. Ground each finding against ${ground}, not prior prose${groundExtra}. Record the report wherever the convention you found puts it — establish that place before you start writing. If discovery genuinely turns up no such place, put the full report in this task's own comment instead of inventing a new location for it.`;
  },
  uncappedReportTrend({ ground = 'the source at HEAD', cleanQual = '', ledgerUnit = 'finding', ledgerExtra = '' } = {}) {
    return `- **Write an uncapped, trend-framed report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean${cleanQual} result is a genuine outcome. Ground each finding against ${ground}, not prior prose. Close the report with a compact trend ledger — each ${ledgerUnit} under a stable, descriptive name, with its severity and its delta against the previous run${ledgerExtra} — so the next run can compare mechanically wherever the report lives. Record the report wherever the convention you found puts it — establish that place before you start writing. If discovery genuinely turns up no such place, put the full report in this task's own comment instead of inventing a new location for it.`;
  },
  mint() {
    return `- **Mint a bounded set of follow-up tasks — highest-severity only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), each well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.`;
  },
  mintObjectiveBreakage({ examples = 'a contrast failure, a mobile overflow, a broken or unusable layout', subjective = 'a subjective design-direction call' } = {}) {
    return `- **Mint a bounded set of follow-up tasks — objective breakage only.** Turn the findings worth acting on into new Linear tasks yourself, but cap it hard: create at most the top ~3 by severity (fewer is fine; zero is a valid result when nothing rises to that bar), and mint a fix-task **only for objective breakage** — ${examples} — never for ${subjective}. Each task is well-scoped (title + short scope) and left in its default state so normal operations pick it up. Record EVERY finding in the report — including the ones you did NOT promote to a task — so nothing is lost and the next run (which reads prior reports first) can promote what still matters. Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle.`;
  },
  reportBackNoFollowUps(body) {
    return `- **Report back for a human decision — mint NO follow-up tasks.** ${body}`;
  },
  conclude() {
    return `- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report, or the report in full when it has no separate location) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. The follow-up tasks you minted carry the actionable work forward through normal operations; this task's own job ends once the report is written and the highest-severity work is on the stack.`;
  },
  concludeAdvisory() {
    return `- **Then conclude this task — do not leave it open.** Post a concise, severity-ranked summary of the report (with a path/link to the full report, or the report in full when it has no separate location) as a comment on this task in Linear, then move the task to its done/completed state. Concluding is the whole point: a review task left open is re-recommended for review indefinitely and never resolves. This review hands its decision to the human through that summary; its own job ends once the report is written and reported.`;
  },
  reviewOnly({ changes = 'no code, config, or secrets — and no docs beyond writing the report artifact itself', extra = '' } = {}) {
    return `- **Stay review-only.** Producing the report changes ${changes}${extra}. An operator instruction to avoid touching files is about the code and docs *under review* — it does not override this task's own deliverable, and the report artifact is never the code under review. Linear access and reporting come from the harness — don't restate them.`;
  },
  // LIN-2323: the universal adversarial-second-read requirement, appended once
  // by buildPeriodicalScaffold's allBullets so every one of the 15 minted tasks
  // carries it (mirroring the gapAudit() precedent — LIN-700). Necessary but
  // not sufficient by itself: lib/periodical-report-gate.js's
  // hasAdversarialReadEvidenceComment is the code-level backstop that makes
  // this binding rather than a convention a conflicting instruction could
  // silently override.
  adversarialRead() {
    return `- **Get a fresh-context adversarial second-read before this task can conclude — a required, structural step, not advice.** After the report above (and any follow-up tasks) is written, and before the Done transition described above can actually succeed, a genuinely separate reader must answer one question cold: *"what is the largest item in this window that this report missed or misfiled?"* Two tiers get you a reader separate enough — **Tier 1 (preferred):** dispatch a wholly separate session with no memory of this run. **Tier 2 (accepted fallback):** a fresh-context sub-agent carrying no memory of the report-writing turn. **Tier 3 — this same session re-reading its own report "from a cold stance" — is not accepted**; state which of Tier 1 or Tier 2 you used. Then post one comment on this task recording, together in a single comment body: \`Adversarial second-read verdict: AGREE\` or \`Adversarial second-read verdict: DISAGREE\`; \`Differed from top finding: YES\` or \`Differed from top finding: NO\` — whether the reader's own answer to the largest-missed-item question differed from the report's own top-ranked finding, independent of the verdict; and \`Disposition: fixed in place\`, \`Disposition: escalated\`, or \`Disposition: no change\`. That comment is mandatory, not optional documentation: the engine reads it and refuses a premature Done transition, naming exactly what is missing, until all three are present together in one comment body. Copy the same three fields into a \`## Adversarial Second-Read\` section of the report artifact itself, alongside the tier used, the question, and the reader's answer in full — a human-readable duplicate the engine never reads, not a substitute for the comment. **AGREE and DISAGREE both conclude this task normally — a DISAGREE verdict is itself the escalation**, visible in the comment and the appendix, never a reason to leave this task open pending a human. This task owns merging its own report PR, if it opened one: once the PR's required CI checks are green, merge it before the Done transition above — the report is docs-only, so merging it yourself is safe. Only when merging is genuinely impossible (no merge permission, required checks still red) may this task conclude with that PR left open, and then only as an explicit handoff naming what blocks the merge in the closing comment — never as ordinary completion. An open, not-yet-merged report pull request is not a normal terminal state; escalating — via a DISAGREE verdict or via a named merge blocker — never blocks concluding.`;
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
      `- **Write an uncapped, trend-framed report.** The deliverable is a clear, severity-ranked report of everything found — finding nothing, one thing, or several are all valid; do not pad, cap, or invent make-work to hit a number, and a clean "no real headwinds" result is a genuine outcome. Rank the remediable headwinds by severity — and **aggregate before you rank**: a concentration of individually-small, individually-closed items in one subsystem can be a larger headwind than any single one, so grade the pattern, not the parts. Trend-framing is the whole point, but do not let a prior-run diff bury a *new* headwind that has no prior row to compare against: **before writing the ledger, scan explicitly for headwinds that did not exist last run** — a new cluster, a new subsystem under strain — and give them the same scrutiny as the carried-forward names, because the un-forecasted headwind is exactly the one a diff-first method is most likely to miss. Give each headwind one or more concrete remediation options for a human to weigh. Ground each finding against the live history at HEAD, not prior prose. Close the report with a compact trend ledger — each headwind under a stable, descriptive name, with its severity and its delta against the previous run — so the next run can compare mechanically wherever the report lives. Record the report wherever the convention you found puts it — establish that place before you start writing. If discovery genuinely turns up no such place, put the full report in this task's own comment instead of inventing a new location for it.`,
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
 * Performance / Scale Review (LIN-1038, supersedes the LIN-611 stub) — a
 * corrective, trend-aware review whose evidence is *measured runtime behaviour*
 * rather than source read in the abstract: it exercises the running app and
 * reads real numbers — page/endpoint latency, the cost of expensive
 * computations, how each hot read scales with data volume, and provider/datastore
 * call cost on the hot path — framing each as a delta against the prior run and
 * measuring toward the platform's request-timeout ceiling. It sits at the
 * measured-*symptom* altitude ("this is slow / will be slow at scale, here is the
 * number") and carves that seam against its data/operations siblings: the Data &
 * Fetch review owns the static *cause* (where data lives, why a read is
 * unbounded), Reliability owns behaviour under *failure*, Stability owns *rate of
 * change*, and Observability owns *visibility* — cite them, don't headline their
 * findings. Anti-over-optimisation is load-bearing (carried from LIN-611): only a
 * real, measured bottleneck earns a fix-task, and a clean "nothing near the
 * ceiling" is a genuine outcome. Trend framing mirrors the Drift & Coherence and
 * Dependency & Supply-Chain reviews. Kept implementation-agnostic — the concrete
 * baseline (which surfaces are hot, which computation is super-linear) is
 * discovered by the executing agent at run time, not baked into the template.
 * @returns {string} Prompt text
 */
function generatePerformanceScalePrompt() {
  return buildPeriodicalScaffold({
    title: 'Performance / Scale Review',
    reviewKind: 'a performance-and-scale review',
    groundNoun: 'product',
    leadIn: `

This review's evidence is **measured runtime behaviour**, not source read in the abstract: actually exercise the running app and read real numbers — page/endpoint latency, the cost of expensive computations, how hot reads scale with data volume — rather than reasoning about speed from the code alone. The repo already carries the machinery to run and inspect itself; introduce no new profiling tooling.`,
    orientSurfaces: 'the real surfaces it serves and how they are exercised, the expensive computations on the hot path (tree building, graph/critical-path, layout, ranking), the hot reads that scale with data volume, and the platform request-timeout ceiling the deployment imposes',
    bullets: [
      periodicalBullet.priorRunsTrend({ insert: ' Performance is a *trajectory*: a single measurement cannot tell an improving path from a worsening one, so framing each number as a delta against the prior run is the whole point.' }),
      periodicalBullet.runReview(`This review works at the **measured-symptom** altitude — "this is slow, or will be slow at scale, and here is the number" — grounding every finding in a real measurement taken against the running app at HEAD, never in reasoning from source alone. Cover: *page / endpoint latency* (measure load/response times for the real surfaces and find the ones trending toward the platform's request-timeout ceiling); *cost per heuristic* (walk the expensive computations — tree building, graph/critical-path, layout, ranking — and cost each against scaled input, noting which grow super-linearly); *scale across vectors* (model how each hot read scales as the data behind it grows — record count, history depth, nesting/feedback depth, tenant/workspace count — the target class is a path that is fine at small N yet crosses the timeout ceiling at large N); and *third-party / provider and datastore call cost* (the latency and volume of outbound provider and database calls on the hot path — e.g. an un-cached full fetch re-issued per page-view). Measure before/after where feasible, and treat a clean "nothing near the ceiling" as a real, valid result rather than a gap to fill.`),
      `- **Anti-over-optimisation is load-bearing.** Only a *real, measured* bottleneck earns a fix-task — never a speculative micro-optimisation or a constant-factor tweak on already-sound code. A computation that is linear and cheap at the scales this project actually reaches is a **clean result**, reported as such and not promoted to a task; chasing constant-factor gains on code that is already fast enough is itself a finding of over-engineering. Every claim of slowness is grounded in a number you observed, not an intuition that something "looks slow".`,
      `- **Mind the altitude — do not double-flag the siblings' territory.** This review owns the **measured symptom** under *load*: how slow a surface is, and where a real number crosses the ceiling. It does **not** own the *cause*: where the data lives and why a read is unbounded is the **Data & Fetch** review's job — cite it as the structural home for the fix, never headline its cause as this review's own discovery. Likewise, behaviour under *failure* belongs to the **Reliability** review (you own behaviour under *load*); the project's *rate of change* belongs to the **Stability** review (you own *runtime cost*); and whether a slowdown is *visible / observable* belongs to the **Observability** review (you own *how slow it is*). Two reviews seeing one slow path from different altitudes is fine; presenting a sibling-owned cause as your headline is not — name the sibling and the seam.`,
      `- **Name a structural floor, not a point patch.** Every finding names the **structural / design** change that raises the performance floor for the whole codebase — a bounded read, a shared cache, an incremental or memoised computation — rather than a one-off tweak at a single call site that leaves the next caller to rediscover the same cliff. Keep the promoted set small and paced; a queue swamped with micro-optimisations is worse than one real bottleneck that waits a cycle.`,
      periodicalBullet.uncappedReportTrend({ ground: 'a real measurement taken against the running app at HEAD', cleanQual: ' "nothing near the ceiling"', ledgerUnit: 'measurement', ledgerExtra: ', with the number observed this run' }),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly({ extra: ' — taking measurements against the running app is inspection, not a change to ship' })
    ]
  });
}

/**
 * Data & Fetch Architecture Review (LIN-1039) — a corrective, trend-aware review
 * at the *static cause* altitude behind performance: how data is organised, where
 * it lives, and how it is fetched, read from the source and data layer rather than
 * the running app. The thesis is that chasing performance produces a brittle
 * system, whereas a sensible data model and disciplined reads are fast as a
 * consequence — so it reviews the data-and-read *shape*, not the measured symptom.
 * Finding classes: the store-vs-provider boundary (serve data we already own vs
 * re-fetch a provider live), read discipline (projection/index/limit/pagination
 * pushed into the query vs done in memory after a full read), read-model /
 * derived-fact persistence (materialise at write vs re-derive on read), fetch
 * amplification / N-scaling, and cache-layer coherence. Trend framing mirrors the
 * Drift & Coherence / Dependency & Supply-Chain reviews. Carves its altitude vs
 * the API Quality Review (external contract), the Performance / Scale Review
 * (measured runtime symptom), and the Drift & Coherence Review (general structural
 * duplication) so the shared findings are not double-headlined.
 * @returns {string} Prompt text
 */
function generateDataFetchArchitecturePrompt() {
  return buildPeriodicalScaffold({
    title: 'Data & Fetch Architecture',
    reviewKind: 'a data-and-fetch-architecture review',
    orientSurfaces: 'where this project keeps the data it owns and how it reads it (its own stores and caches, the external providers it fetches from live, and the hot read paths its pages and endpoints exercise)',
    bullets: [
      periodicalBullet.priorRunsTrend(),
      periodicalBullet.runReview(`Review **how data is organised, where it lives, and how it is fetched** — statically, from the source and the data layer, not the running app. The thesis: chasing performance produces a brittle system, whereas a sensible data model and disciplined reads are fast *as a consequence*, so this review reads the *cause* — the shape of the data and the reads — not the measured symptom. Use the repo's own store and provider layers as the reference and introduce no new tooling. Assess: *the store-vs-provider boundary* (do hot reads serve data the project already owns from its own store, or re-fetch an external provider live on every request — prefer serving what is already ours where the data is local); *read discipline* (is projection, indexing, limiting, and pagination pushed **into** the store query, or done in application code **after** reading a whole collection or history into memory — a limit applied as an in-memory slice after a full read is a defect catchable statically, before it degrades under load); *read-model / derived-fact persistence* (are expensive facts materialised at write time and served cheaply, or re-derived from raw records or transcripts on every read); *fetch amplification and N-scaling* (reads whose cost grows with the number of entities, history, or accumulated feedback, unbounded and uncached); and *cache coherence* (is the storage-and-cache layer a coherent, deliberate strategy, or a feature-by-feature accretion where indexes and caches are bolted on reactively only once something hurts). Each finding must name a concrete structural cost — a read that will not scale, a fact re-derived N times, a boundary crossed the wrong way — and propose a **design** improvement that raises the floor for the whole codebase, never a local point patch or a constant-factor tweak on already-sound code (chasing micro-optimisations on sound code is itself a finding of over-engineering, not an improvement — call it out, do not commit it).`),
      `- **Mind the altitude — do not double-flag.** This review works at the **static data-and-fetch design** altitude: how data is stored, where it lives, and how it is read, *behind* the interface. That is distinct from the **API Quality Review**, which owns the *external contract* (naming, validation, the error envelope) — you own how data is stored and fetched behind it; from the **Performance / Scale Review**, which owns the *measured runtime symptom* — you own the *static cause*, the review that would flag an unscalable read before it is ever observed to time out; and from the **Drift & Coherence Review**, which owns structural duplication and layering *in general* — you own the *data-access and fetch-shape slice* specifically. Two reviews seeing the same thing from different altitudes is fine and even useful, but never headline a finding a sibling owns as if this review discovered it: name the sibling and the seam, and cite an overlapping observation only as evidence for this review's own angle. Reading prior reports first seeds the scope but never dictates it — re-derive every finding against the source at HEAD rather than inheriting a prior run's blind spots.`,
      periodicalBullet.uncappedReportTrend(),
      periodicalBullet.mint(),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly()
    ]
  });
}

/**
 * Integration & Surface Maturity (LIN-1336) — the third 'advisory' periodical
 * and a portfolio/meta layer over the other reviews: it inventories the
 * project's surfaces with a MOD/API/FLOW/META taxonomy, scores each against a
 * fixed set of twelve maturity dimensions, and hands a human a triageable
 * maturity read rather than minting fix-work. Its evidence policy is
 * flexible: it prefers current evidence the sibling reviews, prior reports,
 * docs, and related tickets already produced, and falls back to a bounded
 * first-party inspection — with explicit confidence marking — only where that
 * evidence is missing, stale, or shallow. For a sibling-owned dimension it
 * summarizes maturity and names the owning review as the fix's home; it never
 * re-derives a sibling's findings or double-mints/re-homes a fix into that
 * territory, and surfaces the still-unbuilt Reliability and Observability
 * reviews by name rather than silently absorbing their remit. Its own unique
 * first-party remit is the FLOW surface type (end-to-end wiring no single
 * module owns), Core/happy-path completeness, Configuration, and the
 * portfolio/meta scorecard itself. Carries measurement fixes over raw
 * Completeness %: a ledger-first primary signal, a frozen and justified N/A
 * denominator, and evidence required for every changed score. Self-audits its
 * own methodology as a `META` surface each run.
 * @returns {string} Prompt text
 */
function generateIntegrationSurfaceMaturityPrompt() {
  return buildPeriodicalScaffold({
    title: 'Integration & Surface Maturity',
    reviewKind: 'an integration-and-surface-maturity review',
    deliverableNoun: 'report',
    groundNoun: 'code',
    leadIn: `

This review is a **portfolio/meta layer over the other periodicals**, not a fourteenth sibling review that re-inspects everything from scratch: most of its evidence should come from what the other reviews, prior audits, and related tickets already found, and its own first-party inspection is bounded to what nothing else owns. It is advisory, not corrective: like the Stability Review and Recent Headwinds, its job is to hand a human a maturity read across the whole system, not to mint fix-work into territory another review already governs.`,
    orientSurfaces: 'the modules, integration boundaries, and cross-module flows this project is built from, which maturity dimensions the other periodical reviews already cover or have specced for a future review, and any related Linear tickets for reviews not yet built',
    bullets: [
      periodicalBullet.priorRunsTrend({ unit: 'surface', insert: ' Surface maturity is a trajectory: a single snapshot cannot tell steady improvement from stagnation or regression, so framing every surface and recommendation as a delta against the previous run is the whole point.' }),
      `- **Inventory the surfaces using the MOD / API / FLOW / META taxonomy.** Classify every part of the system that can be more or less "done" into one of four types: **MOD** — a structural module or component; **API** — an integration or boundary crossing a trust or process boundary, such as an external dependency or an internal service call; **FLOW** — a concept or entity that traverses multiple modules and may be only partly wired end-to-end, and which no single module "owns" — give FLOW surfaces extra scrutiny, because they are the ones most often left half-finished; and **META** — the audit framework itself (see the self-audit bullet below). Assign each surface a stable, descriptive id and reuse it across runs — an id is forever: a surface that is removed is marked retired, never deleted, so the trend ledger stays diffable.`,
      periodicalBullet.runReview(`Score every surface against a fixed set of maturity dimensions: **core/happy path** (does the primary success scenario work), **error handling & failure modes** (are failures caught, classified, surfaced), **resilience** (timeouts, retries with backoff, circuit breaking, graceful degradation), **rate limits & pagination** (respects limits; handles multi-page or streamed results), **auth & credentials** (token refresh, rotation, expiry, least privilege), **idempotency & consistency** (safe to retry; no double-effects; consistent state on partial failure), **input & schema validation** (validates data in and out; handles version/schema drift), **observability** (logging, metrics, tracing; can you tell when it breaks and why), **security** (secrets handling, injection surfaces, data exposure), **testing** (unit, integration, and for API surfaces, contract tests), **documentation** (enough for the next person to operate and extend it), and **configuration** (env-specific config, feature flags, safe defaults). Score each applicable dimension 0 (absent) through 4 (hardened), or N/A when it genuinely doesn't apply — a pure compute module has no pagination. Cite concrete evidence, a path, symbol, or a specific cited sibling report, for any score of 0-1 or 4, and for every score that changed since the previous run.`),
      `- **Prefer existing evidence; use bounded first-party inspection only to fill the gap.** For each dimension, first look for current, sufficient evidence in the sibling periodicals' own prior reports, existing project docs, earlier reviews, and related Linear tickets — where that evidence is fresh and thorough, score from it rather than re-deriving it. A report existing is not the same as a report being current: treat a stale or shallow one the same as a missing one. Where evidence is missing, stale, or shallow, do a bounded first-party inspection of the code to fill that specific gap. Whichever path you used, mark the surface's confidence explicitly as High, Medium, or Low, and never let a bounded first-party pass imply it now owns a sibling review's full remit — a Low confidence score from a quick look is honest; a High confidence claim without a current source is not.`,
      `- **Mind the altitude: name the owner, don't re-home the fix.** For a dimension a sibling review already owns, this review summarizes maturity and coverage only — it never re-derives the sibling's own findings and never mints or re-homes a fix into that sibling's territory; name the owning review as the natural home for deeper follow-up. Error handling, resilience, rate limits/pagination, and idempotency/consistency belong to the **Reliability** review; whether a gap is visible or observable belongs to the **Observability** review — surface both by name even where neither yet exists in this registry, rather than silently absorbing their remit or blocking on them. Auth & credentials and security belong to the **Security Review**; input & schema validation to the **API Quality Review**; testing to the **Test Coverage Gap Review**; documentation to the **Documentation Review**. This review's own unique first-party remit is the FLOW surface type, Core/happy-path completeness, Configuration, and the portfolio/meta scorecard itself — everything else here is aggregation, not original inspection.`,
      `- **Measurement discipline.** Treat the per-surface, per-dimension ledger with cited evidence as the primary signal; treat portfolio Completeness % as a secondary, explicitly noisy number, and never cite a Completeness % delta as an outcome without naming which surfaces moved and why. Persist every N/A decision with its justification in the state block; a dimension flipping to or from N/A is itself a reportable delta, never a silent denominator change — marking one more dimension N/A must not read as improvement. Require cited evidence for every score that changed since the previous run, not only the extremes — a delta with no cited evidence is scorer drift and should be recorded as unchanged.`,
      `- **Rank the findings for triage.** Emit each recommendation as an object carrying an id, the surface and dimension it targets, the finding with cited evidence, the concrete action, impact and effort (H/M/L), a derived priority (highest impact and lowest effort first), and status. Cap the headline list a human is asked to read at the top 5-10 by priority; the full set stays in the machine-readable state so nothing is lost, and an unresolved recommendation carries forward under its original id so its trend is visible across runs.`,
      `- **Self-audit the framework as its own META surface.** Register this review's own methodology as a META surface and score it each run: how many surfaces are stuck at Low confidence and why; whether a real finding elsewhere in the project hit a surface this review had rated as done (a scoring-model gap); whether a dimension is consistently N/A across everything (dead weight) or consistently 0 (possibly unmeasurable here); and whether past top recommendations are actually getting acted on. Turn what you find into recommendations against the META surface like any other, so the framework's own incompleteness is tracked and paid down run over run instead of frozen at its first version.`,
      periodicalBullet.uncappedReportTrend({ ground: 'the source at HEAD or the sibling evidence you cited', ledgerUnit: 'surface', ledgerExtra: ", plus its Completeness % and confidence, and any N/A dimension with its justification" }),
      periodicalBullet.reportBackNoFollowUps(`This review is a portfolio governor: its conclusion is a maturity read a human triages, not auto-generated work. Do NOT create follow-up tasks, and do not mint or re-home a fix into a sibling review's territory — even a high-severity finding on a sibling-owned dimension is handed to the human as a pointer to the owning review, never turned into a task here. End the report with the ranked recommendations, the scorecard, and the self-audit findings, and leave the triage decision to them.`),
      periodicalBullet.concludeAdvisory(),
      periodicalBullet.reviewOnly()
    ]
  });
}

/**
 * Onboarding & Cold-Start Review (LIN-1689) — a corrective review, with an
 * advisory tail, whose evidence is a *performed* cold-start journey walk
 * rather than an assessment of onboarding artifacts. Every other first-run
 * lens reads the rendered product (Design & Interface Review) or the docs in
 * the abstract (Documentation Review); this one actually attempts the
 * project's own distinct cold-start entry paths step by step, from a
 * declared zero state to the project's own stated destination, recording per
 * step whether it proceeded, needed guessing, or hard-blocked, plus whether
 * the destination was reached. Three mitigations are load-bearing against the
 * ways a performed walk can still read green while onboarding is bad: the
 * destination is pinned from the project's own stated purpose (discovered,
 * frozen, and any later change to that claim treated as a reportable delta,
 * never a silent redefinition of success); every reach outside the journey's
 * own surface for repo context or its agent-guidance and contributor docs is
 * logged as a finding in its own right, since nothing actually denies that
 * context to the executor; and credential/browser/email-gated steps are
 * marked capability-gated and said so explicitly rather than silently
 * skipped. No funnel telemetry is assumed to exist. Mode mirrors Design &
 * Interface Review exactly via mintObjectiveBreakage(): objective breakage (a
 * dead link, a documented command that doesn't exist, a hard block with no
 * workaround) mints fix-tasks; subjective friction stays advisory-only.
 * Carries a one-way "Mind the altitude" bullet naming Design & Interface
 * Review, Documentation Review, Comprehension-Debt Review, and Integration &
 * Surface Maturity so it does not double-flag their territory. reviewOnly()
 * carries an override (unlike the vocabulary's bare default) authorizing the
 * performed walk itself — including running the project's own setup steps in
 * a scratch/throwaway environment — as inspection, since this is the one
 * periodical whose entire evidentiary basis is a walk that writes files and
 * runs setup. Kept project-agnostic: the concrete entry paths for any given
 * project are discovered by the executor at run time, never baked into the
 * template.
 * @returns {string} Prompt text
 */
function generateOnboardingJourneyPrompt() {
  return buildPeriodicalScaffold({
    title: 'Onboarding & Cold-Start Review',
    reviewKind: 'a cold-start onboarding review',
    groundNoun: 'product',
    leadIn: `

This review's evidence is a **performed cold-start journey**, not an assessment of onboarding artifacts: every other first-run lens reads the rendered product or the docs in the abstract, but this one must actually attempt to use the product from a standing start and record what happened at each step.`,
    orientSurfaces: "the project's own stated purpose (wherever it states what it is for — typically its README or other top-level docs — discovered, never assumed at a fixed location) and its distinct cold-start entry paths and personas (illustrative examples: a hosted or signed-up visitor, a from-scratch local or self-hosted setup, a programmatic/API or CLI consumer if the product exposes one — not this product's actual complete set, which the executor discovers)",
    bullets: [
      periodicalBullet.priorRunsTrend({ unit: 'journey step' }),
      `- **Pin the destination first.** Before walking anything, discover the project's own stated purpose and freeze it as this run's destination — what "used as intended" means for this review. Treat a later run finding that stated purpose has changed as a reportable delta against the frozen destination, never a silent redefinition of what success means.`,
      periodicalBullet.runReview(`Declare a zero state, then discover this product's distinct cold-start entry paths and, for each, actually attempt it step by step as a genuine first-time user would — not as someone who already knows the answer. Record, per step: whether it *proceeded* cleanly, *had to guess* (worked, but only after trial and error or an inference the product itself did not provide), or *hard-blocked* (no workaround found) — and at the end of each journey, whether the frozen destination was actually reached.`),
      `- **Simulate first-time, log every reach.** Nothing actually denies the executor its repo checkout, prior reports, or its agent-guidance and contributor docs — this is a discipline, not an enforced sandbox. Attempt each journey step using *only* what that step's own surface offers — its own copy, its own error messages, its own in-product prompts, and docs it explicitly points to — and every time you catch yourself reaching for outside repo knowledge to get unstuck, log that catch as a finding in its own right (a "reach") rather than silently using it and moving on.`,
      `- **Separate hard blocks from friction; say when a step is capability-gated.** A hard block (fails outright, no workaround) is not the same as friction (eventually worked, but took guessing or was confusing) — keep them distinct in the ledger. Where a step needs a browser, an email inbox, or a human-held credential the executor doesn't have, mark it explicitly **capability-gated** and say so in the report rather than silently skipping it or guessing at the outcome.`,
      `- **No funnel telemetry exists — do not assume it.** Do not go looking for a signup/activation analytics signal or assume one is tracked; if none exists, say so plainly and continue with the performed walk as the primary signal. Any human-reported feedback surface the product exposes is a secondary, capability-gated corroboration only, never a substitute for the walk.`,
      `- **Mind the altitude — do not double-flag.** This review owns the **performed journey** from cold start to the frozen destination. Defer the *rendered* first-experience surface (landing hero, empty states, CTA affordance, the aesthetic verdict) to the **Design & Interface Review** — this review does not re-render or re-judge aesthetics, only the behaviour of the journey; defer whether the docs read well *in the abstract* to the **Documentation Review** — report only where following a doc's instructions actually failed mid-walk (a stale command, a broken link), never doc prose quality generally; defer a cold reader of *code* to the **Comprehension-Debt Review** — this review never reads source, only walks the product as a user or agent would; and defer cross-review aggregation to **Integration & Surface Maturity** — feed it evidence, never duplicate its scorecard.`,
      periodicalBullet.uncappedReportTrend({ ground: 'the journey as actually walked this run', ledgerUnit: 'journey step' }),
      periodicalBullet.mintObjectiveBreakage({
        examples: "a broken or dead link, a documented command that doesn't exist or errors, a setup step that hard-blocks with no workaround, a 404/500 mid-journey",
        subjective: 'friction — a step that merely required guessing or felt confusing but eventually worked, with no hard block'
      }),
      periodicalBullet.conclude(),
      periodicalBullet.reviewOnly({ extra: " — performing the journey itself (running the project's own setup steps in a scratch checkout or throwaway environment) is inspection, not a change to ship; the repo under review is left untouched" })
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
 * direction advisory as a ranked before→after shortlist — plus the corrective,
 * trend-aware Performance / Scale Review (LIN-1038, superseding the LIN-611 stub)
 * at the measured-*symptom* altitude, whose evidence is measured runtime
 * behaviour (latency, per-heuristic cost, scale-across-vectors, provider/datastore
 * call cost) and which cites its Data & Fetch / Reliability / Stability /
 * Observability siblings for the cause it does not own — plus the corrective,
 * trend-aware Data & Fetch Architecture review (LIN-1039), the static-*cause*
 * lens behind performance that reads how data is organised, where it lives, and
 * how it is fetched (store-vs-provider boundary, read discipline, derived-fact
 * persistence, N-scaling, cache coherence), carved from the API Quality,
 * Performance / Scale, and Drift & Coherence reviews — plus the advisory
 * Integration & Surface Maturity review (LIN-1336), a portfolio/meta layer
 * over the other periodicals: it inventories the project's surfaces with a
 * MOD/API/FLOW/META taxonomy, scores each against twelve maturity dimensions,
 * prefers existing sibling-review evidence over first-party inspection
 * (falling back to a bounded first-party pass, with explicit confidence
 * marking, only where that evidence is missing, stale, or shallow), and names
 * — rather than re-derives — the sibling review that owns each dimension,
 * surfacing the still-unbuilt Reliability and Observability reviews by name
 * so they are not silently absorbed — plus the corrective Onboarding &
 * Cold-Start Review (LIN-1689), with an advisory tail, whose evidence is a
 * *performed* cold-start journey walk rather than an assessment of onboarding
 * artifacts: it attempts the project's own distinct entry paths from a
 * declared zero state to the project's own stated (and frozen) destination,
 * logs every reach outside the journey's own surface as a finding, and mints
 * fix-tasks only for objective breakage, deferring the rendered first-run
 * surface, doc quality in the abstract, and code comprehension to Design &
 * Interface, Documentation, and Comprehension-Debt respectively. Each is a
 * Stage-1 task-generation prompt that mints a review task carrying the report
 * contract.
 * @type {PeriodicalTemplate[]}
 */
export const PERIODICALS = [
  {
    id: 'documentation-review',
    title: 'Documentation Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateDocumentationReviewPrompt
  },
  {
    id: 'test-coverage-gap',
    title: 'Test Coverage Gap Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateTestCoverageGapPrompt
  },
  {
    id: 'security-review',
    title: 'Security Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateSecurityReviewPrompt
  },
  {
    id: 'api-quality',
    title: 'API Quality Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateApiQualityPrompt
  },
  {
    id: 'code-quality',
    title: 'Code Quality Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateCodeQualityPrompt
  },
  {
    id: 'drift-coherence',
    title: 'Drift & Coherence Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateDriftCoherencePrompt
  },
  {
    id: 'comprehension-debt',
    title: 'Comprehension-Debt Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateComprehensionDebtPrompt
  },
  {
    id: 'stability-review',
    title: 'Stability Review',
    mode: 'advisory',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateStabilityReviewPrompt
  },
  {
    id: 'dependency-supply-chain',
    title: 'Dependency & Supply-Chain Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateDependencySupplyChainPrompt
  },
  {
    id: 'recent-headwinds',
    title: 'Recent Headwinds',
    mode: 'advisory',
    scope: 'workspace',
    cadence: 'weekly',
    generatePrompt: generateRecentHeadwindsPrompt
  },
  {
    id: 'design-review',
    title: 'Design & Interface Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateDesignReviewPrompt
  },
  {
    id: 'performance-scale',
    title: 'Performance / Scale Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generatePerformanceScalePrompt
  },
  {
    id: 'data-fetch-architecture',
    title: 'Data & Fetch Architecture',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateDataFetchArchitecturePrompt
  },
  {
    id: 'integration-surface-maturity',
    title: 'Integration & Surface Maturity',
    mode: 'advisory',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateIntegrationSurfaceMaturityPrompt
  },
  {
    id: 'onboarding-journey',
    title: 'Onboarding & Cold-Start Review',
    mode: 'corrective',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateOnboardingJourneyPrompt
  }
]

/**
 * Get all periodical templates (returns the live registry array).
 * @returns {PeriodicalTemplate[]}
 */
export function getPeriodicals() {
  return PERIODICALS
}

// =============================================================================
// Mint + Autopilot variant tail (LIN-1279)
// =============================================================================
//
// The periodical surface offers a second "Mint + Autopilot" action beside the
// existing plain Mint. It dispatches the SAME periodical prompt with workspace-API
// proxy context attached, plus this tail appended, so the minting agent — the only
// actor that holds the identifier of the task it just created — chains a *scoped*
// autopilot run against that task itself, then stops (Approach A, LIN-1279). The
// handoff is solved by construction: no Harbour-side correlation id, no feedback
// parsing, no new persisted state.
//
// The tail is VARIANT-ONLY. Plain Mint never carries it, so the plain-mint prompt
// (`periodical.prompt`, from the untouched no-arg `template.generatePrompt()`)
// stays byte-identical and the shared-contract test — which asserts the template
// carries NO proxy mechanics (`POST /api/proxy/...`) or route literals — still
// holds. Only the variant (`periodical.autopilotPrompt`) names the kickoff verb.
//
// It lives in one place and is appended by `withAutopilotTail`, which
// `buildPeriodicalNodes` applies to every template's base prompt. (Appending here
// rather than threading a parameter through all fifteen `generate*` builders
// yields a byte-identical variant with far less surface, and keeps the plain
// prompt exactly as-is.)
export const PERIODICAL_AUTOPILOT_TAIL = `---

## After minting: hand off to autopilot — do not run the review yourself

You were dispatched through the **Mint + Autopilot** action, so you have one extra step after minting the review task, and one hard boundary.

**The extra step.** Once you have created the review task and have its **identifier** (e.g. \`LIN-1234\`), launch a scoped autopilot run against it by calling the workspace API proxy:

\`\`\`
POST /api/proxy/autopilot/kickoff
{ "issueIdentifier": "<the identifier of the task you just minted>" }
\`\`\`

Send it with the workspace-API token and base URL from your proxy access block (exchange the bootstrap token for a working token first, exactly as that block describes). Passing \`issueIdentifier\` makes it a **scoped** run — autopilot targets that one newly-minted task and drives it through its first execution.

**The hard boundary — do not run the review yourself.** Minting the task and kicking off autopilot is the whole of your job on this dispatch. The autopilot run you just launched is what performs the review. After the kickoff call returns, **stop**: do not pick the minted task back up, do not start or execute the review, and do not report findings. Running the review inline *in addition to* the autopilot run would double-execute it — the kickoff is the handoff, and your turn ends there.`

/**
 * Append the Mint + Autopilot handoff tail (LIN-1279) to a base periodical
 * prompt, producing the variant the "Mint + Autopilot" action dispatches. The
 * base prompt is returned unchanged plus the tail, so the plain-mint prompt is
 * never mutated.
 *
 * @param {string} basePrompt - A rendered periodical (Stage-1) prompt
 * @returns {string} The same prompt with the autopilot-handoff tail appended
 */
export function withAutopilotTail(basePrompt) {
  return `${basePrompt}\n\n${PERIODICAL_AUTOPILOT_TAIL}`
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
  return PERIODICALS.map(template => {
    // Render the plain Stage-1 prompt once and derive the Mint + Autopilot variant
    // from it (LIN-1279). `prompt` is the untouched plain-mint text; `autopilotPrompt`
    // is the same text plus the handoff tail, dispatched only by the gated
    // "Mint + Autopilot" action (see renderPeriodicalNode).
    const prompt = template.generatePrompt()
    return {
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
        prompt,
        autopilotPrompt: withAutopilotTail(prompt)
      }
    }
  })
}
