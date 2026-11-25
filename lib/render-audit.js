/**
 * Operator audit page renderer
 *
 * Generates HTML for the /audit operator page (formerly "Operator Dashboard"; LIN-4565 names it by its place).
 * Maintains the CLI aesthetic while adding dashboard functionality.
 */

import { escapeHtml } from './utils/html.js';
import { renderFrame } from './components/frame.js';

/**
 * Options for renderAuditPage
 * @typedef {Object} AuditPageOptions
 * @property {Object} [deployInfo] - Deploy information (see lib/deploy-info.js)
 * @property {string} [deployInfo.version] - DEPLOY_VERSION
 * @property {string} [deployInfo.createdAt] - DEPLOY_CREATED_AT (ISO-8601)
 * @property {string} [deployInfo.commit] - DEPLOY_COMMIT / RAILWAY_GIT_COMMIT_SHA
 * @property {string} [urlKey] - Current workspace URL key for generating links
 * @property {'oauth'|'env'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {import('./workspace.js').Workspace[]} [workspaces] - Array of connected workspaces
 */

/**
 * Renders the Operator audit page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {AuditPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderAuditPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options

  // Generate workspace-aware URLs
  const apiAuditUrl = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/api/audit` : '/api/audit'

  // LIN-4565 (LIN-4342 piece 4): the page sits in the frame as Operator audit, drilled in under Settings (lib/places.js):
  // Settings is lit and "← Settings" is the way back. Its name is the h1, the band and the tab.
  return renderFrame({
    place: 'audit',
    subtitle: 'Workspace audit and health check',
    urlKey,
    workspaceName,
    workspaces,
    featureFlags,
    openRouterSource,
    deployInfo,
    stylesheets: ['/style.css', '/common-actions.css', '/audit.css'],
    bodyAttrs: `data-api-audit-url="${escapeHtml(apiAuditUrl)}"`,
    scripts: ['/common.js', { module: '/app.js' }, '/audit.js'],
    content: `    <section class="audit-controls">
      <button id="run-audit" class="audit-button">Run Audit</button>
      <span id="audit-status" class="audit-status"></span>
    </section>

    <section id="audit-report" class="audit-report hidden">
      <!-- Report will be rendered here by JavaScript -->
    </section>

    <section id="audit-error" class="audit-error hidden">
      <!-- Error message will be rendered here -->
    </section>`
  });
}
