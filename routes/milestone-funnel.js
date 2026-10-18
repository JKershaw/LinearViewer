/**
 * Milestone-funnel route (LIN-2952, LIN-3501): the per-person query the milestone
 * demo pastes — the funnel counts people (their merge group, across all their
 * workspaces) and a person's funnel is their first-ever moment at each step;
 * this route returns the signed-in person's five timestamps and states, plus the
 * task-mode record joined in, read through the same `stepsForAccountGroup` that
 * /kpis folds over the people who signed up in the last 30 days.
 *
 *   GET /workspace/:urlKey/api/milestone-funnel
 *
 * Session auth (workspaceFromUrl), like the other workspace API routes. The
 * account is the SESSION's own: the merge group is resolved with the shared
 * `resolveAccountGroup` (narrow to the session account on a corrupt chain), and
 * only that group's data is read — never another account's. This is the
 * per-account seam, so it MAY carry the account's own task identifiers (the
 * cross-account KPI aggregate must not).
 *
 * The funnel is ACCOUNT-WIDE by design: login and connected are account-level,
 * so the steps span every workspace the person has, not just `:urlKey`. The
 * echoed `urlKey` is the REQUEST's workspace, not a scope on the data.
 */

import { Router } from 'express';
import { jsonError, unauthorized } from '../lib/errors.js';
import { resolveAccountGroup } from '../lib/account-group.js';
import { stepsForAccountGroup } from '../lib/milestone-funnel.js';
import { foldTaskMode } from '../lib/task-mode-store.js';

/**
 * @param {Object} deps
 * @param {import('../lib/task-mode-store.js').TaskModeStore} deps.taskModeStore
 * @param {import('../lib/account-store.js').AccountStore} deps.accountStore
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} deps.accountWorkspaceStore
 * @param {Object} deps.dispatchQueue - 'dispatch-queue' collection
 * @param {Object} deps.dispatchHistory - 'dispatch-history' collection
 * @param {import('../lib/funnel-event-store.js').FunnelEventStore} deps.funnelEventStore
 * @param {readonly string[]} [deps.instrumentedSteps] - test seam; defaults to the INSTRUMENTED_STEPS code constant
 * @param {Function} deps.workspaceFromUrl
 */
export function createMilestoneFunnelRoutes({
  taskModeStore,
  accountStore,
  accountWorkspaceStore,
  dispatchQueue,
  dispatchHistory,
  funnelEventStore,
  instrumentedSteps,
  workspaceFromUrl
}) {
  const router = Router();

  router.get('/workspace/:urlKey/api/milestone-funnel', workspaceFromUrl, async (req, res) => {
    const accountId = req.session?.accountId;
    if (!accountId) {
      return unauthorized.json(res, 'Not authenticated');
    }

    try {
      const accountIds = await resolveAccountGroup(accountStore, accountId);
      const { steps, outOfOrder } = await stepsForAccountGroup({
        accountIds,
        accountStore,
        accountWorkspaceStore,
        dispatchQueue,
        dispatchHistory,
        funnelEventStore,
        instrumentedSteps
      });
      const mode = foldTaskMode(await taskModeStore.listForAccount(accountIds));
      return res.json({ accountId, urlKey: req.workspace.urlKey, steps, outOfOrder, mode });
    } catch (err) {
      console.error('Error reading milestone funnel:', err.message);
      return jsonError(res, 500, 'Failed to read milestone funnel');
    }
  });

  return router;
}
