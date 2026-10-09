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
import { isReviewSummary, PR_URL_RE, latestReviewComment, parseRunLedger } from './run-ledger.js';
import { extractPlanSection } from './file-pointer.js';

// Reader-side definitions of the plan-review formats (LIN-3309). The contract form
// is `### Plan Review Verdict` (lib/prompt-contract.js); the legacy form is LIN-2950's
// `## Plan-review (round 2) — Request Changes`.
const PLAN_REVIEW_VERDICT_HEADING = /^Plan Review Verdict\b/i;
const PLAN_REVIEW_LEGACY_HEADING = /^plan[-\s]+review\b/i;

/**
 * The mark the in-app comment route appends to a person's comment (routes/workspace-api.js).
 * It is the one reliable "a person wrote this" mark on a trail: agents post under the
 * same account, so the author name cannot tell them apart (LIN-3300 research).
 */
export const RULING_MARK = '— Ruling recorded via Harbour';

// An agent's own note on the trail (LIN-3309, FC "a reply means a person's reply"): the
// planner reporting the plan or revision it wrote ("Plan posted…", "Plan revised…",
// "Plan revision 1 written", a bare `Revision N — addresses plan-review` line) or an
// autopilot step record ("**Autopilot step record — …"). Read from the first line,
// with leading markdown stripped. These are part of the trail, not a person answering
// the verdict, so they never count as a reply. Anything not matched stays a reply, so
// an unrecognised note fails toward the model reading it, as before.
const AGENT_NOTE_RE = /^(?:autopilot\b|plan\s+(?:posted|revis\w*)\b|revision\s+\d+\s*[—–-]\s*addresses plan-review)/i;

/** A comment's first non-blank line, with leading markdown stripped. */
const firstLineOf = (body) => (body.split('\n').find(l => l.trim()) || '').replace(/^[\s#>*_]+/, '');

/** True when a comment is an agent's own status note rather than a person's reply. */
export function isAgentNote(body) {
  return AGENT_NOTE_RE.test(firstLineOf(body));
}

/**
 * A ruling (LIN-3300): a person's comment that ENDS with the mark the in-app route
 * appends. A comment that only quotes the mark is not one, and neither is an agent's
 * own note.
 * @param {string} body
 * @returns {boolean}
 */
export function isRuling(body) {
  const text = String(body || '').trimEnd();
  return text.endsWith(RULING_MARK) && !isAgentNote(text);
}

/**
 * Work landed (LIN-3309): a code review, or a comment naming a PR's full URL that is
 * not an agent's own note (the implementation summary must carry one,
 * lib/prompt-contract.js).
 */
function isLandingEvidence(body) {
  return isReviewSummary(body) || (!isAgentNote(body) && PR_URL_RE.test(body));
}

/** A close-out's own report: a close-out heading, or a first line that opens with "Close-out". */
function isCloseOut(body) {
  return /\bclose-?out\b/i.test(firstHeading(body)) || /^close-?out\b/i.test(firstLineOf(body));
}

/**
 * A person's comment (LIN-3300): a ruling, or a comment that is none of an agent's own
 * note, a landing report or code review, a plan-review verdict, a close-out or a stage's
 * report (one that opens with a markdown heading: research notes, a plan, an
 * investigation). Agents post under a person's account, so the author cannot decide it.
 * @param {string} body
 * @returns {boolean}
 */
export function isPersonComment(body) {
  if (isRuling(body)) return true;
  if (/^#{1,6}[ \t]/.test((body.split('\n').find(l => l.trim()) || '').trim())) return false;
  return !isAgentNote(body) && !isLandingEvidence(body) && !planReviewVerdictOf(body) && !isCloseOut(body);
}

/** Comments with a body, oldest first (provider order is not trusted). */
function byTime(comments) {
  return (Array.isArray(comments) ? [...comments] : [])
    .filter(c => c && typeof c.body === 'string')
    .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
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


// ─── Plan-review facts and the review loop bound (LIN-3309) ──────────────────

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
  if (!PLAN_REVIEW_VERDICT_HEADING.test(heading) && !PLAN_REVIEW_LEGACY_HEADING.test(heading)) return null;
  const firstLine = (body.split('\n').find(l => l.trim()) || '').trim();
  // `extractVerdict` reads the contract form; the legacy heading carries the token
  // in its own first line (LIN-2950: "## Plan-review (round 2) — Request Changes").
  return normalizeVerdictToken(extractVerdict(body)) || normalizeVerdictToken((firstLine.match(VERDICT_WORD_RE) || [])[0]);
}

/**
 * The plan-review facts, read from every comment in time order: the verdicts of each
 * kind, the latest one and when, and whether a person has commented or work has landed
 * since it. `count` (Request Changes and Needs Discussion since the latest Approve; only
 * an Approve resets it) is for the loop bound alone and is never shown to the model.
 * @param {Array<{body?: string, createdAt?: string}>} [comments]
 * @returns {{verdicts: number, byKind: Object<string, number>, latestVerdict: string|null, latestAt: string|null, count: number, personSince: boolean, landed: string|null}}
 */
export function assemblePlanReviewFacts(comments = []) {
  const sorted = byTime(comments);
  const verdicts = [];
  sorted.forEach((c, index) => {
    const verdict = planReviewVerdictOf(c.body);
    if (verdict) verdicts.push({ verdict, at: c.createdAt || null, index });
  });
  const byKind = {};
  for (const v of verdicts) byKind[v.verdict] = (byKind[v.verdict] || 0) + 1;
  const latest = verdicts[verdicts.length - 1] || null;
  const since = latest ? sorted.slice(latest.index + 1) : [];
  const landedComment = since.find(c => isLandingEvidence(c.body));
  return {
    verdicts: verdicts.length,
    byKind,
    latestVerdict: latest ? latest.verdict : null,
    latestAt: latest ? latest.at : null,
    count: verdicts.length - 1 - verdicts.map(v => v.verdict).lastIndexOf('approve'),
    personSince: since.some(c => isPersonComment(c.body)),
    landed: landedComment ? ((landedComment.body.match(PR_URL_RE) || [])[0] || 'a code review') : null
  };
}

/** Plan-review verdicts asking for changes or discussion since the latest Approve that stop the loop. */
export const REVIEW_LOOP_BOUND = 3;

/**
 * The review loop bound, the one route code settles (LIN-3309): a plan sent back
 * REVIEW_LOOP_BOUND or more times since its latest Approve goes to `blocked`, unless a
 * person has commented or work has landed since the latest verdict, or the task is
 * already terminal. It guarantees that a planner and a reviewer who keep disagreeing
 * stop for a person; it is structural, so the model is not asked.
 * @param {Object} issue
 * @param {Array} [comments]
 * @returns {boolean}
 */
export function reviewLoopExhausted(issue, comments = []) {
  if (isTerminalState(issue?.state?.type)) return false;
  const f = assemblePlanReviewFacts(comments);
  return f.count >= REVIEW_LOOP_BOUND && !f.personSince && !f.landed;
}

// ─── Trail facts for the stage selector (LIN-3300) ───────────────────────────
//
// The selector reads only the latest comments, so every question about the whole
// trail is answered here, in code, from all of them, as plain data: the latest code
// review and its ledger (run-ledger.js is the authority on what a code review is), work
// or a close-out reported after it, the PRs linked, the latest person's comment and
// ruling, the plan-review verdicts, and for a leaf the plan, its session fit and
// whether a plan-review is due. The rules that read them live in lib/stage-router.js.

// The plan's own answer, plain or bold (`**plan-review due:** yes`).
const PLAN_REVIEW_DUE = /plan-review due:\**[ \t]*(yes|no)\b/i;
const PLAN_HEADING_ANY = /^#{1,3}[ \t]+Implementation Plan\b/im;
const day = (at) => (at || '').slice(0, 16).replace('T', ' ') || 'undated';

/**
 * @param {Array<{body?: string, createdAt?: string}>} [comments]
 * @param {string} [description]
 * @param {{leaf?: boolean, parentPlan?: {identifier: string, description: string}|null}} [options] - plan facts are a leaf's; a node reads its subtask facts. `parentPlan`: the parent's description, for a leaf whose plan lives there
 */
export function assembleTrailFacts(comments = [], description = '', { leaf = true, parentPlan = null } = {}) {
  const sorted = byTime(comments);
  const reviewComment = latestReviewComment(sorted);
  const ledger = reviewComment ? parseRunLedger(reviewComment) : null;
  const review = ledger ? {
    verdict: ledger.verdict,
    at: ledger.at,
    ledgerItems: ledger.ledger.items.length,
    ledgerOpen: ledger.ledger.items.filter(i => !i.discharged).length
  } : null;
  const after = reviewComment ? sorted.slice(sorted.indexOf(reviewComment) + 1) : [];

  const prUrls = [];
  for (const c of sorted) {
    for (const url of c.body.match(new RegExp(PR_URL_RE.source, 'g')) || []) {
      if (!prUrls.includes(url)) prUrls.push(url);
    }
  }

  const personIndex = sorted.map(c => isPersonComment(c.body)).lastIndexOf(true);
  const person = sorted[personIndex];
  const ruling = [...sorted].reverse().find(c => isRuling(c.body));

  let plan = null;
  if (leaf) {
    // The plan is in the description, or posted as a comment (the comment cap can cut
    // its session-fit line from the selector's view, so code reads it from all of it).
    const inDescription = extractPlanSection(description || '') !== null;
    const planComment = inDescription ? null : [...sorted].reverse().find(c => !planReviewVerdictOf(c.body) &&
      (PLAN_HEADING_ANY.test(c.body) || /^plan\b/i.test(firstLineOf(c.body))));
    const text = [description || '', planComment ? planComment.body : ''].join('\n\n');
    plan = {
      where: inDescription ? 'description' : planComment ? 'comment' : null,
      // Only a leaf with no plan of its own; its own plan always wins.
      ...(!inDescription && !planComment && parentPlan && extractPlanSection(parentPlan.description || '') !== null ? { parent: parentPlan.identifier } : {}),
      at: planComment ? planComment.createdAt || null : null,
      sessionFit: extractSessionFit(text),
      planReviewDue: (text.match(PLAN_REVIEW_DUE)?.[1] || '').toLowerCase() || null
    };
  }

  return {
    review,
    // Work after the review: a landing report (an agent's own note re-linking the PR is
    // not new work), not another review and not a close-out.
    workAfterReview: after.some(c => !isReviewSummary(c.body) && !isCloseOut(c.body) && isLandingEvidence(c.body)),
    closeOutAfterReview: after.some(c => !isReviewSummary(c.body) && isCloseOut(c.body)),
    prUrls,
    // An agent acted after the person's comment: its own note, landed work or a
    // close-out. Without it a comment already acted on would keep deciding the stage.
    latestPerson: person ? {
      at: person.createdAt || null,
      ruling: isRuling(person.body),
      actedAfter: sorted.slice(personIndex + 1).some(c => isAgentNote(c.body) || isLandingEvidence(c.body) || isCloseOut(c.body))
    } : null,
    latestRuling: ruling ? { at: ruling.createdAt || null } : null,
    planReview: assemblePlanReviewFacts(sorted),
    plan
  };
}

/** Under an approving review the open ledger items are close-out's to discharge, not a fix round's. */
function ledgerOpenWording(verdict) {
  return /^approve/.test(verdict || '') ? 'left for close-out to discharge' : 'not discharged';
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
    r
      ? `- Latest code review: ${r.verdict} (${day(r.at)}; ledger: ${r.ledgerItems} item(s), ${r.ledgerOpen} ${ledgerOpenWording(r.verdict)})`
      : '- Latest code review: none (a plan-review verdict, a bug write-up or a run summary is not one)'
  ];
  if (r) {
    lines.push(`- Work reported after it (a later comment links a PR): ${facts.workAfterReview ? 'yes' : 'no'}`);
    lines.push(`- Close-out reported after it: ${facts.closeOutAfterReview ? 'yes' : 'no'}`);
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
  if (facts.plan) {
    const p = facts.plan;
    lines.push(`- Implementation plan: ${p.where === 'comment' ? `in a comment (${day(p.at)})` : p.where === 'description' ? 'in the description' : p.parent ? `none on this task; it is part of the plan in its parent ${p.parent}'s description` : 'none'}`);
    lines.push(`- Session fit stated: ${p.sessionFit || 'none'}`);
    lines.push(`- Plan-review due stated: ${p.planReviewDue || 'none'}`);
  }
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
  if (f) lines.push(`- Session fit stated in the plan: ${f.sessionFit || 'none'}`);
  return lines.join('\n');
}

const PLAN_HEADING = /^##[ \t]+Implementation Plan\b[^\n]*$/;
const MACHINE_LINE = /session[- ]?fit|plan-review due|\brevision\b/i;

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
    if (/session[- ]?fit/i.test(heading)) { out.push(part.trim()); continue; }
    out.push([heading, leadOf(nl === -1 ? '' : part.slice(nl + 1), leadCap)].filter(Boolean).join('\n\n'));
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
 * whole Session fit section (a heading-only outline lost LIN-2944) and the lines that
 * state session fit, plan-review due or a revision. Text outside the plan, and a plan
 * under the threshold, are unchanged.
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
