/**
 * Proxy Page Renderer
 *
 * Generates HTML for the standalone /proxy page.
 * Displays: ready-to-copy prompt, token management, curl examples, event log.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';

/**
 * Renders the proxy page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {Object} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderProxyPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'proxy', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/proxy',
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
  <title>${escapeHtml(workspaceName)} - Proxy</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/common-actions.css">
  <link rel="stylesheet" href="/proxy.css">
</head>
<body>
  ${navBarHtml}
  <header>
    <h1>Proxy</h1>
    <p class="proxy-subtitle">Let AI agents interact with Linear through secure proxy tokens</p>
  </header>

  <main>
    <section class="proxy-section">
      <h2 class="proxy-section-header">Agent Prompt</h2>
      <p class="proxy-hint">Generate a token, then copy the prompt below into any AI agent. The agent will receive instructions and credentials to interact with Linear.</p>
      <div class="proxy-prompt-box" data-url-key="${encodedUrlKey}">
        <div class="proxy-prompt-controls">
          <label class="proxy-scope-toggle">
            <span class="proxy-label">scope:</span>
            <select class="proxy-scope-select" id="proxy-scope-select">
              <option value="read">read-only</option>
              <option value="readWrite">read-write</option>
            </select>
          </label>
          <button class="action-btn save" id="proxy-generate-btn">generate &amp; copy</button>
          <span class="proxy-prompt-feedback" id="proxy-generate-feedback"></span>
        </div>
        <pre class="proxy-prompt-output" id="proxy-prompt-output">Click "generate &amp; copy" to create a token and prompt</pre>
      </div>
    </section>

    <section class="proxy-section">
      <h2 class="proxy-section-header">Tokens</h2>
      <div class="tree">
        <div class="node">
          <div class="line token-create">
            <span class="proxy-label">new token:</span>
            <form class="dispatch-form token-form" id="proxy-create-token-form" data-url-key="${encodedUrlKey}">
              <input type="text" name="label" class="token-label-input" maxlength="50" placeholder="Label (optional)">
              <select name="scope" class="proxy-scope-select">
                <option value="read">read</option>
                <option value="readWrite">read-write</option>
              </select>
              <button type="submit" class="action-btn save">generate</button>
            </form>
          </div>
        </div>
      </div>
      <div class="proxy-token-list" data-url-key="${encodedUrlKey}">
        <div class="token-list-loading">Loading tokens...</div>
      </div>
    </section>

    <section class="proxy-section">
      <h2 class="proxy-section-header">Examples</h2>
      <div class="proxy-examples">
        <div class="proxy-example">
          <div class="proxy-example-label">List teams:</div>
          <code class="proxy-example-code">curl -H "Authorization: Bearer TOKEN" ${escapeHtml(`${options.baseUrl || ''}/api/proxy/teams`)}</code>
        </div>
        <div class="proxy-example">
          <div class="proxy-example-label">Search issues:</div>
          <code class="proxy-example-code">curl -H "Authorization: Bearer TOKEN" "${escapeHtml(`${options.baseUrl || ''}/api/proxy/search?q=bug`)}"</code>
        </div>
        <div class="proxy-example">
          <div class="proxy-example-label">Get issue detail:</div>
          <code class="proxy-example-code">curl -H "Authorization: Bearer TOKEN" ${escapeHtml(`${options.baseUrl || ''}/api/proxy/issue/LIN-123`)}</code>
        </div>
        <div class="proxy-example">
          <div class="proxy-example-label">Agent instructions:</div>
          <code class="proxy-example-code">curl -H "Authorization: Bearer TOKEN" ${escapeHtml(`${options.baseUrl || ''}/api/proxy/instructions`)}</code>
        </div>
      </div>
    </section>

    <section class="proxy-section">
      <h2 class="proxy-section-header">Event Log <button class="action-btn proxy-events-refresh">refresh</button></h2>
      <div class="proxy-events-list" data-url-key="${encodedUrlKey}">
        <div class="proxy-events-loading">Loading events...</div>
      </div>
    </section>
  </main>
  ${footerHtml}
  <script src="/common.js"></script>
  <script src="/app.js"></script>
  <script src="/proxy.js"></script>
</body>
</html>`;
}
