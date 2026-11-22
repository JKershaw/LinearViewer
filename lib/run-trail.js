// The text rules a trail still reads, until Slice 4 retires them (LIN-4520).
//
// Verdicts, changes, the landing, the latest review and its blind read are records now (lib/task-standing.js
// trailForTicket, lib/records/standing.js): no comment is read to find a verdict or the commit it judged. What
// stays here is the authorship text rule, which the design keeps until the ticket section goes (slice 4):
//   - a ruling: a person's comment that ENDS with the mark the in-app route appends (`RULING_MARK`);
//   - a Harbour summary (lib/records/summary.js isSummaryBody, LIN-4516): Harbour's own plan summary, never a person's;
//   - whether a comment is a person's words (`isPersonComment`): not a ruling, not Harbour's, not an agent's note, not
//     a headed report, not a close-out, not a review or a plan-review verdict, and not one that cites a PR as landed work.
// Landed work is NOT read from comments (LIN-4520, finding-ca44ecba, finding-5d38c050): it is a change record version that wrote a head
// after the instant in question (lib/records-store.js planReviewRunForTicket). A comment that only looks like a verdict decides nothing.
//
// PURE: no I/O, no clock, no store. The openings below are the ones the trail has always read; no table, no kinds
// exported. Words come from their leaves: the Survey and blind-read headings (lib/prompts/*-words.js).

import { BLIND_READ_HEADING } from './prompts/blind-read-words.js';
import { SURVEY_HEADINGS } from './prompts/survey-words.js';
import { prUrlsIn } from './run-ledger.js';
import { isSummaryBody } from './records/summary.js';

/** The comment's first non-blank line, trimmed. */
const firstLine = (body) => (String(body || '').split('\n').find(l => l.trim()) || '').trim();

/** A comment's first non-blank line, with leading markdown stripped. */
const firstLineOf = (body) => firstLine(body).replace(/^[#>*_\s]+/, '');

/** The heading TEXT of a comment's first heading line (anywhere in it), or '' when it has none. */
function firstHeading(body) {
  const m = (body || '').match(/^#{1,6}[ \t]+([^\n]*)/m);
  return m ? m[1].trim() : '';
}

/**
 * Whether a comment opens with `heading`, matched exactly: its first non-blank line is the heading,
 * then a tail `tail` accepts (by default the end of the line or a `:`). A longer heading
 * (`## Blind read pilot`) is another heading (lesson LIN-4414: a check on comment bodies keys on the opening line).
 */
function opensWithHeading(body, heading, tail = /^(?:$|:)/) {
  const line = firstLine(body);
  return line.startsWith(heading) && tail.test(line.slice(heading.length));
}

// A review summary is identified by its TITLE (its first heading line), never by a heading that merely appears in the
// body (R1'). A plan review is not the finished-run review; a `Close-out`/`Autopilot` title is not one either.
const TITLE_NON_REVIEW = /^(?:close-?out|autopilot)\b/i;
const TITLE_PLAN_REVIEW = /plan[-\s]+review/i;
const TITLE_NAMES_REVIEW = /\breview\b/i;
const VERDICT_WORD = /\b(?:approve[sd]?|request(?:ed)?\s+changes?|needs?\s+discussion)\b/i;
const LEDGER_HEADING = /^###\s*What CI Did Not Prove\b[^\n]*/im;

function opensAsReview(body) {
  const title = firstHeading(body);
  if (!title || TITLE_NON_REVIEW.test(title)) return false;
  if (!TITLE_NAMES_REVIEW.test(title) || TITLE_PLAN_REVIEW.test(title)) return false;
  return VERDICT_WORD.test(body) || LEDGER_HEADING.test(body);
}

// An agent's own note (LIN-3309): the planner reporting the plan or revision it wrote, or an autopilot step record.
const AGENT_NOTE_OPENING = /^(?:autopilot\b|plan\s+(?:posted|revis\w*)\b|revision\s+\d+\s*[—–-]\s*addresses plan-review)/i;
const opensAsAgentNote = (body) => AGENT_NOTE_OPENING.test(firstLineOf(body));

// A plan-review verdict comment, by its contract heading or the legacy one (its verdict is a record now).
const PLAN_REVIEW_HEADINGS = [/^Plan Review Verdict\b/i, /^plan[-\s]+review\b/i];
const opensAsPlanReview = (body) => PLAN_REVIEW_HEADINGS.some(re => re.test(firstHeading(body)));

const opensAsCloseOut = (body) => /\bclose-?out\b/i.test(firstHeading(body)) || /^close-?out\b/i.test(firstLineOf(body));

/** The heading an area read posts under (docs/plans/survey/area-read.md, LIN-4453). */
const AREA_READ_HEADING = '## Area read';
/** A Survey's or an area read's heading takes a `:` or a space after it (`## Survey global @ sha`). */
const REPORT_TAIL = /^(?:$|[:\s])/;
const opensAsSurveyOrAreaRead = (body) => opensWithHeading(body, SURVEY_HEADINGS['survey-task'], REPORT_TAIL)
  || opensWithHeading(body, SURVEY_HEADINGS['survey-place'], REPORT_TAIL)
  || opensWithHeading(body, AREA_READ_HEADING, REPORT_TAIL);

const bodyOf = (comment) => (typeof comment === 'string' ? comment : (comment && typeof comment.body === 'string' ? comment.body : ''));

/**
 * The mark the in-app comment route appends to a person's comment (routes/workspace-api-issue-write.js writes it from
 * here). The one reliable "a person wrote this" mark on a trail: agents post under the same account.
 */
export const RULING_MARK = '— Ruling recorded via Harbour';

/**
 * A ruling (LIN-3300): a person's comment that ENDS with the mark the in-app route appends. A comment that only quotes
 * the mark is not one, and neither is an agent's own note. Read from the agent-note opening: the mark says who wrote
 * the comment, whatever it is.
 */
export function isRuling(comment) {
  const text = bodyOf(comment).trimEnd();
  return text.endsWith(RULING_MARK) && !opensAsAgentNote(text);
}

/**
 * Whether a comment is a Harbour summary: THE mark predicate (lib/records/summary.js isSummaryBody, LIN-4516).
 */
export function isHarbourSummary(comment) {
  return isSummaryBody(bodyOf(comment));
}

/**
 * LIN-4503: the comments a brief or a prompt reads, without Harbour's plan summaries. A summary repeats a plan the
 * records already hold, so it is noise to the brief and the selector.
 */
export const withoutHarbourSummaries = (comments) => (Array.isArray(comments) ? comments : []).filter((c) => !isHarbourSummary(bodyOf(c)));

/**
 * Whether a comment is a blind read by its opening (the blind-read kind, LIN-4437): its first line is the blind-read
 * heading, and it is not a Harbour summary, a close-out or a review by title. The write guard holds these to the PR set.
 */
export function opensAsBlindRead(comment) {
  const body = bodyOf(comment);
  return opensWithHeading(body, BLIND_READ_HEADING) && !isHarbourSummary(body) && !opensAsCloseOut(body) && !opensAsReview(body);
}

/**
 * Whether a comment is an agent's activity after a person's comment (the selector's `actedAfter`): an agent's own note,
 * or a close-out, read as the opening rules read them. A review or a Harbour summary is neither. Landed work is not a
 * comment fact any more (LIN-4520, finding-ca44ecba): the caller reads a change record written after the person's comment.
 */
export function isAgentActivity(comment) {
  const body = bodyOf(comment);
  if (isHarbourSummary(body) || opensAsReview(body)) return false;
  if (opensAsCloseOut(body)) return true;
  return !opensAsBlindRead(body) && !opensAsSurveyOrAreaRead(body) && opensAsAgentNote(body);
}

/**
 * Whether a comment cites a full PR URL as landed work, by the authorship text rule (isPersonComment): a comment that
 * is not an agent's note, a Survey or an area read, a blind read, or a Harbour summary. Only the authorship rule reads
 * it; no decision does (LIN-4520, finding-ca44ecba).
 */
export function reportsLandedWork(comment) {
  const body = bodyOf(comment);
  if (isHarbourSummary(body)) return false;
  if (opensAsCloseOut(body)) return prUrlsIn(body).length > 0;
  if (opensAsBlindRead(body) || opensAsSurveyOrAreaRead(body) || opensAsAgentNote(body)) return false;
  return prUrlsIn(body).length > 0;
}

/**
 * A person's comment (LIN-3300): a ruling, or an unheaded comment that is none of an agent's own note, a headed
 * report, a close-out, a plan-review verdict, a review, or landed work. Agents post under a person's account, so the
 * author cannot decide it. The rule is the text rule of this file; Slice 4 retires it with the ticket section.
 */
export function isPersonComment(comment) {
  const body = bodyOf(comment);
  if (isHarbourSummary(body)) return false; // LIN-4503: Harbour's summary, never a person's words
  if (isRuling(body)) return true;
  if (/^#{1,6}[ \t]/.test(firstLine(body))) return false;
  if (opensAsAgentNote(body) || opensAsPlanReview(body) || opensAsCloseOut(body) || opensAsReview(body)) return false;
  return !reportsLandedWork(body);
}
