/**
 * Foreman Page Renderer
 *
 * Generates HTML for the /foreman page. The page is a live observation
 * dashboard for autonomous agents: active task, recent timeline, up-next stack,
 * plus a collapsible setup panel with the playbook.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { getProviderForWorkspace } from './providers/registry.js';
import { renderEmptyState } from './components/empty-state.js';

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

  // Provider-aware display name for the "Open {id} in {provider}" link titles,
  // which foreman.js renders client-side (LIN-177 S3). Injected once on <body>
  // so the polled task cards can read it. Falls back to Linear for legacy
  // workspaces, matching the dashboard.
  const providerDisplayName = escapeHtml(getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))?.ui?.displayName || 'Linear');

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Foreman`,
    stylesheets: ['/style.css', '/common-actions.css', '/foreman.css'],
    bodyClass: 'foreman-page',
    // LIN-525 #2: live proxy flag → ProxyToggle.maybeAppend no-ops when off.
    bodyAttrs: `data-provider-name="${providerDisplayName}"${featureFlags.proxy === true ? ' data-proxy-feature="true"' : ''}`,
    nav: navBarHtml,
    scripts: ['/common.js', '/app.js', '/foreman.js'],
    content: `<header class="foreman-header">
    <h1>Foreman <span class="foreman-experimental">experimental</span></h1>
    <p class="foreman-subtitle">Live view of an autonomous agent working your Linear task stack</p>
  </header>

  <main class="foreman-main">
    <!-- Sessions: one chip per posting token; click to filter the view below -->
    <section class="foreman-section foreman-sessions-section" id="foreman-sessions-section" hidden>
      <div class="foreman-section-header-row">
        <h2 class="foreman-section-header">Sessions</h2>
        <span class="foreman-sessions-hint" id="foreman-sessions-hint">pick a session to focus, or keep "all" for the combined view</span>
      </div>
      <div class="foreman-sessions" id="foreman-sessions" role="tablist" aria-label="Filter by session">
        <button class="foreman-session-chip is-selected" type="button" data-token-id="" role="tab" aria-selected="true">all sessions</button>
      </div>
    </section>

    <!-- Applied filter chips (session + task). Hidden when no filters active. -->
    <div class="foreman-filters" id="foreman-filters" hidden aria-live="polite">
      <span class="foreman-filters-label">showing:</span>
      <span class="foreman-filter-chip" id="foreman-filter-session" hidden>
        <span class="foreman-filter-chip-label">session:</span>
        <span class="foreman-filter-chip-value" id="foreman-filter-session-value"></span>
        <button class="foreman-filter-chip-clear" type="button" data-clear="session" aria-label="Clear session filter">\u2715</button>
      </span>
      <span class="foreman-filter-chip" id="foreman-filter-task" hidden>
        <span class="foreman-filter-chip-label">task:</span>
        <span class="foreman-filter-chip-value" id="foreman-filter-task-value"></span>
        <button class="foreman-filter-chip-clear" type="button" data-clear="task" aria-label="Clear task filter">\u2715</button>
      </span>
    </div>

    <!-- Now Working: the active task card (mirrors swipe card visual language) -->
    <section class="foreman-section foreman-now" id="foreman-now" data-url-key="${encodedUrlKey}">
      <div class="foreman-section-header-row">
        <h2 class="foreman-section-header">Now working</h2>
        <span class="foreman-live-indicator" id="foreman-live-indicator" hidden aria-live="polite">● live</span>
      </div>
      <div class="card foreman-now-card" id="foreman-now-card">
        ${renderEmptyState({ className: 'foreman-now-empty', text: 'Waiting for a token — generate one below to start watching.' })}
      </div>
    </section>

    <!-- Timeline: richer status log -->
    <section class="foreman-section foreman-timeline-section">
      <div class="foreman-section-header-row">
        <h2 class="foreman-section-header">Timeline</h2>
        <button class="action-btn foreman-refresh" id="foreman-status-refresh" aria-label="Refresh timeline">refresh</button>
      </div>
      <div class="foreman-timeline" id="foreman-status-list" data-url-key="${encodedUrlKey}">
        ${renderEmptyState({ className: 'foreman-empty', text: 'Waiting for a token.' })}
      </div>
      <div class="foreman-status-pager" id="foreman-status-pager" hidden>
        <button class="action-btn" id="foreman-status-more" type="button">load more</button>
        <span class="foreman-status-pager-info" id="foreman-status-pager-info"></span>
      </div>
    </section>

    <!-- Task threads: compact, clickable groups of status entries by Linear task -->
    <section class="foreman-section foreman-threads-section" id="foreman-threads-section" hidden>
      <div class="foreman-section-header-row">
        <h2 class="foreman-section-header">Task threads</h2>
        <span class="foreman-sessions-hint">click a task to filter the timeline</span>
      </div>
      <div class="foreman-threads" id="foreman-threads"></div>
    </section>

    <!-- Up next: stack preview as swipe-style mini cards -->
    <section class="foreman-section foreman-upnext-section">
      <div class="foreman-section-header-row">
        <h2 class="foreman-section-header">Up next</h2>
        <button class="action-btn foreman-refresh" id="foreman-stack-refresh" aria-label="Refresh up next">refresh</button>
      </div>
      <div class="foreman-stack-cards" id="foreman-stack-list" data-url-key="${encodedUrlKey}">
        ${renderEmptyState({ className: 'foreman-empty', text: 'Waiting for a token.' })}
      </div>
    </section>

    <!-- Setup: collapsible playbook + token controls -->
    <details class="foreman-setup" id="foreman-setup" open>
      <summary class="foreman-setup-summary">
        <span class="foreman-setup-toggle" aria-hidden="true">\u25B8</span>
        <span class="foreman-setup-label">Setup</span>
        <span class="foreman-setup-hint" id="foreman-setup-hint">generate a read-write token, copy the playbook into Claude</span>
      </summary>
      <div class="foreman-setup-body">
        <div class="foreman-playbook-box" data-url-key="${encodedUrlKey}">
          <div class="foreman-playbook-controls">
            <label class="foreman-token-label" for="foreman-token-select">token:</label>
            <select class="foreman-token-select" id="foreman-token-select" data-url-key="${encodedUrlKey}" aria-label="Select read-write token">
              <option value="">Loading tokens...</option>
            </select>
            <button class="action-btn save" id="foreman-generate-btn" aria-label="Generate a new read-write token and load playbook">generate</button>
            <button class="action-btn" id="foreman-autopilot-btn" title="Load a general Autopilot kickoff into the box instead of the foreman playbook" aria-label="Load Autopilot kickoff" disabled>autopilot</button>
            <button class="action-btn save" id="foreman-copy-btn" aria-label="Copy playbook to clipboard" disabled>copy</button>
            ${featureFlags.proxy === true ? `
              <button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt" aria-label="Toggle proxy API block">+proxy</button>` : ''}
            <span class="foreman-playbook-feedback" id="foreman-playbook-feedback" role="status" aria-live="polite"></span>
          </div>
          <pre class="foreman-playbook-output" id="foreman-playbook-output" title="Click to copy" tabindex="0">Click "generate" to mint a token and load the playbook</pre>
        </div>
      </div>
    </details>
  </main>
  ${footerHtml}`
  });
}
