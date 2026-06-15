/**
 * Dashboard Page Renderer (LIN-509).
 *
 * Renders the experimental combined, realtime autopilot dashboard shell: a
 * mobile-first feed of autopilot runs merged across every connected workspace,
 * with workspace filter chips, a live (polled) active/recent feed, a run
 * drill-down overlay, and an on-demand "summarise" button per completed run.
 *
 * Models its layout on Foreman/Swipe (mobile-first), NOT the Pipeline desktop
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

  const controlsBody = `<div class="dashboard-controls">
        <div class="dashboard-chips" id="dashboard-chips" role="group" aria-label="Filter workspaces">${chipsHtml}</div>
        <span class="dashboard-poll-status" id="dashboard-poll-status" aria-live="polite"></span>
      </div>`;

  const activeBody = `<ul class="dashboard-feed" id="dashboard-active" aria-label="Active runs"></ul>
      ${renderEmptyState({ tag: 'p', className: 'dashboard-feed-empty', id: 'dashboard-active-empty', text: '○ no active runs right now' })}`;

  const recentBody = `<ul class="dashboard-feed" id="dashboard-recent" aria-label="Recent runs"></ul>
      ${renderEmptyState({ tag: 'p', className: 'dashboard-feed-empty', id: 'dashboard-recent-empty', text: '○ no recent runs in the last 30 days' })}`;

  // Drill-down overlay — populated client-side from the polled feed + lazy hydration.
  const overlayHtml = `<div class="dashboard-overlay hidden" id="dashboard-overlay" role="dialog" aria-modal="true" aria-label="Run detail">
      <div class="dashboard-overlay-card" id="dashboard-overlay-card">
        <div class="dashboard-overlay-head">
          <span class="dashboard-overlay-title" id="dashboard-overlay-title"></span>
          <button type="button" class="dashboard-overlay-close" id="dashboard-overlay-close" aria-label="Close">✕</button>
        </div>
        <div class="dashboard-overlay-body" id="dashboard-overlay-body"></div>
      </div>
    </div>`;

  return renderPage({
    title: 'Dashboard - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/dashboard.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__DASHBOARD_DATA__', value: dashboardData },
    scripts: ['/common.js', '/dashboard.js'],
    content: `<main class="dashboard-page" data-url-key="${encodedUrlKey}">
    <header class="dashboard-header">
      <h1>Dashboard</h1>
      <p class="dashboard-subtitle">Autopilot runs across all your workspaces, live.</p>
    </header>

    ${renderSection({ boxed: true, className: 'dashboard-section dashboard-controls-section', titleClass: 'section-header', title: 'Workspaces', body: controlsBody })}

    ${renderSection({ boxed: true, className: 'dashboard-section dashboard-active-section', titleClass: 'section-header', title: 'Active', body: activeBody })}

    ${renderSection({ boxed: true, className: 'dashboard-section dashboard-recent-section', titleClass: 'section-header', title: 'Recent', body: recentBody })}
  </main>
  ${overlayHtml}
  ${footerHtml}`
  });
}
