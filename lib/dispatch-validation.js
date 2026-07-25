/**
 * Shared validation for opaque dispatch execution fields (`model`, `harness`).
 *
 * Both `routes/proxy.js` and `routes/dispatch.js` independently hand-rolled the
 * same type/length/dangerous-chars checks for `model`, and drifted: the proxy
 * path rejected `model: 0` (a falsy non-string) while the dispatch path silently
 * accepted it as absent. This helper is the single source of truth going
 * forward — used by both routers for both fields — so the two paths can no
 * longer diverge. See LIN-1084.
 */

const MAX_NAME_LENGTH = 1000;
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// Input length limits to prevent MongoDB errors (16MB document limit). These are
// the SAME caps routes/dispatch.js + routes/proxy.js each hand-rolled for the two
// main dispatch handlers; centralizing them here (alongside the shared
// validateDispatchPayload block below) is the de-dup home LIN-1084 established so
// the two paths can no longer drift. See LIN-1139.
const MAX_PROMPT_LENGTH = 10000000;    // 10MB max for prompt content
const MAX_URL_LENGTH = 8000;           // URLs (covers long query strings)
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `sessionId` is an opaque grouping key, not a foreign key, so it accepts any
// string — but a much tighter one than the 1000-char MAX_NAME_LENGTH default
// (LIN-1118). It becomes a Mongo `_id` PREFIX via `${urlKey}:${sessionId}`
// (lib/observation-sessions-store.js) and `urlKey` is capped at 50, so 128 keeps
// the composed key at 179 bytes — far under Mongo's 1024-byte `_id` index-key
// limit, which 1000 would not be.
const MAX_SESSION_ID_LENGTH = 128;

// Stricter than DANGEROUS_CHARS_REGEX: the full C0 set INCLUDING \t \n \r.
// The shared regex deliberately permits those three because it also guards
// `prompt`, where newlines are essential — a prompt-shaped rule, wrong for an
// identifier. Scoped to `sessionId` only (LIN-1118).
const STRICT_CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

// Reserved: `_sessionDocId(urlKey, '__meta__')` collides exactly with
// `_metaDocId(urlKey)` in lib/observation-sessions-store.js, and `upsertSession`
// would $set `type: 'session'` over the backfill marker's `type: 'meta'`. The
// marker then reads as absent, so the workspace re-fans the full backfill every
// poll with both writers clobbering each other. Silent; one-line guard.
const RESERVED_SESSION_ID = '__meta__';

/**
 * Validates an opaque dispatch execution field (e.g. `model`, `harness`).
 * `undefined`/`null` are treated as "absent" and are always valid — the field
 * is optional/nullable at every seam it flows through.
 *
 * @param {*} value - The field value to validate
 * @param {string} fieldName - Field name, used in the returned error message
 * @param {{maxLength?: number}} [options]
 * @returns {{error: string}|null} An error object, or null when valid
 */
function validateOpaqueDispatchField(value, fieldName, { maxLength = MAX_NAME_LENGTH } = {}) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return { error: `${fieldName} must be a string` };
  }
  if (value.length > maxLength) {
    return { error: `${fieldName} exceeds maximum length of ${maxLength}` };
  }
  if (DANGEROUS_CHARS_REGEX.test(value)) {
    return { error: `${fieldName} contains invalid characters` };
  }
  return null;
}

/**
 * Validates a caller-supplied `sessionId` (LIN-1118).
 *
 * `sessionId` is an OPAQUE grouping key, never parsed or dereferenced: storage
 * writes it blind (`lib/dispatch-store.js`), grouping compares it by string
 * equality (`lib/pipeline-loops.js`), and the observation store uses it as a
 * document-key suffix. So the rule is a *pure relaxation* of the old UUID-only
 * check — every UUID that passed before still passes — which lets callers use
 * deterministic composite ids like `LIN-1117-autopilot-standalone-2026-07-07`
 * that are far easier to trace through logs than a random UUID.
 *
 * `undefined`/`null` are "absent" and valid, matching every other optional
 * dispatch field. `:` is deliberately NOT rejected: `urlKey` is
 * `[a-z0-9-]{1,50}` and so cannot contain one, making the `${urlKey}:${sessionId}`
 * prefix unambiguous however many colons the suffix holds, and nothing splits
 * that key back apart.
 *
 * The single home for this rule — the three call sites (this file's
 * `validateDispatchPayload`, which covers both main dispatch routes, plus
 * autopilot kickoff and recommend-and-dispatch in routes/proxy.js) keep their
 * own guard/reject shape but share the rule, so it cannot drift the way the
 * hand-rolled `model` check did before LIN-1084/LIN-1139.
 *
 * @param {*} value - The sessionId value to validate
 * @returns {{error: string}|null} An error object, or null when valid
 */
function validateSessionId(value) {
  if (value === undefined || value === null) {
    return null;
  }
  // Type + length (128, not the 1000 default) + the shared dangerous-char set.
  const opaqueError = validateOpaqueDispatchField(value, 'sessionId', { maxLength: MAX_SESSION_ID_LENGTH });
  if (opaqueError) return opaqueError;
  // Empty string: rejected by the old UUID test too. Left accepted it would be
  // coerced to `null` by `item.sessionId || null` at the store — turning a
  // caller typo that fails loudly today into a silent no-op.
  if (value.length === 0) {
    return { error: 'sessionId must not be empty' };
  }
  if (STRICT_CONTROL_CHARS_REGEX.test(value)) {
    return { error: 'sessionId contains invalid characters' };
  }
  if (value === RESERVED_SESSION_ID) {
    return { error: 'sessionId must not be a reserved value' };
  }
  return null;
}

/**
 * Shared request-payload validation for the two MAIN dispatch handlers — the
 * user-facing `POST /workspace/:urlKey/api/dispatch` (routes/dispatch.js) and
 * its proxy-token twin `POST /api/proxy/dispatch` (routes/proxy.js). Both
 * accept a caller-supplied prompt/body, so both ran the identical block of
 * length caps, dangerous-char checks, opaque model/harness validation, and
 * id/format/combination rules — hand-rolled twice and drifting (LIN-1084 fixed
 * the model half; LIN-1139 lifts the WHOLE block here so it cannot re-diverge).
 *
 * Extracts ONLY the checks the two handlers share verbatim, in the exact order
 * they ran, so the FIRST error returned for a multiply-invalid request is
 * unchanged. The caller-specific checks that DIFFER between the two handlers —
 * prompt-required, target vocabulary (dispatch.js allows `local`), abort
 * eligibility, cascade, kind, waitForFollowUps, queueIfBusy, subscription, and
 * the localhost-only `local` guard — deliberately stay in each caller and run
 * BEFORE this helper, matching the original interleaving.
 *
 * Returns an error STRUCTURE ({ error }) rather than writing a response, so each
 * caller keeps ownership of its own reject behavior — the proxy caller still
 * emits its own `logEvent(req, path, 400)` on reject; dispatch.js does not log.
 * The server-generated dispatch paths (kickoff, recommend-and-dispatch,
 * feedback, collective) intentionally do NOT call this — their prompt is trusted
 * and never caller-supplied, so they skip prompt/length/dangerous-char checks.
 *
 * @param {Object} body - The dispatch request body
 * @returns {{error: string}|null} The first validation error, or null when valid
 */
function validateDispatchPayload(body = {}) {
  const {
    prompt, promptName, issueIdentifier, issueTitle, issueUrl, repo,
    model, harness, issueId, followUpTo, target, force, cascade, abort, sessionId
  } = body;
  const isAbort = abort === true;

  // Length caps (guard the prompt-specific check on presence — an abort carries none).
  if (prompt && prompt.length > MAX_PROMPT_LENGTH) {
    return { error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}` };
  }
  if (promptName && promptName.length > MAX_NAME_LENGTH) {
    return { error: `promptName exceeds maximum length of ${MAX_NAME_LENGTH}` };
  }
  if (issueIdentifier && issueIdentifier.length > MAX_IDENTIFIER_LENGTH) {
    return { error: `issueIdentifier exceeds maximum length of ${MAX_IDENTIFIER_LENGTH}` };
  }
  if (issueTitle && issueTitle.length > MAX_NAME_LENGTH) {
    return { error: `issueTitle exceeds maximum length of ${MAX_NAME_LENGTH}` };
  }
  if (issueUrl && issueUrl.length > MAX_URL_LENGTH) {
    return { error: `issueUrl exceeds maximum length of ${MAX_URL_LENGTH}` };
  }
  if (repo && repo.length > MAX_NAME_LENGTH) {
    return { error: `repo exceeds maximum length of ${MAX_NAME_LENGTH}` };
  }

  // Execution model + harness (LIN-438, LIN-1084): opaque strings, validated
  // type/length/dangerous-chars only — never against a model registry.
  const modelValidationError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
  if (modelValidationError) return modelValidationError;
  const harnessValidationError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
  if (harnessValidationError) return harnessValidationError;

  // Reject null bytes and dangerous control characters.
  if (prompt && DANGEROUS_CHARS_REGEX.test(prompt)) {
    return { error: 'prompt contains invalid characters' };
  }
  if (promptName && DANGEROUS_CHARS_REGEX.test(promptName)) {
    return { error: 'promptName contains invalid characters' };
  }
  if (issueTitle && DANGEROUS_CHARS_REGEX.test(issueTitle)) {
    return { error: 'issueTitle contains invalid characters' };
  }
  if (repo && DANGEROUS_CHARS_REGEX.test(repo)) {
    return { error: 'repo contains invalid characters' };
  }

  // issueId format.
  if (issueId && !UUID_REGEX.test(issueId)) {
    return { error: 'Invalid issueId format' };
  }

  // Follow-up reference (LIN-415): well-formed UUID + cli/web-only target.
  if (followUpTo !== undefined && followUpTo !== null) {
    if (!UUID_REGEX.test(followUpTo)) {
      return { error: 'Invalid followUpTo format' };
    }
    const followUpTarget = target || 'cli';
    if (!['cli', 'web'].includes(followUpTarget)) {
      return { error: 'followUpTo is only supported for cli/web targets' };
    }
  }

  // Force flag (LIN-559/946/951): boolean, mutually exclusive with cascade, and
  // meaningful only alongside a verb that has a runner-side guard (followUpTo or abort).
  if (force !== undefined && typeof force !== 'boolean') {
    return { error: 'force must be a boolean' };
  }
  if (force === true && cascade === true) {
    return { error: 'force and cascade are mutually exclusive' };
  }
  if (force === true && !isAbort && (followUpTo === undefined || followUpTo === null)) {
    return { error: 'force requires followUpTo or abort' };
  }

  // Autopilot session reference (LIN-591): opaque grouping key, not a UUID
  // (LIN-1118); no target restriction. Stays LAST — the check order here is the
  // first-error contract for a multiply-invalid request.
  const sessionIdError = validateSessionId(sessionId);
  if (sessionIdError) return sessionIdError;

  return null;
}

export {
  validateOpaqueDispatchField,
  validateSessionId,
  validateDispatchPayload,
  MAX_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_URL_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_SESSION_ID_LENGTH,
  UUID_REGEX,
  DANGEROUS_CHARS_REGEX,
  STRICT_CONTROL_CHARS_REGEX,
  RESERVED_SESSION_ID
};
