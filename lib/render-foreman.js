/**
 * Foreman Page Renderer
 *
 * Generates HTML for the /foreman page.
 * Displays: onboarding strip, playbook prompt with copy/+proxy, status log, stack preview.
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
  const proxyUrl = `/workspace/${encodedUrlKey}/proxy`;

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
    <ol class="foreman-onboarding" aria-label="How to use foreman">
      <li><span class="foreman-onboarding-num">1</span> Generate a read-write token (below, or on the <a href="${proxyUrl}">proxy page</a>)</li>
      <li><span class="foreman-onboarding-num">2</span> Copy the playbook prompt into a Claude session</li>
      <li><span class="foreman-onboarding-num">3</span> Watch progress below as the agent reports status</li>
    </ol>

    <section class="foreman-section">
      <h2 class="foreman-section-header">Playbook</h2>
      <p class="foreman-hint">A complete prompt with curl instructions and your token embedded. Click the output or the copy button to place it on your clipboard.</p>
      <div class="foreman-playbook-box" data-url-key="${encodedUrlKey}">
        <div class="foreman-playbook-controls">
          <label class="foreman-token-label" for="foreman-token-select">token:</label>
          <select class="foreman-token-select" id="foreman-token-select" data-url-key="${encodedUrlKey}" aria-label="Select read-write token">
            <option value="">Loading tokens...</option>
          </select>
          <button class="action-btn save" id="foreman-generate-btn" aria-label="Generate new read-write token and load playbook">generate</button>
          <button class="action-btn save" id="foreman-copy-btn" aria-label="Copy playbook to clipboard" disabled>copy</button>
          ${featureFlags.proxy === true ? `
            <button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt" aria-label="Toggle proxy API block">+proxy</button>` : ''}
          <span class="foreman-playbook-feedback" id="foreman-playbook-feedback" role="status" aria-live="polite"></span>
        </div>
        <pre class="foreman-playbook-output" id="foreman-playbook-output" title="Click to copy" tabindex="0">Click "generate" to mint a token and load the playbook</pre>
      </div>
    </section>

    <section class="foreman-section">
      <h2 class="foreman-section-header">
        Status Log
        <span class="foreman-live-indicator" id="foreman-status-live" title="Auto-refreshing every 10s" hidden>● live</span>
        <button class="action-btn foreman-refresh" id="foreman-status-refresh" aria-label="Refresh status log">refresh</button>
      </h2>
      <p class="foreman-hint">Progress reported by the running agent. Auto-refreshes every 10 seconds.</p>
      <div class="foreman-status-list" id="foreman-status-list" data-url-key="${encodedUrlKey}">
        <div class="foreman-status-loading">Waiting for a token...</div>
      </div>
      <div class="foreman-status-pager" id="foreman-status-pager" hidden>
        <button class="action-btn" id="foreman-status-more" type="button">load more</button>
        <span class="foreman-status-pager-info" id="foreman-status-pager-info"></span>
      </div>
    </section>

    <section class="foreman-section">
      <h2 class="foreman-section-header">
        Stack Preview
        <button class="action-btn foreman-refresh" id="foreman-stack-refresh" aria-label="Refresh stack preview">refresh</button>
      </h2>
      <p class="foreman-hint">Top 5 tasks the foreman would work through, sorted by priority. Click a task to open it in Linear.</p>
      <div class="foreman-stack-list" id="foreman-stack-list" data-url-key="${encodedUrlKey}">
        <div class="foreman-stack-loading">Waiting for a token...</div>
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
