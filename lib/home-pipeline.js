/**
 * lib/home-pipeline.js — the one Home-view pipeline (LIN-4118, S3a-1: no behaviour change).
 *
 * Three callers used to rebuild the same inputs: the Home route (server.js `GET /workspace/:urlKey/`),
 * `/api/home-rows`, and the sign-in refresh (lib/dashboard-refresh.js). This module holds the part all three do:
 *
 *   fetch → top task → run-control flags → row states → held-facts write
 *
 * Two entry points over that one gather:
 *   - gatherHomeInputs: the gather, and nothing else. It builds NO view. `/api/home-rows` uses it and hands the
 *     inputs to `homeRowsFor`, which builds its view once, as it always has.
 *   - gatherHomePage: the gather plus exactly one `buildHomeView` call. The pages use it.
 *
 * Route-specific reads stay in the callers, outside this module: custom prompts, `readFilledRung` (once per page
 * load, in the page route), deploy info, Home's halt read, and the request-scoped flag read itself. The caller
 * passes that read in as `resolveFlags`, so it runs at the same point in the gather it always did.
 *
 * Every dependency is injected (the server's own functions), in the same style as `renderDashboardAfterRefresh`,
 * so the module runs under a test with its I/O boundaries faked.
 */
import { nodeKey } from './tree.js';
import { buildHomeView } from './home-view.js';
import { rowDataByNodeKey } from './task-board-view.js';

/**
 * The shared gather. Builds no view.
 *
 * Order is part of the contract and matches the three callers it replaced: fetch, then the top task (pure, over the
 * same fetched trees), then the flags, then the row states, then the held-facts write. The write runs after the gather
 * and reuses the index it built (`homeStates.roots`). The holder refuses a degraded or team-scoped set.
 *
 * @param {Object} deps - injected server reads
 * @param {Function} deps.fetchAndPrepareProjects - `(workspace, teamId, null, urlKey, opts)`
 * @param {Function} deps.orderIssuesForSwipe - the front-card order over the fetched trees
 * @param {Function} deps.homeRowStates - `({ urlKey, issues, runControls })`
 * @param {Function} [deps.writeTaskFacts] - `(urlKey, fetched, { index })`; optional, as the refresh has always had it
 * @param {Object} opts
 * @param {Object} opts.workspace
 * @param {string|null} opts.teamId
 * @param {string|null} opts.accountId - the session's account, passed to the fetch
 * @param {string|null} opts.assigneeName - the resolved assignee filter (`resolvedAssigneeName`)
 * @param {boolean} [opts.degradeSecondary=false] - the refresh's secondary-source degradation; the key is only added
 *   to the fetch options when true, so the page routes send the same options object they always have
 * @param {Function} opts.resolveFlags - `async () => featureFlags`; the caller's own flag read, run after the top task
 * @returns {Promise<{
 *   fetched: Object, trees: Array, inProgressTrees: Array, recentActivityTrees: Array,
 *   featureFlags: Object, homeStates: Object|null, rowStates: Map|null,
 *   homeTopTask: Object|null, topTaskId: string|null, seedOnlyHome: boolean
 * }>}
 */
export async function gatherHomeInputs(deps, { workspace, teamId, accountId, assigneeName, degradeSecondary = false, resolveFlags }) {
  const { fetchAndPrepareProjects, orderIssuesForSwipe, homeRowStates, writeTaskFacts } = deps;
  const fetchOpts = {
    slim: true,
    assigneeName,
    accountId,
    ...(degradeSecondary ? { degradeSecondary: true } : {}),
  };
  const fetched = await fetchAndPrepareProjects(workspace, teamId, null, workspace.urlKey, fetchOpts);
  const { trees, inProgressTrees, recentActivityTrees } = fetched;

  // The top task is the first non-seed card of the front-card order. It is computed over the SAME fetched trees, so it
  // adds no provider call. With only seed rows left, the caller shows the onboarding hint instead.
  const orderedHome = orderIssuesForSwipe({ projectTrees: trees, inProgressTrees, recentActivityTrees, urlKey: workspace.urlKey });
  const homeTopTask = orderedHome.find((issue) => !issue.isSeed) || null;
  const seedOnlyHome = orderedHome.length > 0 && orderedHome.every((issue) => issue.isSeed);

  const featureFlags = await resolveFlags();
  const homeStates = await homeRowStates({ urlKey: workspace.urlKey, issues: fetched.stateIssues, runControls: featureFlags.runControls === true });

  // LIN-4068: hold the fetched set through the holder's write gate, after the gather, handing it the index the gather
  // built so the request does not build it twice. A degraded or team-scoped set is refused, and nothing is written.
  writeTaskFacts?.(workspace.urlKey, fetched, { index: homeStates?.roots ?? null });

  return {
    fetched,
    trees,
    inProgressTrees,
    recentActivityTrees,
    featureFlags,
    homeStates,
    rowStates: homeStates?.states ?? null,
    homeTopTask,
    topTaskId: homeTopTask ? nodeKey(homeTopTask) : null,
    seedOnlyHome,
  };
}

/**
 * The page entry point: the gather, then the one `buildHomeView` call. The page renders `homeView`; the rest is what
 * the caller's own reads and render need.
 *
 * @param {Object} deps - as gatherHomeInputs
 * @param {Object} opts - as gatherHomeInputs
 * @returns {Promise<Object>} gatherHomeInputs's result plus `homeView` (`{ inProgressTrees, trees }`)
 */
export async function gatherHomePage(deps, opts) {
  const gathered = await gatherHomeInputs(deps, opts);
  const homeView = buildHomeView({
    inProgressTrees: gathered.inProgressTrees,
    trees: gathered.trees,
    states: gathered.rowStates ?? new Map(),
    topTaskId: gathered.topTaskId,
  });
  return { ...gathered, homeView };
}

/**
 * LIN-4120: the rowData a page carries for its rows, from the same view the page renders, so Home and `/backlog` cannot
 * disagree. Home draws In Progress and Recent only, so its rowData carries those and no project tree (its project
 * sections are gone). `/backlog` draws the project trees, so its rowData carries them too.
 *
 * @param {Object} opts
 * @param {'home'|'backlog'} opts.pageMode
 * @param {string} opts.urlKey
 * @param {{inProgressTrees: Array, trees: Array}} opts.homeView - `gatherHomePage`'s view
 * @param {Array} opts.recentActivityTrees
 * @param {Map<string, Object>|null} opts.rowStates
 * @returns {Object<string, Object>} rowData keyed by node key (`rowDataByNodeKey`)
 */
export function homeRowDataFor({ pageMode, urlKey, homeView, recentActivityTrees, rowStates }) {
  return rowDataByNodeKey({
    urlKey,
    inProgressTrees: homeView.inProgressTrees,
    recentActivityTrees,
    projectTrees: pageMode === 'backlog' ? homeView.trees : [],
    rowStates,
  });
}
