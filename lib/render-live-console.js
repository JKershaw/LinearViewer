/**
 * Live Console page renderer (experimental, LIN-1436).
 *
 * The ambient, lean-back view: a real-time console of the whole swarm working.
 * This renders only the STATIC shell + mount points — a status banner, a tempo
 * sparkline canvas, a pulse-lane rail (currently-working agents), and the event
 * stream list. All motion + data live in public/live-console.{css,js}, which
 * polls the generation-free events endpoint and animates arrivals.
 *
 * Zero business logic here; the page is provider-free and the events endpoint
 * assembles the feed on demand (lib/live-console.js).
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { renderEmptyState } from './components/empty-state.js';

/**
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderLiveConsolePage(options = {}) {
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'live-console', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/live-console', urlKey, openRouterSource, featureFlags });

  // The client needs the workspace list to render cross-workspace filter chips
  // and filter the merged feed in place (no refetch). Pass a minimal projection.
  const consoleData = {
    urlKey: urlKey || '',
    workspaces: (navWorkspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name || w.urlKey })),
  };
  const encodedUrlKey = escapeHtml(urlKey || '');

  // Status banner: one live line the client refreshes each poll (aria-live here,
  // NOT on the wholesale-replaced stream list). Tempo sparkline sits alongside it
  // as the system's "rhythm".
  const bannerHtml = `<div class="lc-banner" data-testid="live-console-banner">
        <span class="lc-status-dot" id="live-console-dot" aria-hidden="true">●</span>
        <span class="lc-status-line" id="live-console-status" aria-live="polite">connecting to the feed…</span>
      </div>`;

  // Flowing activity strip: a full-width band that scrolls right→left in real
  // time — a soft heartbeat "hum" area beneath colour-coded event blips that
  // drift in from the right and fade as they age. All motion is in the client
  // (public/live-console.js) on the #live-console-tempo canvas.
  const pulseHtml = `<div class="lc-pulse" title="live activity — heartbeats and events, newest on the right">
        <canvas id="live-console-tempo" aria-hidden="true"></canvas>
      </div>`;

  // Cross-workspace filter chips (populated + wired client-side; hidden until the
  // client decides there is more than one workspace to filter).
  const chipsHtml = `<div class="lc-chips" id="live-console-chips" data-testid="live-console-chips" role="group" aria-label="Filter workspaces" hidden></div>`;

  // Swimlane timeline (LIN-1742 Phase 1 of LIN-1720 + LIN-1743 Phase 2): a
  // last-24h panel below the ambient strip. All layout/paint/gesture wiring is
  // client-side (public/live-console.js's paintTimeline + the zoom/pan gesture
  // handlers, using lib/timeline-zoom.js's shared pure helper) — this is only
  // the shell + mount points. The 1h/24h preset buttons are wired client-side
  // by public/live-console.js's wireTimelineGestures. The `<svg>` inside the
  // bars viewport is the run-to-run connector overlay (paintTimelineConnectors)
  // — a static, empty mount point; it must come before any bar node so bars
  // (appended later via appendChild) paint on top of the connector lines.
  //
  // No full-bleed breakout — the axis + bars viewport lay out in `.lc-page`'s
  // normal centered column, same as the label/presets and every other section
  // on this page. A full-bleed breakout was tried across three review cycles
  // and reverted: see the CSS comment on `.lc-timeline-section` in
  // public/live-console.css for why widening past the page column kept
  // producing viewport-conditional clipping bugs.
  const timelineHtml = `<section class="lc-timeline-section" aria-label="Last 24 hours">
        <div class="lc-section-label"><span class="lc-section-mark" aria-hidden="true">▤</span> last 24 hours</div>
        <div class="lc-timeline-presets" role="group" aria-label="Timeline range">
          <button type="button" class="lc-timeline-preset" data-testid="live-console-timeline-preset-1h" data-range="1h" aria-pressed="false">1h</button>
          <button type="button" class="lc-timeline-preset" data-testid="live-console-timeline-preset-24h" data-range="24h" aria-pressed="true">24h</button>
        </div>
        <div class="lc-timeline-axis" id="live-console-timeline-axis" aria-hidden="true"></div>
        <div class="lc-timeline-viewport" id="live-console-timeline" data-testid="live-console-timeline">
          <svg class="lc-timeline-connectors" id="live-console-timeline-connectors" data-testid="live-console-timeline-connectors" aria-hidden="true" preserveAspectRatio="none"></svg>
        </div>
        ${renderEmptyState({ tag: 'p', className: 'lc-timeline-empty', id: 'live-console-timeline-empty', attrs: 'hidden', text: '○ no runs in the last 24 hours' })}
      </section>`;

  // Pulse-lane rail: one breathing lane per currently-working agent.
  const lanesHtml = `<section class="lc-lanes-section" aria-label="Working now">
        <div class="lc-section-label"><span class="lc-section-mark" aria-hidden="true">◐</span> working now</div>
        <ul class="lc-lanes" id="live-console-lanes" data-testid="live-console-lanes"></ul>
        ${renderEmptyState({ tag: 'p', className: 'lc-lanes-empty', id: 'live-console-lanes-empty', attrs: 'hidden', text: '○ all quiet — agents will appear here the moment they pick up work' })}
      </section>`;

  // The stream: newest events at the top, trickling in. Below it a "view more"
  // affordance pages OLDER events (things that happened before you loaded the
  // page) into a separate history list, so you can see where the live feed sits.
  const streamHtml = `<section class="lc-stream-section" aria-label="Activity stream">
        <div class="lc-section-label"><span class="lc-section-mark" aria-hidden="true">≡</span> activity</div>
        <ol class="lc-stream" id="live-console-stream" data-testid="live-console-stream"></ol>
        ${renderEmptyState({ tag: 'p', className: 'lc-stream-empty', id: 'live-console-stream-empty', attrs: 'hidden', text: '○ nothing has happened yet — hang tight' })}
        <ol class="lc-stream lc-history" id="live-console-history" data-testid="live-console-history"></ol>
        <div class="lc-more" id="live-console-more" hidden>
          <button type="button" class="lc-more-btn" id="live-console-more-btn" data-testid="live-console-more">view earlier activity ↓</button>
        </div>
      </section>`;

  return renderPage({
    title: 'Live Console - Experimental',
    // observation.css supplies `.obs-act-chip`/`.obs-act-idle` — the Live
    // Console's heartbeat idle chip (LIN-1908 Phase C) reuses that exact
    // markup/class vocabulary rather than duplicating the rule here.
    stylesheets: ['/style.css', '/common-actions.css', '/live-console.css', '/observation.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__LIVE_CONSOLE_DATA__', value: consoleData },
    scripts: ['/common.js', '/live-console.js'],
    content: `<main class="lc-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Live Console', subtitle: 'Sit back and watch the swarm build. Updates trickle in across every workspace.' })}
    <p class="lc-experimental">⚗ Experimental — a lean-back, generation-free feed of the whole system working.</p>
    ${bannerHtml}
    ${pulseHtml}
    ${chipsHtml}
    ${timelineHtml}
    ${lanesHtml}
    ${streamHtml}
  </main>
  ${footerHtml}`,
  });
}
