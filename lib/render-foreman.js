/**
 * Foreman Page Renderer
 *
 * Generates HTML for the /foreman page.
 * Displays: playbook prompt with copy/+proxy, status log, stack preview.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';

/**
 * Renders the foreman page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {Object} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderForemanPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'foreman', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/foreman',
    urlKey,
    openRouterSource,
    featureFlags
  });

  const encodedUrlKey = escapeHtml(urlKey);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(workspaceName)} - Foreman</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/common-actions.css">
  <link rel="stylesheet" href="/foreman.css">
</head>
<body>
  ${navBarHtml}
  <header>
    <h1>Foreman <span class="foreman-experimental">experimental</span></h1>
    <p class="foreman-subtitle">Autonomous task runner — works through your Linear task stack</p>
  </header>

  <main>
    <section class="foreman-section">
      <h2 class="foreman-section-header">Playbook</h2>
      <p class="foreman-hint">Select a read-write token, then copy the playbook prompt into a Claude session. The agent will work through tasks autonomously.</p>
      <div class="foreman-playbook-box" data-url-key="${encodedUrlKey}">
        <div class="foreman-playbook-controls">
          <select class="foreman-token-select" id="foreman-token-select" data-url-key="${encodedUrlKey}">
            <option value="">Loading tokens...</option>
          </select>
          <button class="action-btn save" id="foreman-copy-btn" disabled>copy</button>
          ${featureFlags.proxy === true ? `
            <button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>` : ''}
          <span class="foreman-playbook-feedback" id="foreman-playbook-feedback"></span>
        </div>
        <pre class="foreman-playbook-output" id="foreman-playbook-output">Select a token to load the playbook</pre>
      </div>
    </section>

    <section class="foreman-section">
      <h2 class="foreman-section-header">Status Log <button class="action-btn foreman-refresh" id="foreman-status-refresh">refresh</button></h2>
      <div class="foreman-status-list" id="foreman-status-list" data-url-key="${encodedUrlKey}">
        <div class="foreman-status-loading">Loading status...</div>
      </div>
    </section>

    <section class="foreman-section">
      <h2 class="foreman-section-header">Stack Preview <button class="action-btn foreman-refresh" id="foreman-stack-refresh">refresh</button></h2>
      <p class="foreman-hint">Top 5 tasks the foreman would work through, sorted by priority.</p>
      <div class="foreman-stack-list" id="foreman-stack-list" data-url-key="${encodedUrlKey}">
        <div class="foreman-stack-loading">Loading stack...</div>
      </div>
    </section>
  </main>
  ${footerHtml}
  <script src="/common.js"></script>
  <script src="/app.js"></script>
  <script src="/foreman.js"></script>
</body>
</html>`;
}
