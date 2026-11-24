// The comment text readers a trail still holds (LIN-4520, LIN-4535).
//
// Verdicts, changes, the landing, the latest review, its blind read and who wrote a comment are records and findings now:
// lib/task-standing.js trailForTicket and lib/records/standing.js for the trail, lib/comment-ingest.js for a person's comment
// (a finding `by person:<id>`, decided by the author's tracker id, never by its words). What stays here is the reading that
// names a comment's kind for its one remaining caller (the blind-read guard, until the blind read retires its comment):
//   - a Harbour summary (lib/records/summary.js isSummaryBody, LIN-4516), filtered out of the briefs and the selector as noise
//     (`withoutHarbourSummaries`), never read to say whose words a comment is;
//   - a blind read by its opening (`opensAsBlindRead`, LIN-4437).
// Landed work is NOT read from comments (LIN-4520): it is a change record version that wrote a head after the instant in question.
//
// PURE: no I/O, no clock, no store. Words come from their leaves: the blind-read heading (lib/prompts/blind-read-words.js).

import { BLIND_READ_HEADING } from './prompts/blind-read-words.js';
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

const opensAsCloseOut = (body) => /\bclose-?out\b/i.test(firstHeading(body)) || /^close-?out\b/i.test(firstLineOf(body));

const bodyOf = (comment) => (typeof comment === 'string' ? comment : (comment && typeof comment.body === 'string' ? comment.body : ''));

/**
 * Whether a comment is a Harbour summary (lib/records/summary.js isSummaryBody, LIN-4516): a noise filter for the briefs and
 * the selector. It is never read to say whose words a comment are.
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
