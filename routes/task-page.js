/**
 * Task page routes (LIN-3329, Subtask B of LIN-3324).
 *
 *   GET /workspace/:urlKey/task/:identifier            — the owner's task page
 *   GET /workspace/:urlKey/api/task/:identifier/state  — stored-data repaint
 *   GET /workspace/:urlKey/api/task/:identifier/proposals — the owner's staged chat proposals (LIN-3975)
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
 * The page reads with the session credential, through the issue's own
 * provider-kind source (`?source=`, as the Edit link carries it). The state
 * endpoint reads the held task facts only (LIN-4070): it never touches a
 * provider, and a poll must never spend a tracker read or an LLM call. A
 * refresh of the held set is started only here, by the private handlers (the
 * page load and the state poll), with the request's own workspace and account.
 *
 * The viewer is the owner or a member (LIN-3975). A member reads the page without
 * any owner control; the server still refuses each action a member may not take.
 */

import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { sessionSummaryOf } from '../lib/task-page-loader.js';
import { rowRecordOf } from '../lib/task-board-view.js';
import { pageStatusOf } from '../lib/task-state.js';
import { isHiddenState } from '../lib/providers/state-map.js';
import { renderTaskQuestion } from '../lib/render-task-page.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import { resolveIssueBinding, isValidIssueId } from '../lib/workspace.js';
import { jsonError } from '../lib/errors.js';
import { readOwnerSeamStatus } from '../lib/workspace-owner.js';
import { buildPromptOpts } from '../lib/render-prompt-opts.js';
import { isLocalhostRequest } from '../lib/public-origin.js';
import {
  renderTaskPage,
  renderTaskNotFoundPage,
  renderTaskStatus,
  renderHomeStatus,
  renderTaskTrack,
  renderStageStrip,
} from '../lib/render-task-page.js';

/** A non-empty query string value, else undefined. */
function queryValue(value) {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * The state poll's `sessions` block (LIN-3833, LIN-4068 D7). The task's own summary, with `action` from the gather and
 * `busy` widened to a running or queued subtask (the same rollUp the row's action reads), so the opened box holds its
 * step line back exactly where the row holds its action (LIN-4070, found by the opened-box E2E).
 */
function sessionsOfState(model, taskState) {
  const summary = sessionSummaryOf(model, { container: taskState.container === true });
  return { ...summary, busy: summary.busy || !!(taskState.running || taskState.queued), action: taskState.action };
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - Workspace resolution middleware.
 * @param {Function} deps.getOpenRouterSource - Footer AI-status source.
 * @param {Function} deps.getDeployInfo - Footer deploy info.
 * @param {{loadTaskPage: Function, loadTaskState: Function}} deps.loader - `createTaskPageLoader(...)`
 * @param {Function|null} [deps.workspaceOwnerCheck] - the ONE hoisted owner seam (server.js)
 * @param {Function} [deps.now] - () → Date
 * @returns {Router}
 */
export function createTaskPageRoutes({ workspaceFromUrl, getOpenRouterSource, getDeployInfo, loader, workspaceOwnerCheck = null, runProposalsStore = null, taskFacts = null, refreshTaskFacts = null, now = () => new Date() }) {
  if (!loader) throw new Error('task-page routes: loader is required');
  const router = Router();

  // LIN-4070: the private handlers' only route to the holder. An incomplete read starts the background refresh (the
  // holder's trigger is rate-limited and single-flight), and a read the page's own tracker contradicts drops the stale
  // entry first. Neither is reachable from the loader, which the public guest route shares.
  // `trackerType` is the page's own tracker read. A task the tracker says is live and that the set lacks (task-missing)
  // refreshes at once; a hidden (canceled) task does not, as before. The state poll reads no tracker, so it passes no
  // `trackerType` (undefined) and a task-missing read is urgent there too (LIN-4070 review: the poll alone must start the
  // one refresh the ticket names). The cost is that a hidden task's open page may refresh once per 60 s attempt floor
  // rather than once per 2 minutes; the floor and single-flight rules still bound it.
  const kickTaskFacts = ({ workspace, accountId, result, trackerType = undefined }) => {
    if (!result || !result.incomplete) return;
    if (result.stale && taskFacts) taskFacts.invalidate(workspace.urlKey);
    const live = trackerType === undefined ? true : trackerType !== null && !isHiddenState({ state: { type: trackerType } });
    const urgent = result.incomplete === 'task-missing' && live;
    if (refreshTaskFacts) refreshTaskFacts({ urlKey: workspace.urlKey, workspace, accountId, urgent });
  };

  // LIN-3975: the chat proposals still pending for this task's runs (the run control stages them). Read for the owner
  // only, from the runs the page already links (a run outside the page's read window has no link, so no proposal
  // either). A proposal carries its first line as its reason; the prompt itself stays in the store.
  const pendingProposalsOf = async (urlKey, model) => {
    if (!runProposalsStore) return [];
    const runIds = [...new Set((model.sessions || []).map(s => s.runId).filter(Boolean))];
    const lists = await Promise.all(runIds.map(runId => runProposalsStore.list(urlKey, runId).catch(() => [])));
    return lists.flat()
      .filter(p => p && p.status === 'proposed')
      .map(p => ({ id: p.id, runId: p.runId, reason: String(p.prompt || '').split('\n')[0].trim().slice(0, 200) }));
  };

  // LIN-3975: the owner or a member. Fail closed: no seam, no account, or an unreadable answer is a member, the
  // same reading the share-creation seam takes (an ownerless workspace reads as member, not as owner).
  const viewerOf = async (req) => {
    const accountId = req.session?.accountId;
    if (!accountId || !workspaceOwnerCheck) return 'member';
    const { status } = await readOwnerSeamStatus(() => workspaceOwnerCheck({ workspaceId: req.workspace.id, accountId }));
    return status === 'owner' ? 'owner' : 'member';
  };

  router.get('/workspace/:urlKey/task/:identifier', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;
    const pageOptions = {
      deployInfo: getDeployInfo(),
      openRouterSource: getOpenRouterSource(req),
      workspaces: req.session.workspaces,
      featureFlags: await requestFeatureFlags(req),
    };

    // A malformed id is just a task that doesn't exist: 404 body, no detail.
    if (!isValidIssueId(identifier)) {
      return res.status(404).send(renderTaskNotFoundPage({ identifier, urlKey: workspace.urlKey }, pageOptions));
    }

    // The issue's OWN provider-kind source (LIN-1904 / LIN-3335), from the
    // provenance the links carry. Single-binding workspaces fall back to the
    // active one. The pair-era `bindingScope` is gone.
    const binding = { source: queryValue(req.query.source) };
    const issueBinding = resolveIssueBinding(workspace, binding.source);
    const access = { provider: issueBinding.provider, callScope: issueBinding.callScope };

    try {
      const viewer = await viewerOf(req);
      const owner = viewer === 'owner';
      const result = await loader.loadTaskPage({
        urlKey: workspace.urlKey,
        workspaceId: workspace.id,
        identifier,
        access,
        viewerIsOwner: owner,
        runnerReady: owner && (await requestFeatureFlags(req)).runControls === true,
      });
      kickTaskFacts({ workspace, accountId: req.session?.accountId ?? null, result, trackerType: result.model?.tracker?.state?.type ?? null });
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
      const model = owner ? { ...result.model, proposals: await pendingProposalsOf(workspace.urlKey, result.model) } : result.model;
      const stateQuery = model.issueId ? [`issueId=${encodeURIComponent(model.issueId)}`] : [];
      const stateUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/api/task/${encodeURIComponent(model.identifier)}/state${stateQuery.length ? `?${stateQuery.join('&')}` : ''}`;
      // The page's pill and run control read the gathered state (LIN-4070 B). When the held set is incomplete the pill is
      // the display-only provisional one, and the row record carries no action, so no run is offered.
      const taskState = result.taskState || null;
      // The run control's options (LIN-3975): the owner's only. The same vocabulary Home's opened task takes.
      // LIN-4016/LIN-4068/LIN-4071: the task's own decision record (the gathered action and the copy-first words), the one a
      // Home row carries. A page with no held state carries no action, so no run is offered.
      const promptOpts = owner ? {
        ...buildPromptOpts({
          openRouterSource: pageOptions.openRouterSource,
          featureFlags: pageOptions.featureFlags,
          isLocalhost: isLocalhostRequest(req),
        }),
        row: rowRecordOf({ stateType: model.tracker?.state?.type ?? null, decided: taskState }),
      } : null;
      return res.send(renderTaskPage(model, {
        viewer,
        urlKey: workspace.urlKey,
        binding: { source: binding.source || null },
        stateUrl,
        now: now(),
        pageOptions,
        promptOpts,
        taskState: taskState || result.provisional || null,
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

  // Stored data only: dispatch rows, agent status, brief/recap caches, and the held set's gathered state. Returns the
  // header status, the track and the brief/recap panels, rendered by the same functions as the page. Viewer-blind: the
  // owner controls stay in the page and are never re-sent. `status` is the gathered state's projection (`pageStatusOf`,
  // LIN-4071), so a poll stops only on a complete gathered `done`, never on a page-load word.
  router.get('/workspace/:urlKey/api/task/:identifier/state', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    const issueId = queryValue(req.query.issueId);
    try {
      const { model, taskState, incomplete } = await loader.loadTaskState({
        urlKey: workspace.urlKey,
        identifier,
        issueId: issueId && isValidIssueId(issueId) ? issueId : null,
      });
      kickTaskFacts({ workspace, accountId: req.session?.accountId ?? null, result: { incomplete } });
      res.set('Cache-Control', 'no-store');
      // The history facts (count, last, track, strip) are the task's own whole-life read and ride even when the held set is
      // incomplete. The state does not: no `taskState`, no run-offering action, and the reply says why. The browser keeps
      // what it painted and polls on.
      // LIN-4070 D7 (found by the opened-box E2E): `busy` is the gather's too. A parent whose subtask runs is busy, so the box
      // holds its step line back; the step line is the one run offer the box paints besides the Go button. A cold reply is
      // busy as well: no step is offered on a state that is not known (busy hides the step line in the client).
      if (incomplete) {
        return res.json({
          incomplete,
          trackHtml: renderTaskTrack(model, { now: now(), urlKey: workspace.urlKey, runLinks: true }),
          stripHtml: renderStageStrip(model, { now: now() }),
          sessions: { ...sessionSummaryOf(model), next: null, offered: null, busy: true, action: null },
        });
      }
      // LIN-4024: the question card carries an answer box, so only the owner gets one. Whether it shows at all is
      // `renderTaskQuestion`'s gate (LIN-4038: an open ruling only, not a shelved or bare `[blocked]` wait), the same
      // one the page-load card uses, so this read and the page cannot disagree. The poll keys on this string.
      const questionHtml = (await viewerOf(req)) === 'owner'
        ? renderTaskQuestion(model, { urlKey: workspace.urlKey })
        : '';
      const body = {
        // LIN-4071: the page's status is the gathered state's (the poll stops on a Done task only when the gather says done).
        status: pageStatusOf(taskState),
        live: model.live,
        // LIN-4070 B: the pill and Home's one-line state read the gathered state, the decision Home's row shows.
        headerHtml: renderTaskStatus(model, { now: now(), taskState }),
        // LIN-4010: Home's one-line state (no "Harbour:" label; a waiting task says needs you or parked).
        homeStatusHtml: renderHomeStatus(model, { now: now(), taskState }),
        // The owner's and a member's state carries the attempts' run links (LIN-3975); it is a signed-in read.
        trackHtml: renderTaskTrack(model, { now: now(), urlKey: workspace.urlKey, runLinks: true }),
        // LIN-3968: the one-row stage strip Home's opened task pastes; the task page keeps trackHtml.
        stripHtml: renderStageStrip(model, { now: now() }),
        // LIN-3833: the sessions the state block and the run control read (count, last, running). LIN-4068 D7: the
        // action is the gather's (busy includes a running subtree), so it is not recomputed here.
        sessions: sessionsOfState(model, taskState),
        // LIN-4016: the task's decided state, with its main action (the gather's, LIN-4068).
        taskState,
        // LIN-4071: the subtask line the opened task names (a subtask that needs you, else a failed one): the gather's words,
        // so the browser paints the line from `/state`, not from a page-load row.
        attention: taskState.attention ?? null,
        // LIN-4024: the question card, for a task waiting on an open ruling only (a parked task has none). The
        // same renderer as the task page.
        questionHtml,
      };
      return res.json(body);
    } catch (error) {
      console.error('Task page state error:', error.message);
      return jsonError(res, 500, 'Could not read task state');
    }
  });

  // LIN-3975 (finding 1): the owner's staged chat proposals for this task, re-read when a fold turn proposes one, so the
  // run control shows it without a reload. Owner-only and fail-closed: a member gets a refusal, not an empty list, so no
  // proposal is ever named to a viewer who cannot act on it. The state poll stays free of them (its key set is pinned).
  router.get('/workspace/:urlKey/api/task/:identifier/proposals', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    if ((await viewerOf(req)) !== 'owner') return jsonError(res, 403, 'Only the workspace owner can read staged proposals');
    const issueId = queryValue(req.query.issueId);
    try {
      const { model } = await loader.loadTaskState({
        urlKey: workspace.urlKey,
        identifier,
        issueId: issueId && isValidIssueId(issueId) ? issueId : null,
      });
      res.set('Cache-Control', 'no-store');
      return res.json({ proposals: await pendingProposalsOf(workspace.urlKey, model) });
    } catch (error) {
      console.error('Task page proposals error:', error.message);
      return jsonError(res, 500, 'Could not read staged proposals');
    }
  });

  return router;
}
