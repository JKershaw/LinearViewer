/**
 * Shared issue-write validation seam (LIN-1552 / LIN-1504 Session A).
 *
 * The single home for the field-validation rules that every issue-write surface
 * must apply identically. It was extracted verbatim from the proxy-local checks
 * in `routes/proxy.js` (the consumer-token `POST /api/proxy/issues` +
 * `PATCH /api/proxy/issues/:id` handlers) so the new session-auth workspace API
 * routes (Session B / beat 2) consume the SAME definition and cannot drift.
 *
 * Behaviour contract (must stay byte-for-byte compatible with the proxy route):
 *  - Length caps: title ≤ MAX_NAME_LENGTH, description ≤ MAX_DESCRIPTION_LENGTH,
 *    comment ≤ MAX_COMMENT_LENGTH.
 *  - Control-character guard: DANGEROUS_CHARS_REGEX rejects null bytes and
 *    dangerous control chars in title/description.
 *  - Priority range 0–4 (inclusive), integers only. Note this is a SILENT-DROP
 *    guard, not a rejection: the proxy today never 400s on a bad priority, it
 *    just declines to forward it. `isValidPriority` is the range primitive both
 *    surfaces gate the assignment on; `validateIssueWriteFields` deliberately
 *    does NOT reject on priority so proxy behaviour is unchanged.
 *
 * The error strings returned here are the exact messages the proxy route emitted
 * inline, in the exact per-mode order, so the extraction is observationally
 * identical for a single-field violation.
 */

// Length caps shared by every issue-write surface.
export const MAX_NAME_LENGTH = 1000;
export const MAX_DESCRIPTION_LENGTH = 100000;
export const MAX_COMMENT_LENGTH = 50000;

// Null bytes and dangerous control characters.
export const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// Inclusive priority range (Linear: 0 = No priority … 4 = Low).
export const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 4;

/**
 * The shared priority range guard. True only for an integer in [0, 4].
 * Callers gate the assignment on this (silent-drop), matching the proxy's
 * long-standing `priority !== undefined && Number.isInteger(...) && 0..4`
 * behaviour — an out-of-range priority is ignored, never a 400.
 */
export function isValidPriority(priority) {
  return Number.isInteger(priority) && priority >= MIN_PRIORITY && priority <= MAX_PRIORITY;
}

/**
 * Validate the string fields of an issue-write payload. Returns an error message
 * string on the first violation (to be surfaced as a 400 by the caller), or
 * `null` when the fields pass.
 *
 * @param {{ title?: unknown, description?: unknown }} fields
 * @param {{ title?: unknown, description?: unknown, priority?: unknown }} fields
 * @param {{ mode?: 'create' | 'update', validatePriority?: boolean }} [options]
 *   - `create` (default): title is required and always length/char-checked;
 *     order: title-required → title-length → description-length →
 *     title-chars → description-chars.
 *   - `update`: every field optional; order: title-length → title-chars →
 *     description-length → description-chars.
 *   - `validatePriority` (default false): when true, a supplied `priority`
 *     outside 0–4 is REJECTED (checked last, after the string fields). The proxy
 *     surface leaves this off and silent-drops a bad priority (byte-identical to
 *     its history); the session-auth workspace-API surface turns it on so a bad
 *     priority is a clean 400 (LIN-1552 Session A spec).
 * @returns {string | null}
 */
export function validateIssueWriteFields(fields = {}, { mode = 'create', validatePriority = false } = {}) {
  const { title, description, priority } = fields;

  const stringError = mode === 'create'
    ? createStringError(title, description)
    : updateStringError(title, description);
  if (stringError) return stringError;

  // Priority range — opt-in rejection, checked last so the string-field messages
  // win. Only a supplied, out-of-range priority is rejected; an omitted priority
  // is always valid.
  if (validatePriority && priority !== undefined && !isValidPriority(priority)) {
    return `priority must be an integer between ${MIN_PRIORITY} and ${MAX_PRIORITY}`;
  }
  return null;
}

// create-mode string checks: title-required → title-length → description-length
// → title-chars → description-chars (the exact order the proxy create route used).
function createStringError(title, description) {
  // Required-field check kept here for the shared seam's safety, though the
  // proxy route performs its own title-required check (with its logEvent)
  // before calling this, so this branch never fires for the proxy path.
  if (!title || typeof title !== 'string') {
    return 'title is required';
  }
  if (title.length > MAX_NAME_LENGTH) {
    return `title exceeds maximum length of ${MAX_NAME_LENGTH}`;
  }
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return 'description exceeds maximum length';
  }
  if (DANGEROUS_CHARS_REGEX.test(title)) {
    return 'title contains invalid characters';
  }
  if (description && DANGEROUS_CHARS_REGEX.test(description)) {
    return 'description contains invalid characters';
  }
  return null;
}

// update-mode string checks: every field optional (presence-guarded);
// title-length → title-chars → description-length → description-chars (the exact
// order the proxy update route used).
function updateStringError(title, description) {
  if (title && title.length > MAX_NAME_LENGTH) {
    return `title exceeds maximum length of ${MAX_NAME_LENGTH}`;
  }
  if (title && DANGEROUS_CHARS_REGEX.test(title)) {
    return 'title contains invalid characters';
  }
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return 'description exceeds maximum length';
  }
  if (description && DANGEROUS_CHARS_REGEX.test(description)) {
    return 'description contains invalid characters';
  }
  return null;
}

/**
 * Shared comment-body validation (LIN-2154), consumed by all three comment-write
 * call sites — the agent-lane create (`routes/proxy.js`, required) and update
 * (required) routes, this ticket's new session-auth route (required) — plus the
 * attachment relay's optional caption (`required: false`). Owns exactly the
 * checks genuinely common to all of them: presence/type when required, type-when-
 * provided when not, and the dangerous-control-char guard. Length checking
 * (`MAX_COMMENT_LENGTH`) deliberately stays a call-site concern — the relay does
 * budget arithmetic against a not-yet-built composite string this function has no
 * business knowing about.
 *
 * @param {unknown} body
 * @param {{required?: boolean}} [options] - `required` defaults to true.
 * @returns {{valid: true} | {valid: false, error: string}}
 */
export function validateCommentBody(body, { required = true } = {}) {
  if (required) {
    if (!body || typeof body !== 'string') {
      return { valid: false, error: 'body is required' };
    }
  } else if (body !== undefined && typeof body !== 'string') {
    return { valid: false, error: 'body must be a string' };
  }
  if (typeof body === 'string' && DANGEROUS_CHARS_REGEX.test(body)) {
    return { valid: false, error: 'body contains invalid characters' };
  }
  return { valid: true };
}
