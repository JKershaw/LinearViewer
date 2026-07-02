/**
 * Observation Page Renderer (LIN-595).
 *
 * Renders the first-class autopilot Observation page shell: a mobile-first,
 * CLI/terminal-aesthetic feed where a user sits back and watches autopilot work
 * one *session* at a time. Sessions are the LIN-591 reconstructed `sessionId`
 * spine (a seed/epic spanning its descended + spun-off tasks), NOT the older
 * per-task issue grouping.
 *
 * Three levels of progressive disclosure (LIN-595):
 *   1. Feed of ACTIVE sessions at the top; a collapsible ARCHIVE of completed
 *      sessions below (with a count). Sorted by most-recent activity.
 *   2. Session card (collapsed): run id + seed task title, a status pill
 *      (◐/✓/✕), the one-sentence summary (LIN-592), runtime + model (LIN-594),
 *      and a per-worker-run progress bar (the live segment pulses).
 *   3. Session body (drill-down): tasks touched + relationships (session-context,
 *      LIN-593) with best-effort live Linear state (lazy hydration); per-task
 *      worker-session tree (phase / recap / metric chips); per-node drill-down
 *      to the activity log, produced-artifact links, and next steps (LIN-594 +
 *      on-demand run-summary). All Level-3 fetches are drill-down-only.
 *
 * Models its layout on the retired experimental dashboard / Swipe (mobile-first),
 * NOT the Pipeline desktop floor. Reuses the page shell + navbar + footer +
 * section components and the visibility-gated poll pattern (initial config in
 * `window.__OBSERVATION_DATA__`, then a poll of `/api/dashboard/sessions` driven
 * by `public/observation.js`). Zero business logic here — formatting/polling
 * live in the CSS/JS.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
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
export function renderObservationPage(data, options = {}) {
  const { workspaces = [] } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {}
  } = options;

  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/observation', urlKey, openRouterSource, featureFlags });

  // Observation-local app bar (LIN-927, Strategy 1). The mockup replaces the
  // shared global `renderNavBar` with a bespoke sticky, translucent bar — brand
  // wordmark, a workspace chip with a health dot, and a `← projects` back
  // affordance. The theme toggle is deliberately NOT duplicated here: it already
  // lives in the footer (the one global control). Kept page-local so the global
  // nav is untouched.
  const currentWorkspaceName =
    navWorkspaces.find(w => w.urlKey === urlKey)?.name
    || workspaces.find(w => w.urlKey === urlKey)?.name
    || urlKey
    || '';
  const projectsHref = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/` : '/';
  const appBarHtml = `<header class="obs-appbar" data-testid="observation-appbar">
    <span class="obs-appbar-brand" data-testid="observation-appbar-brand">harbour<span class="obs-appbar-brand-dot">.</span></span>
    <span class="obs-appbar-ws" data-testid="observation-appbar-workspace">
      <span class="obs-appbar-ws-dot" aria-hidden="true"></span>${escapeHtml(currentWorkspaceName)}
    </span>
    <a class="obs-appbar-back" href="${projectsHref}" data-testid="observation-appbar-projects">← projects</a>
  </header>`;

  const observationData = {
    urlKey: urlKey || '',
    workspaces: workspaces.map(w => ({ urlKey: w.urlKey, name: w.name }))
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  // Workspace filter chips — one per connected workspace, all on by default.
  // Client-side filtering only (merged data is cheap, so filtering is free).
  const chipsHtml = workspaces.length > 0
    ? workspaces.map(ws => `
            <button type="button" class="obs-chip is-on" data-ws="${escapeHtml(ws.urlKey)}">
              <span class="obs-chip-dot"></span>${escapeHtml(ws.name || ws.urlKey)}
            </button>`).join('')
    : renderEmptyState({ tag: 'p', className: 'obs-empty', text: 'No connected workspaces.' });

  // The top status-recap line (active/done/error counts) was removed (LIN-608) —
  // the Active feed and per-session pills already carry that story. Only the live
  // poll status remains, now fused into the view header as the pulsing green
  // "● live" indicator beside the title (LIN-927), replacing the separate banner.
  // Initial placeholder is "loading…", not "connecting…": there is no socket to
  // connect (the feed is polled), so the honest initial state is "the first
  // /sessions poll is in flight". The client flips it to "● live" / "●
  // disconnected" once that poll resolves (LIN-617). The #obs-banner /
  // #obs-poll-status hooks are preserved so `setPollStatus()` keeps driving it.
  const bannerHtml = `<div class="obs-banner obs-livetag" id="obs-banner" aria-live="polite">
      <span class="obs-poll-status" id="obs-poll-status">loading…</span>
    </div>`;

  // Workspace chips only — no scope toggle: the feed is sessionId-grouped, which
  // is autopilot-anchored by construction.
  const controlsBody = `<div class="obs-controls">
        <div class="obs-chips" id="obs-chips" role="group" aria-label="Filter workspaces">${chipsHtml}</div>
      </div>`;

  // Level 1 — active feed.
  const activeBody = `<ul class="obs-feed" id="obs-active" aria-label="Active sessions"></ul>
      ${renderEmptyState({ tag: 'p', className: 'obs-feed-empty', id: 'obs-active-empty', text: '○ nothing running right now' })}`;

  // Level 1 — collapsible completed archive with a count. Collapsed by default
  // (the eye stays on what's live); the header toggles it open.
  const archiveBody = `<button type="button" class="obs-archive-toggle" id="obs-archive-toggle" aria-expanded="false" aria-controls="obs-recent">
        <span class="obs-archive-caret" aria-hidden="true">▸</span>
        <span class="obs-archive-label">Completed</span>
        <span class="obs-archive-count" id="obs-archive-count">0</span>
      </button>
      <div class="obs-archive-body" id="obs-archive-body" hidden>
        <ul class="obs-feed" id="obs-recent" aria-label="Completed sessions"></ul>
        ${renderEmptyState({ tag: 'p', className: 'obs-feed-empty', id: 'obs-recent-empty', text: '○ no finished sessions in the last 30 days' })}
        <button type="button" class="obs-archive-more" id="obs-archive-more" hidden>load more</button>
      </div>`;

  return renderPage({
    title: 'Observation',
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css'],
    nav: appBarHtml,
    embeddedData: { globalVar: '__OBSERVATION_DATA__', value: observationData },
    scripts: ['/common.js', '/observation.js'],
    content: `<main class="obs-page" data-url-key="${encodedUrlKey}">
    <header class="obs-header">
      <h1>Observation</h1>
      ${bannerHtml}
    </header>

    ${renderSection({ className: 'obs-section obs-controls-section', titleClass: 'obs-eyebrow', title: 'Filter', body: controlsBody })}

    ${renderSection({ className: 'obs-section obs-active-section', titleClass: 'obs-eyebrow', title: 'Active', body: activeBody })}

    ${renderSection({ className: 'obs-section obs-archive-section', titleClass: 'obs-eyebrow', title: 'Archive', body: archiveBody })}
  </main>
  ${footerHtml}`
  });
}
