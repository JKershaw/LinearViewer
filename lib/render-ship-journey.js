/**
 * Ship Journey page renderer (experimental, LIN-1675 P3).
 *
 * Server-rendered shell + stable mount points; all playback/animation lives in
 * public/ship-journey.js (script order copies lib/render-ship.js's exactly —
 * common.js before the page script — so window.computeFitZoom exists before
 * first paint). Zero business logic here beyond the coverage-figure text and
 * the thin-data gate: the route (routes/ship-journey.js) already ran
 * deriveJourney (lib/ship-journey.js), so this only formats and embeds it.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { renderEmptyState } from './components/empty-state.js';

/**
 * A single waypoint can't show a trail or a direction, so it is treated as
 * thin data alongside the true zero-waypoint case — the "honest thin-data
 * empty state" P2 left as the only surviving guard (LIN-1684).
 */
const MIN_WAYPOINTS_FOR_JOURNEY = 2;

/**
 * A waypoint with no `completedAt` cannot be placed on a chronological trail.
 * This is reachable on the local provider, where `completedAt` is a stored
 * passthrough never auto-set on a state transition (LIN-1684 close-out ledger
 * item 2 — routed here as P3's call). Rather than invent a sort position or a
 * third coverage class, such waypoints are skipped from the rendered/playable
 * trail entirely. `deriveJourney`'s own `coverage.completions` already only
 * counts issues by `completedAt` falling inside the report span, so a
 * waypoint with no `completedAt` was never in that denominator either —
 * skipping it here keeps the displayed waypoint count and the coverage
 * numerator in agreement instead of silently diverging from each other.
 *
 * @param {Array} waypoints
 * @returns {Array}
 */
function placeableWaypoints(waypoints) {
  return waypoints.filter(wp => !!wp.completedAt);
}

/**
 * The coverage figure is the primary on-page claim, so it must say what
 * window it covers: `listFull()` retains at most 20 runs per workspace
 * (ReportHistoryStore's `MAX_REPORTS_PER_WORKSPACE`), so the coverage figure
 * is scoped to "the last N retained runs", never presented as the whole
 * journey (LIN-1683 close-out ledger item 1, routed to this ticket).
 *
 * The percentage is derived from `waypointCount` (the same filtered numerator
 * the sentence prints), never from `coverage.ratio` — `deriveJourney` computes
 * `ratio` over the UNFILTERED waypoint list, so reading it here would disagree
 * with a numerator that has had null-`completedAt` waypoints removed by
 * `placeableWaypoints` (LIN-1970 defect 1). A `ratio`-like value above 1 stays
 * possible and is not a bug: a waypoint can complete after `span.newest`,
 * which counts it in `waypointCount` but not in `coverage.completions`.
 *
 * @param {{completions: number}} coverage
 * @param {{totalReports: number}} capDropped
 * @param {number} waypointCount
 * @returns {string}
 */
function formatCoverageFigure(coverage, capDropped, waypointCount) {
  const { completions } = coverage;
  const runWord = capDropped.totalReports === 1 ? 'run' : 'runs';
  const capNote = capDropped.totalReports >= 20 ? ' — the retention cap; earlier runs are gone' : '';
  const windowPhrase = `across the last ${capDropped.totalReports} retained ${runWord}${capNote}`;

  if (completions === 0) {
    return `${waypointCount} waypoint${waypointCount === 1 ? '' : 's'} charted; no completions recorded in the retained window, ${windowPhrase}.`;
  }
  const pct = Math.round((waypointCount / completions) * 100);
  return `${pct}% coverage — ${waypointCount} of ${completions} completed task${completions === 1 ? '' : 's'} charted, ${windowPhrase}.`;
}

/**
 * @param {Object} journey - deriveJourney() output: { waypoints, coverage, capDropped, starChanges, bearingHistogram }
 * @param {Object} [options]
 * @param {Object} [options.deployInfo]
 * @param {string} [options.urlKey]
 * @param {string} [options.openRouterSource]
 * @param {Array}  [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @returns {string} Complete HTML document.
 */
export function renderShipJourneyPage(journey = {}, options = {}) {
  const {
    deployInfo = {},
    urlKey = '',
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {},
  } = options;

  const {
    waypoints = [],
    coverage = { completions: 0, ratio: null, span: null },
    capDropped = { atCapCount: 0, totalReports: 0, message: null },
    starChanges = [],
    bearingHistogram = {},
  } = journey || {};

  const navBarHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'ship-journey', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/ship-journey', urlKey, openRouterSource, featureFlags });
  const encodedUrlKey = escapeHtml(urlKey || '');

  const rendered = placeableWaypoints(waypoints);
  const isThin = rendered.length < MIN_WAYPOINTS_FOR_JOURNEY;

  // Embedded for the client to animate — playback, auto-fit, and the
  // star-change segment breaks are all client-side concerns (public/ship-journey.js).
  const journeyData = {
    urlKey: urlKey || '',
    waypoints: rendered,
    starChanges,
    bearingHistogram,
  };

  let bodyHtml;
  if (isThin) {
    // The honest thin-data empty state: this is NOT the same claim as "this
    // workspace has no history" — a store failure and a genuinely empty
    // workspace both arrive as [] from listFull() (LIN-1683 close-out ledger
    // item 2), so the copy below deliberately avoids asserting either one.
    bodyHtml = renderEmptyState({
      tag: 'p',
      className: 'sj-empty',
      id: 'ship-journey-empty',
      attrs: 'data-testid="ship-journey-empty"',
      text: '○ not enough charted history yet — waypoints appear once completed tasks have been scored against a north star in a saved roadmap report; check back after a few more runs',
    });
  } else {
    const coverageHtml = `<p class="sj-coverage" id="ship-journey-coverage" data-testid="ship-journey-coverage">${escapeHtml(formatCoverageFigure(coverage, capDropped, rendered.length))}</p>`;
    const capNoteHtml = capDropped.message
      ? `<p class="sj-cap-note" data-testid="ship-journey-cap-note">⚠ ${escapeHtml(capDropped.message)}</p>`
      : '';
    const lastIndex = Math.max(0, rendered.length - 1);
    const controlsHtml = `<div class="sj-controls" id="ship-journey-controls" data-testid="ship-journey-controls" role="group" aria-label="Playback">
        <button type="button" class="sj-control-btn" id="ship-journey-step-back" data-testid="ship-journey-step-back" aria-label="Step back">⏮</button>
        <button type="button" class="sj-control-btn" id="ship-journey-play" data-testid="ship-journey-play" aria-pressed="false" aria-label="Play">▶</button>
        <button type="button" class="sj-control-btn" id="ship-journey-step-forward" data-testid="ship-journey-step-forward" aria-label="Step forward">⏭</button>
        <input type="range" class="sj-scrub" id="ship-journey-scrub" data-testid="ship-journey-scrub" min="0" max="${lastIndex}" value="${lastIndex}" aria-label="Scrub journey">
      </div>`;
    const mapHtml = `<div class="sj-map-wrap" id="ship-journey-map-wrap">
        <svg class="sj-map" id="ship-journey-map" data-testid="ship-journey-map" aria-label="Journey map" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet"></svg>
      </div>`;
    bodyHtml = `${coverageHtml}${capNoteHtml}${controlsHtml}${mapHtml}`;
  }

  return renderPage({
    title: 'Ship Journey - Experimental',
    stylesheets: ['/style.css', '/common-actions.css', '/ship-journey.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__SHIP_JOURNEY_DATA__', value: journeyData },
    scripts: ['/common.js', '/ship-journey.js'],
    content: `<main class="sj-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Ship Journey', subtitle: 'Play back completed work as waypoints charted against your north star.' })}
    <p class="sj-experimental">⚗ Experimental — a generation-free replay of your roadmap history.</p>
    ${bodyHtml}
  </main>
  ${footerHtml}`,
  });
}
