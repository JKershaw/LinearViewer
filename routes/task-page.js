/**
 * Task page routes (LIN-3329, Subtask B of LIN-3324).
 *
 *   GET /workspace/:urlKey/task/:identifier            — the owner's task page
 *   GET /workspace/:urlKey/api/task/:identifier/state  — stored-data repaint
 *
 * A DRILL-DOWN page, like `/task/:issueId/edit` and the run page: no feature
 * flag, no view-tier entry, a back link, and a 404 body for an unknown id.
 * Like task-edit, the page needs its tracker read: the tracker not knowing the
 * task is the 404 page and any other tracker failure is a try-again page (503),
 * whatever sessions are stored — there is no stored-only page (John's
 * no-fallback decision, LIN-3329 close-out).
 *
 * MOUNT ORDER IS LOAD-BEARING. `ISSUE_ID_REGEX` accepts `new`, so this router
 * must mount AFTER `createTaskCreateRoutes` (server.js) or `/task/new` would
 * render as a task called "new". `/task/:issueId/edit` has one more segment and
 * can't collide. Both are pinned in tests/unit/task-page-route.test.js.
 *
 * The page reads with the session credential, through the issue's own binding
 * (`?source=&bindingScope=`, as the Edit link carries it). The state endpoint
 * reads stored data only and never touches a provider: the client polls it, and
 * a poll must never spend a tracker read or an LLM call.
 */

import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { resolveIssueBinding, bindingRefusalResponse, isValidIssueId } from '../lib/workspace.js';
import { jsonError } from '../lib/errors.js';
import {
  renderTaskPage,
  renderTaskNotFoundPage,
  renderTaskStatus,
  renderTaskTrack,
  renderTaskContext,
} from '../lib/render-task-page.js';

/** A non-empty query string value, else undefined. */
function queryValue(value) {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - Workspace resolution middleware.
 * @param {Function} deps.getOpenRouterSource - Footer AI-status source.
 * @param {Function} deps.getDeployInfo - Footer deploy info.
 * @param {{loadTaskPage: Function, loadTaskState: Function}} deps.loader - `createTaskPageLoader(...)`
 * @param {Function} [deps.now] - () → Date
 * @returns {Router}
 */
export function createTaskPageRoutes({ workspaceFromUrl, getOpenRouterSource, getDeployInfo, loader, now = () => new Date() }) {
  if (!loader) throw new Error('task-page routes: loader is required');
  const router = Router();

  router.get('/workspace/:urlKey/task/:identifier', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;
    const pageOptions = {
      deployInfo: getDeployInfo(),
      openRouterSource: getOpenRouterSource(req),
      workspaces: req.session.workspaces,
      featureFlags: getFeatureFlags(req.session),
    };

    // A malformed id is just a task that doesn't exist: 404 body, no detail.
    if (!isValidIssueId(identifier)) {
      return res.status(404).send(renderTaskNotFoundPage({ identifier, urlKey: workspace.urlKey }, pageOptions));
    }

    // The issue's OWN binding (LIN-1904 / LIN-3240), from the provenance the
    // links carry. Single-binding workspaces fall back to the active one.
    const binding = { source: queryValue(req.query.source), bindingScope: queryValue(req.query.bindingScope) };
    const issueBinding = resolveIssueBinding(workspace, binding);
    if (issueBinding.error) {
      const { status, body } = bindingRefusalResponse(issueBinding);
      return res.status(status).json(body);
    }
    const access = { provider: issueBinding.provider, callScope: issueBinding.callScope };

    try {
      const result = await loader.loadTaskPage({ urlKey: workspace.urlKey, identifier, access });
      if (result.notFound) {
        return res.status(404).send(renderTaskNotFoundPage({ identifier, urlKey: workspace.urlKey }, pageOptions));
      }
      if (result.unavailable) {
        // The tracker couldn't be read: an upstream outage, not a missing task,
        // so try-again (503) rather than not-found.
        return res.status(503).send(renderErrorPage(
          'Task unavailable',
          'Could not read this task from the tracker just now. Please try again shortly.',
          { action: 'Back to tasks', actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/` }
        ));
      }
      const { model } = result;
      const issueIdQuery = model.issueId ? `?issueId=${encodeURIComponent(model.issueId)}` : '';
      const stateUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/api/task/${encodeURIComponent(model.identifier)}/state${issueIdQuery}`;
      return res.send(renderTaskPage(model, {
        viewer: 'owner',
        urlKey: workspace.urlKey,
        binding: { source: binding.source || null, bindingScope: binding.bindingScope || null },
        stateUrl,
        now: now(),
        pageOptions,
      }));
    } catch (error) {
      console.error('Task page error:', error);
      return res.status(500).send(renderErrorPage(
        'Something Went Wrong',
        'Could not load this task. Please try again.',
        { action: 'Back to tasks', actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/` }
      ));
    }
  });

  // Stored data only: dispatch rows, agent status, brief/recap caches. Returns
  // the header status, the track and the brief/recap panels, rendered by the
  // same functions as the page. Viewer-blind: the owner controls stay in the
  // page and are never re-sent. It can't see the tracker, so it never reports
  // `done`; the client doesn't poll a page that loaded done.
  router.get('/workspace/:urlKey/api/task/:identifier/state', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    const issueId = queryValue(req.query.issueId);
    try {
      const { model } = await loader.loadTaskState({
        urlKey: workspace.urlKey,
        identifier,
        issueId: issueId && isValidIssueId(issueId) ? issueId : null,
      });
      res.set('Cache-Control', 'no-store');
      return res.json({
        status: model.status,
        live: model.live,
        headerHtml: renderTaskStatus(model),
        trackHtml: renderTaskTrack(model, { now: now() }),
        contextHtml: renderTaskContext(model, { urlKey: workspace.urlKey }),
      });
    } catch (error) {
      console.error('Task page state error:', error.message);
      return jsonError(res, 500, 'Could not read task state');
    }
  });

  return router;
}
