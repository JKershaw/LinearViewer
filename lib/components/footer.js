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
 * Renders AI status indicator for the footer.
 * @param {'oauth'|'env'|'free'|null} source - Source of OpenRouter API key
 * @param {string|null} urlKey - Current workspace URL key for settings link
 * @returns {string} HTML for AI status indicator
 */
function renderAiStatus(source, urlKey) {
  let statusClass, statusText, statusIcon;
  if (source === 'oauth') {
    statusClass = 'connected';
    statusText = 'connected';
    statusIcon = '●';
  } else if (source === 'env') {
    statusClass = 'env';
    statusText = 'env';
    statusIcon = '●';
  } else if (source === 'free') {
    statusClass = 'free';
    statusText = 'free tier';
    statusIcon = '●';
  } else {
    statusClass = 'disconnected';
    statusText = 'off';
    statusIcon = '○';
  }

  const settingsUrl = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/settings` : '/settings';

  // For free tier, show a span that will be updated client-side with remaining count
  if (source === 'free') {
    return `<a href="${settingsUrl}" class="footer-ai-status ${statusClass}" data-ai-source="free" title="OpenRouter: ${statusText}">ai: ${statusIcon} free</a>`;
  }

  return `<a href="${settingsUrl}" class="footer-ai-status ${statusClass}" title="OpenRouter: ${statusText}">ai: ${statusIcon}</a>`;
}

/**
 * Get navigation links for the footer with workspace prefix.
 * @param {string|null} urlKey - Current workspace URL key
 * @returns {Array<{href: string, text: string}>} Array of link objects
 */
function getFooterLinks(urlKey) {
  const prefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : '';
  return [
    { href: `${prefix}/settings`, text: 'settings' },
    { href: `${prefix}/prompts`, text: 'prompts' },
    { href: `${prefix}/audit`, text: 'audit' }
  ];
}

/**
 * Renders the page footer with navigation links and deploy info.
 *
 * @param {Object} options - Footer options
 * @param {Object} [options.deployInfo] - Heroku deploy information
 * @param {boolean} [options.isLanding] - If true, hide all action links (unauthenticated)
 * @param {boolean} [options.showReset] - If true, show reset link (main dashboard only)
 * @param {string} [options.currentPage] - Current page path (e.g., '/settings') to show in bold
 * @param {string} [options.urlKey] - Current workspace URL key for generating links
 * @param {'oauth'|'env'|null} [options.openRouterSource] - Source of OpenRouter API key
 * @returns {string} HTML for footer
 */
export function renderPageFooter(options = {}) {
  const { deployInfo = {}, isLanding = false, showReset = false, currentPage = null, urlKey = null, openRouterSource = null } = options;

  const deployHtml = renderDeployInfo(deployInfo);

  // Build links HTML with separators (hidden for landing page)
  let linksHtml = '';
  if (!isLanding) {
    const linkElements = [];

    // Add reset link first if requested (client-side action, not navigation)
    if (showReset) {
      linkElements.push('<a href="#" class="footer-action reset-view">reset</a>');
    }

    // Get links with workspace prefix
    const footerLinks = getFooterLinks(urlKey);

    // Add navigation links (current page in bold, others as links)
    // For currentPage matching, compare normalized paths (without workspace prefix)
    const normalizedCurrentPage = currentPage?.replace(/^\/workspace\/[^/]+/, '') || currentPage;
    footerLinks.forEach(link => {
      const normalizedLinkPath = link.href.replace(/^\/workspace\/[^/]+/, '');
      if (normalizedLinkPath === normalizedCurrentPage) {
        linkElements.push(`<strong class="footer-current">${escapeHtml(link.text)}</strong>`);
      } else {
        linkElements.push(`<a href="${escapeHtml(link.href)}" class="footer-action">${escapeHtml(link.text)}</a>`);
      }
    });

    linksHtml = `
    <div class="footer-actions">
      ${linkElements.join(' · ')}
    </div>`;
  }

  // AI status (only for authenticated users)
  const aiStatusHtml = !isLanding ? renderAiStatus(openRouterSource, urlKey) : '';
  const deployParts = [aiStatusHtml, deployHtml].filter(Boolean).join(' · ');

  return `
  <footer class="page-footer">
    ${linksHtml}
    <div class="footer-deploy">${deployParts}</div>
  </footer>`;
}
