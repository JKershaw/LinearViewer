// The run trail (LIN-4458, piece 2 of LIN-4447): what each comment on a task is, and what the
// trail of them says, read once.
//
// Two things live here and nowhere else:
//   - THE ONE COMMENT CLASSIFIER. `COMMENT_KINDS` is a frozen table, one row per kind, in the
//     order a comment is matched (first match wins). Each row declares its opening and three
//     readings: whether its PRs join the landing (`landing`), whether it reports landed work
//     (`landed`, what `isLandingEvidence` used to answer), and whether it counts as work after the
//     review (`work`). `commentKindOf` returns the row's kind. A new kind is a row, and the census
//     (`tests/unit/lin-4458-comment-kind-census.test.js`) fails on a kind test written anywhere
//     else. The authorship readings, a ruling and a person's comment, are read here too.
//   - THE ONE TRAIL PASS. `readTrail(comments)` answers the review on record (its ledger and the
//     latest blind read after it), the current landing, work and close-out after the review, and
//     the two facts piece 1 (LIN-4460) reads (`closeOutOnTrail`, `landingHasNotesPr`). The gate's
//     readers (`readGateTrail`, `landingPrUrls`) and the selector's (`assembleTrailFacts`,
//     lib/recommendation-facts.js) are views of it, so the box, the guard, the route and the
//     prompt cannot disagree about which PRs are the task's.
//
// The trail readers that need a comment's kind moved here from lib/run-ledger.js (no re-export):
// `latestReviewComment`, `readRunLedger`, `latestReviewRef`, `checkBlindRead`, `parseBlindRead`,
// `latestBlindRead`, `landingPrUrls`, `readGateTrail`. lib/run-ledger.js keeps the parsers of one
// comment (the review ledger, the blind read's shape) and the PR-URL readers (`prUrlsIn`, `prOf`):
// it imports nothing from here, so the two never import each other.
//
// PURE: no I/O, no clock, no store. Words come from their leaves, never retyped: the blind read's
// heading (lib/prompts/blind-read-words.js) and the Surveys' (lib/prompts/survey-words.js). The
// audit and area-read openings have no leaf yet (the audit heading is a literal in
// lib/prompt-template-defs.js; the area read's is prose in docs/plans/survey/area-read.md), so their
// openings are the rows below; a leaf added later is imported here (agreed with LIN-4448).

import { BLIND_READ_HEADING } from './prompts/blind-read-words.js';
import { SURVEY_HEADINGS } from './prompts/survey-words.js';
import { LEDGER_HEADING, parseRunLedger, prUrlsIn, byTime, checkBlindReadShape } from './run-ledger.js';

// ─── Openings ─────────────────────────────────────────────────────────────────

/** The comment's first non-blank line, trimmed. */
const firstLine = (body) => (String(body || '').split('\n').find(l => l.trim()) || '').trim();

/** A comment's first non-blank line, with leading markdown stripped. */
export const firstLineOf = (body) => firstLine(body).replace(/^[#>*_\s]+/, '');

/** The heading TEXT of a comment's first heading line (anywhere in it), or '' when it has none. */
function firstHeading(body) {
  const m = (body || '').match(/^#{1,6}[ \t]+([^\n]*)/m);
  return m ? m[1].trim() : '';
}

/**
 * Whether a comment opens with `heading`, matched exactly: its first non-blank line is the heading,
 * then a tail `tail` accepts (by default the end of the line or a `:`). A longer heading
 * (`## Blind read pilot`) is another heading, and a comment that mentions the heading further down
 * never opens with it (lesson LIN-4414: a check on comment bodies keys on the opening line).
 */
function opensWithHeading(body, heading, tail = /^(?:$|:)/) {
  const line = firstLine(body);
  return line.startsWith(heading) && tail.test(line.slice(heading.length));
}

// A review summary is identified by its TITLE (its first heading line), never by a heading that
// merely appears inside the body (R1'). The title names a review when it carries `review` anywhere,
// but a plan review is not the finished-run review. Exclusions are anchored to the START of the
// title text: a `## Close-out`/`## Autopilot` title is skipped, while a review whose title mentions a
// close-out (LIN-2944's round 5) is kept. The body must then carry a verdict word or the line-start
// ledger heading, so a review "fix-up" that names a review in its title is not the review itself.
const TITLE_NON_REVIEW = /^(?:close-?out|autopilot)\b/i;
const TITLE_PLAN_REVIEW = /plan[-\s]+review/i;
const TITLE_NAMES_REVIEW = /\breview\b/i;
const VERDICT_WORD = /\b(?:approve[sd]?|request(?:ed)?\s+changes?|needs?\s+discussion)\b/i;

function opensAsReview(body) {
  const title = firstHeading(body);
  if (!title || TITLE_NON_REVIEW.test(title)) return false;
  if (!TITLE_NAMES_REVIEW.test(title) || TITLE_PLAN_REVIEW.test(title)) return false;
  return VERDICT_WORD.test(body) || LEDGER_HEADING.test(body);
}

// An agent's own note (LIN-3309): the planner reporting the plan or revision it wrote ("Plan
// posted…", "Plan revised…", "Plan revision 1 written", a bare `Revision N — addresses plan-review`
// line) or an autopilot step record. Read from the first line, leading markdown stripped. Anything
// not matched stays a reply, so an unrecognised note fails toward the model reading it.
const AGENT_NOTE_OPENING = /^(?:autopilot\b|plan\s+(?:posted|revis\w*)\b|revision\s+\d+\s*[—–-]\s*addresses plan-review)/i;
const opensAsAgentNote = (body) => AGENT_NOTE_OPENING.test(firstLineOf(body));

// A plan-review verdict comment: the contract heading or the legacy one, read from its first
// heading. The verdict WORD is the plan-review readers' to parse (`planReviewVerdictOf`,
// lib/recommendation-facts.js, through `extractVerdict`): this row says only what the comment is.
const PLAN_REVIEW_HEADINGS = [/^Plan Review Verdict\b/i, /^plan[-\s]+review\b/i];

/** The heading an area read posts under (docs/plans/survey/area-read.md, LIN-4453). */
const AREA_READ_HEADING = '## Area read';
/** A Survey's or an area read's heading takes a `:` or a space after it (`## Survey global @ sha`). */
const REPORT_TAIL = /^(?:$|[:\s])/;

/**
 * The mark the in-app comment route appends to a person's comment
 * (routes/workspace-api-issue-write.js writes it from here). The one reliable "a person wrote this"
 * mark on a trail: agents post under the same account, so the author cannot tell them apart.
 */
export const RULING_MARK = '— Ruling recorded via Harbour';

// ─── The table ────────────────────────────────────────────────────────────────

/**
 * The readings each row declares.
 *   - `landing`: which of its full PR URLs join the landing. `all`; `none` (it names the landing
 *     or forecasts it, so counting it would make a cited PR current); `first-cited` (only the PRs
 *     it is the first on the trail to cite: an audit's notes PRs, LIN-4432, never the landing it
 *     re-cites).
 *   - `landed`: whether it reports work landed (a person's comment acted on, the plan-review
 *     `landed` fact). `always`; `cites-pr` (when it names a full PR URL); `never`.
 *   - `work`: whether, after the latest review, it is work the review did not cover. `cites-pr`
 *     (any full PR URL, today's landing evidence); `cites-new-pr` (a PR the reviewed landing did not
 *     hold: an agent's note re-linking the reviewed PR is not new work, a new PR is, Seams §3.0a);
 *     `never` (the review itself, a close-out, which has its own reading, and the reports that
 *     name or forecast PRs).
 */
export const COMMENT_KIND_READINGS = Object.freeze(['landing', 'landed', 'work']);

const row = (kind, opens, landing, landed, work) => Object.freeze({ kind, opens, landing, landed, work });

/**
 * One row per comment kind, in match order. Order matters where openings overlap, and each
 * overlap is resolved the way the readers already resolved it:
 *   - review before close-out: a review whose title mentions a close-out is a review (the landing
 *     anchor and both after-review readings skipped reviews first);
 *   - review and close-out before agent note: an autopilot note that carries a review or a
 *     close-out heading counts as that (it already counted as landed work or a close-out);
 *   - agent note before plan review: a planner's note that quotes a plan-review heading is the
 *     planner's note, never a verdict.
 * `plain` is last and matches everything else: an implementation summary, a link comment, a
 * research note, a person's reply.
 */
export const COMMENT_KINDS = Object.freeze([
  row('review', opensAsReview, 'all', 'always', 'never'),
  row('close-out', (b) => /\bclose-?out\b/i.test(firstHeading(b)) || /^close-?out\b/i.test(firstLineOf(b)), 'all', 'cites-pr', 'never'),
  row('blind-read', (b) => opensWithHeading(b, BLIND_READ_HEADING), 'none', 'never', 'never'),
  row('survey-task', (b) => opensWithHeading(b, SURVEY_HEADINGS['survey-task'], REPORT_TAIL), 'none', 'never', 'never'),
  row('survey-place', (b) => opensWithHeading(b, SURVEY_HEADINGS['survey-place'], REPORT_TAIL), 'none', 'never', 'never'),
  row('area-read', (b) => opensWithHeading(b, AREA_READ_HEADING, REPORT_TAIL), 'none', 'never', 'never'),
  row('agent-note', opensAsAgentNote, 'all', 'never', 'cites-new-pr'),
  row('plan-review', (b) => PLAN_REVIEW_HEADINGS.some(re => re.test(firstHeading(b))), 'all', 'cites-pr', 'cites-pr'),
  row('audit', (b) => /^retrospective audit\b/i.test(firstLineOf(b)), 'first-cited', 'cites-pr', 'cites-pr'),
  row('plain', () => true, 'all', 'cites-pr', 'cites-pr'),
]);

/** The two Survey kinds (each a stage kind and a SURVEY_HEADINGS key). */
export const SURVEY_KINDS = Object.freeze(Object.keys(SURVEY_HEADINGS));

const ROW_OF = new Map(COMMENT_KINDS.map(r => [r.kind, r]));
const bodyOf = (comment) => (typeof comment === 'string' ? comment : (comment && typeof comment.body === 'string' ? comment.body : ''));

/**
 * The kind of a comment: the first row of `COMMENT_KINDS` whose opening it matches.
 * @param {string|{body?: string}} comment - a comment, or its body
 * @returns {string} one of the table's kinds; `plain` when nothing else matches
 */
export function commentKindOf(comment) {
  const body = bodyOf(comment);
  return COMMENT_KINDS.find(r => r.opens(body)).kind;
}

const rowOf = (body) => ROW_OF.get(commentKindOf(body));

/**
 * The finished share page's close-out title (LIN-3373), kept exactly as it was: the comment's very
 * first line is a `#`–`####` heading OPENING "Close-out". Stricter than the close-out row on
 * purpose: `## Autopilot close-out` is a close-out on the trail (it anchors and ends a landing) but
 * not a title whose block the page quotes (lib/run-evidence.js `closeOutSummaryFor`).
 */
export function opensWithCloseOutTitle(comment) {
  return /^#{1,4}[ \t]*close-?out\b/i.test(bodyOf(comment).split('\n')[0].trim());
}

/** Whether a comment reports landed work: its row's `landed`, read against its PR URLs. */
export function reportsLandedWork(comment) {
  const body = bodyOf(comment);
  const { landed } = rowOf(body);
  return landed === 'always' || (landed === 'cites-pr' && prUrlsIn(body).length > 0);
}

/**
 * A ruling (LIN-3300): a person's comment that ENDS with the mark the in-app route appends. A
 * comment that only quotes the mark is not one, and neither is an agent's own note. Read from the
 * agent-note opening, not the kind: the mark says who wrote the comment, whatever it is.
 */
export function isRuling(comment) {
  const text = bodyOf(comment).trimEnd();
  return text.endsWith(RULING_MARK) && !opensAsAgentNote(text);
}

/**
 * A person's comment (LIN-3300): a ruling, or an unheaded comment that is none of an agent's own
 * note, landed work, a plan-review verdict or a close-out. Agents post under a person's account, so
 * the author cannot decide it.
 */
export function isPersonComment(comment) {
  const body = bodyOf(comment);
  if (isRuling(body)) return true;
  if (/^#{1,6}[ \t]/.test(firstLine(body))) return false;
  return !['agent-note', 'plan-review', 'close-out'].includes(commentKindOf(body)) && !reportsLandedWork(body);
}

// ─── The latest review ────────────────────────────────────────────────────────

/**
 * The latest review comment on the trail, by `createdAt`, or null when it holds none. Close-out
 * and autopilot comments are not reviews (the review row's title rule).
 * @param {Array<{body?: string, createdAt?: string, id?: string}>} comments
 * @returns {Object|null}
 */
export function latestReviewComment(comments) {
  if (!Array.isArray(comments)) return null;
  const reviews = comments.filter(c => commentKindOf(c) === 'review');
  if (!reviews.length) return null;
  return reviews.reduce((latest, c) => {
    const a = Date.parse(c?.createdAt || '');
    const b = Date.parse(latest?.createdAt || '');
    if (Number.isNaN(a)) return latest;
    if (Number.isNaN(b)) return c;
    return a >= b ? c : latest;
  });
}

/**
 * The latest review comment, parsed (lib/run-ledger.js `parseRunLedger`). A `parseRunLedger(null)`
 * model when none exists. It carries no `blindRead`: its callers read the verdict only.
 * @param {Array<Object>} comments
 */
export function readRunLedger(comments) {
  return parseRunLedger(latestReviewComment(comments));
}

/**
 * The PR the latest review was written about (LIN-3309): the URL named in that review's OWN body,
 * plus its title line, or null when there is no review.
 * @param {Array<{body?: string, createdAt?: string, id?: string}>} comments
 * @returns {{url: string|null, title: string}|null}
 */
export function latestReviewRef(comments) {
  const review = latestReviewComment(comments);
  if (!review) return null;
  const body = typeof review.body === 'string' ? review.body : '';
  return { url: prUrlsIn(body)[0] || null, title: firstHeading(body) };
}

// ─── The blind read ───────────────────────────────────────────────────────────

/**
 * A blind read's shape check (LIN-4437): not a blind read → `{ok: true, applies: false}`;
 * otherwise lib/run-ledger.js `checkBlindReadShape` (one verdict line, a verdict word, a reason,
 * the PRs, and with `landing` exactly the landing's PRs). The proxy holds it at write time.
 * @param {string} body
 * @param {{landing?: string[]|null}} [options]
 */
export function checkBlindRead(body, options = {}) {
  if (commentKindOf(body) !== 'blind-read') return { ok: true, applies: false };
  return checkBlindReadShape(body, options);
}

/**
 * One comment as a blind read, or null when it is not one or its shape does not hold (no landing
 * set check: the read is judged as it stands on the trail).
 * @param {{body?: string, createdAt?: string, id?: string, commentId?: string}|null} comment
 */
export function parseBlindRead(comment) {
  const check = checkBlindRead(bodyOf(comment));
  if (!check.ok || !check.applies) return null;
  return { verdict: check.verdict, reason: check.reason, prs: check.prs, at: comment.createdAt || null, commentId: comment.id || comment.commentId || null };
}

/**
 * The latest blind read on record (LIN-4396 builder note 4): the newest well-formed read posted
 * after `reviewComment`, or anywhere on the trail when there is no review.
 * @param {Array<Object>} comments
 * @param {Object|null} [reviewComment] - the latest review comment, or null
 */
export function latestBlindRead(comments, reviewComment = null) {
  const sorted = byTime(comments);
  const from = reviewComment ? sorted.indexOf(reviewComment) : -1;
  const reviewAt = reviewComment ? Date.parse(reviewComment.createdAt || '') : NaN;
  for (let i = sorted.length - 1; i > from; i--) {
    const c = sorted[i];
    // A review passed in from another list (not this array's object) is placed by its time.
    if (from === -1 && reviewComment && !(Date.parse(c.createdAt || '') > reviewAt)) continue;
    const read = parseBlindRead(c);
    if (read) return read;
  }
  return null;
}

// ─── The trail pass ───────────────────────────────────────────────────────────

/**
 * What the trail says, read once (LIN-4458).
 *
 * The landing (LIN-4396's "which landing is current"):
 *   1. The anchor is the latest close-out before the latest review. With no review, or no such
 *      close-out, it is the start of the trail.
 *   2. The landing is the PRs the comments after the anchor carry, by their row's `landing`, in the
 *      order they first appear after the anchor. "First appear after the anchor", not "never cited
 *      before": a fix round that re-cites the reviewed PR after a not-ready close-out keeps it
 *      (row 13 of tests/unit/lin-4438-blind-read-gate.test.js), or the landing would empty and the
 *      gate open on a re-reviewed PR. A close-out after the review is an attempt on this landing,
 *      never a new one. An audit carries only the PRs it is the first on the trail to cite, so an
 *      audit that re-cites a merged landing PR leaves the notes PR's landing to the notes PR (row 14).
 *      Not narrowed by repository: no caller holds the task's repository, so a foreign PR cited
 *      before the first review still joins a first landing (row 15, a stated limit).
 *
 * Work after review: a later comment whose row counts as `work`, against the reviewed landing (the
 * landing as it stood at the review). Re-citing the reviewed PR in an agent's note does not restart
 * review; a new PR in one does.
 *
 * @param {Array<{body?: string, createdAt?: string, id?: string}>} comments
 * @returns {{
 *   review: Object|null,          the latest review's ledger with the latest blind read after it; null with no review
 *   reviewComment: Object|null,
 *   landing: string[],
 *   workAfterReview: boolean,
 *   closeOutAfterReview: boolean,
 *   closeOutOnTrail: boolean,     a close-out after the anchor: on this landing
 *   landingHasNotesPr: boolean,   the landing holds an audit's notes PR
 *   auditAfterCloseOut: boolean,  an audit already ran on the current landing (LIN-4432)
 *   notesPrs: string[]
 * }}
 */
export function readTrail(comments) {
  const sorted = byTime(comments);
  const kinds = sorted.map(c => commentKindOf(c.body));
  const reviewComment = latestReviewComment(sorted);
  const at = reviewComment ? sorted.indexOf(reviewComment) : -1;

  // The PRs each comment is the first on the trail to cite; an audit's are its notes PRs.
  const seen = new Set();
  const firstCited = sorted.map(c => {
    const fresh = prUrlsIn(c.body).filter(u => !seen.has(u));
    for (const u of prUrlsIn(c.body)) seen.add(u);
    return fresh;
  });
  const notesPrs = new Set(sorted.flatMap((c, i) => (kinds[i] === 'audit' ? firstCited[i] : [])));

  let anchor = -1;
  for (let i = 0; i < at; i++) if (kinds[i] === 'close-out') anchor = i;

  const carried = (i) => {
    const { landing } = ROW_OF.get(kinds[i]);
    return landing === 'all' ? prUrlsIn(sorted[i].body) : landing === 'first-cited' ? firstCited[i] : [];
  };
  const landingOver = (from, to) => {
    const urls = [];
    for (let i = from; i < to; i++) for (const u of carried(i)) if (!urls.includes(u)) urls.push(u);
    return urls;
  };
  const landing = landingOver(anchor + 1, sorted.length);

  let workAfterReview = false;
  let closeOutAfterReview = false;
  if (reviewComment) {
    const reviewed = new Set(landingOver(anchor + 1, at + 1));
    for (let i = at + 1; i < sorted.length; i++) {
      const { work } = ROW_OF.get(kinds[i]);
      const urls = prUrlsIn(sorted[i].body);
      if (work === 'cites-pr' && urls.length > 0) workAfterReview = true;
      if (work === 'cites-new-pr' && urls.some(u => !reviewed.has(u))) workAfterReview = true;
      if (kinds[i] === 'close-out') closeOutAfterReview = true;
    }
  }

  // LIN-4432: the landing close-out is the last close-out that does not cite a notes PR, so a notes
  // PR's own close-out never starts a new landing; an audit after it means an audit already ran.
  // Known limit: a close-out that merges a notes PR without citing its URL reads as a landing.
  let landingCloseOut = -1;
  kinds.forEach((k, i) => { if (k === 'close-out' && !prUrlsIn(sorted[i].body).some(u => notesPrs.has(u))) landingCloseOut = i; });

  return {
    review: reviewComment ? { ...parseRunLedger(reviewComment), blindRead: latestBlindRead(sorted, reviewComment) } : null,
    reviewComment,
    landing,
    workAfterReview,
    closeOutAfterReview,
    closeOutOnTrail: kinds.slice(anchor + 1).includes('close-out'),
    landingHasNotesPr: landing.some(u => notesPrs.has(u)),
    auditAfterCloseOut: landingCloseOut >= 0 && kinds.slice(landingCloseOut + 1).includes('audit'),
    notesPrs: [...notesPrs],
  };
}

/**
 * The PRs of the current landing: `readTrail(comments).landing`. A thin named view for its two
 * callers that want nothing else, the blind-read write check (routes/proxy-writes.js) and measure 1
 * (scripts/stability-measures-blind.mjs). Never narrowed in a caller.
 * @param {Array<{body?: string, createdAt?: string}>} comments
 * @returns {string[]}
 */
export function landingPrUrls(comments) {
  return readTrail(comments).landing;
}

/**
 * What the close-out gate reads of the trail (LIN-4438), as lib/close-out-readiness.js and the box
 * take it: the latest review's ledger carrying the latest blind read after it (null with no review,
 * LIN-3497), and the current landing.
 * @param {Array<Object>} comments
 * @returns {{ledger: Object|null, landingPrs: string[]}}
 */
export function readGateTrail(comments) {
  const { review, landing } = readTrail(comments);
  return { ledger: review, landingPrs: landing };
}
