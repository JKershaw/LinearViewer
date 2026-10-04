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
import { extractVerdict } from './plan-review-round-trips.js';

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
 * the model still reads the plan itself.
 *
 * @param {string} [description]
 * @returns {'fits one session'|'needs multiple sessions'|null}
 */
export function extractSessionFit(description) {
  if (!description) return null;
  if (/needs?\s+multiple\s+sessions/i.test(description)) return 'needs multiple sessions';
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
 * @returns {{verdicts: number, count: number, latestVerdict: string|null, revised: boolean, revisionN: number, replies: Array<{text: string, at: string|null}>, commentsRead: number}}
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

  // Replies: the comments after the latest verdict that are not themselves verdicts,
  // newest first. A reply is language — a person's go-ahead or hold, a planner's
  // revision note, an autopilot step — and the model is its right reader, so any reply
  // defers the route to the model (below). First line only, capped, so one long comment
  // cannot flood the block.
  const lastVerdictPos = verdicts.length ? verdicts[verdicts.length - 1].index : -1;
  const verdictPositions = new Set(verdicts.map(v => v.index));
  const trailing = sorted
    .map((c, index) => ({ c, index }))
    .filter(({ index }) => index > lastVerdictPos && !verdictPositions.has(index));
  const replies = trailing
    .map(({ c }) => ({
      text: (c.body.split('\n').find(l => l.trim()) || '').trim().slice(0, 160),
      at: c.createdAt || null
    }))
    .filter(r => r.text)
    .slice(-3)
    .reverse();

  // The route computed in code (F1 + the FC narrowing). Code settles ONLY the cases
  // where no reply follows the latest verdict; there the description's "Blocked until …"
  // prose can no longer over-block the model. Any reply goes to the router as text and
  // the model reads it (the FC removed the word-list go/hold classifier and the
  // "any Request Changes → implementation" rule); an Approve is left to the session-fit
  // rules. null means "the model decides".
  const route = resolveDeterministicRoute({
    verdicts: verdicts.length, count, latestVerdict, revised, replies
  });

  return { verdicts: verdicts.length, count, latestVerdict, revised, revisionN, replies, commentsRead: sorted.length, route };
}

/**
 * The next-stage route for the cases the code can settle itself (LIN-3309, F1 + the FC
 * narrowing). Returns a stage name or null when the choice needs the model.
 *
 * Precedence, deliberately small:
 *  - no plan-review verdicts → null (ordinary Step 1–4 routing).
 *  - latest verdict Approve → null (route on session-fit as before).
 *  - a reply follows the latest verdict → null: a reply is language, and the router
 *    reads it as it reads the rest of the thread (no word-list go/hold classifier, and
 *    no "any Request Changes → implementation" rule).
 *  - otherwise code owns the no-reply case: a landed revision → `plan-review`; count
 *    1–2 → `plan`; count 3 or more → `blocked`.
 *
 * @param {{verdicts:number,count:number,latestVerdict:string|null,revised:boolean,replies:Array<{text:string,at:string|null}>}} facts
 * @returns {'plan'|'plan-review'|'blocked'|null}
 */
export function resolveDeterministicRoute(facts) {
  if (!facts || !(facts.verdicts > 0)) return null;
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
- Reply after the latest verdict: ${replies}
${steer}
Route on these facts, first match wins:
1. Latest verdict is Approve → route on the session-fit answer (\`implementation\` if "fits one session", \`breakdown\` if "needs multiple sessions"); never re-emit \`plan-review\` on a plan that already has one, and never read an Approve as close-out evidence.
2. A reply after the latest verdict tells the work to hold (stop, wait, do not proceed) → \`blocked\`, at any count. The NEWEST reply wins: a hold a later reply superseded is not a hold.
3. A revision has landed since the latest verdict → \`plan-review\`, at any count (unless rule 2's NEWEST reply came after the revision).
4. Count 1 or 2 → \`plan\` (the revision pass).
5. Count 3 or more → \`blocked\`, unless the NEWEST reply after the latest verdict tells the work to continue: follow it — \`implementation\` if it names implementation or says the plan is approved to build, otherwise \`plan\` (the revision pass). An agent's own status note ("Plan posted…") is not a reply.
Never route past an unanswered verdict to \`breakdown\` or \`implementation\`.
`;
}

