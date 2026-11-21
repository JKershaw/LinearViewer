/**
 * Recommendation fact assembly (LIN-434) — the deterministic, network-free seam.
 *
 * One module that owns the per-node fact set the recommendation prompts consume, so
 * fact assembly is boring, isolated, and unit-testable instead of scattered inline
 * across the prompt builders. It does NOT touch the network and never calls the LLM;
 * generation (prompt body) and decision (markdown-contract parsing) are the other two
 * seams and stay in lib/openrouter.js.
 *
 * The frontier ranking (selectFocusSubtask, computeFrontierFacts, compareByIdentifier)
 * was seeded in lib/tree.js by LIN-433 and, though LIN-434 left it there, is moved
 * here by LIN-3727: which child a recommendation descends into is the recommendation's
 * rule. lib/tree.js re-exports it for existing importers. Blocker resolution and
 * terminal-state stay owned by providers/state-map.js; this module re-exports them so
 * call sites have a single fact-import surface, and adds computeNodeStateCounts (was computed
 * inline inside buildMetaPrompt).
 *
 * The fact set (per the LIN-434 Done-when list):
 *   - terminal-state .............. isTerminalState (owned by providers/state-map.js)
 *   - open-child count + status ... computeFrontierFacts (owned here, LIN-3727)
 *   - frontier ranking ............ selectFocusSubtask (owned here, LIN-3727)
 *   - blocker-resolution .......... isBlocked (owned by providers/state-map.js)
 *   - plan facts .................. records (lib/records/plan-facts.js, LIN-4504), passed in
 *   - bug-investigation-present ... NOT a deterministic fact (no stable marker exists);
 *                                   stays an inline soft gate on the prompt paths.
 */
import { findingsCount, findingsNotRead } from './close-out-findings.js';
import { isTerminalState, isBlocked } from './providers/state-map.js';
import { computeGraphFeatures, childrenToGraphNodes, hasOpenFrontier } from './graph-features.js';
import { prUrlsIn, byTime } from './run-ledger.js';
import { commentKindOf, extractVerdict, isRuling, isPersonCommentOf, reportsLandedWork, readTrail } from './run-trail.js';
import { readSizeRecord, sizeFact } from './size-of-move.js';
import { gateTrailOf } from './task-standing.js';
import { planFactsNotMeasured } from './records/plan-facts.js';

// What kind each comment is (a person's, an agent's note, a ruling, landed work, a close-out, a
// review, a plan-review verdict) is lib/run-trail.js's one classifier (LIN-4458); this file reads it
// and keeps only the verdict WORD of a plan review (`planReviewVerdictOf`).

// Single fact-import surface: re-export the state-map primitives so consumers import all
// deterministic fact helpers from here (the picker below is defined here).
export { isTerminalState, isBlocked };

/**
 * Select the next subtask to focus on for AI recommendations.
 *
 * Eligibility (HAR-149 fix, LIN-433): non-blocked in-progress → non-blocked todo
 * → non-terminal fallback. The in-progress branch now skips blocked children — it
 * previously returned the lowest-identifier in-progress child *regardless of
 * blocked status*, routing the descent straight into a blocked branch (HAR-149 →
 * blocked HAR-497/502) instead of the live, actionable frontier.
 *
 * Among the eligible (non-blocked, non-terminal) candidates, a transitive
 * dead-end guard runs FIRST (LIN-444): a candidate whose entire reachable subtree
 * frontier is blocked (descending into it can only land on blocked work) is set
 * aside in favour of any candidate with a genuinely open frontier — and only when
 * NO open-frontier candidate exists anywhere do we fall back to a dead-end branch.
 * This is what stops a busy epic from routing into a dead branch (HAR-149: HAR-497
 * → blocked HAR-502) instead of its live frontier (HAR-545 → HAR-616). The signal
 * (`hasOpenFrontier`, lib/graph-features.js) is inert when the children carry no
 * subtree blocked-ness — every candidate then reads as open — so it bites only on
 * the enriched data and never perturbs the Harbour baseline.
 *
 * Within the surviving pool the original tiering holds — in-progress before todo —
 * each ranked by live frontier signals: `downstreamUnblocks` desc (clear the most
 * successors), then `criticalPathLen` desc (shorten the makespan), then
 * `compareByIdentifier` asc as the deterministic tie-break. Those signals are the
 * same ones the swipe/stack digest computes, reconstructed from the in-set siblings'
 * `inverseRelations` (canonical children carry no forward `blocksIds`). An edge-free
 * set leaves every feature at its default, so ranking degrades cleanly to identifier
 * order — today's behavior.
 *
 * NOTE: this picker IS the single next-child source of truth. It is called only by
 * `parentNextOf` (LIN-4039), the one seam the descent (recommend-recurse.js), the prompt's
 * `nextChild` (prompt-formatters.js), the providers' `focusedChild` and the row all read,
 * so the advertised "next child" can never disagree with the child the descent actually enters.
 *
 * The transitive guard reaches the cross-sibling-set blockers LIN-391 deferred
 * (its Scope 3): a child's dead-end is detected from its OWN subtree's blocked-ness,
 * whatever set the blockers live in — not from in-set sibling edges (which the
 * frontier features above still reconstruct only within the sibling set).
 *
 * Relocated from lib/linear.js (LIN-330): this reasons over the children tree
 * shape and state types, not Linear's transport.
 *
 * @param {Array} children - Array of child issues
 * @returns {Object|null} The selected focus subtask or null if none available
 */
export function selectFocusSubtask(children) {
  if (!children?.length) return null

  // Frontier features over the in-set sibling blocking graph. Computed on adapter
  // nodes (childrenToGraphNodes returns fresh objects) so computeGraphFeatures'
  // in-place mutation never touches the caller's children.
  const featById = new Map(
    computeGraphFeatures(childrenToGraphNodes(children)).map(n => [n.id, n])
  )
  const byFrontier = (a, b) => {
    const fa = featById.get(a.id) || {}
    const fb = featById.get(b.id) || {}
    if ((fb.downstreamUnblocks || 0) !== (fa.downstreamUnblocks || 0)) {
      return (fb.downstreamUnblocks || 0) - (fa.downstreamUnblocks || 0)
    }
    if ((fb.criticalPathLen || 0) !== (fa.criticalPathLen || 0)) {
      return (fb.criticalPathLen || 0) - (fa.criticalPathLen || 0)
    }
    return compareByIdentifier(a, b)
  }

  // Eligible candidates: non-blocked AND non-terminal (the union of the
  // in-progress + todo tiers below). LIN-444: split them by whether their reachable
  // subtree frontier is open. A dead-end candidate (entire reachable frontier
  // blocked) is skipped in favour of ANY open candidate — across the state tiers,
  // since descending into a dead-end can only reach blocked work — and we fall back
  // to the dead-end pool only when no open frontier exists at all. Precomputed once
  // (hasOpenFrontier walks each subtree) rather than inside the comparator.
  const nonBlocked = children.filter(c => !isBlocked(c) && !isTerminalState(c.state?.type))
  const openFrontier = nonBlocked.filter(c => hasOpenFrontier(c, isBlocked))
  const pool = openFrontier.length ? openFrontier : nonBlocked

  // 1. Continue in-progress work, frontier-ranked.
  const inProgress = pool
    .filter(c => c.state?.type === 'started')
    .sort(byFrontier)
  if (inProgress.length) return inProgress[0]

  // 2. First todo, frontier-ranked.
  const nextTodo = pool
    .filter(c => c.state?.type === 'unstarted' || c.state?.type === 'backlog')
    .sort(byFrontier)
  if (nextTodo.length) return nextTodo[0]

  // 3. Fall back to the lowest-identifier non-terminal subtask (degenerate
  //    all-blocked case — identifier order, no frontier preference to express)
  return children.filter(c => !isTerminalState(c.state?.type)).sort(compareByIdentifier)[0]
}

/**
 * LIN-4039: the one place a parent's "next" is decided. The row no longer reads it (LIN-4103: a row names no subtask), the
 * prompt seed the providers hand the model (`focusedChild`), the frontier facts and the Subtasks line, and the
 * descent's terminal redirect all ask here, so none of them can name a different subtask.
 *
 * With no `own` facts this is exactly `selectFocusSubtask(children)` (the seed does not change). The row passes the
 * parent's own facts: a session of its own is unended, its own step failed, or its own trail has reached
 * implementation or later (LIN-4010). Then the parent runs its own step and this returns null.
 *
 * This is the seed the prompt names as the defer candidate. It does not force the model's `deferTo` (LIN-328,
 * LIN-4040 item 2): the model may still pick a different child.
 *
 * @param {Array} children - children in the picker's shape (nested `children`, `inverseRelations`)
 * @param {{busy?: boolean, failed?: boolean, landed?: boolean}|null} [own] - the parent's own facts (the row's only)
 * @returns {Object|null} the child to start from, or null when the parent runs its own step or has no open child
 */
export function parentNextOf(children, own = null) {
  if (!children?.length) return null
  if (own && (own.busy || own.failed || own.landed)) return null
  if (!children.some(c => !isTerminalState(c.state?.type))) return null
  return selectFocusSubtask(children)
}

/**
 * Deterministic frontier facts for a node's children (LIN-433). Surfaced into both
 * prompt paths so the model stops re-deriving them at the LIN-389 defer-vs-breakdown
 * fork. Reads the SAME `isBlocked` + `parentNextOf` computation the descent uses,
 * so the facts can never disagree with the child the descent picks.
 *
 * @param {Array} children - Array of child issues
 * @returns {{openCount, blockedCount, openChildren: Array<{identifier, blocked}>, nextChild}|null}
 */
export function computeFrontierFacts(children) {
  if (!children?.length) return null
  const open = children.filter(c => !isTerminalState(c.state?.type))
  const openChildren = open.map(c => ({ identifier: c.identifier, blocked: isBlocked(c) }))
  const next = parentNextOf(children)
  return {
    openCount: open.length,
    blockedCount: openChildren.filter(c => c.blocked).length,
    openChildren,
    nextChild: next ? next.identifier : null
  }
}

/**
 * Natural-order comparator for issues by identifier (LIN-9 before LIN-10, not
 * "LIN-10" before "LIN-9" as a raw string compare would give).
 *
 * It is the deterministic tie-break for selectFocusSubtask: among equally-eligible
 * candidates (same state, all unblocked) the picker would otherwise fall to the
 * input array's order, which is Linear's connection order (newest-first) — so it
 * surfaces the most recently created subtask, the opposite of the usual "work them
 * in order" intuition (LIN-177: parallel subtasks S0–S5, all unblocked once S0/S1
 * were Done, picked S5 instead of the earliest remaining, S2). The same comparator
 * orders the subtask overview so the displayed order matches the chosen one.
 *
 * @param {{identifier?: string}} a
 * @param {{identifier?: string}} b
 * @returns {number}
 */
export function compareByIdentifier(a, b) {
  return (a?.identifier || '').localeCompare(b?.identifier || '', undefined, { numeric: true, sensitivity: 'base' })
}


/**
 * Deterministic child-state counts for a node's subtasks. Lifted verbatim out of
 * buildMetaPrompt (LIN-434) so the counts are assembled in one pure, testable place.
 *
 * @param {Array} [children] - Array of child issues
 * @returns {{subtaskCount, completedCount, inProgressCount, remainingCount, hasOpenChildren}}
 */
export function computeNodeStateCounts(children = []) {
  const subtaskCount = children.length;
  const completedCount = children.filter(c => isTerminalState(c.state?.type)).length;
  const inProgressCount = children.filter(c => c.state?.type === 'started').length;
  const remainingCount = subtaskCount - completedCount;
  return {
    subtaskCount,
    completedCount,
    inProgressCount,
    remainingCount,
    hasOpenChildren: remainingCount > 0
  };
}

/**
 * Assemble the full per-node fact set the meta-prompt consumes (LIN-434). Pure and
 * network-free: combines the child-state counts, the node's own terminal flag, and
 * the frontier facts (open/blocked counts + next child + the node's plan facts).
 *
 * The plan facts are attached only when there are children (and therefore frontier facts).
 * LIN-4504: they are the records' (lib/records/plan-facts.js, read once by
 * prepareRecommendationInput), never the description's; absent, they read not measured.
 *
 * @param {Object} issue - The node issue (uses .state.type)
 * @param {Array} [children] - The node's subtasks
 * @param {{planFacts?: object}} [options]
 * @returns {{completedCount, inProgressCount, remainingCount, hasOpenChildren, isTerminal, frontierFacts}}
 */
export function assembleNodeFacts(issue, children = [], { planFacts = planFactsNotMeasured('no records read for these node facts') } = {}) {
  const counts = computeNodeStateCounts(children);
  const frontierFacts = children.length ? computeFrontierFacts(children) : null;
  if (frontierFacts) frontierFacts.planFacts = planFacts;
  return {
    completedCount: counts.completedCount,
    inProgressCount: counts.inProgressCount,
    remainingCount: counts.remainingCount,
    hasOpenChildren: counts.hasOpenChildren,
    isTerminal: isTerminalState(issue?.state?.type),
    frontierFacts
  };
}


// ─── Plan-review facts and the review loop bound (LIN-3309) ──────────────────

const VERDICT_WORD_RE = /\b(approve[sd]?|request(?:ed)?\s+changes?|needs?\s+discussion)\b/i;

/** Normalise a verdict token to the three-value vocabulary, or null. */
function normalizeVerdictToken(token) {
  if (!token) return null;
  const t = String(token).toLowerCase();
  if (/approve/.test(t)) return 'approve';
  if (/request\s+changes?/.test(t)) return 'request changes';
  if (/needs?\s+discussion/.test(t)) return 'needs discussion';
  return null;
}

/**
 * A plan-review verdict comment's verdict: a `plan-review` comment (lib/run-trail.js, the contract
 * heading `### Plan Review Verdict` of lib/prompt-contract.js or LIN-2950's legacy
 * `## Plan-review (round 2) — Request Changes`), its verdict word read here.
 */
function planReviewVerdictOf(body) {
  if (commentKindOf(body) !== 'plan-review') return null;
  const firstLine = (body.split('\n').find(l => l.trim()) || '').trim();
  // `extractVerdict` reads the contract form; the legacy heading carries the token
  // in its own first line (LIN-2950: "## Plan-review (round 2) — Request Changes").
  return normalizeVerdictToken(extractVerdict(body)) || normalizeVerdictToken((firstLine.match(VERDICT_WORD_RE) || [])[0]);
}

// The reviewer's own count (LIN-3651): `Blocking findings: <n>` on a line of its own, which
// the plan-review contract asks for on Request Changes. Anchored to a line start, tolerant
// of `**`, `>` and list markers; the first such line is the verdict's.
const BLOCKING_FINDINGS_RE = /^[^\w\n]*Blocking findings[^\w\n]*(\d+)/im;

/** The blocking-findings count of a Request Changes verdict: an integer of 1 or more, else null. */
function blockingFindingsOf(verdict, body) {
  if (verdict !== 'request changes') return null;
  const n = Number((String(body).match(BLOCKING_FINDINGS_RE) || [])[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * The plan-review facts, read from every comment in time order: the verdicts of each
 * kind, the latest one and when, and whether a person has commented or work has landed
 * since it. `count` (Request Changes and Needs Discussion since the latest Approve; only
 * an Approve resets it) is for the loop bound alone and is never shown to the model; so is
 * `run`, the verdicts since the latest Approve with each one's blocking-findings count (LIN-3651).
 * @param {Array<{body?: string, createdAt?: string}>} [comments]
 * @returns {{verdicts: number, byKind: Object<string, number>, latestVerdict: string|null, latestAt: string|null, count: number, run: Array<{verdict: string, blocking: number|null}>, personSince: boolean, landed: string|null}}
 */
export function assemblePlanReviewFacts(comments = [], harbourIds = null) {
  const sorted = byTime(comments);
  const verdicts = [];
  sorted.forEach((c, index) => {
    const verdict = planReviewVerdictOf(c.body);
    if (verdict) verdicts.push({ verdict, at: c.createdAt || null, index, blocking: blockingFindingsOf(verdict, c.body) });
  });
  const byKind = {};
  for (const v of verdicts) byKind[v.verdict] = (byKind[v.verdict] || 0) + 1;
  const latest = verdicts[verdicts.length - 1] || null;
  const since = latest ? sorted.slice(latest.index + 1) : [];
  const landedComment = since.find(c => reportsLandedWork(c.body));
  return {
    verdicts: verdicts.length,
    byKind,
    latestVerdict: latest ? latest.verdict : null,
    latestAt: latest ? latest.at : null,
    count: verdicts.length - 1 - verdicts.map(v => v.verdict).lastIndexOf('approve'),
    run: verdicts.slice(verdicts.map(v => v.verdict).lastIndexOf('approve') + 1).map(v => ({ verdict: v.verdict, blocking: v.blocking })),
    personSince: since.some(c => isPersonCommentOf(c, harbourIds)),
    landed: landedComment ? (prUrlsIn(landedComment.body)[0] || 'a code review') : null
  };
}

/** Plan-review verdicts asking for changes or discussion since the latest Approve that stop the loop. */
export const REVIEW_LOOP_BOUND = 3;

/**
 * The most verdicts since the latest Approve a converging plan gets (LIN-3651). Structural,
 * like the bound: a model must not set it, so no count or reviewer judgement lifts it. 5
 * because every press on the trails (LIN-3634, LIN-3614, LIN-3601, LIN-3611) resolved within
 * five rounds; the extra rounds are bought only by a narrowing count, never past this.
 */
export const REVIEW_LOOP_CEILING = 5;

/**
 * Is the plan converging (LIN-3651)? The last two verdicts of the run are both Request Changes
 * with a stated count, and the latest is lower than the one before, or both are 1. A Needs
 * Discussion latest verdict, a missing count, or a flat or rising count above 1 is not.
 * @param {Array<{verdict: string, blocking: number|null}>} run - assemblePlanReviewFacts(...).run
 * @returns {boolean}
 */
export function reviewLoopConverging(run) {
  if (!Array.isArray(run) || run.length < 2) return false;
  const [prev, last] = run.slice(-2);
  if (prev.verdict !== 'request changes' || last.verdict !== 'request changes') return false;
  if (prev.blocking == null || last.blocking == null) return false;
  return last.blocking < prev.blocking || (prev.blocking === 1 && last.blocking === 1);
}

/**
 * The review loop bound (LIN-3309): the `review-bound` entry of CODE_ROUTES (lib/code-routes.js),
 * which holds its reasons. A plan sent back
 * REVIEW_LOOP_BOUND or more times since its latest Approve goes to `blocked`, unless it is
 * converging (LIN-3651), which buys rounds up to REVIEW_LOOP_CEILING. A person's comment or
 * landed work since the latest verdict, or a terminal task, lifts it. It guarantees that a
 * planner and a reviewer who keep disagreeing stop for a person; it is structural, so the
 * model is not asked.
 * @param {Object} issue
 * @param {Array} [comments]
 * @returns {null|'not-converging'|'ceiling'} which stop applies, or null
 */
export function reviewLoopStop(issue, comments = []) {
  if (isTerminalState(issue?.state?.type)) return null;
  const f = assemblePlanReviewFacts(comments);
  if (f.personSince || f.landed) return null;
  if (f.count >= REVIEW_LOOP_CEILING) return 'ceiling';
  if (f.count >= REVIEW_LOOP_BOUND && !reviewLoopConverging(f.run)) return 'not-converging';
  return null;
}

/** Whether the review loop bound stops the plan; one source with reviewLoopStop. */
export function reviewLoopExhausted(issue, comments = []) {
  return reviewLoopStop(issue, comments) !== null;
}

/**
 * The review loop bound's code-route step: blocked, with the reason the bound or the ceiling stopped the plan, or
 * null when it does not. Its reasons live here beside the bound, so its CODE_ROUTES entry (lib/code-routes.js)
 * delegates like the other routes' entries.
 * @returns {{step: 'blocked', codeRoute: 'blocked', why: string}|null}
 */
export function reviewLoopStep(issue, comments = []) {
  const stop = reviewLoopStop(issue, comments);
  if (!stop) return null;
  const why = stop === 'ceiling'
    ? `the plan-review loop reached its ceiling of ${REVIEW_LOOP_CEILING} reviews since the last Approve, whatever the findings count`
    : 'the plan-review loop reached its bound: the plan has been sent back repeatedly since its last Approve and the findings are not narrowing';
  return { step: 'blocked', codeRoute: 'blocked', why: `${why}, with no person's comment since the latest verdict.` };
}

// ─── Trail facts for the stage selector (LIN-3300) ───────────────────────────
//
// The selector reads only the latest comments, so every question about the whole
// trail is answered here, in code, from all of them, as plain data: the latest code
// review and its ledger (run-ledger.js is the authority on what a code review is), work
// or a close-out reported after it, the PRs linked, the latest person's comment and
// ruling, the plan-review verdicts, and for a leaf the plan facts. The rules that read them
// live in lib/stage-router.js. LIN-4504: the plan facts are records (lib/records/plan-facts.js),
// passed in; no plan, session fit or review owed is read from a description or a comment.

const day = (at) => (at || '').slice(0, 16).replace('T', ' ') || 'undated';

/** The selector's words for the open findings to close-out: a count with its wording, or not measured (never zero). */
function findingsLine(reading, verdict) {
  const count = findingsCount(reading);
  if (count === null) return 'open findings to close-out: not measured';
  return `open findings to close-out: ${count}${count ? `, ${findingsWording(verdict)}` : ''}`;
}

/**
 * @param {Array<{body?: string, createdAt?: string}>} [comments]
 * @param {string} [description]
 * @param {{leaf?: boolean, planFacts?: object, openFindings?: object, standing?: object|null}} [options] - plan facts are a leaf's; a node reads its subtask facts. `planFacts`: the ticket's plan facts from records (lib/records/plan-facts.js; default: not read, so the lines say "not measured", never "none"). `openFindings`: the open findings to close-out as lib/close-out-findings.js read them (default: not read, so the line says "not measured", never zero). `standing` (LIN-4518): the ticket's records standing (lib/task-standing.js): the review, work and close-out after it come from it; `null` is a records read that failed, so those lines say "not measured"; absent, the comment trail is read (callers not yet moved).
 */
export function assembleTrailFacts(comments = [], description = '', { leaf = true, planFacts = planFactsNotMeasured('no records read for this trail'), openFindings = findingsNotRead('no records read for this trail'), standing = undefined , harbourIds = null } = {}) {
  const sorted = byTime(comments);
  // LIN-4458: the audit fact is the comment trail's (an audit is not a verdict; no records kind carries it yet).
  const commentTrail = readTrail(sorted);
  // LIN-4518 (beat 4): the review, and work and close-out after it, are the records' standing (lib/task-standing.js
  // gateTrailOf). Not read (no standing: a records fault or no store) reads as not measured, never as none.
  const gate = gateTrailOf({ standing });
  const trail = gate ? gate.trail : null;
  const ledger = trail?.review ?? null;
  // LIN-4495: the open findings to close-out come from the records store (one reading, passed in); the review's own
  // comment no longer carries items to count.
  const review = ledger ? {
    verdict: ledger.verdict,
    at: ledger.at,
    openFindings,
  } : null;

  const prUrls = [];
  for (const c of sorted) {
    for (const url of prUrlsIn(c.body)) {
      if (!prUrls.includes(url)) prUrls.push(url);
    }
  }

  const personIndex = sorted.map(c => isPersonCommentOf(c, harbourIds)).lastIndexOf(true);
  const person = sorted[personIndex];
  const ruling = [...sorted].reverse().find(c => isRuling(c.body));

  // LIN-4504: a leaf's plan facts are the records' (one reading, passed in). The description and the comments are not read for them.
  const plan = leaf ? planFacts : null;

  return {
    review,
    // Work after the review: on records, a push that staled the review, or a change first written after it (lib/records/
    // standing.js); on the comment trail (no standing passed), lib/run-trail.js readTrail's reading.
    workAfterReview: trail ? trail.workAfterReview : null,
    closeOutAfterReview: trail ? trail.closeOutAfterReview : null,
    // The records read did not happen: the review and the work after it are not measured (LIN-4518).
    ...(trail ? {} : { recordsNotRead: true }),
    // LIN-4432: an audit already ran on this landing.
    auditAfterCloseOut: commentTrail.auditAfterCloseOut,
    prUrls,
    // An agent acted after the person's comment: its own note, landed work or a
    // close-out. Without it a comment already acted on would keep deciding the stage.
    latestPerson: person ? {
      at: person.createdAt || null,
      ruling: isRuling(person.body),
      actedAfter: sorted.slice(personIndex + 1).some(c => ['agent-note', 'close-out'].includes(commentKindOf(c.body)) || reportsLandedWork(c.body))
    } : null,
    latestRuling: ruling ? { at: ruling.createdAt || null } : null,
    planReview: assemblePlanReviewFacts(sorted, harbourIds),
    plan,
    // LIN-4368: the size record, read from the description outside a legacy As-asked block only;
    // a comment with the same heading is a person's ruling, never a record.
    size: sizeFact(readSizeRecord(description))
  };
}

/** Under an approving review the open findings to close-out are close-out's to settle, not a fix round's. */
function findingsWording(verdict) {
  return /^approve/.test(verdict || '') ? 'left for close-out to settle' : 'not settled';
}

/**
 * Render the selector's TRAIL FACTS block: facts only, each stated once. With the
 * task's runs beside it (`runs`), whether an agent acted after a person's comment is
 * the run list's to show, so the comment-derived reading is left out.
 * @param {ReturnType<typeof assembleTrailFacts>} facts
 * @param {number} commentCount
 * @param {{runs?: boolean}} [options]
 * @returns {string}
 */
export function formatTrailFactsBlock(facts, commentCount, { runs = false } = {}) {
  const r = facts.review;
  const lines = [
    `**TRAIL FACTS (computed in code from all ${commentCount} comments — do not re-derive):**`,
    facts.recordsNotRead
      ? '- Latest code review: not measured (the records read failed; a review is not read as none)'
      : r
        ? `- Latest code review: ${r.verdict} (${day(r.at)}; ${findingsLine(r.openFindings, r.verdict)})`
        : '- Latest code review: none (a plan-review verdict, a bug write-up or a run summary is not one)'
  ];
  if (r && !facts.recordsNotRead) {
    lines.push(`- Work reported after it (a later comment links a PR): ${facts.workAfterReview ? 'yes' : 'no'}`);
    lines.push(`- Close-out reported after it: ${facts.closeOutAfterReview ? 'yes' : 'no'}`);
    lines.push(`- Audit reported after the landing close-out: ${facts.auditAfterCloseOut ? 'yes' : 'no'}`);
  }
  lines.push(`- PRs linked on the trail: ${facts.prUrls.length ? facts.prUrls.join(', ') : 'none'}`);
  const lp = facts.latestPerson;
  lines.push(`- Latest person's comment (not an agent note, landing report, review, verdict or close-out): ${lp
    ? `${day(lp.at)}${lp.ruling ? ', a ruling recorded via Harbour' : ''} (shown with the comments)${runs ? '' : `; an agent acted after it (a note, landed work or a close-out): ${lp.actedAfter ? 'yes' : 'no'}`}`
    : 'none'}`);
  lines.push(`- Latest ruling recorded via Harbour: ${facts.latestRuling ? `${day(facts.latestRuling.at)} (shown with the comments)` : 'none'}`);
  const pr = facts.planReview;
  if (pr.verdicts > 0) {
    const kinds = Object.entries(pr.byKind).map(([k, n]) => `${n} ${k}`).join(', ');
    lines.push(`- Plan-review verdicts: ${pr.verdicts} (${kinds}); latest: ${pr.latestVerdict} (${day(pr.latestAt)})`);
    lines.push(`- Since the latest plan-review verdict: a person's comment: ${pr.personSince ? 'yes' : 'no'}; landed work: ${pr.landed || 'none'}`);
  }
  if (facts.plan) lines.push(...planFactLines(facts.plan));
  if (facts.size) lines.push(`- Size of the move: ${facts.size}`);
  return lines.join('\n');
}

/**
 * The selector's node facts (LIN-3300): the subtask counts and frontier, as facts only.
 * '' for a leaf.
 * @param {ReturnType<typeof assembleNodeFacts>} nodeFacts
 * @param {number} subtaskCount
 * @returns {string}
 */
export function formatNodeFactsBlock(nodeFacts, subtaskCount) {
  if (!subtaskCount) return '';
  const f = nodeFacts.frontierFacts;
  const lines = [`- Subtasks: ${subtaskCount} (${nodeFacts.completedCount} done, ${nodeFacts.inProgressCount} in progress, ${nodeFacts.remainingCount} remaining)`];
  if (f && f.openCount > 0) {
    lines.push(`- Open subtasks: ${f.openChildren.map(c => `${c.identifier} ${c.blocked ? '[blocked]' : '[actionable]'}`).join(', ')}`);
    lines.push(`- Frontier next child (skip-blocked, unblocks-most/critical-path ranked): ${f.nextChild || 'none — all open subtasks blocked'}`);
  }
  if (f) {
    const pf = f.planFacts || planFactsNotMeasured('no records read for these node facts');
    lines.push(`- Session fit (this task's own plan records): ${pf.measured ? sessionFitWords(pf.sessionFit) : `not measured (${pf.reason})`}`);
    if (pf.measured && pf.childTasksWithoutTicket > 0) lines.push(`- Child tasks with no ticket yet: ${pf.childTasksWithoutTicket}`);
  }
  return lines.join('\n');
}

// ─── Plan facts from records (LIN-4504) ──────────────────────────────────────
//
// The words the selector reads for a ticket's plan records (lib/records/plan-facts.js). They avoid the phrases the old
// plan text was written in, so the census (tests/unit/lin-4504-plan-text-census.test.js) can ban those outright.

/** The session fit a plan record's addressee gives, in the selector's words. */
function sessionFitWords(fit) {
  if (fit === 'several') return 'several sessions (a plan is addressed to breakdown)';
  if (fit === 'one') return 'one session (addressed to implementation)';
  return 'none';
}

/** One plan record: its id, current version, addressee and when it last changed. */
const planRecordWords = (p) => `${p.id} v${p.v} to ${p.to || 'no stage'} (changed ${day(p.at)})`;

/**
 * The leaf's plan fact lines: the plan records (each with its current version and last change, read beside the
 * plan-review verdicts line so a revision after a verdict shows), the session fit, whether a plan review is owed, and
 * the child tasks with no ticket. Not measured says so on one line and claims nothing.
 * @param {object} p - plan facts (lib/records/plan-facts.js)
 * @returns {string[]}
 */
export function planFactLines(p) {
  if (!p || !p.measured) return [`- Plan records: not measured (${p?.reason || 'not read'}); ticket text is not read for a plan`];
  const records = p.own.length
    ? p.own.map(planRecordWords).join('; ')
    : p.piece ? `none of its own; it is a piece of its parent's plan: ${planRecordWords(p.piece)}` : 'none';
  const r = p.reviewOwed || {};
  const owed = !r.owed ? 'no'
    : r.why === 'open-finding' ? `yes (open finding ${r.finding} to plan-review about ${r.plan})`
    : `yes (${r.plan} is addressed to breakdown and no plan-review finding is about it)`;
  const lines = [
    `- Plan records on this task: ${records}`,
    `- Session fit (the plan records' addressee): ${sessionFitWords(p.sessionFit)}`,
    `- Plan review owed: ${owed}`,
  ];
  if (p.childTasksWithoutTicket > 0) lines.push(`- Child tasks with no ticket yet: ${p.childTasksWithoutTicket}`);
  return lines;
}
