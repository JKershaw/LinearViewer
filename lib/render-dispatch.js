/**
 * Dispatch Page Renderer
 *
 * Generates HTML for the standalone /dispatch page.
 * Consolidates dispatch-related UI: custom prompt dispatcher,
 * queue list, token management, and dispatch history.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';

/**
 * Options for renderDispatchPage
 * @typedef {Object} DispatchPageOptions
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [urlKey] - Current workspace URL key
 * @property {'oauth'|'env'|'free'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {import('./workspace.js').Workspace[]} [workspaces] - Array of connected workspaces
 * @property {Object} [featureFlags] - Current feature toggle states
 */

/**
 * Renders the dispatch page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {DispatchPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderDispatchPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'dispatch', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/dispatch',
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
  <title>${escapeHtml(workspaceName)} - Dispatch</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/dispatch.css">
</head>
<body>
  ${navBarHtml}
  <header>
    <h1>Dispatch</h1>
    <p class="dispatch-subtitle">Queue prompts for AI agents and automation tools</p>
  </header>

  <main>
    <section class="dispatch-section">
      <h2 class="dispatch-section-header">Send Prompt</h2>
      <div class="tree">
        <div class="node">
          <div class="line">
            <span class="dispatch-label">prompt:</span>
            <span class="dispatch-value" style="flex:1">
              <textarea class="dispatch-prompt-input" data-url-key="${encodedUrlKey}" placeholder="Type a custom prompt or /command..." rows="3"></textarea>
            </span>
          </div>
          <div class="children">
            <div class="node">
              <div class="line dispatch-prompt-actions">
                <button class="dispatch-action save dispatch-prompt-send" data-target="cli">dispatch</button>
                <button class="dispatch-action save dispatch-prompt-send" data-target="web">dispatch &rarr; web</button>
                <span class="dispatch-prompt-feedback"></span>
              </div>
            </div>
            <div class="node dispatch-recents-container"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="dispatch-section">
      <h2 class="dispatch-section-header">Queue</h2>
      <div class="queue-list" data-url-key="${encodedUrlKey}">
        <div class="queue-list-loading">Loading queue...</div>
      </div>
    </section>

    <section class="dispatch-section">
      <h2 class="dispatch-section-header">Tokens</h2>
      <div class="tree">
        <div class="node">
          <div class="line token-create">
            <span class="dispatch-label">new token:</span>
            <form class="dispatch-form token-form" id="create-token-form" data-url-key="${encodedUrlKey}">
              <input type="text" name="label" class="token-label-input" maxlength="50" placeholder="Token label (optional)">
              <button type="submit" class="dispatch-action save">generate</button>
            </form>
          </div>
        </div>
      </div>
      <div class="token-list" data-url-key="${encodedUrlKey}">
        <div class="token-list-loading">Loading tokens...</div>
      </div>
    </section>

    <section class="dispatch-section">
      <h2 class="dispatch-section-header">History</h2>
      <div class="history-list" data-url-key="${encodedUrlKey}">
        <div class="history-list-loading">Loading history...</div>
      </div>
    </section>
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by dispatch.js and app.js -->
  <script src="/common.js"></script>
  <script src="/app.js"></script>
  <script src="/dispatch.js"></script>
</body>
</html>`;
}
