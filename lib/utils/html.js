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
 * Base64-encoded PNG favicon for the site — the Harbour anchor mark (32×32).
 * Inlined as a data URI so every page renderer gets the brand icon with no
 * extra request; the sized PNG / .ico / apple-touch fallbacks live in
 * `public/logo/` and are wired in `lib/components/page.js`.
 * Source asset: harbour-cat `website/public/logo/favicon-32x32.png` (LIN-723).
 */
export const FAVICON_BASE64 = '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';
