/**
 * LIN-4518 (P5, beat 4; ruling lin4518-authorship: the marker convention). Harbour stamps every comment it writes with one
 * mark line, and authorship is read from the mark: a marked comment is Harbour's, an unmarked one is a person's. History
 * predates the mark, so an unmarked comment from before it reads as a person's, as the ruling says. A Harbour summary's
 * opening line (lib/records/summary.js SUMMARY_LEAD) was already Harbour's mark, so a summary reads as Harbour's too.
 *
 * The mark is an HTML comment on a line of its own, as the periodical gate's marker is (lib/periodicals.js): the tracker
 * does not show it, and a reader finds it by the exact line. The writers stamp at their one seam each: the proxy's comment
 * write (routes/proxy-writes.js postComment) and Harbour's own tracker comment (lib/records-tracker.js trackerPortOf).
 */
import { isSummaryBody } from './records/summary.js';

/** The line every comment Harbour writes carries. */
export const HARBOUR_COMMENT_MARK = '<!-- harbour-comment -->';

const bodyOf = (comment) => (typeof comment === 'string' ? comment : (typeof comment?.body === 'string' ? comment.body : ''));
const carriesMark = (body) => body.split('\n').some((line) => line.trim() === HARBOUR_COMMENT_MARK);

/** Whether a comment (or a body) is Harbour's: it carries the mark line, or it is a Harbour summary. */
export function isHarbourMarked(comment) {
  const body = bodyOf(comment);
  return carriesMark(body) || isSummaryBody(body);
}

/** Whether a comment is a person's: it carries no Harbour mark (the ruling: unmarked comments read as a person's). */
export function isPersonAuthored(comment) {
  return !isHarbourMarked(comment);
}

/** The body a Harbour write posts: the text with the mark line at its end (once; a body already marked is returned as is). */
export function markHarbourComment(body) {
  const text = String(body ?? '');
  if (carriesMark(text)) return text;
  return `${text.replace(/\s+$/, '')}\n\n${HARBOUR_COMMENT_MARK}`;
}

/** A body without its mark line, for a reader that shows the words (the selector's view): the mark is not part of what was said. */
export function withoutHarbourMark(body) {
  const text = String(body ?? '');
  if (!carriesMark(text)) return text;
  return text.split('\n').filter((line) => line.trim() !== HARBOUR_COMMENT_MARK).join('\n').replace(/\s+$/, '');
}

