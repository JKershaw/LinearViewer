/**
 * Task-create page route (LIN-1973, Session 2 of LIN-1666 / LIN-1504 Option A).
 *
 *   GET /workspace/:urlKey/task/new — the dedicated task-create page
 *
 * A DRILL-DOWN page — the sibling of `/workspace/:urlKey/task/:issueId/edit`
 * (LIN-1565) and `/observation/session/:sessionId`. Per `docs/view-tiers.md` a
 * drill-down is discovered from the record that owns it, so it sits outside the
 * view-tier model by design: NO feature flag, no `EXPERIMENTAL_VIEWS` entry, no
 * nav or footer link. Reached from the project's "+ Add task" affordance
 * (`lib/render.js`), which carries the project as `?projectId=`.
 *
 * The page renders EXACTLY `provider.createFields()` — capability-derived, never
 * a fixed form (LIN-1504 Option A: refusal over lossy success). It replaces the
 * inline create form LIN-1553 shipped (`renderInlineCreateForm`, removed from
 * `lib/render.js` in this same landing) and submits to the unchanged session-auth
 * `POST /workspace/:urlKey/api/issues` (routes/workspace-api.js), which as of this
 * landing also rejects a submitted-but-undeclared `stateId`/`priority` with 400 —
 * safe only because this page never renders a control for a field the provider
 * doesn't declare.
 *
 * Linear's team→state circularity (states are team-scoped) resolves via a plain
 * GET query-param resubmit: selecting a team in `public/task-create.js` navigates
 * to `?teamId=<id>`, which re-renders the page with states scoped to that team.
 * No new browser-facing endpoint.
 */

import { Router } from 'express';
import { renderTaskCreatePage } from '../lib/render-task-create.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { getWorkspaceCallScope } from '../lib/workspace.js';

/**
 * Best-effort option list for a capability-gated read. Two independent guards,
 * both load-bearing (mirroring routes/task-edit.js's `loadStates`):
 *
 *   1. `supports(method)` — a REAL declared capability, so a provider that never
 *      implemented the read (e.g. github-projects' `fetchTeams`) short-circuits
 *      with no network call.
 *   2. `try/catch → []` — an implemented read can still fail upstream. The page
 *      must never 500 over an unavailable option list; every branch below
 *      degrades to a text-input fallback (lib/render-task-create.js) instead.
 *
 * @param {Object} provider
 * @param {string} method - `fetchTeams` | `fetchProjectsList` | `states`
 * @param {*} scope
 * @param {Array} [extraArgs]
 * @param {string} label - Used only in the warn log.
 * @returns {Promise<Array>}
 */
async function loadOptionList(provider, method, scope, extraArgs, label) {
  if (!provider?.supports?.(method)) return [];
  try {
    const result = await provider[method](scope, ...extraArgs);
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.warn(`Task create: ${label} unavailable, falling back to text input:`, error.message);
    return [];
  }
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - Workspace resolution middleware.
 * @param {Function} deps.getOpenRouterSource - Footer AI-status source.
 * @param {Function} deps.getDeployInfo - Footer deploy info.
 * @returns {Router}
 */
export function createTaskCreateRoutes({ workspaceFromUrl, getOpenRouterSource, getDeployInfo }) {
  const router = Router();

  router.get('/workspace/:urlKey/task/new', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const dashboardHref = `/workspace/${encodeURIComponent(workspace.urlKey)}/`;

    const pageOptions = {
      deployInfo: getDeployInfo(),
      urlKey: workspace.urlKey,
      openRouterSource: getOpenRouterSource(req),
      workspaces: req.session.workspaces,
      featureFlags: getFeatureFlags(req.session)
    };

    // Create is scoped to the workspace's ACTIVE provider (unlike task-edit,
    // which resolves a per-issue binding — there is no issue yet to carry a
    // `source` stamp, so this mirrors POST /api/issues' own provider selection).
    const provider = getProviderForWorkspace(workspace);
    pageOptions.ui = provider?.ui || {};

    // Capability gate: `ui.inlineCreate` (derived from the provider's real
    // `createIssue` support), read EXCLUSIVELY off `provider.ui` and never off
    // `supports()` — the LIN-177 convention task-edit's `ui.inlineEdit` gate also
    // follows. A provider that can't create goes back to the dashboard, not
    // Settings: this is a drill-down page, not a view-tier member.
    if (!provider?.ui?.inlineCreate) {
      return res.redirect(dashboardHref);
    }

    const requestedTeamId = typeof req.query.teamId === 'string' ? req.query.teamId : '';
    const requestedProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';

    try {
      // createFields() is a synchronous, non-throwing contract for every
      // in-tree provider — inside the try anyway so a misbehaving provider
      // renders the error page below instead of crashing the request.
      const fields = provider.createFields();
      const scope = getWorkspaceCallScope(workspace);

      const [teams, projects] = await Promise.all([
        fields.includes('teamId') ? loadOptionList(provider, 'fetchTeams', scope, [], 'teams') : Promise.resolve([]),
        fields.includes('projectId') ? loadOptionList(provider, 'fetchProjectsList', scope, [], 'projects') : Promise.resolve([]),
      ]);

      // Only a team id that actually resolved in the fetched list scopes the
      // states read — an unmatched/absent `?teamId=` is dropped (never guessed),
      // same "silent drop, never a synthetic selection" discipline the projectId
      // prefill uses below.
      const teamId = fields.includes('teamId') && teams.some(t => String(t.id) === requestedTeamId)
        ? requestedTeamId
        : '';

      // A provider that declares teamId needs a RESOLVED team before states can
      // be scoped (Linear's STATES_QUERY needs a non-null team) — skip the read
      // entirely rather than pay a round trip that would just be caught and
      // discarded below.
      const needsTeamFirst = fields.includes('teamId') && !teamId;
      const states = fields.includes('stateId') && !needsTeamFirst
        ? await loadOptionList(provider, 'states', scope, [teamId || null], 'states')
        : [];

      return res.send(renderTaskCreatePage({
        urlKey: workspace.urlKey,
        fields,
        teams,
        projects,
        states,
        teamId,
        projectId: requestedProjectId,
      }, pageOptions));
    } catch (error) {
      console.error('Task create page error:', error);
      return res.status(500).send(renderErrorPage(
        'Something Went Wrong',
        'Could not load the create-task page. Please try again.',
        { action: 'Back to tasks', actionUrl: dashboardHref }
      ));
    }
  });

  return router;
}
