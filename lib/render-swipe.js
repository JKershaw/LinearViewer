/**
 * Swipe Page Renderer
 *
 * Generates HTML for the mobile-first task swipe page. The ordering pipeline that
 * the deck and Home's top-task mark share (LIN-2944 P1) is composed in
 * task-board-view.js (LIN-3754); this page formats its output.
 * Issue data is embedded as JSON (`window.__SWIPE_DATA__`) for client-side cards.
 *
 * Pipeline layers, in the order a card meets them (the ordering layers live in
 * task-order.js, LIN-3554):
 *   flatten trees → card   (flattenTrees, task-order.js)
 *   dedupe, link parents   (orderIssuesForSwipe, task-board-view.js)
 *   rank                   (sortIssuesForSwipe, task-order.js)
 *   dependency order       (applyBlockingOrder, then clusterByParent, task-order.js)
 *   stamp                  (isSeed, why; sessionCount in renderSwipePage)
 *
 * Embedded JSON is compared byte-for-byte, so the key order of cards and of
 * `__SWIPE_DATA__` is part of the contract — see the notes beside each builder.
 */

import { escapeHtml } from './utils/html.js';
import { PREVIEW_NOTE, PREVIEW_HOME_LABEL } from './components/footer.js';
import { renderFilterLine, renderPreviewSignIn } from './components/navbar.js';
import { renderFrame, renderPublicFrame } from './components/frame.js';
import { buildPromptOpts } from './render-prompt-opts.js';
import { renderEmptyState } from './components/empty-state.js';
import { orderIssuesForSwipe } from './task-board-view.js';
import { getProviderForWorkspace } from './providers/registry.js';

/**
 * Build the filter dropdown groups: All, In Progress, Recent activity, one per
 * project, then one per label in use (most used first, ties by name).
 *
 * @param {Array} allIssues - All deduplicated issues
 * @returns {Array<{key: string, label: string, count: number}>} Filter groups
 */
export function buildFilterGroups(allIssues) {
  const countWhere = (predicate) => allIssues.filter(predicate).length;
  const groups = [{ key: 'all', label: 'All', count: allIssues.length }];

  const inProgress = countWhere(i => i.stateType === 'started');
  if (inProgress > 0) groups.push({ key: 'in-progress', label: 'In Progress', count: inProgress });

  const recent = countWhere(i => i.section === 'recent-activity');
  if (recent > 0) groups.push({ key: 'recent-activity', label: 'Recent activity', count: recent });

  const projectNames = [...new Set(allIssues.map(i => i.projectName).filter(Boolean))];
  for (const name of projectNames) {
    groups.push({ key: `project:${name}`, label: name, count: countWhere(i => i.projectName === name) });
  }

  // A label counts once per issue, however often the issue repeats it.
  const labelCounts = new Map();
  for (const issue of allIssues) {
    for (const name of new Set((issue.labels || []).filter(Boolean))) {
      labelCounts.set(name, (labelCounts.get(name) || 0) + 1);
    }
  }
  const labelsByUse = [...labelCounts].sort(([nameA, countA], [nameB, countB]) =>
    countB - countA || nameA.localeCompare(nameB));
  for (const [name, count] of labelsByUse) {
    groups.push({ key: `label:${name}`, label: name, count });
  }

  return groups;
}

// Re-exported so existing imports (server.js, the unit tests) keep working (LIN-3754).
export { orderIssuesForSwipe };

// =============================================================================
// Page
// =============================================================================

/**
 * Renders the swipe page.
 *
 * @param {Object} data - Page data
 * @param {Array} data.projectTrees - Project trees from fetchAndPrepareProjects
 * @param {Array} data.inProgressTrees - In-progress trees
 * @param {Array} data.recentActivityTrees - Recent activity trees
 * @param {Object} options - Page options
 * @returns {string} Complete HTML document
 */
export function renderSwipePage(data, options = {}) {
  const { projectTrees = [], inProgressTrees = [], recentActivityTrees = [] } = data;
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], workspace, featureFlags = {}, customPrompts = [], initialIdentifier = null, isLanding = false, isLocalhost = false, sessionCounts = {}, teams = [], selectedTeamId = null, proxyDefault = true } = options;

  const cards = orderIssuesForSwipe({ projectTrees, inProgressTrees, recentActivityTrees, urlKey });
  // The accordion header shows "Dispatched Sessions [N]" at a glance; counts come
  // from the server-side getLoopsForWorkspace snapshot and the body lazy-loads.
  // Landing has none.
  for (const card of cards) {
    card.sessionCount = (sessionCounts && sessionCounts[card.identifier]) || 0;
  }
  const filterGroups = buildFilterGroups(cards);

  // Provider-aware name for the "View in {provider}" link (LIN-177 S3); Linear for
  // legacy/landing contexts, matching the dashboard.
  const providerDisplayName = getProviderForWorkspace(workspace)?.ui?.displayName || 'Linear';

  // Landing is a read-only preview: AI, Autopilot, dispatch, custom prompts and
  // the localhost seam are all off. With no OpenRouter source the ✦ action
  // renders disabled ("needs OpenRouter").
  const prompts = isLanding
    ? buildPromptOpts()
    : buildPromptOpts({ openRouterSource, featureFlags, customPrompts, isLocalhost });

  // Key order is part of the contract: this object is embedded as JSON.
  const swipeData = {
    issues: cards,
    filters: filterGroups,
    promptMeta: prompts.promptMeta,
    defaultPromptKeys: prompts.defaultPromptKeys,
    morePromptKeys: prompts.morePromptKeys,
    customPrompts: prompts.customPrompts,
    urlKey: isLanding ? '' : (urlKey || ''),
    providerDisplayName,
    initialIdentifier,
    hasAI: prompts.hasAI,
    aiState: prompts.aiState,
    freeTier: prompts.freeTier,
    dispatchEnabled: prompts.dispatchEnabled,
    runSetup: prompts.runSetup,
    isLocalhost: prompts.isLocalhost
  };

  // LIN-2944 P3 (addendum 16): the account's proxy-default state for
  // ProxyToggle.isActive(); unset means on, landing omits both.
  const bodyAttrs = isLanding ? [] : [
    `data-proxy-active="${proxyDefault !== false}"`
  ];

  const filterOptions = filterGroups
    .map((g, i) => `<option value="${escapeHtml(g.key)}"${i === 0 ? ' selected' : ''}>${escapeHtml(g.label)} (${g.count})</option>`)
    .join('\n        ');

  const content = `<div class="swipe-page" data-testid="swipe-page" data-url-key="${escapeHtml(urlKey || '')}">
    <div class="swipe-filter-bar">
      <select class="swipe-filter-select" data-testid="swipe-filter" aria-label="Filter tasks">
        ${filterOptions}
      </select>
    </div>

    <div class="swipe-card-area">
      <div class="swipe-card-container">
        <div class="swipe-card" id="swipe-card" data-testid="swipe-card">
          ${renderEmptyState({ className: 'swipe-card-empty', text: 'No tasks to display' })}
        </div>
      </div>
    </div>

    <div class="swipe-nav-row">
      <button class="swipe-arrow swipe-arrow-left" aria-label="Previous task" disabled>&#8592;</button>
      <div class="swipe-counter" id="swipe-counter"></div>
      <button class="swipe-arrow swipe-arrow-right" aria-label="Next task">&#8594;</button>
    </div>
  </div>`;
  const page = {
    stylesheets: ['/style.css', '/run-control.css', '/swipe.css'],
    embeddedData: { globalVar: '__SWIPE_DATA__', value: swipeData },
    scripts: ['/common.js', '/purify.min.js', '/marked.min.js', '/context.js', '/sessions.js', { module: '/swipe.js' }],
    content,
  };

  // LIN-4564 (LIN-4342 piece 3): the signed-out preview sits in the public frame. Its band carries the preview's sign-in
  // path (renderPreviewSignIn: the sole sign-in path here, `nav-login-*` kept) and the way back to Harbour's front page.
  if (isLanding) {
    return renderPublicFrame({
      ...page,
      title: 'Swipe',
      subtitle: PREVIEW_NOTE,
      back: { href: '/', label: PREVIEW_HOME_LABEL },
      signIn: renderPreviewSignIn(),
      deployInfo,
    });
  }

  // LIN-4564: a workspace's Swipe sits in the frame as the place Swipe. The team selector is a page filter, not
  // navigation: it sits in the frame's filter line (renderFilterLine draws the bar's markup; common.js initNavBar drives it).
  return renderFrame({
    ...page,
    place: 'swipe',
    subtitle: 'Triage tasks one card at a time.',
    urlKey,
    workspaces,
    featureFlags,
    openRouterSource,
    deployInfo,
    filters: renderFilterLine({ currentPage: 'swipe', urlKey, teams, selectedTeamId }),
    bodyAttrs: bodyAttrs.filter(Boolean).join(' ') || undefined,
  });
}
