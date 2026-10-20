/**
 * Validation for dispatch requests: the opaque execution fields (`model`,
 * `harness`, `terminal`, `effort`), `sessionId`, the shared payload check both
 * main dispatch handlers run, and the small "entrance" predicates the routes
 * call at their own positions. One home for each rule so the entrances cannot
 * drift apart (LIN-1084, LIN-1139, LIN-3487).
 *
 * Every check returns `{ error }` (or the bare message for the entrance
 * predicates) and never writes a response: each caller keeps its own reject
 * and logging behaviour.
 */

import { isValidIssueId } from './workspace.js';
import { SESSION_TARGETS } from './dispatch-targets.js';
import { validateRunField } from './dispatch-fields.js';
import { isValidDispatchKind, DISPATCH_KINDS } from './prompt-templates.js';
import { getPeriodicals } from './periodicals.js';
import { AUTOPILOT_VARIANTS } from './prompts/autopilot-kickoff.js';

const MAX_NAME_LENGTH = 1000;
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// Length caps that keep a request under Mongo's 16MB document limit. These are
// the caps both main dispatch handlers once hand-rolled separately (LIN-1139).
const MAX_PROMPT_LENGTH = 10000000;    // 10MB max for prompt content
const MAX_URL_LENGTH = 8000;           // URLs (covers long query strings)
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers
// The shape of an id Harbour mints itself (dispatch item ids, dispatch token ids).
// The one home for it: the routes and lib files that check such ids import this.
// `lib/workspace.js` keeps its own `UUID_REGEX` for provider ids, a separate rule
// that happens to match today.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `sessionId` is an opaque grouping key, so it takes any string, but a tighter
// one than MAX_NAME_LENGTH (LIN-1118): it becomes a Mongo `_id` PREFIX via
// `${urlKey}:${sessionId}` and `urlKey` is capped at 50, so 128 keeps the
// composed key at 179 bytes, far under the 1024-byte `_id` index-key limit.
const MAX_SESSION_ID_LENGTH = 128;

// The full C0 set INCLUDING \t \n \r. DANGEROUS_CHARS_REGEX permits those three
// because it also guards `prompt`, where newlines are essential; that rule is
// wrong for an identifier, so this one is scoped to `sessionId` only (LIN-1118).
const STRICT_CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

// Reserved: `_sessionDocId(urlKey, '__meta__')` collides exactly with
// `_metaDocId(urlKey)` in lib/observation-sessions-store.js, and an upsert would
// $set `type: 'session'` over the backfill marker's `type: 'meta'`. The marker
// then reads as absent and the workspace re-fans the full backfill every poll,
// silently.
const RESERVED_SESSION_ID = '__meta__';

// Known `effort` levels (LIN-2615). Used ONLY for a server-side console.warn on
// an out-of-set value, never to reject: Claude Code itself warns and runs on an
// unknown `--effort`, so Harbour must not be stricter than what it forwards to.
const DISPATCH_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Validates an opaque dispatch execution field (e.g. `model`, `harness`).
 * `undefined`/`null` are "absent" and always valid: the field is optional and
 * nullable at every seam it flows through.
 *
 * `reportReceivedLength` (default `false`) appends the received length to the
 * length message, e.g. `repo exceeds maximum length of 1000 (got 1247)`. Off by
 * default so existing call sites' messages stay byte-identical (LIN-2075).
 *
 * @param {*} value
 * @param {string} fieldName - Used in the returned error message
 * @param {{maxLength?: number, reportReceivedLength?: boolean}} [options]
 * @returns {{error: string}|null}
 */
function validateOpaqueDispatchField(
  value,
  fieldName,
  { maxLength = MAX_NAME_LENGTH, reportReceivedLength = false } = {}
) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return { error: `${fieldName} must be a string` };
  if (value.length > maxLength) {
    const received = reportReceivedLength ? ` (got ${value.length})` : '';
    return { error: `${fieldName} exceeds maximum length of ${maxLength}${received}` };
  }
  if (DANGEROUS_CHARS_REGEX.test(value)) return { error: `${fieldName} contains invalid characters` };
  return null;
}

/**
 * Validates a caller-supplied `sessionId` (LIN-1118).
 *
 * It is an OPAQUE grouping key, never parsed: storage writes it blind, grouping
 * compares it by string equality, and the observation store uses it as a
 * document-key suffix. So the rule is a pure relaxation of the old UUID-only
 * check (every UUID that passed still passes), which lets callers use
 * deterministic ids like `LIN-1117-autopilot-standalone-2026-07-07`. `:` is
 * deliberately allowed: `urlKey` is `[a-z0-9-]{1,50}` and cannot contain one, so
 * the `${urlKey}:${sessionId}` prefix is unambiguous and nothing splits it back.
 *
 * `undefined`/`null` are "absent". An empty string is refused: left accepted it
 * would be coerced to `null` at the store, turning a typo that fails loudly into
 * a silent no-op.
 *
 * @param {*} value
 * @returns {{error: string}|null}
 */
function validateSessionId(value) {
  if (value === undefined || value === null) return null;
  const opaqueError = validateOpaqueDispatchField(value, 'sessionId', { maxLength: MAX_SESSION_ID_LENGTH });
  if (opaqueError) return opaqueError;
  if (value.length === 0) return { error: 'sessionId must not be empty' };
  if (STRICT_CONTROL_CHARS_REGEX.test(value)) return { error: 'sessionId contains invalid characters' };
  if (value === RESERVED_SESSION_ID) return { error: 'sessionId must not be a reserved value' };
  return null;
}

// Entrance predicates (LIN-3487). Each returns the reject message or null and is
// called by the entrances at the position the check always had, so first-error
// order and each caller's logging are unchanged. They live here, not in
// dispatch-fields.js, because they need the prompt-template and periodical
// registries and the store imports dispatch-fields.js. Each is a one-line
// predicate with its own absent rule; a shared table would be longer, not simpler.

const isAbsent = (value) => value === undefined || value === null;

/** `abort` and `followUpTo` are mutually exclusive verbs. A `null` followUpTo is absent. */
function abortFollowUpError({ isAbort, followUpTo }) {
  return isAbort && !isAbsent(followUpTo) ? 'abort and followUpTo are mutually exclusive' : null;
}

/** `abortTo` is a required UUID with abort and refused without it. A `null` abortTo is absent. */
function abortToError({ isAbort, abortTo }) {
  if (!isAbort) return isAbsent(abortTo) ? null : 'abortTo requires abort to be true';
  return abortTo && UUID_REGEX.test(abortTo) ? null : 'abortTo is required and must be a UUID when abort is true';
}

/** `cascade: true` is only meaningful with abort. The type check is `validateRunField('cascade')`. */
function cascadeAbortError({ isAbort, cascade }) {
  return cascade === true && !isAbort ? 'cascade requires abort to be true' : null;
}

/** Only `undefined` is absent; `null` is refused. */
function dispatchKindError(kind) {
  if (kind === undefined || isValidDispatchKind(kind)) return null;
  return `kind must be one of: ${DISPATCH_KINDS.join(', ')}`;
}

/** Registry membership. Only `undefined` is absent; `null` is refused. */
function periodicalIdError(periodicalId) {
  if (periodicalId === undefined || getPeriodicals().some((p) => p.id === periodicalId)) return null;
  return 'periodicalId must be one of the known periodical template ids';
}

/** The shared variant predicate. Each entrance keeps its own absent rule and message. */
function isValidAutopilotVariant(variant) {
  return AUTOPILOT_VARIANTS.includes(variant);
}

/**
 * @param {*} target
 * @param {readonly string[]} allowed - DISPATCH_TARGETS or POLLED_TARGETS
 * Only `undefined` is absent; `null` is refused.
 */
function targetError(target, allowed) {
  if (target === undefined || allowed.includes(target)) return null;
  return `target must be one of: ${allowed.join(', ')}`;
}

/** A well-formed UUID aimed at a cli/web target (an absent target is cli). `null` and `undefined` followUpTo are absent. */
function followUpToError({ followUpTo, target }) {
  if (isAbsent(followUpTo)) return null;
  if (!UUID_REGEX.test(followUpTo)) return 'Invalid followUpTo format';
  return SESSION_TARGETS.includes(target || 'cli') ? null : 'followUpTo is only supported for cli/web targets';
}

// The payload check runs three passes in a fixed order (the first-error contract
// for a request that is wrong in several ways), with the effort warning between
// the second and third. Each pass is a table walked by `firstFailure`.
//
// A pass's value test is the field's truthiness (an abort carries no prompt, and
// `0` or `''` read as absent), and `.length` / `.test()` coerce whatever else
// arrives. Do not normalise the value first: a Symbol must still throw.
const LENGTH_CAPS = [
  ['prompt', MAX_PROMPT_LENGTH],
  ['promptName', MAX_NAME_LENGTH],
  ['issueIdentifier', MAX_IDENTIFIER_LENGTH],
  ['issueTitle', MAX_NAME_LENGTH],
  ['issueUrl', MAX_URL_LENGTH],
  ['repo', MAX_NAME_LENGTH]
];

// Opaque execution fields (LIN-438, LIN-1084, LIN-2452, LIN-2615): type, length
// and dangerous characters only, never checked against a model, harness or
// terminal-driver registry (those belong to the runner).
const OPAQUE_FIELDS = ['model', 'harness', 'terminal', 'effort'];

/**
 * The execution fields' one rule (LIN-3604: written once, for the two caller-supplied bodies
 * above and for the entrances that take only some of the fields): the first opaque failure's text
 * in the order given, else null; then the unknown-effort warning. LIN-2615: an unknown level is
 * logged, never refused, and the log fires even when a later check then fails.
 *
 * @param {Object} body
 * @param {string[]} [fields] - the execution fields the caller takes, in its order
 * @returns {string|null}
 */
function executionFieldError(body, fields = OPAQUE_FIELDS) {
  for (const name of fields) {
    const opaqueError = validateOpaqueDispatchField(body[name], name, { maxLength: MAX_NAME_LENGTH });
    if (opaqueError) return opaqueError.error;
  }
  const { effort } = body;
  if (fields.includes('effort') && effort && !DISPATCH_EFFORT_LEVELS.includes(effort)) {
    console.warn(`Unknown dispatch effort level: ${effort}`);
  }
  return null;
}

const CONTROL_CHAR_FIELDS = ['prompt', 'promptName', 'issueTitle', 'repo'];

function firstFailure(body, fields, fails, describe) {
  for (const field of fields) {
    const name = Array.isArray(field) ? field[0] : field;
    const value = body[name];
    if (value && fails(value, field)) return { error: describe(field) };
  }
  return null;
}

/**
 * Request-payload validation shared by the two MAIN dispatch handlers: the
 * user-facing `POST /workspace/:urlKey/api/dispatch` and its proxy-token twin
 * `POST /api/proxy/dispatch`. Both take a caller-supplied prompt, so both run
 * the same length caps, dangerous-character checks, opaque-field validation and
 * id/format/combination rules (LIN-1084, LIN-1139).
 *
 * Only the checks the two handlers share verbatim live here. The call positions
 * that differ (prompt-required, target vocabulary, abort eligibility, cascade,
 * kind, waitForFollowUps, queueIfBusy, subscription, the localhost-only `local`
 * guard) stay in each caller and run BEFORE this, matching the original
 * interleaving. Server-generated paths (kickoff, recommend-and-dispatch,
 * feedback, collective) do not call this: their prompt is trusted.
 *
 * @param {Object} body - The dispatch request body
 * @returns {{error: string}|null} The first validation error, or null when valid
 */
function validateDispatchPayload(body = {}) {
  const { issueId, followUpTo, target, force, cascade, abort, sessionId, ifParked, issueIdentifier } = body;

  const capError = firstFailure(
    body, LENGTH_CAPS,
    (value, [, max]) => value.length > max,
    ([name, max]) => `${name} exceeds maximum length of ${max}`
  );
  if (capError) return capError;

  const executionError = executionFieldError(body);
  if (executionError) return { error: executionError };

  const charError = firstFailure(
    body, CONTROL_CHAR_FIELDS,
    (value) => DANGEROUS_CHARS_REGEX.test(value),
    (name) => `${name} contains invalid characters`
  );
  if (charError) return charError;

  // LIN-3440: the shared provider-agnostic id check, NOT a UUID test (a GitHub
  // issue's id is a plain number, which a UUID-only gate refused). `followUpTo`
  // below stays UUID-only: it names a dispatch item, whose id always is one.
  if (issueId && !isValidIssueId(issueId)) return { error: 'Invalid issueId format' };

  // LIN-415: well-formed UUID plus a cli/web-only target.
  const followUpMessage = followUpToError({ followUpTo, target });
  if (followUpMessage) return { error: followUpMessage };

  // `force` (LIN-559/946/951/1656): a boolean, never with cascade (a cascade
  // emits its own unforced aborts), and only alongside something it can
  // override. That is a followUpTo (the runner's active-session gate), an abort
  // (the runner's human-continued skip), or, since LIN-1656, an issue-scoped
  // fresh dispatch, where it bypasses the duplicate guard. With no
  // issueIdentifier that guard has nothing to key on, the flag would be stored
  // inert, and it is still refused.
  const forceError = validateRunField('force', force);
  if (forceError) return { error: forceError };
  if (force === true && cascade === true) return { error: 'force and cascade are mutually exclusive' };
  if (force === true && abort !== true && isAbsent(followUpTo) && !issueIdentifier) {
    return { error: 'force requires followUpTo, abort, or an issueIdentifier' };
  }

  // LIN-3438: `ifParked` (the parked-only abort) is retired. It is refused, not
  // ignored: an ignored `ifParked:true` would be a plain abort, which can end a
  // running session. Stays before `sessionId` (first-error order).
  if (ifParked !== undefined && ifParked !== false) {
    return { error: 'ifParked is no longer supported: the parked-only abort was retired (LIN-3438)' };
  }

  // LIN-591 / LIN-1118: the autopilot run reference, last by contract.
  return validateSessionId(sessionId);
}

export {
  validateOpaqueDispatchField,
  executionFieldError,
  validateSessionId,
  validateDispatchPayload,
  abortFollowUpError,
  abortToError,
  cascadeAbortError,
  dispatchKindError,
  periodicalIdError,
  isValidAutopilotVariant,
  targetError,
  followUpToError,
  MAX_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_URL_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_SESSION_ID_LENGTH,
  UUID_REGEX,
  DANGEROUS_CHARS_REGEX,
  STRICT_CONTROL_CHARS_REGEX,
  RESERVED_SESSION_ID,
  DISPATCH_EFFORT_LEVELS
};
