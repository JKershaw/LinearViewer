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
  }
};

/**
 * Map a workspace-resolution failure `reason` to the structured envelope.
 * `context` carries only the public workspace slug — the privacy boundary
 * (same discipline as lib/kpi-stats.js): never accessToken / openRouterApiKey /
 * proxy-token bytes / workspace content. An unrecognised reason falls back to a
 * safe non-retryable `internal` envelope rather than leaking anything.
 *
 * @param {string} reason - one of store_unreachable | session_expired | not_connected
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
