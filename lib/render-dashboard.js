/**
 * Dashboard Page Renderer (LIN-509).
 *
 * Renders the experimental combined, realtime autopilot dashboard shell: a
 * mobile-first feed of autopilot runs merged across every connected workspace.
 * The top status banner carries the at-a-glance counts; a scope toggle
 * (autopilot-only by default) and workspace chips filter; runs group into
 * expandable task "sessions" with an on-demand run summary shown at the top of
 * each expanded session and a streamlined, expandable feed of its runs below.
 *
 * Models its layout on Swipe (mobile-first), NOT the Pipeline desktop
 * floor. Reuses the page shell + navbar + footer + section components and the
 * pipeline poll pattern (initial config in `window.__DASHBOARD_DATA__`, then a
 * visibility-gated poll of `/api/dashboard/loops` driven by `public/dashboard.js`).
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
 * @param {Array<{urlKey: string, name: string}>} data.workspaces - Connected workspaces (for filter chips)
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces] - Full session workspaces (for navbar)
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document
 */
export function renderDashboardPage(data, options = {}) {
  const { workspaces = [] } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {}
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'dashboard', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/dashboard', urlKey, openRouterSource, featureFlags });

  const dashboardData = {
    urlKey: urlKey || '',
    workspaces: workspaces.map(w => ({ urlKey: w.urlKey, name: w.name }))
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  // Workspace filter chips — one per connected workspace, all on by default.
  // Client-side filtering only (merged data is cheap, so filtering is free).
  const chipsHtml = workspaces.length > 0
    ? workspaces.map(ws => `
            <button type="button" class="dashboard-chip is-on" data-ws="${escapeHtml(ws.urlKey)}">
              <span class="dashboard-chip-dot"></span>${escapeHtml(ws.name || ws.urlKey)}
            </button>`).join('')
    : renderEmptyState({ tag: 'p', className: 'dashboard-empty', text: 'No connected workspaces.' });

  // The single at-a-glance story line: deterministic active/done/error counts,
  // filled by the poll. Errors are flagged when present (the thing you most need
  // to see first). Sits at the very top so the average user reads it without scrolling.
  const bannerHtml = `<div class="dashboard-banner" id="dashboard-banner" aria-live="polite">
      <span class="dashboard-banner-line" id="dashboard-banner-line">connecting…</span>
      <span class="dashboard-poll-status" id="dashboard-poll-status"></span>
    </div>`;

  // Scope toggle (default: autopilot-only). "Autopilot" = sessions that include
  // an autopilot orchestrator run; "All" relaxes the filter to every dispatched run.
  const controlsBody = `<div class="dashboard-controls">
        <div class="dashboard-scope" id="dashboard-scope" role="group" aria-label="Run scope">
          <button type="button" class="dashboard-scope-btn is-on" data-scope="autopilot" aria-pressed="true">Autopilot</button>
          <button type="button" class="dashboard-scope-btn" data-scope="all" aria-pressed="false">All runs</button>
        </div>
        <div class="dashboard-chips" id="dashboard-chips" role="group" aria-label="Filter workspaces">${chipsHtml}</div>
      </div>`;

  const activeBody = `<ul class="dashboard-feed" id="dashboard-active" aria-label="Active sessions"></ul>
      ${renderEmptyState({ tag: 'p', className: 'dashboard-feed-empty', id: 'dashboard-active-empty', text: '○ nothing running right now' })}`;

  const recentBody = `<ul class="dashboard-feed" id="dashboard-recent" aria-label="Recent sessions"></ul>
      ${renderEmptyState({ tag: 'p', className: 'dashboard-feed-empty', id: 'dashboard-recent-empty', text: '○ no finished runs in the last 30 days' })}`;

  return renderPage({
    title: 'Dashboard - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/dashboard.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__DASHBOARD_DATA__', value: dashboardData },
    scripts: ['/common.js', '/dashboard.js'],
    content: `<main class="dashboard-page" data-url-key="${encodedUrlKey}">
    <header class="dashboard-header">
      <h1>Dashboard</h1>
      ${bannerHtml}
    </header>

    ${renderSection({ boxed: true, className: 'dashboard-section dashboard-controls-section', titleClass: 'section-header', title: 'Filter', body: controlsBody })}

    ${renderSection({ boxed: true, className: 'dashboard-section dashboard-active-section', titleClass: 'section-header', title: 'Active', body: activeBody })}

    ${renderSection({ boxed: true, className: 'dashboard-section dashboard-recent-section', titleClass: 'section-header', title: 'Recent', body: recentBody })}
  </main>
  ${footerHtml}`
  });
}
