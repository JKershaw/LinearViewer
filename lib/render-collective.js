/**
 * Collective Page Renderer (LIN-450, V1).
 *
 * Renders the experimental Collective discussion shell: pick a subset of your
 * connected workspaces, name a Yap channel, start the discussion (multi-workspace
 * dispatch fan-out), then watch the live transcript and inject your own input.
 *
 * Reuses the page shell + navbar + footer + section components and the pipeline
 * poll pattern (initial config in `window.__COLLECTIVE_DATA__`, then a
 * visibility-gated poll of `/api/collective/state` driven by `public/collective.js`).
 * Zero business logic here — formatting/polling live in the CSS/JS.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderEmptyState } from './components/empty-state.js';

/**
 * @param {Object} data
 * @param {Array<{urlKey: string, name: string}>} data.workspaces - Connected workspaces to choose from
 * @param {string} data.defaultChannel - Default Yap channel (e.g. "#Collective")
 * @param {string} data.defaultTopic - Default discussion topic
 * @param {boolean} data.yapConfigured - Whether the server has a Yap base URL configured
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces] - Full session workspaces (for navbar)
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document
 */
export function renderCollectivePage(data, options = {}) {
  const {
    workspaces = [],
    defaultChannel = '#Collective',
    defaultTopic = '',
    yapConfigured = false,
  } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'collective', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/collective', urlKey, openRouterSource, featureFlags });

  const collectiveData = {
    urlKey: urlKey || '',
    defaultChannel,
    yapConfigured: !!yapConfigured,
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  // Workspace multi-select (checkboxes) — each row a connected workspace.
  const workspaceRows = workspaces.length > 0
    ? workspaces.map(ws => `
            <label class="collective-ws-row">
              <input type="checkbox" class="collective-ws-check" value="${escapeHtml(ws.urlKey)}" data-name="${escapeHtml(ws.name)}">
              <span class="collective-ws-name">${escapeHtml(ws.name)}</span>
            </label>`).join('')
    : renderEmptyState({ tag: 'p', className: 'collective-empty', text: 'No connected workspaces.' });

  const yapWarning = yapConfigured
    ? ''
    : `<p class="collective-warning" data-yap-unconfigured>⚠ Yap is not configured on the server (set <code>YAP_BASE_URL</code>). You can still dispatch participants, but the live transcript and input box need Yap.</p>`;

  const setupBody = `<div class="tree">
        <p class="collective-experimental">⚗ Experimental — dispatches full Claude Code sessions from each selected workspace into one Yap discussion you watch and steer.</p>
        ${yapWarning}
        <div class="collective-field">
          <span class="collective-label">workspaces:</span>
          <div class="collective-ws-list">${workspaceRows}</div>
        </div>
        <div class="collective-field">
          <label class="collective-label" for="collective-channel">channel:</label>
          <input type="text" id="collective-channel" class="collective-input" value="${escapeHtml(defaultChannel)}" maxlength="50">
        </div>
        <div class="collective-field">
          <label class="collective-label" for="collective-topic">topic:</label>
          <textarea id="collective-topic" class="collective-input collective-textarea" rows="3" maxlength="500">${escapeHtml(defaultTopic)}</textarea>
        </div>
        <div class="collective-field">
          <label class="collective-label" for="collective-target">target:</label>
          <select id="collective-target" class="collective-select">
            <option value="cli">cli</option>
            <option value="web">web</option>
          </select>
        </div>
        <div class="collective-field">
          <button type="button" id="collective-start" class="action-btn save">start discussion</button>
          <button type="button" id="collective-view-prompt" class="action-btn">view prompt</button>
          <span class="collective-start-status" id="collective-start-status"></span>
        </div>
        <div class="collective-prompt-wrap hidden" id="collective-prompt-wrap">
          <div class="collective-prompt-head">
            <span class="collective-prompt-label">participant prompt (preview)</span>
            <button type="button" id="collective-prompt-copy" class="collective-copy-btn">copy</button>
          </div>
          <pre class="collective-prompt-preview" id="collective-prompt-preview"></pre>
        </div>
      </div>`;

  const transcriptBody = `<div class="collective-transcript-head">
        <span class="collective-channel-label" id="collective-channel-label"></span>
        <span class="collective-poll-status" id="collective-poll-status"></span>
      </div>
      <ul class="collective-transcript" id="collective-transcript"></ul>
      ${renderEmptyState({ tag: 'p', className: 'collective-transcript-empty', id: 'collective-transcript-empty', text: '○ no messages yet — start a discussion above, then watch it unfold here' })}
      <div class="collective-say">
        <input type="text" id="collective-say-input" class="collective-input collective-input-wide" placeholder="say something (as John)…" maxlength="2000">
        <button type="button" id="collective-say-btn" class="action-btn save">say</button>
      </div>`;

  return renderPage({
    title: 'Collective - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/collective.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__COLLECTIVE_DATA__', value: collectiveData },
    scripts: ['/common.js', '/collective.js'],
    content: `<main class="collective-page" data-url-key="${encodedUrlKey}">
    <header class="collective-header">
      <h1>Collective</h1>
      <p class="collective-subtitle">A cross-project discussion, dispatched and watched from here.</p>
    </header>

    ${renderSection({ boxed: true, className: 'collective-section collective-setup', titleClass: 'section-header', title: 'Set up', body: setupBody })}

    ${renderSection({ boxed: true, className: 'collective-section collective-live', titleClass: 'section-header', title: 'Discussion', body: transcriptBody })}
  </main>
  ${footerHtml}`,
  });
}
