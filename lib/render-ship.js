/**
 * Ship Page Renderer
 *
 * Generates the HTML shell for the radial Ship view. Issue data is embedded as
 * JSON; the client-side `/ship.js` runs `assignLane` + `computePosition` to
 * place cards around the central ship.
 *
 * Card markup is the swim view's `.swim-box` — both stylesheets ship together
 * so prototype cards inherit swim's typography, state accents, and popover.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { flattenTrees } from './render-swipe.js';
import { getProviderForWorkspace } from './providers/registry.js';

/**
 * Render the ship page.
 *
 * @param {Object} data
 * @param {Array}  data.projectTrees
 * @param {Array}  data.inProgressTrees
 * @param {Array}  data.recentActivityTrees
 * @param {Object} options
 * @returns {string} Complete HTML document
 */
export function renderShipPage(data, options = {}) {
  const { projectTrees = [], inProgressTrees = [], recentActivityTrees = [] } = data;
  const {
    deployInfo = {},
    urlKey = null,
    openRouterSource = null,
    workspaces = [],
    featureFlags = {},
    isLanding = false,
    // Orientation mode (LIN-301): saved per-task compass bearings from the
    // latest roadmap report. A pure read — no LLM call on the ship side
    // (LIN-298). Defaults to [] so the toggle is simply inert when no report
    // has been generated for this workspace yet.
    orientation = [],
    orientationMeta = null,
    teams = [],
    selectedTeamId = null
  } = options;

  const navBarHtml = renderNavBar({ workspaces, teams, selectedTeamId, urlKey, currentPage: 'ship', featureFlags, isLanding });

  // Provider-aware popover link text (LIN-356 / LIN-177 S3 carry-forward F1).
  // Resolve the active workspace's provider display name; landing paths pass no
  // workspaces/urlKey and fall back to 'Linear' — byte-identical to before.
  const providerDisplayName = getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))?.ui?.displayName || 'Linear';

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/ship',
    urlKey,
    openRouterSource,
    featureFlags,
    isLanding
  });

  // Flatten everything we know about; the client decides what goes where.
  const projectIssues = flattenTrees(projectTrees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  const seen = new Set();
  const allIssues = [];
  for (const issue of inProgressIssues) {
    if (!seen.has(issue.id)) { seen.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of projectIssues) {
    if (!seen.has(issue.id)) { seen.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of recentIssues) {
    if (!seen.has(issue.id)) { seen.add(issue.id); allIssues.push(issue); }
  }

  // For consistent side-lane sorting if we ever group by project tier.
  const projectOrder = {};
  for (const tree of projectTrees) {
    if (tree.project?.name) {
      projectOrder[tree.project.name] = tree.project.sortOrder ?? 0;
    }
  }

  const shipData = {
    issues: allIssues,
    projectOrder,
    urlKey: urlKey || '',
    // Per-task bearings keyed by Linear identifier; [] when no saved report.
    orientation: Array.isArray(orientation) ? orientation : [],
    orientationMeta: orientationMeta || null
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  return renderPage({
    title: 'Ship',
    stylesheets: ['/style.css', '/swim.css', '/ship.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__SHIP_DATA__', value: shipData },
    scripts: ['/common.js', '/ship.js'],
    content: `<main class="ship-page" data-url-key="${encodedUrlKey}">
    <!-- Stage provides the scroll extent; #ship-canvas is scaled by the zoom
         transform (transform-origin 0 0). Keeping the transform off the scroll
         container means panning math stays in stage coordinates. -->
    <div class="ship-stage" id="ship-stage">
      <div class="ship-canvas" id="ship-canvas">
        <div class="ship-rect" id="ship-rect" data-sector="ship">
          <div class="ship-rect-label">in progress</div>
          <div class="ship-rect-cards" id="ship-rect-cards"></div>
        </div>
        <div class="ship-orbit" id="ship-orbit">
          <!-- rendered client-side -->
        </div>
        <div class="ship-heading-control" id="ship-heading-control">
          <button class="ship-heading-chip" id="ship-heading-chip" type="button" aria-expanded="false">
            <span class="ship-heading-chip-text" id="ship-heading-chip-text">pick a heading</span>
          </button>
          <div class="ship-heading-picker hidden" id="ship-heading-picker" role="dialog" aria-label="Pick heading">
            <label class="ship-heading-row">
              <span class="ship-heading-row-label">project</span>
              <select id="ship-heading-project">
                <option value="">— none —</option>
              </select>
            </label>
            <label class="ship-heading-row">
              <span class="ship-heading-row-label">label</span>
              <select id="ship-heading-label">
                <option value="">— none —</option>
              </select>
            </label>
            <button class="ship-heading-clear" id="ship-heading-clear" type="button">clear heading</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Mode + zoom controls are position:fixed and live OUTSIDE the scaled
         stage so the zoom transform never becomes their containing block. -->
    <div class="ship-mode-control" id="ship-mode-control" role="group" aria-label="Layout mode">
      <button class="ship-mode-btn" id="ship-mode-project" type="button" data-mode="project" aria-pressed="true">project</button>
      <button class="ship-mode-btn" id="ship-mode-orientation" type="button" data-mode="orientation" aria-pressed="false">orientation</button>
      <span class="ship-mode-note hidden" id="ship-mode-note"></span>
    </div>

    <div class="ship-backlog-control" id="ship-backlog-control" role="group" aria-label="Backlog visibility">
      <button class="ship-backlog-btn" id="ship-backlog-toggle" type="button" aria-pressed="false">backlog: hidden</button>
    </div>

    <div class="ship-zoom-control" id="ship-zoom-control" role="group" aria-label="Zoom">
      <button class="ship-zoom-btn" id="ship-zoom-out" type="button" aria-label="Zoom out">&minus;</button>
      <button class="ship-zoom-btn ship-zoom-reset" id="ship-zoom-reset" type="button" aria-label="Reset view">100%</button>
      <button class="ship-zoom-btn" id="ship-zoom-in" type="button" aria-label="Zoom in">&plus;</button>
    </div>

    <div class="swim-popover hidden" id="ship-popover">
      <div class="swim-popover-header">
        <a class="swim-popover-id" id="ship-popover-id" href="#"></a>
        <button class="swim-popover-close" id="ship-popover-close">&times;</button>
      </div>
      <div class="swim-popover-title" id="ship-popover-title"></div>
      <div class="swim-popover-meta" id="ship-popover-meta"></div>
      <div class="swim-popover-desc" id="ship-popover-desc"></div>
      <div class="ship-popover-links">
        <a class="swim-popover-link" id="ship-popover-link" target="_blank">View in ${escapeHtml(providerDisplayName)} &rarr;</a>
        <a class="swim-popover-link" id="ship-popover-swipe">Open in swipe &rarr;</a>
      </div>
    </div>
  </main>
  ${footerHtml}`
  });
}
