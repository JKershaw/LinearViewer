/**
 * Task-mode routes (LIN-2942): record and read which rung of the opened task's
 * ladder a person took a task on (copy / run this step / run the whole task).
 *
 *   POST /workspace/:urlKey/api/task-mode                   — record a client press
 *   GET  /workspace/:urlKey/api/task-mode/:issueIdentifier  — the account's mode for a task
 *
 * Session auth (workspaceFromUrl), like the other workspace API routes. The
 * client records only presses with no server call of their own — copies and
 * presses on a "○ set up ›" rung, and the run-task press. A dispatch is never
 * recorded here: the session dispatch route records it, with the item's
 * dispatchId, once the item exists (routes/dispatch.js, `entryRung`).
 *
 * The record is a self-reported measurement, never a gate: nothing may count
 * these events to allow or refuse a run.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { badRequest, jsonError, unauthorized } from '../lib/errors.js';
import { CLIENT_ACTS, validateTaskModeEvent } from '../lib/task-mode-store.js';
import { resolveAccountGroup } from '../lib/account-group.js';

// PROVISIONAL (LIN-2942, for John): the POST appends to a lifetime-retained
// collection on every press, so it gets its own per-IP budget. 60 a minute is
// far above a person pressing rungs and well below a loop flooding the log.
const taskModeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many task-mode requests, please try again later' },
  // Skip rate limiting in test mode
  skip: () => process.env.NODE_ENV === 'test'
});

/**
 * @param {Object} deps
 * @param {import('../lib/task-mode-store.js').TaskModeStore} deps.taskModeStore
 * @param {import('../lib/account-store.js').AccountStore} deps.accountStore
 * @param {Function} deps.workspaceFromUrl
 */
export function createTaskModeRoutes({ taskModeStore, accountStore, workspaceFromUrl }) {
  const router = Router();

  router.post('/workspace/:urlKey/api/task-mode', taskModeLimiter, workspaceFromUrl, async (req, res) => {
    const accountId = req.session?.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Not authenticated');
    }

    const { rung, ready, needs, act, surface, issueId, issueIdentifier, dispatchId } = req.body || {};
    if (!CLIENT_ACTS.includes(act)) {
      return badRequest.json(res, `act must be one of: ${CLIENT_ACTS.join(', ')}`);
    }
    if (dispatchId !== undefined && dispatchId !== null) {
      return badRequest.json(res, 'dispatchId is not accepted here');
    }

    // Only named fields are taken from the body; accountId, urlKey and `at`
    // come from the server, so a press is always attributed to the session.
    const event = {
      accountId,
      urlKey: req.workspace.urlKey,
      issueId: issueId ?? null,
      issueIdentifier,
      rung,
      ready,
      needs: needs ?? null,
      act,
      dispatchId: null,
      surface: surface ?? null
    };
    const invalid = validateTaskModeEvent(event);
    if (invalid) {
      return badRequest.json(res, invalid);
    }

    await taskModeStore.record(event);
    return res.status(204).end();
  });

  router.get('/workspace/:urlKey/api/task-mode/:issueIdentifier', workspaceFromUrl, async (req, res) => {
    const accountId = req.session?.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Not authenticated');
    }

    try {
      const accountIds = await resolveAccountGroup(accountStore, accountId);
      const mode = await taskModeStore.getTaskMode({
        accountIds,
        urlKey: req.workspace.urlKey,
        issueIdentifier: req.params.issueIdentifier
      });
      return res.json(mode);
    } catch (err) {
      console.error('Error reading task mode:', err.message);
      return jsonError(res, 500, 'Failed to read task mode');
    }
  });

  return router;
}
