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
 * NOT a desktop-first layout. Reuses the page shell + navbar + footer +
 * section components and the visibility-gated poll pattern (initial config in
 * `window.__OBSERVATION_DATA__`, then a poll of `/api/dashboard/sessions` driven
 * by `public/observation.js`). Zero business logic here — formatting/polling
 * live in the CSS/JS.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderSection } from './components/section.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderPageHeader } from './components/page-header.js';
import { renderTabs } from './components/tabs.js';

// The view tabs (LIN-3983), in order. The keys are the page's URL contract
// (`?view=`), so they are not renamed without keeping the old values working.
const OBS_TABS = [
  { key: 'runs', label: 'Runs' },
  { key: 'rulings', label: 'Rulings' }
];

// The filter on the runs view (LIN-3983). Autopilot is the default.
const OBS_FILTERS = [
  { key: 'autopilot', label: 'Autopilot' },
  { key: 'standalone', label: 'Standalone' },
  { key: 'all', label: 'All' }
];

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

  // Observation now uses the SHARED header nav (LIN-978), replacing its bespoke
  // `obs-appbar` (LIN-927): the app bar carried no view switcher, so it is
  // folded into `renderNavBar` — which now carries the tier-gated view switcher
  // for every workspace page. The bespoke workspace chip is superseded by the
  // nav's workspace selector; 'projects' is a regular view-tab item for
  // all pages; the decorative health dot (deferred design Q6, no real
  // wiring) is dropped.
  //
  // CORRECTION (LIN-2298). This comment used to end "the obs-appbar's
  // sticky/translucent feel is not carried over: a global sticky header
  // intercepts clicks on scrolled content, so the shared nav stays in normal
  // flow". False at HEAD: `.nav-bar` IS `position: sticky; top: 0` with a
  // z-index and a translucent backdrop-blurred wash (public/style.css). The
  // click-interception hazard was real and did back the sticky out once, but it
  // was later solved with per-interaction `scroll-margin-top` and the sticky
  // reinstated — and this sentence was not updated to match.
  //
  // Corrected here as the sibling instance of the same false claim LIN-2298
  // found in public/observation.css. Fixing one and leaving its twin is the
  // pattern LIN-2302 exists to clean up, so both move together.
  const navHtml = renderNavBar({
    workspaces: navWorkspaces,
    urlKey,
    currentPage: 'observation',
    featureFlags
  });

  const observationData = {
    urlKey: urlKey || '',
    workspaces: workspaces.map(w => ({ urlKey: w.urlKey, name: w.name }))
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  // Workspace scope (LIN-3983 PR 2, decision 4): the feed opens on this workspace, as Live Console does.
  // "All workspaces" widens it, and the workspace chips below then filter inside it. The scope control
  // shows only when there is more than one workspace. The waiting block ignores the scope.
  const scopeHtml = workspaces.length > 1
    ? `<div class="obs-scope" id="obs-scope" role="group" aria-label="Workspace scope" data-testid="obs-scope">
          <button type="button" class="obs-filter-btn obs-scope-btn is-on" data-scope="current" aria-pressed="true" data-testid="obs-scope-current">This workspace</button>
          <button type="button" class="obs-filter-btn obs-scope-btn" data-scope="all" aria-pressed="false" data-testid="obs-scope-all">All workspaces</button>
        </div>`
    : '';

  // Workspace filter chips — one per connected workspace. Only this workspace's chip starts on, and the
  // chips show only under "All workspaces". Client-side filtering only (merged data is cheap, so filtering is free).
  const chipsHtml = workspaces.length > 0
    ? workspaces.map(ws => `
            <button type="button" class="obs-chip${ws.urlKey === urlKey ? ' is-on' : ''}" data-ws="${escapeHtml(ws.urlKey)}">
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
  const bannerHtml = `<span class="obs-banner obs-livetag" id="obs-banner" aria-live="polite"><span class="obs-poll-status" id="obs-poll-status">loading…</span></span>`;

  // The view strip (LIN-3983): Runs and Rulings, through the shared
  // tab piece. Each tab's name is its own line of hint text below the strip, so
  // a tab says what it holds. The Runs hint names the default filter; the
  // client rewrites it when the filter changes.
  // The Rulings tab (LIN-1728 Phase 4) keeps its own container below, since a
  // ruling is not a session. public/observation.js owns the switch and the URL state.
  const tabsHtml = `<div class="obs-tabs-wrap" id="obs-tabs">${renderTabs({
    tabs: OBS_TABS,
    activeKey: 'runs',
    ariaLabel: 'Observation view',
    testIdPrefix: 'obs-tab',
    className: 'obs-tabs'
  })}</div>
    <p class="obs-view-hint" id="obs-view-hint" data-testid="obs-view-hint">Autopilot runs touched in the last 24 hours. Older runs are in the archive below.</p>`;

  // The runs filter (LIN-3983): which runs the feed shows. Autopilot is the
  // default and keeps today's read; standalone and all include runs dispatched on
  // their own. Its buttons are not `.obs-chip`: that class is the workspace chips'
  // hook, and the workspace filter's own specs count it.
  const filterHtml = `<div class="obs-filter" id="obs-filter" role="group" aria-label="Which runs to show" data-testid="obs-filter">${
    OBS_FILTERS.map(({ key, label }) => `<button type="button" class="obs-filter-btn${key === 'autopilot' ? ' is-on' : ''}" data-filter="${key}" aria-pressed="${key === 'autopilot' ? 'true' : 'false'}" data-testid="obs-filter-${key}">${label}</button>`).join('')
  }</div>`;

  // Workspace chips (client-side filtering only), under the run filter.
  const controlsBody = `<div class="obs-controls">
        ${filterHtml}
        ${scopeHtml}
        <div class="obs-chips" id="obs-chips" role="group" aria-label="Filter workspaces" hidden>${chipsHtml}</div>
      </div>`;

  // The waiting block (LIN-3983): what waits on you, above the runs feed. It holds
  // the open ruling rows (the Rulings tab's own nodes, capped) and one compact row
  // per waiting run no ruling row covers. Hidden when nothing waits, and off the
  // runs view; public/observation.js paints it.
  const waitingSection = `<section class="obs-section obs-waiting" id="obs-waiting" aria-labelledby="obs-waiting-title" data-testid="obs-waiting" hidden>
      <h2 class="obs-eyebrow" id="obs-waiting-title">Waiting on you · <span id="obs-waiting-count" data-testid="obs-waiting-count">0</span></h2>
      <ul class="obs-feed obs-waiting-rulings" id="obs-waiting-rulings" aria-label="Questions waiting on you" data-testid="obs-waiting-rulings"></ul>
      <ul class="obs-feed obs-waiting-runs" id="obs-waiting-runs" aria-label="Runs waiting on you" data-testid="obs-waiting-runs"></ul>
      <button type="button" class="obs-waiting-more" id="obs-waiting-more" data-testid="obs-waiting-more" hidden></button>
    </section>`;

  // Level 1 — active-section eyebrow with the live running count (LIN-929):
  // design §3.4/§8 specifies `Active · N running`, not a static `Active`. The
  // count starts at 0 (no feed data is rendered server-side — the first
  // /sessions poll is still in flight) and `public/observation.js` keeps the
  // `.obs-active-count-n` number in sync as sessions come and go. The number is
  // a machine fact, so it takes the structural (mono) face per the type split.
  const activeTitle = 'Active<span class="obs-active-count" id="obs-active-count" aria-live="polite">'
    + ' · <span class="obs-active-count-n">0</span> running</span>';

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

  // Level 1 — rulings feed (LIN-1728 Phase 4). Hidden by default (the Autopilot
  // tab is selected on load); public/observation.js's switchView toggles `hidden`
  // on this section alongside the Filter/Active/Archive sections above when the
  // tab changes. Each row is an open question record addressed to the person,
  // built client-side from the shared question-record card (LIN-4532, LIN-4541) —
  // no server-rendered rows here, same "poll then paint" shape as the runs tab.
  const rulingsSection = `<section class="obs-section obs-rulings-section" id="obs-rulings-section" data-testid="obs-rulings-section" hidden>
      <h2 class="obs-eyebrow">Rulings
        <a class="obs-rulings-kpis-link" href="/workspace/${encodeURIComponent(urlKey)}/escalation-kpis">escalation KPIs →</a>
      </h2>
      <ul class="obs-feed obs-rulings-feed" id="obs-rulings" aria-label="Unanswered rulings"></ul>
      ${renderEmptyState({ tag: 'p', className: 'obs-feed-empty', id: 'obs-rulings-empty', text: '○ nothing waiting on you' })}
    </section>`;

  return renderPage({
    title: 'Observation',
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css', '/chat.css'],
    nav: navHtml,
    embeddedData: { globalVar: '__OBSERVATION_DATA__', value: observationData },
    // observation.js is a native module (LIN-4463 piece 4) and reads no cost-format bridge, so this page does not load
    // one. A module runs after every classic script above it, wherever listed.
    scripts: ['/common.js', { module: '/question-records.js' }, { module: '/observation.js' }],
    content: `<main class="obs-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ titleHtml: `Observation ${bannerHtml}`, headerClass: 'obs-header' })}

    ${tabsHtml}

    ${waitingSection}

    <div class="obs-session-views" id="obs-session-views" data-testid="obs-session-views">
      ${renderSection({ className: 'obs-section obs-controls-section', titleClass: 'obs-eyebrow', title: 'Filter', body: controlsBody })}

      ${renderSection({ className: 'obs-section obs-active-section', titleClass: 'obs-eyebrow', title: activeTitle, body: activeBody })}

      ${renderSection({ className: 'obs-section obs-archive-section', titleClass: 'obs-eyebrow', title: 'Archive', body: archiveBody })}
    </div>

    ${rulingsSection}
  </main>
  ${footerHtml}`
  });
}
