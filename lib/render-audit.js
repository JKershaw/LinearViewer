/**
 * Operator Dashboard Renderer
 *
 * Generates HTML for the /audit operator dashboard page.
 * Maintains the CLI aesthetic while adding dashboard functionality.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';

/**
 * Options for renderAuditPage
 * @typedef {Object} AuditPageOptions
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [deployInfo.version] - HEROKU_RELEASE_VERSION
 * @property {string} [deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT
 * @property {string} [deployInfo.commit] - HEROKU_BUILD_COMMIT
 * @property {string} [urlKey] - Current workspace URL key for generating links
 * @property {'oauth'|'env'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {import('./workspace.js').Workspace[]} [workspaces] - Array of connected workspaces
 */

/**
 * Renders the operator dashboard page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {AuditPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderAuditPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options

  // Generate workspace-aware URLs
  const apiAuditUrl = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/api/audit` : '/api/audit'

  // Unified navigation bar
  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'audit', featureFlags })

  // Footer with deploy info and navigation links
  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/audit',
    urlKey,
    openRouterSource,
    featureFlags
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(workspaceName)} - Operator Dashboard</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/common-actions.css">
  <link rel="stylesheet" href="/audit.css">
</head>
<body data-api-audit-url="${apiAuditUrl}">
  ${navBarHtml}
  <header>
    <h1>Operator Dashboard</h1>
    <p class="dashboard-subtitle">Workspace audit and health check</p>
  </header>

  <main>
    <section class="audit-controls">
      <button id="run-audit" class="audit-button">Run Audit</button>
      <span id="audit-status" class="audit-status"></span>
    </section>

    <section id="audit-report" class="audit-report hidden">
      <!-- Report will be rendered here by JavaScript -->
    </section>

    <section id="audit-error" class="audit-error hidden">
      <!-- Error message will be rendered here -->
    </section>
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by audit.js and app.js -->
  <script src="/common.js"></script>
  <script src="/app.js"></script>
  <script src="/audit.js"></script>
</body>
</html>`;
}
