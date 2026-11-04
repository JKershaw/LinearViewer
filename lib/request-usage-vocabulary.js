/**
 * lib/request-usage-vocabulary.js: the one vocabulary a usage reading and a request record share (LIN-4201, scope item 3).
 *
 * Two shapes carry a model's token counts: the per-lineage snapshot a runner posts as `[usage]` feedback
 * (lib/session-telemetry.js reads it) and the per-request record (the record store, written by
 * lib/request-usage-intake.js). Both fold through lib/row-usage.js and lib/request-usage-fold.js. Before this module
 * each restated the token-field list and the lane set, so a field added to one shape could silently miss the other.
 *
 * Every server-side reader imports the names from here. The runner kit (lib/runner-kit/runner.mjs) ships as a
 * standalone copy, so it keeps its own TRANSCRIPT_TOKEN_FIELDS; tests/unit/request-usage-vocabulary.test.js pins that
 * copy equal to USAGE_TOKEN_FIELDS.
 */

/** The five token counters. Identity fields (requestId, model, ...) are not among them. */
export const USAGE_TOKEN_FIELDS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'cacheCreationInputTokens',
  'cacheCreation1hInputTokens',
  'cacheReadInputTokens'
]);

/**
 * The lanes a reading may name (subscription, api, openrouter). The snapshot reader keeps this as a closed set: a
 * usage reading with any other lane has no lane. The record intake does NOT close it: a record carrying another lane
 * is stored, because rejecting it would drop a live request's tokens from the cost. Only the closed set is shared.
 */
export const USAGE_LANES = Object.freeze(['subscription', 'api', 'openrouter']);
