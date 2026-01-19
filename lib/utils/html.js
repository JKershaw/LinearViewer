/**
 * HTML Utility Functions
 *
 * Shared utilities for HTML rendering across the application.
 */

/**
 * Escapes HTML entities to prevent XSS attacks.
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML-safe string
 */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Base64-encoded SVG favicon for the site.
 * Used across all page renderers for consistent branding.
 */
export const FAVICON_BASE64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjI2IiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHBhdGggZD0iTTMgMTB2MTJoNiIgc3Ryb2tlPSIjMjIyIiBzdHJva2Utd2lkdGg9IjQiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjEzIiBjeT0iMjIiIHI9IjMuNSIgZmlsbD0iIzIyMiIvPjxyZWN0IHg9IjE4IiB5PSIxMiIgd2lkdGg9IjExIiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHJlY3QgeD0iMTgiIHk9IjIwIiB3aWR0aD0iOSIgaGVpZ2h0PSI0IiByeD0iMSIgZmlsbD0iIzIyMiIvPjwvc3ZnPg==';
