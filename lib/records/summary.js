/**
 * LIN-4503 (P3, the outward half): the marked plan summary Harbour posts on a ticket, one per plan version. Pure: no
 * store, no tracker. The mark is the OPENING LINE only, so a comment that merely quotes it is not a summary.
 *
 * A summary is not a person's comment, not a plan comment and not a trail row's landing: lib/run-trail.js reads
 * `isHarbourSummary` as its first row (`harbour-summary`), which excludes it from the person facts, the plan-comment
 * selection and the look-first scan, and lib/brief.js and lib/openrouter.js drop it from the brief and the prompt.
 */

/** The opening line: `**Harbour summary** · <plan id> v<n>` (the middle dot is U+00B7). */
const OPENING = /^\*\*Harbour summary\*\* · (\S+) v(\d+)$/;

/** The first non-blank line of a comment body, trimmed; '' for a non-string or a blank body. */
function firstLineOf(body) {
  if (typeof body !== 'string') return '';
  const line = body.split('\n').find((l) => l.trim() !== '');
  return line ? line.trim() : '';
}

/** The opening line a summary of plan `id` at version `v` carries. */
export const summaryOpeningOf = (id, v) => `**Harbour summary** · ${id} v${v}`;

/** Whether a comment body is a Harbour plan summary: its opening line is the mark. */
export function isHarbourSummary(body) {
  return OPENING.test(firstLineOf(body));
}

/**
 * The comment Harbour posts for a plan version: the mark, the version, the revision reason (a first version says so),
 * and the plan's own words. The words are the record's `says`, posted as they stand; nothing is summarised here.
 * @param {{id: string, v: number, fields?: {says?: string}}} plan - the plan's current version (a snapshot)
 * @param {{reason?: string|null}} [change] - why this version exists; null or absent for a first version
 * @returns {string}
 */
export function summaryBodyOf(plan, change = null) {
  const says = typeof plan.fields?.says === 'string' ? plan.fields.says.trim() : '';
  const why = change?.reason ? `Revised: ${String(change.reason).trim()}` : 'First version.';
  return `${summaryOpeningOf(plan.id, plan.v)}\n\n${why}\n\n${says}`;
}
