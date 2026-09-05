/**
 * Consumer-API rulings routes (LIN-2444).
 *
 * Two endpoints, and the gap between them is the whole point of the ticket:
 *
 *   GET  /api/proxy/rulings                     — read this workspace's unanswered decisions
 *   POST /api/proxy/rulings/:decisionId/suggest-dismissal — PROPOSE that one be dismissed
 *
 * John's ruling, verbatim:
 *
 *   "We don't want an agent to actually dismiss a ruling, but perhaps it could
 *    recommend a dismiss and it's easy for me/a user to agree."
 *
 * So there is deliberately NO proxy dismiss here. The original proposal on the
 * ticket had one; it was dropped. An operator or agent session may say "I think
 * this can go, and here is why"; a human then agrees in the UI, which runs the
 * pre-existing session-authed dismiss. This router never calls
 * `markDecisionAnswered`, never writes a `decision-answer` stamp, and never
 * touches a loop or task-decision row — it writes only to its own suggestion
 * store, which is a view annotation (see lib/dismissal-suggestions-store.js).
 *
 * That keeps LIN-1728's structural guarantee intact rather than merely
 * unexercised: `decision-answer` stays absent from `FEEDBACK_ENTRY_KINDS`
 * (lib/dispatch-store.js), so a dispatch-consumer token still cannot discharge
 * the question it asked. This ticket adds a way to ASK, never a way to ANSWER.
 *
 * Scope: the read needs only `read`; proposing needs `readWrite`. A proxy token
 * is minted by a signed-in human and carries their `createdBy`, which is what
 * makes attribution on a suggestion meaningful — an unattributed proposal is
 * refused by the store.
 */
import { Router } from 'express';
import { badRequest, jsonError } from '../lib/errors.js';
import { getLoopsForWorkspace } from '../lib/pipeline-loops.js';
import { collectUnansweredDecisions } from '../lib/unanswered-decisions.js';
import { enrichLoop } from './dashboard.js';

const MAX_REASON_LENGTH = 500;

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware
 * @param {Function} deps.authenticateProxyToken - Proxy bearer-token auth middleware
 * @param {Function} deps.requireWriteScope - Middleware requiring a readWrite-scoped token
 * @param {Function} deps.logEvent - Proxy event/audit logger
 * @param {Object} deps.dispatchQueueStore - Dispatch storage (loop reconstruction input)
 * @param {Object} deps.agentStatusStore - Agent status storage (loop reconstruction input)
 * @param {Object} [deps.taskDecisionsStore] - Scan-produced decisions (null → that input is skipped)
 * @param {Object} [deps.shelvedRulingsStore] - Shelved rulings (null → that input is skipped)
 * @param {Object} [deps.dismissalSuggestionsStore] - Proposed dismissals (null → the propose route 503s)
 */
export function createRulingsRoutes({
  proxyLimiter,
  authenticateProxyToken,
  requireWriteScope,
  logEvent,
  dispatchQueueStore,
  agentStatusStore,
  taskDecisionsStore = null,
  shelvedRulingsStore = null,
  dismissalSuggestionsStore = null
}) {
  const router = Router();

  /**
   * Every unanswered decision for the TOKEN's workspace.
   *
   * Deliberately single-workspace, unlike the session-authed
   * `/workspace/:urlKey/api/dashboard/rulings`, which merges across
   * `req.session.workspaces`. A proxy token is scoped to exactly one
   * workspace, and widening this read to a session's merged set would hand a
   * single-workspace credential a cross-workspace view — the isolation
   * property the whole proxy token model rests on.
   *
   * @route GET /api/proxy/rulings
   */
  router.get('/api/proxy/rulings', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const urlKey = req.proxyUrlKey;
    try {
      // `lean` drops the heavy per-loop promptText the feed never reads
      // (LIN-622/LIN-623) — the same read the rulings feed itself uses.
      // Shaped exactly as the session-authed rulings feed shapes its own loops
      // (routes/dashboard.js's mergeLoops): `enrichLoop` supplies the
      // `agentState` that `resolveDisposition` reads, and the workspace tag is
      // what puts a usable `anchor.workspaceUrlKey` on every row. Both are
      // load-bearing rather than cosmetic — without the tag a caller cannot
      // route a reply back to the right workspace, and without the enrichment
      // a live, mid-turn ruling would report as repliable.
      const rawLoops = await getLoopsForWorkspace(urlKey, {
        dispatchStore: dispatchQueueStore,
        agentStatusStore,
        lean: true
      });
      const loops = rawLoops.map(loop => ({ ...enrichLoop(loop), workspaceUrlKey: urlKey }));
      const [taskDecisions, shelvedRulings, suggestions] = await Promise.all([
        taskDecisionsStore ? taskDecisionsStore.listUnansweredForWorkspaces([urlKey]) : Promise.resolve([]),
        shelvedRulingsStore ? shelvedRulingsStore.listForWorkspaces([urlKey]) : Promise.resolve([]),
        dismissalSuggestionsStore ? dismissalSuggestionsStore.listForWorkspaces([urlKey]) : Promise.resolve([])
      ]);

      const rulings = collectUnansweredDecisions(
        { loops, taskDecisions, shelvedRulings },
        { now: new Date() }
      );

      // Attach any STANDING proposal to its ruling. A withdrawn row is not
      // standing — the human already said Keep — so it is excluded here rather
      // than in the store, which deliberately returns raw rows so exactly one
      // place owns this predicate.
      const standing = new Map();
      for (const s of suggestions) {
        if (!s.withdrawn && s.decisionId) standing.set(s.decisionId, s);
      }

      logEvent(req, '/api/proxy/rulings', 200);
      res.json({
        count: rulings.length,
        rulings: rulings.map(row => {
          const suggestion = standing.get(row.decision?.decision_id) || null;
          return {
            ...row,
            suggestedDismissal: suggestion
              ? { reason: suggestion.reason, suggestedBy: suggestion.suggestedBy, suggestedAt: suggestion.suggestedAt }
              : null
          };
        }),
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Proxy rulings read error:', error);
      logEvent(req, '/api/proxy/rulings', 500);
      jsonError(res, 500, 'Could not load rulings');
    }
  });

  /**
   * Propose that a ruling be dismissed. This does NOT dismiss it.
   *
   * A `reason` is mandatory. That is not ceremony: the operator's whole
   * interaction with this is a one-click Agree, so a proposal with no stated
   * reason turns that click into a rubber stamp. It is the same rule shelving
   * already enforces — silent muting is forbidden
   * (docs/escalation-philosophy.md §6) — applied to the same class of act.
   *
   * @route POST /api/proxy/rulings/:decisionId/suggest-dismissal
   */
  router.post(
    '/api/proxy/rulings/:decisionId/suggest-dismissal',
    proxyLimiter,
    authenticateProxyToken,
    requireWriteScope,
    async (req, res) => {
      const { decisionId } = req.params;
      const { reason } = req.body || {};

      if (!decisionId || typeof decisionId !== 'string') {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 400);
        return badRequest.json(res, 'decisionId is required');
      }
      if (typeof reason !== 'string' || !reason.trim()) {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 400);
        return badRequest.json(res, 'A reason is required — a dismissal nobody justified is one the operator cannot agree to');
      }
      if (reason.length > MAX_REASON_LENGTH) {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 400);
        return badRequest.json(res, `reason must be ${MAX_REASON_LENGTH} characters or fewer`);
      }
      if (!dismissalSuggestionsStore) {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 503);
        return jsonError(res, 503, 'Dismissal-suggestions store not configured');
      }

      try {
        // Attribution comes from the TOKEN, never from the request body — a
        // caller must not be able to propose in someone else's name. A token
        // is minted by a signed-in human, so `createdBy` is a real identity;
        // the label is the fallback for a pre-LIN-1397 ownerless token.
        const suggestedBy = req.proxyCreatedBy || req.proxyTokenLabel || 'proxy token';
        const record = await dismissalSuggestionsStore.suggest({
          urlKey: req.proxyUrlKey,
          decisionId,
          reason,
          suggestedBy
        });
        if (!record) {
          logEvent(req, '/api/proxy/rulings/suggest-dismissal', 500);
          return jsonError(res, 500, 'Failed to record the suggestion');
        }
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 201);
        res.status(201).json({
          success: true,
          suggestion: record,
          // Said plainly on the wire, because the whole risk of this endpoint
          // is a caller believing it discharged the ruling.
          note: 'Recorded as a SUGGESTION only. The ruling is still unanswered until a human agrees to it.'
        });
      } catch (error) {
        console.error('Proxy ruling suggest-dismissal error:', error);
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 500);
        jsonError(res, 500, 'Failed to record the suggestion');
      }
    }
  );

  return router;
}
