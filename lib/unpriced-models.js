/**
 * Bounded registry of raw worker model strings whose derived cost came out null
 * (LIN-3094). parseUsagePayload records into it; the pricing-conformance sweep reads
 * it through its `getSeenModels` seam and logs the ones that still price to null.
 *
 * In-process only: a restart empties it, and the next parse of the same usage refills it.
 */

// LIN-3094: ticket cap — a model-string typo storm must not grow the sweep's input without bound.
export const MAX_SEEN_MODELS = 50;

const seen = new Set();

/** @param {unknown} model raw `usage.model`; non-strings and empty strings are ignored */
export function recordUnpricedModel(model) {
  if (typeof model !== 'string' || model === '') return;
  // Re-insert so a model still being seen stays newest; the oldest is evicted at the cap.
  seen.delete(model);
  seen.add(model);
  if (seen.size > MAX_SEEN_MODELS) seen.delete(seen.values().next().value);
}

/** @returns {string[]} snapshot of the recorded model strings, oldest first */
export function getSeenModels() {
  return [...seen];
}

/** Test seam: empty the registry. */
export function resetSeenModels() {
  seen.clear();
}
