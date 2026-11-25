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
import { PREVIEW_HOME_LABEL } from './components/footer.js';
import { renderFilterLine, renderPreviewSignIn } from './components/navbar.js';
import { renderFrame, renderPublicFrame } from './components/frame.js';
import { flattenIssuesForShip } from './task-board-view.js';
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
    workspace,
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

  // Provider-aware popover link text (LIN-356 / LIN-177 S3 carry-forward F1).
  // Resolve the active workspace's provider display name; landing paths pass no
  // workspace and fall back to 'Linear' — byte-identical to before.
  const providerDisplayName = getProviderForWorkspace(workspace)?.ui?.displayName || 'Linear';

  const allIssues = flattenIssuesForShip({ projectTrees, inProgressTrees, recentActivityTrees });

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

  const content = `<div class="ship-page" data-url-key="${encodedUrlKey}">
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
  </div>`;
  const page = {
    stylesheets: ['/style.css', '/swim.css', '/ship.css'],
    embeddedData: { globalVar: '__SHIP_DATA__', value: shipData },
    scripts: ['/common.js', '/ship.js'],
    content,
  };

  // LIN-4564 (LIN-4342 piece 3): the signed-out preview sits in the public frame; its band carries the preview's sign-in
  // path (renderPreviewSignIn: the sole sign-in path here, `nav-login-*` kept) and the way back to Harbour's front page.
  if (isLanding) {
    return renderPublicFrame({ ...page, title: 'Ship', back: { href: '/', label: PREVIEW_HOME_LABEL }, signIn: renderPreviewSignIn(), deployInfo });
  }

  // LIN-4564: a workspace's Ship sits in the frame as its flagged place; the team selector is in the frame's filter line.
  return renderFrame({
    ...page,
    place: 'ship',
    urlKey,
    workspaces,
    featureFlags,
    openRouterSource,
    deployInfo,
    filters: renderFilterLine({ currentPage: 'ship', urlKey, teams, selectedTeamId }),
  });
}
