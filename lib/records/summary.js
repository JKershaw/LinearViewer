/**
 * LIN-4503 (P3, the outward half), extended by LIN-4516: the marked summary Harbour posts on a ticket after a plan
 * version or a verdict is written, one per version. Pure: no store, no tracker. This leaf holds the words and THE one mark
 * predicate. Every reader that tells a summary from a person's comment reads `isSummaryBody`: the comment classifier's first
 * row (lib/run-trail.js `harbour-summary`), the summary filter the briefs and the selector read (`withoutHarbourSummaries`),
 * and the person test. The mark is the first non-blank line only, so a comment that merely quotes it further down is not a
 * summary. It no longer carries a plan-only tail: a verdict's summary opens the same way and reads the same.
 */

/** What a summary's opening line starts with; the plan id and `v<n>` follow (the middle dot is U+00B7). */
export const SUMMARY_LEAD = '**Harbour summary** · ';

/** The opening line a summary of record `id` at version `v` carries. */
export const summaryOpeningOf = (id, v) => `${SUMMARY_LEAD}${id} v${v}`;

/**
 * THE mark predicate (LIN-4516): a comment is a Harbour summary when its first non-blank line starts with SUMMARY_LEAD,
 * whatever follows it. Takes a body (a string) or a comment (`{body}`).
 * @returns {boolean}
 */
export function isSummaryBody(comment) {
  const body = typeof comment === 'string' ? comment : (typeof comment?.body === 'string' ? comment.body : '');
  return (String(body || '').split('\n').find((l) => l.trim()) || '').trim().startsWith(SUMMARY_LEAD);
}

/** A verdict's judgement, as the summary names it: its word, with the first letter capitalised (`plan-review` reads "Plan review"). */
const judgementLabelOf = (judgement) => String(judgement ?? 'Verdict').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * The comment Harbour posts for a record version: a plan version (the mark, the version, the revision reason, and the plan's
 * own words, posted as they stand) or a verdict (the mark, the judgement and its outcome, and the verdict's reasoning as written).
 * @param {{id: string, v: number, kind?: string, fields?: {says?: string, judgement?: string, outcome?: string, reasoning?: string}}} record
 *   the record's current version (a snapshot)
 * @param {{reason?: string|null}} [change] - a plan's revision reason; null or absent for a first version. A verdict ignores it.
 * @returns {string}
 */
export function summaryBodyOf(record, change = null) {
  if (record.kind === 'verdict') {
    const f = record.fields || {};
    const label = judgementLabelOf(f.judgement);
    const reasoning = typeof f.reasoning === 'string' ? f.reasoning.trim() : '';
    return `${summaryOpeningOf(record.id, record.v)}\n\n${label} verdict: ${f.outcome}.${reasoning ? `\n\n${reasoning}` : ''}`;
  }
  const says = typeof record.fields?.says === 'string' ? record.fields.says.trim() : '';
  const why = change?.reason ? `Revised: ${String(change.reason).trim()}` : 'First version.';
  return `${summaryOpeningOf(record.id, record.v)}\n\n${why}\n\n${says}`;
}
