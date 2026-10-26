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
  { key: 'rulings', label: 'Rulings' },
  { key: 'due', label: 'Scan-due' }
];

// The filter on the runs view (LIN-3983). Autopilot is the default.
const OBS_FILTERS = [
  { key: 'autopilot', label: 'Autopilot' },
  { key: 'standalone', label: 'Standalone' },
  { key: 'all', label: 'All' }
];

// LIN-2706 §B.9: the THIRD due-tab disclaimer — textually distinct from
// `obs-rulings-limits` (rulings tab) and `obs-due-limits` (existing due-tab
// disclaimer) above. The parent's explicit no-shared-partial constraint
// governs the THREE disclaimers, not this function's own two branches: both
// existing disclaimers are inline template-literal strings with no shared
// helper between them, and this one stays that way too — it is a dedicated
// renderer for this ONE new disclaimer, never folded into (or replacing)
// either of the other two.
//
// Takes a flag rather than hard-coding one wording: the dollar-estimate
// disclaimer is unconditional; the quota disclaimer is conditional on
// `isFreeTier`, mirroring the scan route's own asymmetry
// (routes/workspace-api.js:2466 `isFreeTier` gates ONLY the
// `freeTierStore.tryUse` check at :2472-2477, never the AI-configured gate
// above it). Two independent budget gates exist on that route — the
// OpenRouter call itself, and the free-tier quota — so they are disclosed
// as two separate sentences here too, never merged into one.
function renderBulkScanDisclaimer(isFreeTier) {
  // "below", not "above" (review finding 2, LIN-2706 PR #1424): this partial
  // mounts BEFORE #obs-due-bulk-bar, the element that actually carries the
  // estimate -- a live render measured the bar 280px below this text, so a
  // disclaimer calling it "above" pointed the wrong way. Fix the wording
  // rather than the mount point, since moving this after the bar would also
  // move it after the refusal/feed it introduces, which is not the fix N3
  // asked for.
  const quotaNote = isFreeTier
    ? `<p class="obs-bulk-scan-quota-note" id="obs-due-bulk-quota-note">You&rsquo;re on the free tier: each scan you send also draws against the shared hourly free quota, a separate gate from the dollar estimate below &mdash; a scan can be refused there even when the estimate looks affordable.</p>`
    : '';
  return `<p class="obs-bulk-scan-limits" id="obs-due-bulk-disclaimer">A scan costs about the estimate below, which is the average of the last 30 days, not a quote, and the real cost varies. Stop ends the queue and frees the browser. Scans already sent finish and are billed, and may still raise a question for you.</p>
      ${quotaNote}`;
}

/**
 * @param {Object} data
 * @param {Array<{urlKey: string, name: string}>} data.workspaces - Connected workspaces (for filter chips)
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces] - Full session workspaces (for navbar)
 * @param {Object} [options.featureFlags]
 * @param {Object} [options.scanCostEstimate] - Scan-due pre-run cost estimate (LIN-2706): {calls, pricedCalls, meanUsd, unknown}, carried verbatim into window.__OBSERVATION_DATA__
 * @returns {string} Complete HTML document
 */
export function renderObservationPage(data, options = {}) {
  const { workspaces = [] } = data;
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
    scanCostEstimate = null
  } = options;

  // LIN-2706 §B.9: the same free-tier signal the footer's `ai: ● free`
  // status already surfaces (server.js's getOpenRouterSource) -- 'free' means
  // no session OAuth key, no paid env key, and a free-tier key/flag present.
  // Reused rather than re-derived so this can never disagree with what the
  // footer on the SAME page load is telling the operator.
  const isFreeTier = openRouterSource === 'free';

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
    workspaces: workspaces.map(w => ({ urlKey: w.urlKey, name: w.name })),
    // Scan-due pre-run cost estimate (LIN-2706, §B.1). Carried verbatim,
    // `unknown` included -- collapsing it here would destroy exactly what
    // Phase 1 exists to preserve (§B.5 renders `unknown` as "unknown", never
    // `$0.00`).
    scanCostEstimate
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

  // The view strip (LIN-3983): Runs, Rulings and Scan-due, through the shared
  // tab piece. Each tab's name is its own line of hint text below the strip, so
  // a tab says what it holds. The Runs hint names the default filter; the
  // client rewrites it when the filter changes.
  // The Rulings tab (LIN-1728 Phase 4) and the Scan-due tab (LIN-2649 S4) keep
  // their own containers below, since a ruling and a due-check row are not
  // sessions. public/observation.js owns the switch and the URL state.
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
      <p class="obs-rulings-limits" id="obs-rulings-limits">Some questions are raised automatically, by a model reading a task. They can be wrong, so check each one before you answer.</p>
      <!-- Bulk-agree bar (LIN-2444 Phase 5): inline above the feed, not
           fixed -- a fixed bar would collide with the --nav-sticky-h mobile
           clearance budget (public/style.css). Own .obs-ruling-bulk-* names
           with real rules (public/observation.css) -- LIN-2711 found the
           Scan-due bulk bar's class names ship with zero CSS between them,
           and reusing those names would inherit that gap along with the
           unstyled controls. Rendered already wired to its click handlers
           (public/observation.js's initControls), same as the Scan-due bar;
           enabled/hidden/count state is derived, never stored, and re-synced
           by syncRulingsBulkBar on every repaint and every selection change.
           LIN-2758: the progress line sits OUTSIDE/ABOVE the bar itself,
           mirroring where #obs-due-progress sits relative to #obs-due-bulk-bar
           below -- an aria-live="polite" node updated once per row so
           screen readers get "Applying N of M..." without a visual-only
           indicator. Stop lives INSIDE the bar (mirrors #obs-due-stop),
           hidden unless a batch is running (toggled by syncRulingsBulkBar,
           never stored). -->
      <p class="obs-ruling-bulk-progress" id="obs-ruling-bulk-progress" aria-live="polite"></p>
      <!-- The bulk apply's own question (LIN-3983 PR 2): asked here, in the page, never through
           window.confirm(). public/observation.js's askBulkApply fills the text and the Apply label,
           and resolves on Apply or Cancel. Hidden until a bulk apply is pressed. -->
      <div class="obs-ruling-bulk-confirm" id="obs-ruling-bulk-confirm" role="group" aria-label="Confirm bulk apply" data-testid="obs-ruling-bulk-confirm" hidden>
        <p class="obs-ruling-bulk-confirm-text" id="obs-ruling-bulk-confirm-text" data-testid="obs-ruling-bulk-confirm-text"></p>
        <div class="obs-ruling-bulk-confirm-actions">
          <button type="button" class="action-btn obs-ruling-bulk-confirm-yes" id="obs-ruling-bulk-confirm-yes" data-testid="obs-ruling-bulk-confirm-yes">Apply</button>
          <button type="button" class="obs-ruling-bulk-confirm-no" id="obs-ruling-bulk-confirm-no" data-testid="obs-ruling-bulk-confirm-no">Cancel</button>
        </div>
      </div>
      <div class="obs-ruling-bulk-bar" id="obs-ruling-bulk-bar" hidden>
        <label class="obs-ruling-bulk-select-all">
          <input type="checkbox" id="obs-ruling-select-all" aria-label="select all proposed">
          <span class="obs-ruling-bulk-select-all-text">select all proposed</span>
        </label>
        <span class="obs-ruling-bulk-count" id="obs-ruling-selected-count"></span>
        <button type="button" class="action-btn obs-ruling-bulk-agree" id="obs-ruling-agree-selected" data-testid="obs-ruling-agree-selected" disabled>Apply 0 as proposed</button>
        <button type="button" class="obs-ruling-bulk-stop" id="obs-ruling-bulk-stop" data-testid="obs-ruling-bulk-stop" hidden>Stop</button>
      </div>
      <ul class="obs-feed obs-rulings-feed" id="obs-rulings" aria-label="Unanswered rulings"></ul>
      ${renderEmptyState({ tag: 'p', className: 'obs-feed-empty', id: 'obs-rulings-empty', text: '○ nothing waiting on you' })}
    </section>`;

  // Scan-due section (LIN-2649 S4/LIN-2667). Hidden by default, toggled by
  // public/observation.js's switchView alongside the other view containers.
  // Structurally parallel to rulingsSection, never sharing markup with
  // #obs-session-views — a due-check row is `{issueId, issueIdentifier,
  // dueStatus}`, not a session or a ruling.
  //
  // The disclaimer below is deliberately its own wording, not the rulings
  // disclaimer lifted to a shared partial (the parent ticket's explicit
  // instruction): a due check compares the task's content with its last scan,
  // and never asks a model, so the two are different things (LIN-3983 PR 2 keeps
  // the mechanism's name out of the copy; the code comment names it).
  const dueSection = `<section class="obs-section obs-due-section" id="obs-due-section" hidden>
      <h2 class="obs-eyebrow">Scan-due</h2>
      <p class="obs-due-limits" id="obs-due-limits">Due means the task&rsquo;s content has changed since its last scan. It tells you the content changed, not whether the change matters.</p>
      <p class="obs-due-cost-note" id="obs-due-cost-note">Checking is free: it reads each task but calls no model. Scanning a task calls a model and costs the estimate below.</p>
      ${renderBulkScanDisclaimer(isFreeTier)}
      <p class="obs-due-dayone" id="obs-due-dayone" hidden>Tasks you scanned before show &ldquo;unknown&rdquo; the first time you open this tab, because the way a scan records a task has changed. Scan each one again to record its baseline. After that, this tab can tell you when it is worth a re-scan.</p>
      <p class="obs-due-progress" id="obs-due-progress" aria-live="polite"></p>
      <div class="obs-bulk-scan-bar" id="obs-due-bulk-bar" hidden>
        <label class="obs-bulk-scan-select-all">
          <input type="checkbox" id="obs-due-select-all">
          select all due + unknown
        </label>
        <span class="obs-bulk-scan-count" id="obs-due-selected-count"></span>
        <span class="obs-bulk-scan-estimate" id="obs-due-selected-cost"></span>
        <!-- LIN-2701 §B.7: rendered ALREADY WIRED to their click handlers
             (public/observation.js's initControls) — plan-review N3, so this
             control never ships inert. Enabled/hidden state itself is
             derived, never stored, and re-synced by the SAME syncDueBulkBar
             that already owns the readouts above. -->
        <button type="button" class="obs-bulk-scan-run" id="obs-due-scan-selected" data-testid="obs-due-scan-selected" disabled>Scan selected (0)</button>
        <button type="button" class="obs-bulk-scan-stop" id="obs-due-stop" data-testid="obs-due-stop" hidden>Stop</button>
      </div>
      <p class="obs-bulk-scan-refusal" id="obs-due-bulk-refusal" hidden></p>
      <ul class="obs-feed obs-due-feed" id="obs-due-list" aria-label="Scan-due checks"></ul>
      ${renderEmptyState({ tag: 'p', className: 'obs-feed-empty', id: 'obs-due-empty', text: '○ nothing to check yet' })}
      <button type="button" class="obs-archive-more" id="obs-due-more" hidden>load more due checks</button>
    </section>`;

  return renderPage({
    title: 'Observation',
    stylesheets: ['/style.css', '/common-actions.css', '/observation.css', '/chat.css'],
    nav: navHtml,
    embeddedData: { globalVar: '__OBSERVATION_DATA__', value: observationData },
    // chat.js before observation.js: the rulings tab's option-button rows call
    // window.ChatUI.appendOptions (chat.js), so it must exist before
    // observation.js's poll/render logic runs.
    // scan.js added (LIN-2700, Phase 2 of LIN-2651): observation.js's bulk-scan
    // pool calls window.ScanSection.postScan. Confirmed inert to add here —
    // scan.js's only top-level statements are two `const`s off window.escapeHtml/
    // window.relativeTime (already defined by common.js) and, at the very end,
    // `window.ScanSection = { init, postScan }`; every DOM query/addEventListener
    // it contains lives inside functions this page never calls (init() is not
    // invoked here, only postScan()), so loading it does not run, wire, or
    // clobber anything on this page. Placed after common.js (for those two
    // globals) and before observation.js (its consumer); order versus chat.js
    // does not matter, since neither references the other.
    scripts: ['/common.js', '/scan.js', '/chat.js', '/observation.js'],
    content: `<main class="obs-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ titleHtml: `Observation ${bannerHtml}`, headerClass: 'obs-header' })}

    ${tabsHtml}

    ${waitingSection}

    <div class="obs-session-views" id="obs-session-views">
      ${renderSection({ className: 'obs-section obs-controls-section', titleClass: 'obs-eyebrow', title: 'Filter', body: controlsBody })}

      ${renderSection({ className: 'obs-section obs-active-section', titleClass: 'obs-eyebrow', title: activeTitle, body: activeBody })}

      ${renderSection({ className: 'obs-section obs-archive-section', titleClass: 'obs-eyebrow', title: 'Archive', body: archiveBody })}
    </div>

    ${rulingsSection}

    ${dueSection}
  </main>
  ${footerHtml}`
  });
}
