/**
 * Shared head metadata for public pages (LIN-3980, outcome 8): the description,
 * canonical and social-preview tags. The Library and the landing both emit
 * these, so a shared link previews the same way on either.
 */

import { escapeHtml } from '../utils/html.js';

/** The share image committed under public/logo (1200×630; scrapers reject SVG). */
export const SOCIAL_IMAGE_PATH = '/logo/og-image.png';

/**
 * @param {string} canonicalUrl - absolute canonical URL
 * @returns {string} `<link rel="canonical">`, or '' when there is no URL
 */
export function canonicalTag(canonicalUrl) {
  return canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : '';
}

/**
 * @param {string} summary
 * @returns {string} `<meta name="description">`, or '' when there is no summary
 */
export function descriptionTag(summary) {
  return summary ? `<meta name="description" content="${escapeHtml(summary)}">` : '';
}

/**
 * Open Graph and Twitter card tags for a shared-link preview. The URL and the
 * image must be absolute for a scraper to fetch them, so without an `origin`
 * those two tags are left out, and only the title and description remain.
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string|null} [opts.origin] - e.g. `https://harbour.cat`, or null
 * @param {string} [opts.path] - the page's path under the origin
 * @returns {string} tags, one per line, for the `<head>`
 */
export function socialPreviewTags({ title, description = '', origin = null, path = '/' }) {
  const lines = [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    '<meta property="og:type" content="website">',
  ];
  if (description) lines.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
  if (origin) {
    lines.push(`<meta property="og:url" content="${escapeHtml(origin + path)}">`);
    lines.push(`<meta property="og:image" content="${escapeHtml(origin + SOCIAL_IMAGE_PATH)}">`);
    lines.push('<meta name="twitter:card" content="summary_large_image">');
  }
  return lines.join('\n  ');
}
