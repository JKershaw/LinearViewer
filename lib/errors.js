/**
 * Error response helpers for consistent error formatting.
 *
 * Pattern:
 * - User-facing routes → HTML error pages
 * - API routes (/api/*) → JSON responses
 */

import { escapeHtml } from './utils/html.js';

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${status} - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="container">
    <h1>Error ${status}</h1>
    <p><strong>${escapeHtml(title)}</strong></p>
    <p>${escapeHtml(message)}</p>
    <p><a href="/">← Back to home</a></p>
  </main>
</body>
</html>`;
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
