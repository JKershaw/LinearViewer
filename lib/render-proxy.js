/**
 * Proxy Page Renderer
 *
 * Generates HTML for the standalone /proxy page.
 * Displays: ready-to-copy prompt, token management, curl examples, event log.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderField } from './components/field.js';
import { renderSurface } from './components/surface.js';

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

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Proxy`,
    stylesheets: ['/style.css', '/common-actions.css', '/proxy.css'],
    nav: navBarHtml,
    scripts: ['/common.js', '/app.js', '/proxy.js'],
    content: `${renderPageHeader({ title: 'Proxy', subtitle: 'Let AI agents interact with Linear through secure proxy tokens' })}

  <main>
    ${renderSection({ boxed: true, className: 'proxy-section', titleClass: 'section-header proxy-section-header', title: 'Agent Prompt', body: `<p class="proxy-hint">Generate a token, then copy the prompt below into any AI agent. The agent will receive instructions and credentials to interact with Linear.</p>
      ${renderSurface({ className: 'proxy-prompt-box', attrs: `data-url-key="${encodedUrlKey}"`, body: `<div class="proxy-prompt-controls">
          <label class="proxy-scope-toggle">
            <span class="field-label">scope:</span>
            <select class="proxy-scope-select" id="proxy-scope-select">
              <option value="read">read-only</option>
              <option value="readWrite">read-write</option>
            </select>
          </label>
          <button class="action-btn save" id="proxy-generate-btn">generate &amp; copy</button>
          <span class="proxy-prompt-feedback" id="proxy-generate-feedback"></span>
        </div>
        ${renderSurface({ as: 'pre', variant: 'inset', className: 'proxy-prompt-output', attrs: 'id="proxy-prompt-output"', body: 'Click "generate &amp; copy" to create a token and prompt' })}` })}` })}

    ${renderSection({ boxed: true, className: 'proxy-section', titleClass: 'section-header proxy-section-header', title: 'Tokens', body: `<div class="tree">
        <div class="node">
          <div class="line token-create">
            <span class="field-label">new token:</span>
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
      <details class="proxy-collapsible" id="proxy-tokens-collapsible">
        <summary class="proxy-collapsible-summary">
          <span class="proxy-collapsible-label">existing tokens</span>
          <span class="proxy-collapsible-count" id="proxy-tokens-count"></span>
        </summary>
        <div class="proxy-token-list" data-url-key="${encodedUrlKey}">
          <div class="token-list-loading">Loading tokens...</div>
        </div>
      </details>` })}

    ${renderSection({ boxed: true, className: 'proxy-section', titleClass: 'section-header proxy-section-header', title: 'Examples', body: `<div class="proxy-examples">
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
          <code class="proxy-example-code">curl -H "Authorization: Bearer TOKEN" ${escapeHtml(`${options.baseUrl || ''}/api/proxy/issues/LIN-123`)}</code>
        </div>
        <div class="proxy-example">
          <div class="proxy-example-label">Agent instructions:</div>
          <code class="proxy-example-code">curl -H "Authorization: Bearer TOKEN" ${escapeHtml(`${options.baseUrl || ''}/api/proxy/instructions`)}</code>
        </div>
      </div>` })}

    ${renderSection({ boxed: true, className: 'proxy-section', titleClass: 'section-header proxy-section-header', title: 'Credential Health', body: `<p class="proxy-hint">Per-token status over the last 15 minutes. A token that looks alive (e.g. its dispatch calls succeed) while its workspace-scoped calls silently fail as ownerless shows <strong>credential-dead</strong> here (LIN-1577).</p>
      <div class="proxy-credential-health-list" data-url-key="${encodedUrlKey}">
        <div class="proxy-credential-health-loading">Loading credential health...</div>
      </div>` })}

    ${renderSection({ boxed: true, className: 'proxy-section', titleClass: 'section-header proxy-section-header', title: 'Event Log <button class="action-btn proxy-events-refresh">refresh</button>', body: `<details class="proxy-collapsible" id="proxy-events-collapsible">
        <summary class="proxy-collapsible-summary">
          <span class="proxy-collapsible-label">recent events</span>
          <span class="proxy-collapsible-count" id="proxy-events-count"></span>
        </summary>
        <div class="proxy-events-list" data-url-key="${encodedUrlKey}">
          <div class="proxy-events-loading">Loading events...</div>
        </div>
        <div class="proxy-events-pager" id="proxy-events-pager" hidden>
          <button class="action-btn proxy-events-prev" type="button">prev</button>
          <span class="proxy-events-pager-info"></span>
          <button class="action-btn proxy-events-next" type="button">next</button>
        </div>
      </details>` })}
  </main>
  ${footerHtml}`
  });
}
