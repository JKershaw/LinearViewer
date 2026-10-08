/**
 * Route-boundary redaction of the live bootstrap token for session-readable
 * dispatch responses (LIN-3384 / LIN-2954 S1.5).
 *
 * A claude-code row carries a live, single-use `bootstrapToken` (structured
 * field); a prose-mode row carries the same credential as an
 * `Authorization: Bearer <token>` line inside `prompt`. Only the runner
 * (poll/take) may receive it. Session-readable routes (queue list, history,
 * trim, proxy prompt read) call these helpers on the way out.
 *
 * Deliberately NOT done in the store: `_formatItem` also feeds poll/take, which
 * must stay token-bearing, so the store formatter cannot be the redaction point.
 */

import { SECRET_RULES } from './secret-scan.js';

export const REDACTED_TOKEN_PLACEHOLDER = '[REDACTED-BOOTSTRAP-TOKEN]';

const BOOTSTRAP_RULE = SECRET_RULES.find(r => r.id === 'harbour-bootstrap-token');

/**
 * Null-safe ownership: the reader owns the row only when both identities are
 * present, non-empty strings and equal. A bare `a === b` would treat
 * `null === null` (ownerless row, anonymous reader) as an owner match.
 *
 * @param {{dispatchedBy?: *}} item
 * @param {*} callerId
 * @returns {boolean}
 */
export function isItemOwner(item, callerId) {
  const by = item?.dispatchedBy;
  return typeof by === 'string' && by !== '' && typeof callerId === 'string' && callerId !== '' && by === callerId;
}

/**
 * Mask every bootstrap-token match in a prompt, leaving the rest intact.
 * Over-masking is acceptable; under-masking is not, so the shared rule's
 * `validate` (entropy/placeholder filter) is deliberately not applied.
 */
export function maskBootstrapTokens(prompt) {
  if (typeof prompt !== 'string' || !BOOTSTRAP_RULE) return prompt;
  // The shared rule is /g (stateful lastIndex) — always use a fresh clone.
  const re = new RegExp(BOOTSTRAP_RULE.regex.source, BOOTSTRAP_RULE.regex.flags);
  return prompt.replace(re, (match, token) => match.replace(token, REDACTED_TOKEN_PLACEHOLDER));
}

/**
 * Redact one session-visible dispatch item: `bootstrapToken` → null always;
 * `prompt` masked unless the caller is the row's own dispatcher. All other
 * fields are preserved. Returns the input untouched when it is not an object.
 */
export function redactSessionItem(item, callerId) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  if ('bootstrapToken' in out) out.bootstrapToken = null;
  if (typeof out.prompt === 'string' && !isItemOwner(item, callerId)) {
    out.prompt = maskBootstrapTokens(out.prompt);
  }
  return out;
}

export function redactSessionItems(items, callerId) {
  return Array.isArray(items) ? items.map(i => redactSessionItem(i, callerId)) : items;
}
