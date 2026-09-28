/**
 * Shared feedback-body validation for the dispatch and runner feedback routes
 * (LIN-3035, extracted for LIN-3130 S2a).
 *
 * This is the single source of truth for the `message`/`url`/`urlLabel`/`kind`/
 * `rootItemId` checks that `POST /api/dispatch/feedback/:itemId` already
 * enforced; the runner feedback route reuses it rather than forking the rules.
 * Extracted verbatim — validation ORDER, error strings and the returned payload
 * shape are unchanged, and the missing shapes stay `{ error }` so callers map
 * them onto their existing 100-level `badRequest.json` contract.
 */

import { FEEDBACK_ENTRY_KINDS } from './dispatch-store.js';

const MAX_NAME_LENGTH = 1000;          // Names/labels/titles
const MAX_URL_LENGTH = 8000;           // URLs (covers long query strings)
const MAX_FEEDBACK_MESSAGE_LENGTH = 2000; // Feedback message
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pattern to detect null bytes and dangerous control characters (except common whitespace)
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Validates a feedback request body. Returns `{ value }` with the sanitized
 * payload on success, or `{ error }` with the caller-facing 400 message on
 * failure. The route decides how to emit the error (JSON status, etc.).
 *
 * @param {Object} body - the parsed request body (`req.body`)
 * @returns {{value: {message: string, url: string|null, urlLabel: string|null, kind: string|undefined, rootItemId: string|undefined}}|{error: string}}
 */
export function validateFeedbackBody(body) {
  const { message, url, urlLabel, kind, rootItemId } = body;

  // Additive, tolerant validation (LIN-1297): an invalid kind/rootItemId is
  // silently dropped, never rejected — mirrors the existing tolerate-unknown-
  // keys behavior for this route. `kind` here is the feedback-ENTRY vocabulary
  // (FEEDBACK_ENTRY_KINDS), distinct from the dispatch-item DISPATCH_KINDS.
  const sanitizedKind = typeof kind === 'string' && FEEDBACK_ENTRY_KINDS.includes(kind) ? kind : undefined;
  const sanitizedRootItemId = typeof rootItemId === 'string' && UUID_REGEX.test(rootItemId) ? rootItemId : undefined;

  // Validate required fields
  if (!message || typeof message !== 'string') {
    return { error: 'message is required and must be a string' };
  }

  // Validate lengths
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    return { error: `message exceeds maximum length of ${MAX_FEEDBACK_MESSAGE_LENGTH}` };
  }
  if (url && url.length > MAX_URL_LENGTH) {
    return { error: `url exceeds maximum length of ${MAX_URL_LENGTH}` };
  }
  if (urlLabel && urlLabel.length > MAX_NAME_LENGTH) {
    return { error: `urlLabel exceeds maximum length of ${MAX_NAME_LENGTH}` };
  }

  // Reject dangerous characters
  if (DANGEROUS_CHARS_REGEX.test(message)) {
    return { error: 'message contains invalid characters' };
  }
  if (urlLabel && DANGEROUS_CHARS_REGEX.test(urlLabel)) {
    return { error: 'urlLabel contains invalid characters' };
  }

  // Block javascript: and other dangerous URL schemes
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { error: 'url must use http or https protocol' };
      }
    } catch {
      return { error: 'url must be a valid URL' };
    }
  }

  // LIN-2891/LIN-3035: kind:'decision-withdrawn' carries its own required
  // shape — `message` must be JSON `{decision_id, reason}`, both non-empty
  // (trimmed) strings — validated HERE, immediately before the sole
  // production addFeedback call below, so a malformed payload returns 400
  // instead of silently landing kind-less (the merge-order hazard the
  // `:100` sanitize test guards for every OTHER unrecognized/rejected kind).
  if (sanitizedKind === 'decision-withdrawn') {
    let parsedWithdrawal;
    try {
      parsedWithdrawal = JSON.parse(message);
    } catch {
      return { error: 'message must be valid JSON for kind:"decision-withdrawn"' };
    }
    const decisionId = parsedWithdrawal?.decision_id;
    const reason = parsedWithdrawal?.reason;
    if (
      typeof decisionId !== 'string' || decisionId.trim().length === 0 ||
      typeof reason !== 'string' || reason.trim().length === 0
    ) {
      return { error: 'kind:"decision-withdrawn" requires a non-empty decision_id and reason' };
    }
  }

  return {
    value: {
      message,
      url: url || null,
      urlLabel: urlLabel || null,
      kind: sanitizedKind,
      rootItemId: sanitizedRootItemId
    }
  };
}
