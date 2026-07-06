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
import { renderPageHeader } from './components/page-header.js';

/**
 * @param {Object} data
 * @param {Array<{urlKey: string, name: string}>} data.workspaces - Connected workspaces to bind characters to
 * @param {Array<Object>} [data.characters] - Saved custom + recent characters for this workspace
 * @param {Array<Object>} [data.presets] - Built-in + custom preset meetings (LIN-1050)
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
    characters = [],
    presets = [],
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

  // Client needs each stored character's full persona to POST it at /start; the
  // define-new form needs the repo list. Both ride in the embedded config.
  const collectiveData = {
    urlKey: urlKey || '',
    defaultChannel,
    yapConfigured: !!yapConfigured,
    characters,
    presets,
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  const hasWorkspaces = workspaces.length > 0;

  // Character picker — selectable rows for each saved (custom) + recent
  // character. The client maps a checked row's value (character id) back to the
  // full persona via the embedded config; a newly-defined character is added to
  // this list client-side. When there are no stored characters yet, a note
  // points at the define-new form below (distinct from the no-workspaces state).
  const characterRows = characters.length > 0
    ? characters.map(c => `
            <label class="collective-char-row" data-testid="collective-character" data-kind="${escapeHtml(c.kind || '')}">
              <input type="checkbox" class="collective-char-check" value="${escapeHtml(c.id || '')}">
              <span class="collective-char-name">${escapeHtml(c.name || c.role || 'Implementer')}</span>
              <span class="collective-char-repo">${escapeHtml(c.workspaceName || c.workspaceUrlKey || '')}</span>
              <span class="collective-char-kind">${escapeHtml(c.kind || '')}</span>
            </label>`).join('')
    : (hasWorkspaces
        ? `<p class="collective-char-none">○ no saved characters yet — define one below, or start with a plain Implementer.</p>`
        : '');

  // Define-new-character form: pick a connected repo to ground the character in,
  // fill the five persona fields, name it, optionally save it for later. Hidden
  // entirely when there are no connected workspaces (nothing to bind to) — the
  // whole selection area then shows the shared empty state.
  const personaInputs = [
    { field: 'role', label: 'role', ph: 'e.g. Skeptic' },
    { field: 'lens', label: 'lens', ph: 'what they look through' },
    { field: 'objective', label: 'objective', ph: 'what they push for' },
    { field: 'value', label: 'brings', ph: 'what they bring to the room' },
    { field: 'disposition', label: 'disposition', ph: 'how they carry themselves' },
  ].map(p => `
            <label class="collective-persona-field">
              <span class="collective-persona-label">${p.label}:</span>
              <input type="text" class="collective-input collective-char-persona" data-field="${p.field}" data-testid="collective-char-${p.field}" placeholder="${escapeHtml(p.ph)}" maxlength="300">
            </label>`).join('');

  const defineForm = hasWorkspaces
    ? `<div class="collective-define" data-testid="collective-define-new">
          <div class="collective-persona-field">
            <span class="collective-persona-label">repo:</span>
            <select class="collective-select collective-char-repo" id="collective-char-repo" data-testid="collective-char-repo">
              ${workspaces.map(ws => `<option value="${escapeHtml(ws.urlKey)}" data-name="${escapeHtml(ws.name)}">${escapeHtml(ws.name)}</option>`).join('')}
            </select>
          </div>
          <label class="collective-persona-field">
            <span class="collective-persona-label">name:</span>
            <input type="text" class="collective-input" id="collective-char-name" data-testid="collective-char-name" placeholder="name this character" maxlength="50">
          </label>
          ${personaInputs}
          <label class="collective-persona-field collective-persona-save">
            <input type="checkbox" id="collective-char-save" data-testid="collective-char-save">
            <span>save this character for later</span>
          </label>
          <button type="button" id="collective-char-add" class="action-btn" data-testid="collective-char-add">add character</button>
        </div>`
    : renderEmptyState({ tag: 'p', className: 'collective-empty', text: 'No connected workspaces.' });

  // Preset picker (LIN-1050): built-in + custom preset meetings, each a
  // repo-agnostic roster + objective/exitCondition/defaultTopic bundle. One
  // shared repo select backs the WHOLE roster for a launch (not per-seat —
  // the resolved design from the ticket's planning). Launching is backend-free
  // client logic (public/collective.js `launchPreset`): it populates the
  // existing character rows and reuses the unchanged start button/flow, so no
  // new dispatch path exists here. No preset-authoring UI — out of scope.
  const presetRows = presets.length > 0
    ? presets.map(p => {
        const facilitator = (p.roster || []).find(s => s.isFacilitator);
        const seatNames = (p.roster || []).map(s => s.name).join(', ');
        return `
            <div class="collective-preset-row" data-testid="collective-preset" data-preset-id="${escapeHtml(p.id)}" data-kind="${escapeHtml(p.kind || '')}">
              <span class="collective-preset-name">${escapeHtml(p.name)}</span>
              <span class="collective-preset-meta">${(p.roster || []).length} seat${(p.roster || []).length === 1 ? '' : 's'} · chair: ${escapeHtml(facilitator ? facilitator.name : '')}</span>
              <span class="collective-preset-seats">${escapeHtml(seatNames)}</span>
              <button type="button" class="action-btn collective-preset-launch" data-testid="collective-preset-launch" data-preset-id="${escapeHtml(p.id)}">launch</button>
            </div>`;
      }).join('')
    : `<p class="collective-preset-none">○ no preset meetings available.</p>`;

  const presetsField = hasWorkspaces
    ? `<div class="collective-field">
        <span class="collective-label">presets:</span>
        <div class="collective-preset-body">
          <div class="collective-preset-list" id="collective-preset-list" data-testid="collective-preset-list">${presetRows}</div>
          <label class="collective-persona-field">
            <span class="collective-persona-label">repo:</span>
            <select class="collective-select" id="collective-preset-repo" data-testid="collective-preset-repo">
              ${workspaces.map(ws => `<option value="${escapeHtml(ws.urlKey)}" data-name="${escapeHtml(ws.name)}">${escapeHtml(ws.name)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>`
    : '';

  const yapWarning = yapConfigured
    ? ''
    : `<p class="collective-warning" data-yap-unconfigured>⚠ Yap is not configured on the server (set <code>YAP_BASE_URL</code>). You can still dispatch participants, but the live transcript and input box need Yap.</p>`;

  const setupBody = `<div class="tree">
        <p class="collective-experimental">⚗ Experimental — dispatches full Claude Code sessions from each selected workspace into one Yap discussion you watch and steer.</p>
        ${yapWarning}
        ${presetsField}
        <div class="collective-field">
          <span class="collective-label">characters:</span>
          <div class="collective-char-list" id="collective-char-list" data-testid="collective-character-list">${characterRows}</div>
          ${defineForm}
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
    ${renderPageHeader({ title: 'Collective', subtitle: 'A cross-project discussion, dispatched and watched from here.' })}

    ${renderSection({ boxed: true, className: 'collective-section collective-setup', titleClass: 'section-header', title: 'Set up', body: setupBody })}

    ${renderSection({ boxed: true, className: 'collective-section collective-live', titleClass: 'section-header', title: 'Discussion', body: transcriptBody })}
  </main>
  ${footerHtml}`,
  });
}
