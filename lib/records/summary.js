/**
 * LIN-4503 (P3, the outward half): the marked plan summary Harbour posts on a ticket, one per plan version. Pure: no
 * store, no tracker. This leaf holds the words; the one comment classifier, lib/run-trail.js, matches them (its first
 * row, `harbour-summary`, and `isHarbourSummary`), as it does every leaf's opening. The mark is the OPENING LINE only,
 * so a comment that merely quotes it is not a summary.
 */

/** What a summary's opening line starts with; the plan id and `v<n>` follow (the middle dot is U+00B7). */
export const SUMMARY_LEAD = '**Harbour summary** · ';

/** The opening line a summary of plan `id` at version `v` carries. */
export const summaryOpeningOf = (id, v) => `${SUMMARY_LEAD}${id} v${v}`;

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
