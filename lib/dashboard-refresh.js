/**
 * lib/dashboard-refresh.js — the Home render tail after a successful post-401 credential refresh/re-mint.
 *
 * Extracted from handleTokenRefreshAndRetry (LIN-1503) so the GitHub-family branch in handleUnauthorizedError can reuse
 * the same render tail without duplicating it, and without widening handleTokenRefreshAndRetry's own Linear-specific
 * refresh scope. Provider-agnostic. Moved out of server.js (LIN-4016) so a test runs it with its I/O boundaries
 * injected, rather than slicing server.js's source; server.js keeps a thin wrapper that passes the real dependencies.
 *
 * LIN-4118 (S3a-1): the fetch, top task, flags, row states and held-facts write, and the one Home view build, come from
 * the shared pipeline in lib/home-pipeline.js, the same gather the Home route and /api/home-rows use. What stays here
 * is the refresh's own: its custom prompts, its deploy info and provider, the optional `readFilledRung`, and the render.
 * The refresh's differences are parameters: `degradeSecondary: true`, and flags resolved without a request.
 *
 * LIN-2526 (F2): this path always re-renders as the dashboard regardless of which of the five routes triggered the
 * 401, so it must carry the same assignee state a direct dashboard load would — otherwise `?assignee=` silently drops
 * after a credential refresh.
 */

import { gatherHomePage } from './home-pipeline.js';
import { rowDataByNodeKey } from './task-board-view.js';
import { liveConsoleOn } from './run-controls.js';
import { readHaltForPoll, POLL_HALT_READ_TIMEOUT_MS } from './poll-halt.js';

/**
 * @param {Object} deps - the server-bound reads: customPromptsStore, getDeployInfo, getFeatureFlags,
 *   getProviderForWorkspace, fetchAndPrepareProjects, resolveRunControls, homeRowStates, orderIssuesForSwipe, renderPage,
 *   and writeTaskFacts (LIN-4068: holds a complete fetched set through the holder's write gate). LIN-4115: workspaceHaltStore
 *   (default null) and haltReadTimeoutMs (default the poll constant) feed the same halt read as the Home route. `gatherHomePage` is
 *   optional and defaults to the shared pipeline; a test passes its own to observe that the refresh renders through it.
 * @param {Object} request - { workspace, session, teamId, assigneeState, openRouterSource, res }
 */
export async function renderDashboardAfterRefresh(deps, { workspace, session, teamId, assigneeState, openRouterSource, res }) {
  const { customPromptsStore, getDeployInfo, getFeatureFlags, getProviderForWorkspace, fetchAndPrepareProjects, resolveRunControls, homeRowStates, orderIssuesForSwipe, renderPage, writeTaskFacts, taskModeStore = null, accountStore = null, readFilledRung, gatherHomePage: gatherPage = gatherHomePage, workspaceHaltStore = null, haltReadTimeoutMs = POLL_HALT_READ_TIMEOUT_MS } = deps;
  // Load custom prompts (non-blocking, fallback to empty)
  let customPrompts = [];
  try {
    customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }));
  } catch (e) { /* non-fatal */ }

  const deployInfo = getDeployInfo()
  const provider = getProviderForWorkspace(workspace);
  // LIN-4115: the same halt read as the Home route, started beside the fetch and awaited before render. Never rejects.
  const haltRead = readHaltForPoll(workspaceHaltStore, workspace.urlKey, haltReadTimeoutMs);
  // The shared gather and the one view build (lib/home-pipeline.js). `degradeSecondary` is the refresh's own option;
  // the fetch still passes urlKey so the periodicals group renders consistently after a token refresh (LIN-341).
  const { fetched, homeStates, rowStates, homeTopTask, topTaskId, seedOnlyHome, homeView, featureFlags } = await gatherPage(
    { fetchAndPrepareProjects, orderIssuesForSwipe, homeRowStates, writeTaskFacts },
    {
      workspace,
      teamId,
      accountId: session.accountId,
      assigneeName: assigneeState.resolvedAssigneeName,
      degradeSecondary: true,
      // LIN-3849: no `req` on this post-401 path, so the flags resolve here, directly.
      // LIN-3977: liveConsole follows the one promotion rule (liveConsoleOn), as requestFeatureFlags does.
      resolveFlags: async () => {
        const runControlsBits = await resolveRunControls({ workspace, accountId: session.accountId });
        return {
          ...getFeatureFlags(session),
          ...runControlsBits,
          liveConsole: liveConsoleOn(session.features?.liveConsole, runControlsBits.runControls),
        };
      },
    },
  );
  const { recentActivityTrees, organizationName, teams, selectedTeamId, showSource, truncated, availableAssignees, appliedAssigneeName, degradedSources } = fetched;
  const halt = await haltRead;
  // LIN-4104 D2: the filled run button, read once for this page load (never on the /state poll).
  const filledRung = readFilledRung ? await readFilledRung({ taskModeStore, accountStore, accountId: session.accountId ?? null, urlKey: workspace.urlKey }) : undefined;
  const html = renderPage(homeView.trees, homeView.inProgressTrees, recentActivityTrees, organizationName, {
    teams,
    selectedTeamId,
    availableAssignees,
    rowStates,
    halt,
    rulingCount: homeStates?.rulingCount ?? 0,
    rowData: rowDataByNodeKey({ urlKey: workspace.urlKey, inProgressTrees: homeView.inProgressTrees, recentActivityTrees, projectTrees: homeView.trees, rowStates }),
    copyFirstCard: featureFlags.runControls !== true && session.copyFirstCardDismissed !== true,
    filledRung,
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
    topTaskId,
    topTaskWhy: homeTopTask ? homeTopTask.why : [],
    topTaskOnboarding: seedOnlyHome,
    proxyDefault: session.proxyDefault
  });
  return res.send(html);
}
