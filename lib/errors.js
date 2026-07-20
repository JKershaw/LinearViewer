/**
 * Error response helpers for consistent error formatting.
 *
 * Pattern:
 * - User-facing routes → HTML error pages
 * - API routes (/api/*) → JSON responses
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';

/**
 * Send a JSON error response (for API routes).
 *
 * @param {import('express').Response} res - Express response
 * @param {number} status - HTTP status code
 * @param {string} error - Error message
 * @param {Object} [extra] - Additional fields to include
 * @returns {import('express').Response}
 */
export function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

/**
 * Send an HTML error page (for user-facing routes).
 * Uses a simple, CLI-aesthetic error page.
 *
 * @param {import('express').Response} res - Express response
 * @param {number} status - HTTP status code
 * @param {string} title - Error title
 * @param {string} message - Error message
 * @returns {import('express').Response}
 */
export function htmlError(res, status, title, message) {
  const html = renderPage({
    title: `${status} - ${escapeHtml(title)}`,
    stylesheets: ['/style.css'],
    content: `<main class="container">
    <h1>Error ${status}</h1>
    <p><strong>${escapeHtml(title)}</strong></p>
    <p>${escapeHtml(message)}</p>
    <p><a href="/">← Back to home</a></p>
  </main>`
  });
  return res.status(status).send(html);
}

/**
 * Send a plain text error (simple fallback).
 *
 * @param {import('express').Response} res - Express response
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 * @returns {import('express').Response}
 */
export function textError(res, status, message) {
  return res.status(status).send(message);
}

// =============================================================================
// Common Error Responses
// =============================================================================

/**
 * 400 Bad Request - Invalid input
 */
export const badRequest = {
  json: (res, message = 'Bad request') => jsonError(res, 400, message),
  html: (res, message = 'Bad request') => htmlError(res, 400, 'Bad Request', message),
  text: (res, message = 'Bad request') => textError(res, 400, message)
};

/**
 * 401 Unauthorized - Not authenticated
 */
export const unauthorized = {
  json: (res, message = 'Not authenticated') => jsonError(res, 401, message),
  html: (res) => htmlError(res, 401, 'Unauthorized', 'Please log in to continue.'),
  text: (res, message = 'Not authenticated') => textError(res, 401, message)
};

/**
 * 404 Not Found - Resource not found
 */
export const notFound = {
  json: (res, message = 'Not found') => jsonError(res, 404, message),
  html: (res, message = 'The requested resource was not found.') =>
    htmlError(res, 404, 'Not Found', message),
  text: (res, message = 'Not found') => textError(res, 404, message)
};

/**
 * 500 Internal Server Error
 */
export const serverError = {
  json: (res, message = 'Internal server error', details = null) =>
    jsonError(res, 500, message, details ? { message: details } : {}),
  html: (res, message = 'An unexpected error occurred.') =>
    htmlError(res, 500, 'Server Error', message),
  text: (res, message = 'Internal server error') => textError(res, 500, message)
};

/**
 * 503 Service Unavailable
 */
export const serviceUnavailable = {
  json: (res, message = 'Service temporarily unavailable', details = null) =>
    jsonError(res, 503, message, details ? { message: details } : {}),
  html: (res, message = 'Service temporarily unavailable. Please try again later.') =>
    htmlError(res, 503, 'Service Unavailable', message),
  text: (res, message = 'Service unavailable') => textError(res, 503, message)
};

/**
 * Detect a CLIENT error (4xx) that a thrown error already carries, so the
 * final catch-all middleware can honor it instead of blindly forcing a 500
 * (LIN-1158). The canonical case: body-parser (express.json / the route-scoped
 * 14mb parsers) throws a `SyntaxError` on a malformed body with
 * `type: 'entity.parse.failed'` and `status: 400` (and `entity.too.large` /
 * `status: 413` for an over-limit body). These are client faults, not server
 * faults — surfacing them as 500 misleads callers and floods the logs with
 * bogus "Unhandled route error" stacks.
 *
 * Returns the 4xx status if this is a recognisable client error, else null
 * (so the caller keeps its unchanged 500 path for genuinely unexpected errors).
 *
 * @param {*} err - the caught error
 * @returns {number|null} a 4xx status code, or null if not a client error
 */
export function clientErrorStatus(err) {
  const status = err?.status ?? err?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return status;
  }
  // Body-parser sets `.type` on its errors; treat a parse failure as 400 even
  // if a future version omits the numeric status.
  if (err?.type === 'entity.parse.failed') return 400;
  return null;
}

/**
 * Human-readable message for an honored client-error status (LIN-1158). Names
 * the fault clearly so a caller/agent stops assuming the server or provider is
 * broken. Falls back to a generic "Bad request" for any other 4xx.
 *
 * @param {number} status - the 4xx status
 * @param {*} [err] - the caught error (its `type` refines the message)
 * @returns {string}
 */
export function clientErrorMessage(status, err) {
  if (err?.type === 'entity.parse.failed') return 'Invalid JSON body';
  if (status === 413) return 'Request body too large';
  if (status === 415) return 'Unsupported content type';
  return 'Bad request';
}

// =============================================================================
// Structured Error Envelope (LIN-417)
// =============================================================================

/**
 * Build a structured error envelope so API/proxy consumers — humans and
 * automated operators alike — can make the wait-vs-act call in one read:
 *
 *   { error, code, category, retryable, detail, context }
 *
 * - `error`     human-readable summary (unchanged from the legacy bare body)
 * - `code`      stable, machine-readable identifier to branch on
 * - `category`  one of: upstream | auth | config | internal
 * - `retryable` true → back off and retry; false → escalate to a human
 * - `detail`    human-readable cause
 * - `context`   safe public identifiers ONLY — never tokens, secrets, or content
 *
 * @param {Object} fields
 * @returns {{error: string, code: string, category: string, retryable: boolean, detail: string, context: Object}}
 */
export function errorEnvelope({ error, code, category, retryable, detail, context = {} }) {
  return { error, code, category, retryable, detail, context };
}

/**
 * Classify a thrown error into the structured vocabulary (category / retryable /
 * code / detail) so user-facing pages and logs can tell a transient upstream blip
 * — the connection to Linear dropping mid-request — apart from a real auth failure
 * or an internal bug. This is what lets a route render "couldn't reach Linear, try
 * again" instead of a flat "something went wrong".
 *
 * `detail` is always safe to surface: a short human cause plus the category, never
 * tokens, secrets, or query/response bodies (same privacy discipline as the
 * envelope above). Network failures from Node's native fetch (undici) surface as a
 * `FetchError` whose message contains "Premature close" / "fetch failed", or as a
 * `.cause.code` like ECONNRESET — both map to a retryable `upstream` classification.
 *
 * @param {*} error - the caught error
 * @returns {{code: string, category: string, retryable: boolean, detail: string}}
 */
export function classifyUpstreamError(error) {
  const status = error?.response?.status ?? error?.status;

  if (status === 401 || status === 403) {
    return { code: 'LINEAR_AUTH', category: 'auth', retryable: false,
      detail: 'Linear rejected the request as unauthenticated.' };
  }
  if (status === 429) {
    return { code: 'LINEAR_RATE_LIMITED', category: 'upstream', retryable: true,
      detail: 'Linear rate-limited the request; it should recover shortly.' };
  }
  if (typeof status === 'number' && status >= 500) {
    return { code: 'LINEAR_UPSTREAM_5XX', category: 'upstream', retryable: true,
      detail: `Linear returned a ${status} server error.` };
  }

  // Network / connection failures (undici FetchError, ECONNRESET, "Premature
  // close", DNS hiccups). No HTTP status reaches us — the socket died first.
  if (isNetworkError(error)) {
    return { code: 'LINEAR_UNREACHABLE', category: 'upstream', retryable: true,
      detail: 'The connection to Linear closed before a response arrived — usually transient.' };
  }

  return { code: 'INTERNAL_ERROR', category: 'internal', retryable: false,
    detail: 'An unexpected error occurred while preparing the page.' };
}

/**
 * Does this thrown error look like a transport-level network failure rather than
 * an HTTP response with a status? Native fetch (undici) surfaces these as a
 * `FetchError` whose message contains "Premature close"/"fetch failed", or as a
 * `.cause.code`/`.code` like ECONNRESET. Shared by the Linear classifier and the
 * GitHub diagnostic builder so both treat a dropped socket identically.
 *
 * @param {*} error - the caught error
 * @returns {boolean}
 */
export function isNetworkError(error) {
  const netCode = error?.cause?.code || error?.code;
  const msg = String(error?.message || '');
  return (
    error?.name === 'FetchError' ||
    /premature close|other side closed|fetch failed|socket hang up|terminated|network/i.test(msg) ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
      'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT'].includes(netCode)
  );
}

/**
 * Build a safe diagnostic block ({detail, category, retryable, code, time}) from
 * a thrown GitHub error so the user-facing auth error pages can surface the REAL
 * upstream cause instead of only a generic "Please try again." (LIN-746).
 *
 * GitHub's boundary helpers (lib/providers/github/client.js + app-auth.js) already
 * fold GitHub's own `data.message` into `err.message` and carry the HTTP code on
 * `err.status`; AuthExchangeError carries the specific OAuth error (e.g.
 * 'bad_verification_code') on `.detail` + a stable `.code`. This threads that
 * already-captured detail into the existing `renderErrorPage({ diagnostic })`
 * mechanism (the same block the Linear path renders) — reuse, not new wiring.
 *
 * `detail` is always safe to surface: GitHub's human error message + the HTTP
 * status, never tokens, request bodies, or secrets (the upstream helpers build
 * the message from `data.message`/`statusText`/`HTTP <status>` only). This is
 * deliberately NOT `classifyUpstreamError`, whose wording ("Linear rejected …")
 * is Linear-specific; the status→category mapping mirrors it so the two paths
 * classify auth/upstream/network/internal the same way.
 *
 * @param {*} error - the caught GitHub error
 * @param {string} [time] - ISO timestamp (defaults to now); injected for deterministic tests
 * @returns {{detail: string, category: string, retryable: boolean, code: string, time: string}}
 */
export function githubErrorDiagnostic(error, time = new Date().toISOString()) {
  const status = error?.response?.status ?? error?.status;
  // AuthExchangeError carries the specific upstream cause on `.detail`
  // (e.g. 'bad_verification_code'); otherwise the message already folds in
  // GitHub's `data.message`. Always non-empty so the block renders a Reason row.
  const detail = String(error?.detail || error?.message || '').trim()
    || 'GitHub returned an error without a detail message.';

  let category, retryable;
  if (status === 401 || status === 403) {
    category = 'auth'; retryable = false;
  } else if (status === 429) {
    category = 'upstream'; retryable = true;
  } else if (typeof status === 'number' && status >= 500) {
    category = 'upstream'; retryable = true;
  } else if (isNetworkError(error)) {
    category = 'upstream'; retryable = true;
  } else {
    category = 'internal'; retryable = false;
  }

  // Prefer the HTTP status (the operator's anchor) for the Code row; fall back to
  // a structured error code (e.g. AuthExchangeError's 'AUTH_EXCHANGE_FAILED') or a
  // generic marker when no status reached us.
  const code = typeof status === 'number'
    ? `GITHUB_${status}`
    : (error?.code || 'GITHUB_ERROR');

  return { detail, category, retryable, code, time };
}

/**
 * Does this thrown error represent an auth rejection from Linear, so the caller
 * should run its re-auth recovery (token refresh / workspace removal) instead of
 * rendering a generic, dead-end error page?
 *
 * Mirrors `classifyUpstreamError`'s auth detection exactly: a 401 OR 403,
 * surfaced on either `error.response.status` (graphql-request's ClientError) or
 * a bare `error.status`. The historical route guards matched only
 * `error.response?.status === 401`, so a 403 — or a 401 that landed on
 * `error.status` — slipped past the recovery path and dead-ended on the error
 * page with a "Try again" button that just re-hit the same auth failure.
 *
 * @param {*} error - the caught error
 * @returns {boolean}
 */
export function isAuthError(error) {
  return classifyUpstreamError(error).category === 'auth';
}

/**
 * Reason → envelope mapping for workspace-resolution failures (LIN-417).
 * The HTTP status stays 503 in every case; only the body gains structure.
 * Keyed by the `reason` produced by `resolveWorkspaceAccess` in server.js.
 */
const WORKSPACE_UNAVAILABLE_BY_REASON = {
  store_unreachable: {
    code: 'WORKSPACE_STORE_UNAVAILABLE',
    category: 'upstream',
    retryable: true,
    detail: 'Session store unreachable; dyno may be booting after a deploy.'
  },
  session_expired: {
    code: 'WORKSPACE_SESSION_EXPIRED',
    category: 'auth',
    retryable: false,
    detail: 'Workspace session expired; a human needs to re-authenticate.'
  },
  not_connected: {
    code: 'WORKSPACE_NOT_CONNECTED',
    category: 'config',
    retryable: false,
    detail: 'No active session for this workspace; it is not connected.'
  },
  owner_mismatch: {
    code: 'WORKSPACE_OWNER_MISMATCH',
    category: 'config',
    retryable: false,
    // Deliberately hedged (re-review of LIN-1413's first cut): the detector this
    // reason is built on (detectOwnerAccountMismatch) cannot tell "this token's
    // account lost the workspace" apart from "a different, legitimate account on
    // the same workspace happens to be live while this one's session merely
    // lapsed" — both produce the identical signal (owner not live, someone else
    // is). A confident "will not restore it" is provably wrong in the second,
    // reachable case, so the copy must not claim more than the signal supports.
    detail: 'A different account holds a live session for this workspace while this token\'s own account does not. Re-authenticating may not restore it — if it does not, a new token must be issued from the account that currently holds the workspace.'
  }
};

/**
 * Map a workspace-resolution failure `reason` to the structured envelope.
 * `context` carries only the public workspace slug — the privacy boundary
 * (same discipline as lib/kpi-stats.js): never accessToken / openRouterApiKey /
 * proxy-token bytes / workspace content. An unrecognised reason falls back to a
 * safe non-retryable `internal` envelope rather than leaking anything.
 *
 * @param {string} reason - one of store_unreachable | session_expired | not_connected | owner_mismatch
 * @param {string} workspaceUrlKey - public workspace slug (req.proxyUrlKey)
 * @returns {Object} the structured error envelope (HTTP status stays 503)
 */
export function workspaceUnavailableEnvelope(reason, workspaceUrlKey) {
  const mapped = WORKSPACE_UNAVAILABLE_BY_REASON[reason] || {
    code: 'WORKSPACE_UNAVAILABLE',
    category: 'internal',
    retryable: false,
    detail: 'Workspace not available.'
  };
  return errorEnvelope({
    error: 'Workspace not available',
    code: mapped.code,
    category: mapped.category,
    retryable: mapped.retryable,
    detail: mapped.detail,
    context: { workspaceUrlKey }
  });
}
