/**
 * scripts/lin3014/lib/classify.mjs (LIN-3014)
 *
 * Pure row-first classifier for a before/after byte measurement. Row changes
 * are classified before byte changes: ANY row delta is a LIN-615 violation,
 * regardless of whether bytes also dropped (research beat 3, `299efc16`,
 * "the planted hidden-filter query (7->6 rows) was flagged as a LIN-615
 * violation even though it also saved bytes").
 *
 * `before`/`after` are `{ label, rows, bytes }` (see `measureFind`/`measureAgg`
 * in `measure.template.js` — this function's source is spliced verbatim into
 * that mongosh script by `build-measure.mjs`, so there is exactly one
 * implementation, never two copies that can drift).
 *
 * The corrected classification (beat-4 diff, comment `eca63aab`) adds a
 * fourth outcome the original two-way branch couldn't express: bytes going
 * UP at the same row count, which is what a persisted `feedbackDigest`
 * heavier than the raw feedback it replaces looks like (LIN-3009 L5).
 */
export function classify(before, after) {
  let kind;
  if (before.rows !== after.rows) {
    kind = `ROW-COUNT CHANGE ${before.rows}->${after.rows}: LIN-615 violation`;
  } else if (after.bytes < before.bytes) {
    kind = 'COLUMN reduction (same rows, fewer bytes)';
  } else if (after.bytes > before.bytes) {
    kind = 'BYTES INCREASED at same rows (digest outweighs dropped columns)';
  } else {
    kind = 'no change';
  }
  return {
    compare: `${before.label} -> ${after.label}`,
    kind,
    rowsEqual: before.rows === after.rows,
    bytesSaved: before.bytes - after.bytes
  };
}
