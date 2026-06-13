/**
 * Dispatch Page Renderer
 *
 * Generates HTML for the standalone /dispatch page.
 * Consolidates dispatch-related UI: custom prompt dispatcher,
 * queue list, token management, and dispatch history.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderField } from './components/field.js';

/**
 * Options for renderDispatchPage
 * @typedef {Object} DispatchPageOptions
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [urlKey] - Current workspace URL key
 * @property {'oauth'|'env'|'free'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {import('./workspace.js').Workspace[]} [workspaces] - Array of connected workspaces
 * @property {Object} [featureFlags] - Current feature toggle states
 * @property {Array<{name: string, repo: string}>} [projectRepos] - Projects with repo= in description
 */

/**
 * Renders the dispatch page.
 *
 * @param {string} workspaceName - Name of the active workspace
 * @param {DispatchPageOptions} [options] - Optional settings
 * @returns {string} Complete HTML document
 */
export function renderDispatchPage(workspaceName = 'Workspace', options = {}) {
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {}, projectRepos = [], isLocalhost = false } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'dispatch', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/dispatch',
    urlKey,
    openRouterSource,
    featureFlags
  });

  const encodedUrlKey = escapeHtml(urlKey);

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Dispatch`,
    stylesheets: ['/style.css', '/common-actions.css', '/dispatch.css'],
    nav: navBarHtml,
    scripts: ['/common.js', '/app.js', '/dispatch.js'],
    content: `${renderPageHeader({ title: 'Dispatch', subtitle: 'Queue prompts for AI agents and automation tools', subtitleClass: 'dispatch-subtitle' })}

  <main>
    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', title: 'Send Prompt', body: `<div class="tree">
        <div class="node">
          <div class="line dispatch-prompt-line">
            <span class="field-label">prompt:</span>
            <div class="dispatch-prompt-wrapper">
              <textarea class="dispatch-prompt-input" data-url-key="${encodedUrlKey}" placeholder="Type a custom prompt or /command..." rows="3"></textarea>
            </div>
          </div>
          <div class="children">${projectRepos.length > 0 ? `
            <div class="node">
              ${renderField({ label: 'repo:', valueHtml: `<select class="dispatch-repo-select">
                    <option value="">none</option>
                    ${projectRepos.map(p => `<option value="${escapeHtml(p.repo)}">${escapeHtml(p.name)} (${escapeHtml(p.repo)})</option>`).join('\n                    ')}
                  </select>` })}
            </div>` : ''}
            <div class="node">
              <div class="line dispatch-prompt-actions">
                <button class="action-btn save dispatch-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="dispatch-options">Dispatch &#9662;</button>${featureFlags.proxy === true ? `
                <button class="action-btn dispatch-load-autopilot" title="Load a general Autopilot kickoff — orient off the stack and run the loop until it needs you">load Autopilot</button>` : ''}
                <span class="dispatch-prompt-feedback"></span>
                <div class="dispatch-options hidden" id="dispatch-options">
                  <button class="action-btn save dispatch-prompt-send" data-target="cli">cli</button>
                  <button class="action-btn save dispatch-prompt-send" data-target="web">web</button>
                  <button class="action-btn save dispatch-prompt-send" data-target="dash">dash</button>${isLocalhost ? `
                  <button class="action-btn save dispatch-prompt-send" data-target="local">harbour</button>` : ''}${featureFlags.proxy === true ? `
                  <button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>` : ''}
                </div>
              </div>
            </div>
            <div class="node dispatch-recents-container"></div>
          </div>
        </div>
      </div>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', title: 'Queue', body: `<div class="queue-list" data-url-key="${encodedUrlKey}">
        <div class="queue-list-loading">Loading queue...</div>
      </div>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', title: 'Tokens', body: `<div class="tree">
        <div class="node">
          <div class="line token-create">
            <span class="field-label">new token:</span>
            <form class="dispatch-form token-form" id="create-token-form" data-url-key="${encodedUrlKey}">
              <input type="text" name="label" class="token-label-input" maxlength="50" placeholder="Token label (optional)">
              <button type="submit" class="action-btn save">generate</button>
            </form>
          </div>
        </div>
      </div>
      <div class="token-list" data-url-key="${encodedUrlKey}">
        <div class="token-list-loading">Loading tokens...</div>
      </div>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', title: 'Integration Guide', body: `<p class="guide-summary">Build a consumer that polls for and processes dispatched prompts.</p>
      <div class="tree">
        <div class="node">
          <div class="line"><span class="guide-step">1.</span> <code class="guide-code">GET /api/dispatch/poll</code> <span class="guide-desc">— check for available items</span></div>
        </div>
        <div class="node">
          <div class="line"><span class="guide-step">2.</span> <code class="guide-code">POST /api/dispatch/take/:id</code> <span class="guide-desc">— atomically claim an item</span></div>
        </div>
        <div class="node">
          <div class="line"><span class="guide-step">3.</span> <code class="guide-code">POST /api/dispatch/feedback/:id</code> <span class="guide-desc">— report results back</span></div>
        </div>
      </div>
      <p class="guide-link-line">
        <a href="https://github.com/JKershaw/LinearViewer/blob/main/docs/dispatch-integration.md" target="_blank" rel="noopener noreferrer" class="guide-link">Full integration guide →</a>
      </p>` })}

    ${renderSection({ boxed: true, className: 'dispatch-section', titleClass: 'section-header dispatch-section-header', title: 'History <button class="action-btn history-refresh">refresh</button>', body: `<div class="history-list" data-url-key="${encodedUrlKey}">
        <div class="history-list-loading">Loading history...</div>
      </div>` })}
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by dispatch.js and app.js -->`
  });
}
