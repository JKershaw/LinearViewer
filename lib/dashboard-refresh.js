/**
 * lib/dashboard-refresh.js — the Home render tail after a successful post-401 credential refresh/re-mint.
 *
 * Extracted from handleTokenRefreshAndRetry (LIN-1503) so the GitHub-family branch in handleUnauthorizedError can reuse
 * the same render tail without duplicating it, and without widening handleTokenRefreshAndRetry's own Linear-specific
 * refresh scope. Provider-agnostic. Moved out of server.js (LIN-4016) so a test runs it with its I/O boundaries
 * injected, rather than slicing server.js's source; server.js keeps a thin wrapper that passes the real dependencies.
 *
 * LIN-2526 (F2): this path always re-renders as the dashboard regardless of which of the five routes triggered the
 * 401, so it must carry the same assignee state a direct dashboard load would — otherwise `?assignee=` silently drops
 * after a credential refresh.
 */

import { nodeKey } from './tree.js';
import { buildHomeView } from './home-view.js';
import { rowDataByNodeKey } from './task-board-view.js';
import { liveConsoleOn } from './run-controls.js';

/**
 * @param {Object} deps - the server-bound reads: customPromptsStore, getDeployInfo, getFeatureFlags,
 *   getProviderForWorkspace, fetchAndPrepareProjects, resolveRunControls, homeRowStates, orderIssuesForSwipe, renderPage
 * @param {Object} request - { workspace, session, teamId, assigneeState, openRouterSource, res }
 */
export async function renderDashboardAfterRefresh(deps, { workspace, session, teamId, assigneeState, openRouterSource, res }) {
  const { customPromptsStore, getDeployInfo, getFeatureFlags, getProviderForWorkspace, fetchAndPrepareProjects, resolveRunControls, homeRowStates, orderIssuesForSwipe, renderPage } = deps;
  // Load custom prompts (non-blocking, fallback to empty)
  let customPrompts = [];
  try {
    customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }));
  } catch (e) { /* non-fatal */ }

  const deployInfo = getDeployInfo()
  const provider = getProviderForWorkspace(workspace);
  // Pass urlKey so the periodicals group renders consistently after a token
  // refresh, matching the primary dashboard route (LIN-341).
  const { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId, showSource, truncated, availableAssignees, appliedAssigneeName, degradedSources } = await fetchAndPrepareProjects(workspace, teamId, null, workspace.urlKey, { slim: true, assigneeName: assigneeState.resolvedAssigneeName, accountId: session.accountId, degradeSecondary: true });
  // LIN-2944 P1 F3: the deck's front card, over the SAME already-fetched trees —
  // `orderIssuesForSwipe` is pure and adds no provider call.
  // LIN-2944 P3 (addendum 18): the top task is the first NON-seed card; when only
  // seed rows remain the mark is replaced by a one-line onboarding hint.
  const orderedHome = orderIssuesForSwipe({ projectTrees: trees, inProgressTrees, recentActivityTrees, urlKey: workspace.urlKey });
  const homeTopTask = orderedHome.find((issue) => !issue.isSeed) || null;
  const seedOnlyHome = orderedHome.length > 0 && orderedHome.every((issue) => issue.isSeed);
  // LIN-3849: no `req` on this post-401 path, so call the resolver directly.
  // LIN-3977: liveConsole follows the one promotion rule (liveConsoleOn), as requestFeatureFlags does.
  const runControlsBits = await resolveRunControls({ workspace, accountId: session.accountId });
  const featureFlags = {
    ...getFeatureFlags(session),
    ...runControlsBits,
    liveConsole: liveConsoleOn(session.features?.liveConsole, runControlsBits.runControls),
  };
  const homeStates = await homeRowStates({ urlKey: workspace.urlKey, inProgressTrees, recentActivityTrees, projectTrees: trees, runControls: featureFlags.runControls === true });
  const rowStates = homeStates?.states ?? null;
  // LIN-4024: Home renders the trimmed view (what needs you, what runs, what is next; the rest behind folds).
  const homeView = buildHomeView({ inProgressTrees, trees, states: rowStates ?? new Map(), topTaskId: homeTopTask ? nodeKey(homeTopTask) : null });
  const html = renderPage(homeView.trees, homeView.inProgressTrees, recentActivityTrees, organizationName, {
    teams,
    selectedTeamId,
    availableAssignees,
    rowStates,
    rulingCount: homeStates?.rulingCount ?? 0,
    rowData: rowDataByNodeKey({ urlKey: workspace.urlKey, inProgressTrees: homeView.inProgressTrees, recentActivityTrees, projectTrees: homeView.trees, rowStates }),
    copyFirstCard: featureFlags.runControls !== true && session.copyFirstCardDismissed !== true,
    // LIN-2550: same applied-not-requested labelling rule as the primary
    // dashboard route above — this post-401 re-render carries the assignee
    // state forward (F2), so it must carry the correction with it.
    selectedAssignee: appliedAssigneeName ? assigneeState.selectedAssignee : 'all',
    canFilterByMe: provider.supports('viewer'),
    workspaces: session.workspaces,
    workspace,
    openRouterSource,
    deployInfo,
    urlKey: workspace.urlKey,
    featureFlags,
    customPrompts,
    showSource,
    truncated,
    // LIN-3774: `?? []` because the lin-2006/lin-2550 vm stubs return no list.
    degradedSources: degradedSources ?? [],
    topTaskId: homeTopTask ? nodeKey(homeTopTask) : null,
    topTaskWhy: homeTopTask ? homeTopTask.why : [],
    topTaskOnboarding: seedOnlyHome,
    proxyDefault: session.proxyDefault
  });
  return res.send(html);
}
