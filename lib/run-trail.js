// The comment text readers a trail still holds (LIN-4520, LIN-4535, LIN-4543).
//
// Verdicts, changes, the landing, the latest review, its blind read and who wrote a comment are records and findings now:
// lib/task-standing.js trailForTicket and lib/records/standing.js for the trail, lib/comment-ingest.js for a person's comment
// (a finding `by person:<id>`, decided by the author's tracker id, never by its words). What stays here is one filter:
//   - a Harbour summary (lib/records/summary.js isSummaryBody, LIN-4516), filtered out of the briefs and the selector as noise
//     (`withoutHarbourSummaries`), never read to say whose words a comment is.
// The blind-read guard and its opening reader retired (LIN-4543): a comment is ordinary text to the proxy.
// Landed work is NOT read from comments (LIN-4520): it is a change record version that wrote a head after the instant in question.
//
// PURE: no I/O, no clock, no store.

import { isSummaryBody } from './records/summary.js';

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
