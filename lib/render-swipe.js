/**
 * Swipe Page Renderer
 *
 * Generates HTML for the mobile-first task swipe page, and composes the ordering
 * pipeline that the deck and Home's top-task mark share (LIN-2944 P1).
 * Issue data is embedded as JSON (`window.__SWIPE_DATA__`) for client-side cards.
 *
 * Pipeline layers, in the order a card meets them (the ordering layers live in
 * task-order.js, LIN-3554):
 *   flatten trees → card   (flattenTrees, task-order.js)
 *   dedupe, link parents   (orderIssuesForSwipe)
 *   rank                   (sortIssuesForSwipe, task-order.js)
 *   dependency order       (applyBlockingOrder, then clusterByParent, task-order.js)
 *   stamp                  (isSeed, why; sessionCount in renderSwipePage)
 *
 * Embedded JSON is compared byte-for-byte, so the key order of cards and of
 * `__SWIPE_DATA__` is part of the contract — see the notes beside each builder.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { buildPromptOpts } from './render-prompt-opts.js';
import { nodeKey, PERIODICALS_PROJECT_ID } from './tree.js';
import { computeGraphFeatures } from './graph-features.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder, clusterByParent, buildWhy } from './task-order.js';
import { renderEmptyState } from './components/empty-state.js';
import { starterSeedIssueIds } from './starter-seed.js';
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

// =============================================================================
// The shared ordering pipeline
// =============================================================================

// Dedupe key: the same source-qualified `source:id` the merged tree uses, not the
// raw id (LIN-544). One ticket source per kind (LIN-3332) makes `source` alone
// unambiguous.
const cardKey = (card) => nodeKey({ id: card.id, source: card.source });

/** The slim card summary embedded in `parentInfo` and `subtasks`. */
const summary = ({ id, identifier, title, stateType }) => ({ id, identifier, title, stateType });

/**
 * Stamp `parentInfo` on every card whose parent is in the set, then `subtasks`
 * on each such parent. Keys are source-qualified so a same-number parent in
 * another provider never adopts a card. Two passes keep the stamp order
 * (parentInfo before subtasks) the embedded JSON depends on.
 */
function linkParents(cards) {
  const cardByKey = new Map(cards.map(card => [cardKey(card), card]));
  const subtasksByParent = new Map();
  for (const card of cards) {
    if (!card.parentId) continue;
    const parentKey = cardKey({ id: card.parentId, source: card.source });
    const parent = cardByKey.get(parentKey);
    if (!parent) continue;
    card.parentInfo = summary(parent);
    subtasksByParent.set(parentKey, [...(subtasksByParent.get(parentKey) || []), summary(card)]);
  }
  for (const [parentKey, subtasks] of subtasksByParent) {
    cardByKey.get(parentKey).subtasks = subtasks;
  }
}

/**
 * Order the flat task set exactly as the Swipe deck does (LIN-2944 P1).
 *
 * One helper, two consumers: `renderSwipePage` (the deck) and Home's top-task
 * mark, so the two surfaces cannot drift. It is pure and synchronous — it ranks
 * data already fetched and adds no provider call. The first element is the
 * deck's front card.
 *
 * Periodicals rows are not tasks to rank: they are unstarted with no priority,
 * so one could become Home's top task while Home never marks a Periodicals row,
 * and a Periodicals-only Home would hide the seed-only onboarding hint. The deck
 * never sees them (it is built without `urlKey`), so they are dropped here, from
 * a copy — the caller's trees are untouched.
 *
 * @param {Object} data
 * @param {Array} [data.projectTrees] - Project trees from fetchAndPrepareProjects
 * @param {Array} [data.inProgressTrees] - In-progress trees
 * @param {Array} [data.recentActivityTrees] - Recent activity trees
 * @param {string|null} [data.urlKey] - Workspace key; enables starter-seed demotion
 * @returns {Array} Ordered card objects, stamped (in this key order) with graph
 *   features, parentInfo/subtasks, `isSeed` and `why`. Stamped only on the cards
 *   built here, never on the trees.
 */
export function orderIssuesForSwipe({ projectTrees = [], inProgressTrees = [], recentActivityTrees = [], urlKey = null } = {}) {
  const realProjectTrees = projectTrees.filter(tree => tree.project?.id !== PERIODICALS_PROJECT_ID);

  // In-progress issues also appear in project trees; the first sighting wins.
  const cards = [
    ...flattenTrees(inProgressTrees, 'in-progress'),
    ...flattenTrees(realProjectTrees, 'project'),
    ...flattenTrees(recentActivityTrees, 'recent-activity')
  ];
  const seen = new Set();
  const allIssues = cards.filter(card => {
    const key = cardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  linkParents(allIssues);

  // LIN-391: graph features (sort keys) BEFORE the sort, so the deck order
  // matches the /stack digest order — both surfaces share this pipeline.
  computeGraphFeatures(allIssues);
  sortIssuesForSwipe(allIssues);
  const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

  // LIN-2944 P3 (addendum 18): starter-seed cards are onboarding scaffolding, not
  // real work. Each is marked `isSeed` and moved AFTER every real card (relative
  // order kept) — still in the deck, never the front card as if real. When every
  // card is a seed the caller reads `isSeed` to show the onboarding state.
  const seedIds = urlKey ? starterSeedIssueIds(urlKey) : null;
  for (const card of sortedIssues) {
    card.isSeed = !!(seedIds && seedIds.has(card.id));
  }
  const orderedIssues = seedIds
    ? [...sortedIssues.filter(card => !card.isSeed), ...sortedIssues.filter(card => card.isSeed)]
    : sortedIssues;

  // LIN-2944: each card's one-line ranking reason, the digest the agent stack
  // uses (LIN-391). Swipe shows every card, so no blocker can be off-page; an
  // empty array means the order had nothing to advertise.
  for (const card of orderedIssues) {
    card.why = buildWhy(card);
  }
  return orderedIssues;
}

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

  const navBarHtml = renderNavBar({ workspaces, teams, selectedTeamId, urlKey, currentPage: 'swipe', featureFlags, isLanding });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/swipe', urlKey, openRouterSource, featureFlags, isLanding });

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
  // the localhost seam are all off, and only the prompt-button flag is honoured.
  const prompts = isLanding
    ? buildPromptOpts({ featureFlags: { aiRecommendations: false, promptButtons: featureFlags.promptButtons } })
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
    promptButtons: prompts.promptButtons,
    hasAutopilot: prompts.hasAutopilot,
    dispatchEnabled: prompts.dispatchEnabled,
    proxyEnabled: prompts.proxyEnabled,
    isLocalhost: prompts.isLocalhost
  };

  // LIN-525 #2: the live proxy flag lets ProxyToggle.maybeAppend no-op when off.
  // LIN-2944 P3 (addendum 16): the account's proxy-default state for
  // ProxyToggle.isActive(); unset means on, landing omits both.
  const bodyAttrs = isLanding ? [] : [
    featureFlags.proxy === true && 'data-proxy-feature="true"',
    `data-proxy-active="${proxyDefault !== false}"`
  ];

  const filterOptions = filterGroups
    .map((g, i) => `<option value="${escapeHtml(g.key)}"${i === 0 ? ' selected' : ''}>${escapeHtml(g.label)} (${g.count})</option>`)
    .join('\n        ');

  return renderPage({
    title: 'Swipe - Tasks',
    viewport: 'width=device-width, initial-scale=1.0, user-scalable=no',
    stylesheets: ['/style.css', '/swipe.css'],
    bodyAttrs: bodyAttrs.filter(Boolean).join(' ') || undefined,
    nav: navBarHtml,
    embeddedData: { globalVar: '__SWIPE_DATA__', value: swipeData },
    scripts: ['/common.js', '/purify.min.js', '/marked.min.js', '/recap.js', '/brief.js', '/scan.js', '/context.js', '/prompt-section.js', '/sessions.js', '/swipe.js'],
    content: `<main class="swipe-page" data-testid="swipe-page" data-url-key="${escapeHtml(urlKey || '')}">
    ${renderPageHeader({ title: 'Swipe', subtitle: 'Triage tasks one card at a time.', headerClass: 'swipe-header' })}
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
  </main>
  ${footerHtml}`
  });
}
