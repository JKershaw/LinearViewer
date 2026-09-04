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
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderSection } from './components/section.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderPageHeader } from './components/page-header.js';

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
  const bannerHtml = `<span class="obs-banner obs-livetag" id="obs-banner" aria-live="polite"><span class="obs-poll-status" id="obs-poll-status">loading…</span></span>`;

  // Intra-page view switcher (LIN-1194): the current feed becomes the "Autopilot"
  // tab; the new "Sessions" tab shows every in-flight session, including standalone
  // user-dispatched cli/web prompts the autopilot-centric feed drops. This is an
  // in-page tab (both tabs share the shell/feed markup and re-poll the SAME
  // /api/dashboard/sessions endpoint with a `?view=` discriminator), distinct from
  // the navbar's cross-PAGE view switcher. Autopilot is selected by default so the
  // page's initial behaviour is byte-identical to before. public/observation.js
  // owns the tab state, the per-view bucketing, and the poll-URL switch.
  // Rulings tab (LIN-1728 Phase 4, decision 2): the third `obs-tab`, reusing
  // the shell/filter-chips/poll-loop rather than a new experimental view. Unlike
  // the Autopilot/Sessions pair it does not share the active/archive feed markup
  // below — a ruling row is a different payload shape entirely (an unanswered
  // decision, not a session) — so it gets its own container, `#obs-rulings`,
  // shown/hidden by public/observation.js's switchView.
  const tabsHtml = `<div class="obs-tabs" id="obs-tabs" role="tablist" aria-label="Observation view">
        <button type="button" class="obs-tab is-active" data-view="autopilot" role="tab" aria-selected="true">Autopilot</button>
        <button type="button" class="obs-tab" data-view="sessions" role="tab" aria-selected="false">Sessions</button>
        <button type="button" class="obs-tab" data-view="rulings" role="tab" aria-selected="false">Rulings</button>
      </div>`;

  // Workspace chips only — no scope toggle: the feed is sessionId-grouped, which
  // is autopilot-anchored by construction.
  const controlsBody = `<div class="obs-controls">
        <div class="obs-chips" id="obs-chips" role="group" aria-label="Filter workspaces">${chipsHtml}</div>
      </div>`;

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
  // tab is selected on load, byte-identical to before this ticket); public/
  // observation.js's switchView toggles `hidden` on this section alongside the
  // Filter/Active/Archive sections above when the tab changes. Each row is
  // built client-side (a ruling is `{decision, decisionCase, anchor, disposition,
  // canReply}`, not a session) via appendOptions' option-button primitive
  // (public/chat.js) — no server-rendered rows here, same "poll then paint"
  // shape as the other two tabs.
  const rulingsSection = `<section class="obs-section obs-rulings-section" id="obs-rulings-section" hidden>
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
    // chat.js before observation.js: the rulings tab's option-button rows call
    // window.ChatUI.appendOptions (chat.js), so it must exist before
    // observation.js's poll/render logic runs.
    scripts: ['/common.js', '/chat.js', '/observation.js'],
    content: `<main class="obs-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ titleHtml: `Observation ${bannerHtml}`, headerClass: 'obs-header' })}

    ${tabsHtml}

    <div class="obs-session-views" id="obs-session-views">
      ${renderSection({ className: 'obs-section obs-controls-section', titleClass: 'obs-eyebrow', title: 'Filter', body: controlsBody })}

      ${renderSection({ className: 'obs-section obs-active-section', titleClass: 'obs-eyebrow', title: activeTitle, body: activeBody })}

      ${renderSection({ className: 'obs-section obs-archive-section', titleClass: 'obs-eyebrow', title: 'Archive', body: archiveBody })}
    </div>

    ${rulingsSection}
  </main>
  ${footerHtml}`
  });
}
