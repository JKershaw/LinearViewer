/**
 * Shared Footer Component
 *
 * Renders the page footer with deploy info and navigation links.
 * Used by all pages: Dashboard, Settings, Prompts, and Audit.
 */

import { escapeHtml } from '../utils/html.js';

/**
 * Renders deploy information HTML.
 * @param {Object} deployInfo - Heroku deploy information
 * @param {string} [deployInfo.version] - HEROKU_RELEASE_VERSION
 * @param {string} [deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT
 * @param {string} [deployInfo.commit] - HEROKU_BUILD_COMMIT
 * @returns {string} HTML for deploy info
 */
function renderDeployInfo(deployInfo = {}) {
  if (deployInfo.version) {
    const parts = [];

    // Version (e.g., "v42")
    parts.push(deployInfo.version);

    // Deploy date/time - render with data attribute for client-side local timezone formatting
    if (deployInfo.createdAt) {
      const date = new Date(deployInfo.createdAt);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const fallbackText = `deployed ${months[date.getMonth()]} ${date.getDate()}`;
      parts.push(`<span class="deploy-time" data-timestamp="${escapeHtml(deployInfo.createdAt)}">${fallbackText}</span>`);
    }

    // Commit hash linked to GitHub (e.g., "abc123")
    if (deployInfo.commit) {
      const shortCommit = deployInfo.commit.slice(0, 7);
      parts.push(`<a href="https://github.com/JKershaw/LinearViewer/commit/${escapeHtml(deployInfo.commit)}" target="_blank" class="footer-link">${escapeHtml(shortCommit)}</a>`);
    }

    return parts.join(' · ');
  }

  // Fallback: link to GitHub repo
  return '<a href="https://github.com/JKershaw/LinearViewer" target="_blank" class="footer-link">github.com/JKershaw/LinearViewer</a>';
}

/**
 * @typedef {Object} FooterLink
 * @property {string} href - Link URL
 * @property {string} text - Link text
 */

/**
 * Renders the page footer with navigation links and deploy info.
 *
 * @param {Object} options - Footer options
 * @param {FooterLink[]} [options.links] - Navigation links to display
 * @param {Object} [options.deployInfo] - Heroku deploy information
 * @param {boolean} [options.isLanding] - If true, hide all action links (unauthenticated)
 * @param {boolean} [options.showReset] - If true, show reset link (main dashboard only)
 * @returns {string} HTML for footer
 */
export function renderPageFooter(options = {}) {
  const { links = [], deployInfo = {}, isLanding = false, showReset = false } = options;

  const deployHtml = renderDeployInfo(deployInfo);

  // Build links HTML with separators (hidden for landing page)
  let linksHtml = '';
  if (!isLanding && links.length > 0) {
    const linkElements = [];

    // Add reset link first if requested (client-side action, not navigation)
    if (showReset) {
      linkElements.push('<a href="#" class="footer-action reset-view">reset</a>');
    }

    // Add navigation links
    links.forEach(link => {
      linkElements.push(`<a href="${escapeHtml(link.href)}" class="footer-action">${escapeHtml(link.text)}</a>`);
    });

    linksHtml = `
    <div class="footer-actions">
      ${linkElements.join(' · ')}
    </div>`;
  }

  return `
  <footer class="page-footer">
    ${linksHtml}
    <div class="footer-deploy">${deployHtml}</div>
  </footer>`;
}

/**
 * Standard footer links for the Settings page.
 */
export const SETTINGS_FOOTER_LINKS = [
  { href: '/prompts', text: 'prompts' },
  { href: '/fancy', text: 'audit' }
];

/**
 * Standard footer links for the Prompts page.
 */
export const PROMPTS_FOOTER_LINKS = [
  { href: '/settings', text: 'settings' },
  { href: '/fancy', text: 'audit' }
];

/**
 * Standard footer links for the Audit page.
 */
export const AUDIT_FOOTER_LINKS = [
  { href: '/settings', text: 'settings' },
  { href: '/prompts', text: 'prompts' }
];
