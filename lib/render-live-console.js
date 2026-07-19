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
        <span class="lc-tempo" title="event activity, last 20 min"><canvas id="live-console-tempo" width="160" height="28" aria-hidden="true"></canvas></span>
      </div>`;

  // Cross-workspace filter chips (populated + wired client-side; hidden until the
  // client decides there is more than one workspace to filter).
  const chipsHtml = `<div class="lc-chips" id="live-console-chips" data-testid="live-console-chips" role="group" aria-label="Filter workspaces" hidden></div>`;

  // Pulse-lane rail: one breathing lane per currently-working agent.
  const lanesHtml = `<section class="lc-lanes-section" aria-label="Working now">
        <div class="lc-section-label"><span class="lc-section-mark" aria-hidden="true">◐</span> working now</div>
        <ul class="lc-lanes" id="live-console-lanes" data-testid="live-console-lanes"></ul>
        ${renderEmptyState({ tag: 'p', className: 'lc-lanes-empty', id: 'live-console-lanes-empty', attrs: 'hidden', text: '○ all quiet — agents will appear here the moment they pick up work' })}
      </section>`;

  // The stream: newest events at the top, trickling in.
  const streamHtml = `<section class="lc-stream-section" aria-label="Activity stream">
        <div class="lc-section-label"><span class="lc-section-mark" aria-hidden="true">≡</span> activity</div>
        <ol class="lc-stream" id="live-console-stream" data-testid="live-console-stream"></ol>
        ${renderEmptyState({ tag: 'p', className: 'lc-stream-empty', id: 'live-console-stream-empty', attrs: 'hidden', text: '○ nothing has happened yet — hang tight' })}
      </section>`;

  return renderPage({
    title: 'Live Console - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/live-console.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__LIVE_CONSOLE_DATA__', value: consoleData },
    scripts: ['/common.js', '/live-console.js'],
    content: `<main class="lc-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Live Console', subtitle: 'Sit back and watch the swarm build. Updates trickle in across every workspace.' })}
    <p class="lc-experimental">⚗ Experimental — a lean-back, generation-free feed of the whole system working.</p>
    ${bannerHtml}
    ${chipsHtml}
    ${lanesHtml}
    ${streamHtml}
  </main>
  ${footerHtml}`,
  });
}
