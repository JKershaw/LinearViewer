/**
 * Task-edit page route (LIN-1565).
 *
 *   GET /workspace/:urlKey/task/:issueId/edit — the dedicated task-edit page
 *
 * A DRILL-DOWN page — the sibling of `/observation/session/:sessionId`. The three
 * tiers in `docs/view-tiers.md` classify views by how they are *discovered and
 * gated* from the nav/footer; a drill-down is discovered from the record that
 * owns it and so sits deliberately outside that model, exactly as the session
 * page does. Concretely: NO feature flag, no `EXPERIMENTAL_VIEWS` entry, no nav
 * or footer link. It replaces the hidden inline edit form LIN-1553 shipped inside
 * the tree's collapsed Details panel.
 *
 * It owns no write path: the page's script submits to the existing session-auth
 * `PATCH /workspace/:urlKey/api/issues/:issueId` (routes/workspace-api.js),
 * unchanged. This module is a read + render seam only.
 *
 * `:issueId` accepts a UUID OR an identifier (e.g. `LIN-123`) with no resolver
 * hop, because every reachable provider already accepts both: `ISSUE_ID_REGEX`
 * (the same permissive check the PATCH route uses) matches both forms, Linear's
 * `issue(id:)` resolves an identifier, and `LocalStore.getIssue` looks up by `_id`
 * then falls back to `identifier`. The rendered form's `data-issue-id` is taken
 * from the FETCHED record, so the PATCH always receives the canonical id however
 * the page was reached.
 */

import { Router } from 'express';
import { renderTaskEditPage } from '../lib/render-task-edit.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { getWorkspaceCallScope, isValidIssueId } from '../lib/workspace.js';

/**
 * Best-effort workflow states for the page's state `<select>`.
 *
 * Two independent guards, both load-bearing:
 *
 *   1. `supports('states')` — a REAL declared capability (`readsHeadroom` on
 *      `PROVIDER_SURFACE`), unlike `issueWriteGuard`, which is deliberately off
 *      the declared surface and reports `false` for every provider including
 *      Linear. github-projects declares no `states`, so it takes this branch.
 *   2. `try/catch → []` — Linear's `STATES_QUERY` needs a NON-null team id; an
 *      issue read that yields no team, or a states read that fails upstream,
 *      must not take the page down with it.
 *
 * Either way the renderer degrades to the free-text input the inline form used,
 * so the page NEVER 500s over the dropdown.
 *
 * @param {Object} provider
 * @param {*} scope - Provider call scope (token / binding).
 * @param {string|null} teamId
 * @returns {Promise<Array>} Workflow states, or `[]`.
 */
async function loadStates(provider, scope, teamId) {
  if (!provider?.supports?.('states')) return [];
  try {
    const states = await provider.states(scope, teamId);
    return Array.isArray(states) ? states : [];
  } catch (error) {
    console.warn('Task edit: states unavailable, falling back to text input:', error.message);
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
export function createTaskEditRoutes({ workspaceFromUrl, getOpenRouterSource, getDeployInfo }) {
  const router = Router();

  router.get('/workspace/:urlKey/task/:issueId/edit', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const dashboardHref = `/workspace/${encodeURIComponent(workspace.urlKey)}/`;

    const provider = getProviderForWorkspace(workspace);

    const pageOptions = {
      deployInfo: getDeployInfo(),
      urlKey: workspace.urlKey,
      openRouterSource: getOpenRouterSource(req),
      workspaces: req.session.workspaces,
      featureFlags: getFeatureFlags(req.session),
      // LIN-1886: threads the provider's ui surface through so the renderer can
      // hide the priority control for a provider that cannot honor it (Jira).
      ui: provider?.ui || {}
    };

    if (!isValidIssueId(issueId)) {
      return res.status(400).send(renderErrorPage(
        'Invalid task',
        'That task id is not a valid format.',
        { action: 'Back to tasks', actionUrl: dashboardHref }
      ));
    }

    // Capability gate: `ui.inlineEdit` (derived from the provider's real
    // `updateIssue` support), read EXCLUSIVELY off `provider.ui` and never off
    // `supports()` — the LIN-177 convention the tree's link gate also follows, so
    // if the derivation ever changes, both surfaces move together for free.
    // A read-only provider goes back to the dashboard, not to Settings: this is
    // a drill-down page, not a view-tier member, so there is nothing to enable.
    if (!provider?.ui?.inlineEdit) {
      return res.redirect(dashboardHref);
    }

    try {
      const scope = getWorkspaceCallScope(workspace);
      const issue = await provider.fetchIssueFields(scope, issueId);
      const states = await loadStates(provider, scope, issue?.team?.id || null);

      return res.send(renderTaskEditPage({ issue, states, urlKey: workspace.urlKey, issueId }, pageOptions));
    } catch (error) {
      // Unknown / cross-workspace / deleted id — the provider read seam signals
      // this by throwing `Issue not found: <id>`. Same message match the lazy
      // detail route uses, so the two agree on what "not found" means. Rendered
      // as a page body (never a crash, never a leak of whether the id exists in
      // some OTHER workspace).
      if (error.message?.includes('not found')) {
        return res.status(404).send(renderTaskEditPage({ issue: null, urlKey: workspace.urlKey, issueId }, pageOptions));
      }
      console.error('Task edit page error:', error);
      return res.status(500).send(renderErrorPage(
        'Something Went Wrong',
        'Could not load this task for editing. Please try again.',
        { action: 'Back to tasks', actionUrl: dashboardHref }
      ));
    }
  });

  return router;
}
