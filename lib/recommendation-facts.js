/**
 * Recommendation fact assembly (LIN-434) — the deterministic, network-free seam.
 *
 * One module that owns the per-node fact set the recommendation prompts consume, so
 * fact assembly is boring, isolated, and unit-testable instead of scattered inline
 * across the prompt builders. It does NOT touch the network and never calls the LLM;
 * generation (prompt body) and decision (markdown-contract parsing) are the other two
 * seams and stay in lib/openrouter.js.
 *
 * The graph/tree primitives this builds on live in lib/tree.js (frontier ranking,
 * blocker resolution, terminal-state) and were seeded by LIN-433 — they are NOT moved
 * here (no duplicate module move); this module re-exports them so call sites have a
 * single fact-import surface and adds the two previously-scattered, untested pieces:
 *   - extractSessionFit (was private in openrouter.js)
 *   - computeNodeStateCounts (was computed inline inside buildMetaPrompt)
 *
 * The fact set (per the LIN-434 Done-when list):
 *   - terminal-state .............. isTerminalState (re-exported from tree.js)
 *   - open-child count + status ... computeFrontierFacts (re-exported from tree.js)
 *   - frontier ranking ............ selectFocusSubtask (re-exported from tree.js)
 *   - blocker-resolution .......... isBlocked (re-exported from tree.js)
 *   - plan session-fit ............ extractSessionFit (owned here)
 *   - bug-investigation-present ... NOT a deterministic fact (no stable marker exists);
 *                                   stays an inline soft gate on the prompt paths.
 */
import {
  isTerminalState,
  isBlocked,
  selectFocusSubtask,
  computeFrontierFacts
} from './tree.js';
import { extractVerdict, __internal as planReviewRoundTrips } from './plan-review-round-trips.js';
import { isReviewSummary, PR_URL_RE, latestReviewComment, parseRunLedger } from './run-ledger.js';
import { extractPlanSection } from './file-pointer.js';

/**
 * The mark the in-app comment route appends to a person's comment (routes/workspace-api.js).
 * It is the one reliable "a person wrote this" mark on a trail: agents post under the
 * same account, so the author name cannot tell them apart (LIN-3300 research).
 */
export const RULING_MARK = '— Ruling recorded via Harbour';

// Reader-side definitions of the plan-review formats (LIN-3309). The contract form
// is `### Plan Review Verdict` (lib/prompt-contract.js); the legacy form is LIN-2950's
// `## Plan-review (round 2) — Request Changes`. The revision line is the exact form
// the planner template now requires, so the writer and this reader share one shape.
const PLAN_REVIEW_VERDICT_HEADING = /^Plan Review Verdict\b/i;
const PLAN_REVIEW_LEGACY_HEADING = /^plan[-\s]+review\b/i;
// The revision label, without the global flag so a single `.match()` still returns its
// capture group. `revisionNumber` builds a global twin from this source to find the
// HIGHEST label (F4): a description that holds Revision 2 then Revision 3 must read 3.
export const REVISION_LABEL_RE = /Revision\s+(\d+)\s*[—–-]\s*addresses plan-review/i;

// An agent's own note on the trail (LIN-3309, FC "a reply means a person's reply"): the
// planner reporting the plan or revision it wrote ("Plan posted…", "Plan revised…",
// "Plan revision 1 written", a bare `Revision N — addresses plan-review` line) or an
// autopilot step record ("**Autopilot step record — …"). Read from the first line,
// with leading markdown stripped. These are part of the trail, not a person answering
// the verdict, so they never count as a reply. Anything not matched stays a reply, so
// an unrecognised note fails toward the model reading it, as before.
const AGENT_NOTE_RE = /^(?:autopilot\b|plan\s+(?:posted|revis\w*)\b|revision\s+\d+\s*[—–-]\s*addresses plan-review)/i;

/** True when a comment is an agent's own status note rather than a person's reply. */
function isAgentNote(body) {
  const firstLine = (body.split('\n').find(l => l.trim()) || '').replace(/^[\s#>*_]+/, '');
  return AGENT_NOTE_RE.test(firstLine);
}

/** The highest Revision N label in the description, or 1 when there is none (F4). */
function revisionNumber(description) {
  if (!description) return 1;
  const re = new RegExp(REVISION_LABEL_RE.source, 'gi');
  let max = null;
  for (const m of description.matchAll(re)) {
    const n = Number(m[1]);
    if (max == null || n > max) max = n;
  }
  return max == null ? 1 : max;
}

// Single fact-import surface: re-export the tree primitives so consumers import all
// deterministic fact helpers from here rather than reaching into tree.js directly.
export { isTerminalState, isBlocked, selectFocusSubtask, computeFrontierFacts };

/**
 * Extract the plan's committed session-fit answer from an issue description
 * (LIN-433). The plan/meta-prompt mandate the canonical phrases "fits one session"
 * / "needs multiple sessions", so a light, case-insensitive match is deterministic.
 * Returns null (→ "none found") when neither phrase is present — non-authoritative;
 * the model still reads the plan itself. A negated fit ("does not fit one session",
 * LIN-3300) is a "needs multiple sessions" answer: the positive phrase sits inside it.
 *
 * @param {string} [description]
 * @returns {'fits one session'|'needs multiple sessions'|null}
 */
export function extractSessionFit(description) {
  if (!description) return null;
  if (/needs?\s+multiple\s+sessions/i.test(description)) return 'needs multiple sessions';
  if (/(?:\bnot|n['’]t|\bcannot|\bnever)\s+fit\s+(?:in(?:to)?\s+)?one\s+(?:focused\s+)?session/i.test(description)) return 'needs multiple sessions';
  if (/fits?\s+(?:in\s+)?one\s+(?:focused\s+)?session/i.test(description)) return 'fits one session';
  return null;
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
 * the frontier facts (open/blocked counts + next child + plan session-fit). This is
 * the single entry point buildMetaPrompt calls; the values are byte-identical to the
 * inline computation it replaces.
 *
 * sessionFit is attached only when there are children (and therefore frontier facts),
 * matching the prior behavior exactly.
 *
 * @param {Object} issue - The node issue (uses .state.type and .description)
 * @param {Array} [children] - The node's subtasks
 * @returns {{completedCount, inProgressCount, remainingCount, hasOpenChildren, isTerminal, frontierFacts}}
 */
export function assembleNodeFacts(issue, children = []) {
  const counts = computeNodeStateCounts(children);
  const frontierFacts = children.length ? computeFrontierFacts(children) : null;
  if (frontierFacts) frontierFacts.sessionFit = extractSessionFit(issue?.description);
  return {
    completedCount: counts.completedCount,
    inProgressCount: counts.inProgressCount,
    remainingCount: counts.remainingCount,
    hasOpenChildren: counts.hasOpenChildren,
    isTerminal: isTerminalState(issue?.state?.type),
    frontierFacts
  };
}

// ─── Plan-review facts (LIN-3309) ────────────────────────────────────────────
//
// The plan-review loop bound was prose in the router prompt ("a SECOND Request
// Changes → blocked"), which the model applied noisily. This computes the facts
// in code instead: the verdict count, the latest verdict, whether a revision has
// landed since it, and any reply that follows. The router renders them as a
// deterministic block and routes on the frozen precedence (lib/stage-router.js).

/** The heading TEXT of a comment's first heading line, or '' when it has none. */
function firstHeading(body) {
  const m = (body || '').match(/^#{1,6}[ \t]+([^\n]*)/m);
  return m ? m[1].trim() : '';
}

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

/** A plan-review verdict comment: contract heading, or the legacy first line. */
function planReviewVerdictOf(body) {
  const heading = firstHeading(body);
  const isVerdictComment = PLAN_REVIEW_VERDICT_HEADING.test(heading) || PLAN_REVIEW_LEGACY_HEADING.test(heading);
  if (!isVerdictComment) return null;
  const firstLine = (body.split('\n').find(l => l.trim()) || '').trim();
  // `extractVerdict` reads the contract form; the legacy heading carries the token
  // in its own first line (LIN-2950: "## Plan-review (round 2) — Request Changes").
  return normalizeVerdictToken(extractVerdict(body)) || normalizeVerdictToken((firstLine.match(VERDICT_WORD_RE) || [])[0]);
}

/**
 * Assemble the plan-review facts the router routes on (LIN-3309). Pure and
 * network-free; sorts by `createdAt` itself rather than trusting provider order.
 *
 * @param {Array<{body?: string, createdAt?: string, id?: string}>} [comments]
 * @param {string} [description] - The issue description (carries the revision label)
 * @returns {{verdicts: number, count: number, latestVerdict: string|null, revised: boolean, revisionN: number, replies: Array<{text: string, at: string|null}>, landed: string|null, commentsRead: number, route: string|null}}
 */
export function assemblePlanReviewFacts(comments = [], description = '') {
  const sorted = (Array.isArray(comments) ? [...comments] : [])
    .filter(c => c && typeof c.body === 'string')
    .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));

  const verdicts = [];
  sorted.forEach((c, index) => {
    const verdict = planReviewVerdictOf(c.body);
    if (verdict) verdicts.push({ verdict, at: c.createdAt || null, index });
  });

  // Count Request Changes / Needs Discussion since the latest Approve. Only an
  // Approve resets the count, in code: a revision alone does not (RC1 → revise →
  // RC2 → revise → RC3 is the normal cycle; resetting on it would stop the bound
  // ever firing). The writer counts what it reads, not the trail it cannot see.
  let latestApproveIndex = -1;
  verdicts.forEach((v, i) => { if (v.verdict === 'approve') latestApproveIndex = i; });
  const count = verdicts
    .slice(latestApproveIndex + 1)
    .filter(v => v.verdict === 'request changes' || v.verdict === 'needs discussion').length;
  const latestVerdict = verdicts.length ? verdicts[verdicts.length - 1].verdict : null;

  // The revision label: the planner writes `Revision N — addresses plan-review …`
  // into the description. No label means revision 1. `revised` when the HIGHEST N
  // exceeds the number of verdicts (F4), because each verdict is answered by exactly
  // one revision (1 plan, verdict 1, revision 2, verdict 2, revision 3). Only computed
  // when the latest verdict is not an Approve.
  const revisionN = revisionNumber(description);
  const revised = latestVerdict && latestVerdict !== 'approve' ? revisionN > verdicts.length : false;

  // The comments after the latest verdict that are not themselves verdicts.
  const lastVerdictPos = verdicts.length ? verdicts[verdicts.length - 1].index : -1;
  const verdictPositions = new Set(verdicts.map(v => v.index));
  const trailing = sorted
    .map((c, index) => ({ c, index }))
    .filter(({ index }) => index > lastVerdictPos && !verdictPositions.has(index));

  // Implementation landed since the latest verdict: a code review, or a comment naming a
  // PR's full URL (the implementation summary must carry one, lib/prompt-contract.js).
  // Then the plan-review loop is behind the task and its verdicts no longer route it —
  // not even an Approve, which would otherwise point back at `implementation` and redo
  // finished work. A planner/autopilot note citing an older PR is not evidence. A
  // person's reply that links a PR also reads as landed; that only hands the route to
  // the model (Step 3's already-landed check), the same as any reply would.
  const isLandingEvidence = (body) => isReviewSummary(body) || (!isAgentNote(body) && PR_URL_RE.test(body));
  const landedComment = trailing.find(({ c }) => isLandingEvidence(c.body));
  const landed = landedComment
    ? ((landedComment.c.body.match(PR_URL_RE) || [])[0] || 'a code review is on the trail')
    : null;

  // Replies: a PERSON's comments after the latest verdict, newest first. Agent notes
  // (above) and the implementation/review summaries that show a landing are a stage's
  // own notes, part of the trail and not replies, so a revised plan with only its
  // planner note is still settled in code. A reply is language — a go-ahead or a hold — and the
  // model is its right reader, so any reply defers the route to the model (below).
  // First line only, capped, so one long comment cannot flood the block.
  const replies = trailing
    .filter(({ c }) => !isAgentNote(c.body) && !isLandingEvidence(c.body))
    .map(({ c }) => ({
      text: (c.body.split('\n').find(l => l.trim()) || '').trim().slice(0, 160),
      at: c.createdAt || null
    }))
    .filter(r => r.text)
    .slice(-3)
    .reverse();

  // The route computed in code (F1 + the FC narrowing). Code settles ONLY the cases
  // where no person's reply follows the latest verdict and no implementation has
  // landed; there the description's "Blocked until …" prose can no longer over-block the
  // model. Any reply goes to the router as text and the model reads it (the FC removed
  // the word-list go/hold classifier and the "any Request Changes → implementation"
  // rule); an Approve is left to the session-fit rules. null means "the model decides".
  const route = resolveDeterministicRoute({
    verdicts: verdicts.length, count, latestVerdict, revised, replies, landed
  });

  return { verdicts: verdicts.length, count, latestVerdict, revised, revisionN, replies, landed, commentsRead: sorted.length, route };
}

/**
 * The next-stage route for the cases the code can settle itself (LIN-3309, F1 + the FC
 * narrowing). Returns a stage name or null when the choice needs the model.
 *
 * Precedence, deliberately small:
 *  - no plan-review verdicts → null (ordinary Step 1–4 routing).
 *  - an implementation landed since the latest verdict → null: the loop is behind the
 *    task, and Step 3's already-landed check routes it (`review`, a fix round, close-out).
 *  - latest verdict Approve → null (route on session-fit as before).
 *  - a person's reply follows the latest verdict → null: a reply is language, and the router
 *    reads it as it reads the rest of the thread (no word-list go/hold classifier, and
 *    no "any Request Changes → implementation" rule).
 *  - otherwise code owns the no-reply case: a landed revision → `plan-review`; count
 *    1–2 → `plan`; count 3 or more → `blocked`.
 *
 * @param {{verdicts:number,count:number,latestVerdict:string|null,revised:boolean,replies:Array<{text:string,at:string|null}>,landed?:string|null}} facts
 * @returns {'plan'|'plan-review'|'blocked'|null}
 */
export function resolveDeterministicRoute(facts) {
  if (!facts || !(facts.verdicts > 0)) return null;
  if (facts.landed) return null;
  if (facts.latestVerdict === 'approve') return null;
  if (facts.replies && facts.replies.length > 0) return null;
  if (facts.revised) return 'plan-review';
  return facts.count <= 2 ? 'plan' : 'blocked';
}

/**
 * Render the router's `PLAN-REVIEW FACTS` block and its frozen precedence, or ''
 * when no plan-review verdict is on the trail (so a fresh task's prompt is
 * unchanged). Text lives here, outside the frozen router source, so the block can
 * grow without a byte-budget fight; the rule order is the contract the pass-bar
 * fixtures pin.
 *
 * @param {ReturnType<typeof assemblePlanReviewFacts>} [facts]
 * @returns {string}
 */
export function formatPlanReviewFactsBlock(facts) {
  if (!facts || !(facts.verdicts > 0)) return '';
  if (facts.landed) {
    return `
**PLAN-REVIEW FACTS (deterministic — do not re-derive):**
- Plan-review verdicts on the trail: ${facts.verdicts}, latest ${facts.latestVerdict} (comments read: ${facts.commentsRead})
- Implementation landed since the latest verdict: yes (${facts.landed})

The plan-review loop is behind this task: these verdicts no longer route it, and an Approve does not point at \`implementation\` again. Route on Step 3's already-landed check (\`review\`, the fix round a review's Request Changes names, or \`close-out\`).
`;
  }
  const replies = facts.replies.length
    ? facts.replies.map(r => `"${r.text}"`).join(' | ') + ' (newest first)'
    : 'none';
  // The steer is the code-computed route, and it is named ONLY when code has settled
  // the route (LIN-3309, FC narrowing). When a reply follows the verdict the route is
  // the model's to choose from the facts and the reply text below — the steer then adds
  // no stage, so it can never pin one the router should have read the reply to settle.
  const steer = facts.route
    ? `\n**→ Route this pass: \`${facts.route}\`** — computed in code from the facts below. It supersedes any older escalation wording quoted in the trail (an autopilot step record may repeat a rule that no longer holds).\n`
    : '';
  return `
**PLAN-REVIEW FACTS (deterministic — do not re-derive):**
- Plan-review verdicts on the trail: ${facts.verdicts} (comments read: ${facts.commentsRead})
- Latest verdict: ${facts.latestVerdict}
- Request Changes / Needs Discussion since the latest Approve: ${facts.count}
- Revision landed since the latest verdict: ${facts.revised ? `yes (revision ${facts.revisionN})` : 'no'}
- A person's reply after the latest verdict (agent notes are not replies): ${replies}
${steer}
Route on these facts, first match wins:
1. Latest verdict is Approve → route on the session-fit answer (\`implementation\` if "fits one session", \`breakdown\` if "needs multiple sessions"); never re-emit \`plan-review\` on a plan that already has one, and never read an Approve as close-out evidence.
2. A reply after the latest verdict tells the work to hold (stop, wait, do not proceed) → \`blocked\`, at any count. The NEWEST reply wins: a hold a later reply superseded is not a hold.
3. A revision has landed since the latest verdict → \`plan-review\`, at any count (unless rule 2's NEWEST reply came after the revision).
4. Count 1 or 2 → \`plan\` (the revision pass).
5. Count 3 or more → \`blocked\`, unless the NEWEST reply after the latest verdict tells the work to continue: follow it — \`implementation\` if it names implementation or says the plan is approved to build, otherwise \`plan\` (the revision pass).
Never route past an unanswered verdict to \`breakdown\` or \`implementation\`.
`;
}

// ─── Trail facts for the stage selector (LIN-3300) ───────────────────────────
//
// The selector reads only the latest comments, so every question about the whole
// trail is answered here, in code, from all of them: the latest code review and its
// ledger (run-ledger.js is the authority on what a code review is, so a plan-review
// verdict, a bug write-up or a run summary never counts), whether work or a close-out
// was reported after it, the PRs linked, the latest ruling recorded via Harbour, and
// for a leaf the plan, its session fit and whether a plan-review is due.

/**
 * A blocker relation that is still open: not in a terminal state (a canceled blocker
 * counts as resolved). One definition for every reader (LIN-3309): the context lines,
 * the selector view and the code-route guard.
 * @param {Object} issue
 * @returns {Array<Object>}
 */
export function openBlockers(issue) {
  const blockedBy = Array.isArray(issue?.blockedBy) ? issue.blockedBy : [];
  return blockedBy.filter(b => !isTerminalState(b?.state?.type));
}

const CLOSE_OUT_TITLE = /\bclose-?out\b/i;
const PLAN_REVIEW_NOT_DUE = /plan-review due:\s*no\b/i;

/**
 * @param {Array<{body?: string, createdAt?: string}>} [comments]
 * @param {string} [description]
 * @param {{leaf?: boolean}} [options] - plan facts are a leaf's; a node reads FRONTIER FACTS
 * @returns {{review: {verdict: string, at: string|null, ledgerItems: number, ledgerOpen: number}|null, workAfterReview: boolean, closeOutAfterReview: boolean, prUrls: string[], latestRuling: {at: string|null, body: string}|null, plan: {present: boolean, revision: number|null, sessionFit: string|null, planReviewDue: 'yes'|'no'|null}|null}}
 */
export function assembleTrailFacts(comments = [], description = '', { leaf = true } = {}) {
  const sorted = (Array.isArray(comments) ? [...comments] : [])
    .filter(c => c && typeof c.body === 'string')
    .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));

  const reviewComment = latestReviewComment(sorted);
  const ledger = reviewComment ? parseRunLedger(reviewComment) : null;
  const review = ledger ? {
    verdict: ledger.verdict,
    at: ledger.at,
    ledgerItems: ledger.ledger.items.length,
    ledgerOpen: ledger.ledger.items.filter(i => !i.discharged).length
  } : null;
  const after = reviewComment ? sorted.slice(sorted.indexOf(reviewComment) + 1) : [];
  const isCloseOut = (body) => CLOSE_OUT_TITLE.test(firstHeading(body));
  const workAfterReview = after.some(c => !isReviewSummary(c.body) && !isCloseOut(c.body) && PR_URL_RE.test(c.body));
  const closeOutAfterReview = after.some(c => isCloseOut(c.body));

  const prUrls = [];
  for (const c of sorted) {
    for (const url of c.body.match(new RegExp(PR_URL_RE.source, 'g')) || []) {
      if (!prUrls.includes(url)) prUrls.push(url);
    }
  }

  const ruling = [...sorted].reverse().find(c => c.body.includes(RULING_MARK));
  const latestRuling = ruling
    ? { at: ruling.createdAt || null, body: ruling.body.replace(RULING_MARK, '').trim() }
    : null;

  let plan = null;
  if (leaf) {
    const text = description || '';
    const present = extractPlanSection(text) !== null;
    plan = {
      present,
      revision: present && REVISION_LABEL_RE.test(text) ? revisionNumber(text) : null,
      sessionFit: extractSessionFit(text),
      planReviewDue: planReviewRoundTrips.GATE_DUE_MARKER.test(text) ? 'yes' : PLAN_REVIEW_NOT_DUE.test(text) ? 'no' : null
    };
  }

  return { review, workAfterReview, closeOutAfterReview, prUrls, latestRuling, plan };
}

/**
 * Render the selector's TRAIL FACTS block. Facts only: the rules that read them live
 * in the selector prompt (lib/stage-router.js), each stated once.
 * @param {ReturnType<typeof assembleTrailFacts>} facts
 * @param {number} commentCount
 * @returns {string}
 */
export function formatTrailFactsBlock(facts, commentCount) {
  const r = facts.review;
  const lines = [
    `**TRAIL FACTS (computed in code from all ${commentCount} comments — do not re-derive):**`,
    r
      ? `- Latest code review: ${r.verdict} (${(r.at || '').slice(0, 10) || 'undated'}; ledger: ${r.ledgerItems} item(s), ${r.ledgerOpen} not discharged)`
      : '- Latest code review: none (a plan-review verdict, a bug write-up or a run summary is not one)'
  ];
  if (r) {
    lines.push(`- Work reported after it (a later comment links a PR): ${facts.workAfterReview ? 'yes' : 'no'}`);
    lines.push(`- Close-out reported after it: ${facts.closeOutAfterReview ? 'yes' : 'no'}`);
  }
  lines.push(`- PRs linked on the trail: ${facts.prUrls.length ? facts.prUrls.join(', ') : 'none'}`);
  if (facts.plan) {
    const p = facts.plan;
    lines.push(`- Implementation plan in the description: ${p.present ? `yes${p.revision ? ` (revision ${p.revision})` : ''}` : 'no'}`);
    lines.push(`- Session fit stated: ${p.sessionFit || 'none'}`);
    lines.push(`- Plan-review due stated: ${p.planReviewDue || 'none'}`);
  }
  return lines.join('\n');
}

/**
 * The selector's node facts (LIN-3300): the subtask counts and FRONTIER FACTS as facts
 * only. The defer-vs-breakdown rule that used to ride along is `defer`'s and
 * `breakdown`'s own description now. '' for a leaf.
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
  if (f) lines.push(`- Session fit stated in the plan: ${f.sessionFit || 'none'}`);
  return lines.join('\n');
}

const PLAN_HEADING = /^##[ \t]+Implementation Plan\b[^\n]*$/;
const MACHINE_LINE = /session[- ]?fit|plan-review due|Revision\s+\d+\s*[—–-]/i;

/** The first paragraph of a block, capped. */
function leadOf(text, cap) {
  const para = (text.trim().split(/\n\s*\n/)[0] || '').trim();
  return para.length > cap ? `${para.slice(0, cap)}…` : para;
}

/** Condense one plan body: its lead, each subsection's lead, the whole Session fit section and the machine lines. */
function condensePlanBody(body, leadCap) {
  const parts = body.split(/^(?=#{3,6}[ \t])/m);
  const out = [];
  const head = /^#{3,6}[ \t]/.test(parts[0]) ? '' : parts.shift();
  if (head.trim()) out.push(leadOf(head, leadCap));
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = nl === -1 ? part.trim() : part.slice(0, nl).trim();
    const rest = nl === -1 ? '' : part.slice(nl + 1);
    if (/session[- ]?fit/i.test(heading)) { out.push(part.trim()); continue; }
    out.push([heading, leadOf(rest, leadCap)].filter(Boolean).join('\n\n'));
  }
  const kept = out.join('\n\n');
  for (const line of body.split('\n')) {
    if (MACHINE_LINE.test(line) && !kept.includes(line.trim())) out.push(line.trim());
  }
  return out.join('\n\n');
}

/**
 * The description with each long `## Implementation Plan` body condensed for routing
 * (LIN-3300). On dense tickets the plan is most of the description (88k of 97k on
 * LIN-1892), while the selector needs only its shape: each subsection's lead, the
 * whole Session fit section (a heading-only outline lost LIN-2944) and the lines code
 * also reads (session fit, plan-review due, Revision N). Text outside the plan, and a
 * plan under the threshold, are unchanged.
 * @param {string} description
 * @param {{threshold?: number, leadCap?: number}} [options]
 * @returns {string}
 */
export function condensePlan(description, { threshold = 3000, leadCap = 400 } = {}) {
  if (!description) return description || '';
  const lines = description.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!PLAN_HEADING.test(lines[i])) { out.push(lines[i]); continue; }
    let end = i + 1;
    while (end < lines.length && !/^##[ \t]/.test(lines[end])) end++;
    const body = lines.slice(i + 1, end).join('\n');
    out.push(lines[i]);
    if (body.length <= threshold) {
      out.push(body);
    } else {
      const condensed = condensePlanBody(body, leadCap);
      out.push('', condensed, '', `*[Plan body condensed for routing: ${condensed.length} of ${body.length} characters shown.]*`, '');
    }
    i = end - 1;
  }
  return out.join('\n');
}

