/**
 * Consumer-API rulings routes (LIN-2444; LIN-2790 widens the propose side).
 *
 * Three endpoints, and the gap between them is the whole point of the ticket:
 *
 *   GET  /api/proxy/rulings                                — read this workspace's unanswered decisions
 *   POST /api/proxy/rulings/:decisionId/suggest-dismissal   — PROPOSE that one be dismissed
 *   POST /api/proxy/rulings/:decisionId/suggest-answer      — PROPOSE that one be answered with a given option
 *
 * John's ruling, verbatim:
 *
 *   "We don't want an agent to actually dismiss a ruling, but perhaps it could
 *    recommend a dismiss and it's easy for me/a user to agree."
 *
 * So there is deliberately NO proxy dismiss OR answer here. The original
 * proposal on the ticket had a dismiss; it was dropped. An operator or agent
 * session may say "I think this can go/be answered this way, and here is
 * why"; a human then agrees in the UI, which runs the pre-existing
 * session-authed discharge path. This router never calls
 * `markDecisionAnswered`, never writes a `decision-answer` stamp, and never
 * touches a loop or task-decision row — it writes only to its own suggestion
 * store, which is a view annotation (see lib/dismissal-suggestions-store.js).
 * Structurally: **the proxy may never write `agreed`, `agreedAt`, or
 * `acceptedAt` on its own proposal row** — that boundary is the point of
 * LIN-2790, not a side effect of it.
 *
 * That keeps LIN-1728's structural guarantee intact rather than merely
 * unexercised: `decision-answer` stays absent from `FEEDBACK_ENTRY_KINDS`
 * (lib/dispatch-store.js), so a dispatch-consumer token still cannot discharge
 * the question it asked. This ticket adds a way to ASK, never a way to ANSWER.
 *
 * `suggest-answer` is deliberately disposition-agnostic at propose time — it
 * does not gate on the row's current disposition/canReply/effect. Disposition
 * is "resolved fresh at press time and never stored"
 * (lib/unanswered-decisions.js), so gating propose time on the *current*
 * disposition would check the wrong instant either way. Any refusal on that
 * axis belongs entirely at press time, in the UI's own Agree handling — not here.
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
import { attachStandingSuggestions } from '../lib/dismissal-suggestions-store.js';
import { enrichLoop, isTerminalLoop } from './dashboard.js';

const MAX_REASON_LENGTH = 500;

/**
 * Attribution comes from the TOKEN, never from the request body — a caller
 * must not be able to propose in someone else's name. A token is minted by a
 * signed-in human, so `createdBy` is a real identity; the label is the
 * fallback for a pre-LIN-1397 ownerless token. Shared by both propose routes.
 */
function attributionFromToken(req) {
  return req.proxyCreatedBy || req.proxyTokenLabel || 'proxy token';
}

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
 * @param {Object} [deps.sessionsFeedCache] - Shared SWR cache for the loop read (null → uncached)
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
  dismissalSuggestionsStore = null,
  sessionsFeedCache = null
}) {
  const router = Router();

  /**
   * The workspace's unanswered decisions, through the SAME short-TTL SWR cache
   * the session-authed rulings feed uses (`routes/dashboard.js`).
   *
   * Caching is not an optimisation here, it is a bound. `getLoopsForWorkspace`
   * reconstructs from a 30-day dispatch-history window with NO row cap — the
   * read `lib/pipeline-loops.js` itself flags as the LIN-615 truncation-footgun
   * guard, and the one this repo blames for the LIN-608 OOM. The only other
   * limit on this route is `proxyLimiter`, which is per-IP and shared across
   * every proxy endpoint, so N agents on N addresses would each get their own
   * full reconstruction. A distinct `view` namespace keeps this payload from
   * colliding with the dashboard's on the same workspace key.
   */
  async function readRulings(urlKey) {
    const loadLoops = async () => {
      const rawLoops = await getLoopsForWorkspace(urlKey, {
        dispatchStore: dispatchQueueStore,
        agentStatusStore,
        lean: true
      });
      // Shaped as the session-authed feed shapes its own loops, minus
      // `workspaceName` and the activity sort (neither of which any
      // answer-state decision reads).
      //
      // The workspace tag IS load-bearing: without it `anchor.workspaceUrlKey`
      // is null and a caller cannot route a reply to the right workspace.
      //
      // `enrichLoop` is NOT, on this route, today — an earlier version of this
      // comment claimed it was ("a live, mid-turn ruling reports as
      // repliable") and that was simply false. It sets `agentState` and
      // `completedAt`; `completedAt` never reaches the response, and
      // `agentState` is read only by `resolveDisposition`'s `'mid-turn'`
      // branch, which yields `canReply: false` exactly as `'indeterminate'`
      // does, so repliability cannot change. It is kept so the two feeds
      // cannot drift on how a loop is shaped: `effectiveAgentState` returning
      // `loop.agentState` unchanged here is a property of today's
      // reconstruction, not a contract, and re-deriving the shaping locally is
      // precisely how the two surfaces would come to disagree about a ruling.
      return rawLoops.map(loop => ({ ...enrichLoop(loop), workspaceUrlKey: urlKey }));
    };

    // Only the LOOP READ is cached — the expensive part. The collection runs
    // fresh on every request, matching the dashboard. That distinction is
    // load-bearing, not stylistic: `resolveDisposition`'s own docstring says a
    // disposition is "resolved fresh at press time and never stored (liveness
    // decays, so a stored flag would lie to the operator by the time they act
    // on it)", and `shelfGate` likewise compares `resurfaceAt` against now.
    // Caching the collected rows would store both.
    const loops = sessionsFeedCache
      ? await sessionsFeedCache.get(sessionsFeedCache.keyFor([{ urlKey }], 'proxy-rulings'), loadLoops)
      : await loadLoops();

    const [taskDecisions, shelvedRulings, newestScanByTask] = await Promise.all([
      taskDecisionsStore ? taskDecisionsStore.listUnansweredForWorkspaces([urlKey]) : Promise.resolve([]),
      shelvedRulingsStore ? shelvedRulingsStore.listForWorkspaces([urlKey]) : Promise.resolve([]),
      // LIN-2729 / LIN-2893 Step 5: same `[urlKey]` scope as `taskDecisions`
      // above — see `listNewestScanPerTask`'s own doc for why this read
      // needs it too.
      taskDecisionsStore ? taskDecisionsStore.listNewestScanPerTask([urlKey]) : Promise.resolve({})
    ]);
    // LIN-2773 Area 4: same `liveDispatchOnAnchor` predicate as the
    // session-authed feed (routes/dashboard.js), reusing the SAME exported
    // `isTerminalLoop` rather than a second hand-rolled terminal check —
    // zero new reads, scanning only the `loops` array already fetched above.
    // `anchorTerminal` stays unpassed here too (S3's press-time read).
    return collectUnansweredDecisions({ loops, taskDecisions, shelvedRulings, newestScanByTask }, {
      now: new Date(),
      liveDispatchOnAnchor: (issueIdentifier) =>
        loops.some(l => l.issueIdentifier === issueIdentifier && !isTerminalLoop(l))
    });
  }

  /**
   * Shared decision lookup + orphan-row guard for both propose routes
   * (`suggest-dismissal`, `suggest-answer`). The id must name a ruling that is
   * actually unanswered in THIS workspace. Without this a caller gets `201
   * {success: true}` for a typo or an already-answered decision, and writes a
   * durable, no-TTL row nobody will ever see — a success signal that means
   * nothing, and unbounded orphan rows from any readWrite token. It reuses the
   * GET's own cached loop read, so the check costs a collection pass, not a
   * second reconstruction.
   *
   * LIN-2756: when `decisionLoopId` is given, the SAME orphan-row concern
   * applies to it — a caller passing a decisionLoopId that names no real row's
   * anchor would write a suggestion that can never match anything
   * (attachStandingSuggestions' loop-scoped lookup would never find it),
   * silently. Matched against `anchor.loopId ?? anchor.taskDecisionId`,
   * exactly the segment the composite key uses.
   *
   * On a miss, sends the 404 itself (both callers use the identical shape)
   * and returns `null`; on a hit, returns the matched row — scoped to the
   * exact loop when `decisionLoopId` was given, so a caller (suggest-answer)
   * can read that specific row's own `decision.options`.
   *
   * @returns {Promise<Object|null>}
   */
  async function resolveTargetRuling(req, res, { decisionId, decisionLoopId, routeLabel }) {
    const rulings = await readRulings(req.proxyUrlKey);
    const matchesId = (row) => row.decision?.decision_id === decisionId;
    if (!rulings.some(matchesId)) {
      logEvent(req, routeLabel, 404);
      jsonError(res, 404, 'No unanswered ruling with that decisionId in this workspace', {
        code: 'RULING_NOT_FOUND'
      });
      return null;
    }
    if (decisionLoopId) {
      const matchesLoop = (row) =>
        matchesId(row) && (row.anchor?.loopId ?? row.anchor?.taskDecisionId) === decisionLoopId;
      const row = rulings.find(matchesLoop);
      if (!row) {
        logEvent(req, routeLabel, 404);
        jsonError(res, 404, 'No unanswered ruling with that decisionId AND decisionLoopId in this workspace', {
          code: 'RULING_NOT_FOUND'
        });
        return null;
      }
      return row;
    }
    return rulings.find(matchesId);
  }

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
      const [rulings, suggestions] = await Promise.all([
        readRulings(urlKey),
        dismissalSuggestionsStore ? dismissalSuggestionsStore.listForWorkspaces([urlKey]) : Promise.resolve([])
      ]);

      // LIN-2756: loop-aware join, shared with routes/dashboard.js's own GET
      // — see attachStandingSuggestions' own doc for the two-tier match.
      logEvent(req, '/api/proxy/rulings', 200);
      res.json({
        count: rulings.length,
        rulings: attachStandingSuggestions(rulings, suggestions),
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
      const { reason, decisionLoopId } = req.body || {};

      if (!decisionId || typeof decisionId !== 'string') {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 400);
        return badRequest.json(res, 'decisionId is required');
      }
      // LIN-2756: OPTIONAL, unlike routes/dashboard.js's dismiss route
      // (which requires it) — the ticket's back-compat clause is specifically
      // "keep a decisionId-only write working as applies to every loop
      // carrying that id", and this route is where that write actually
      // happens (an agent proposing via the proxy API). Type-checked exactly
      // like dashboard.js's dismiss validation when PRESENT; its ABSENCE is
      // the documented wide/legacy shape, not an error.
      if (decisionLoopId !== undefined && (typeof decisionLoopId !== 'string' || !decisionLoopId)) {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 400);
        return badRequest.json(res, 'decisionLoopId, when given, must be a non-empty string');
      }
      if (typeof reason !== 'string' || !reason.trim()) {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 400);
        return badRequest.json(res, 'A reason is required — a dismissal nobody justified is one the operator cannot agree to');
      }
      if (reason.trim().length > MAX_REASON_LENGTH) {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 400);
        return badRequest.json(res, `reason must be ${MAX_REASON_LENGTH} characters or fewer`);
      }
      if (!dismissalSuggestionsStore) {
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 503);
        return jsonError(res, 503, 'Dismissal-suggestions store not configured');
      }

      try {
        const row = await resolveTargetRuling(req, res, {
          decisionId, decisionLoopId, routeLabel: '/api/proxy/rulings/suggest-dismissal'
        });
        if (!row) return; // resolveTargetRuling already sent the 404

        const suggestedBy = attributionFromToken(req);
        const record = await dismissalSuggestionsStore.suggest({
          urlKey: req.proxyUrlKey,
          decisionId,
          decisionLoopId: decisionLoopId || undefined,
          reason,
          suggestedBy
        });
        if (!record) {
          logEvent(req, '/api/proxy/rulings/suggest-dismissal', 500);
          return jsonError(res, 500, 'Failed to record the suggestion');
        }
        // LIN-2755: uniform invalidation on every ruling write — suggest-
        // dismissal only ever writes to dismissalSuggestionsStore, which is
        // read live (not cached), so this is defensive/uniform rather than
        // fixing an observable staleness bug. Guarded like the GET read
        // above: a null sessionsFeedCache means this deployment runs
        // uncached, so there is nothing to invalidate.
        if (sessionsFeedCache) sessionsFeedCache.clear(req.proxyUrlKey);
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 201);
        res.status(201).json({
          success: true,
          suggestion: record,
          // Said plainly on the wire, because the whole risk of this endpoint
          // is a caller believing it discharged the ruling.
          note: 'Recorded as a SUGGESTION only. The ruling is still unanswered until a human dismisses or answers it.'
        });
      } catch (error) {
        console.error('Proxy ruling suggest-dismissal error:', error);
        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 500);
        jsonError(res, 500, 'Failed to record the suggestion');
      }
    }
  );

  /**
   * Propose that a ruling be ANSWERED with a given option. This does NOT
   * answer it — exactly as `suggest-dismissal` does not dismiss. LIN-2790.
   *
   * A `reason` is mandatory for the same reason `suggest-dismissal` requires
   * one: the operator's whole interaction with this is a one-click Agree, so
   * an unjustified proposal turns that click into a rubber stamp.
   *
   * `optionId` must name one of the decision's own `options[].id` — an
   * unknown option, or a free-text decision with no `options[]` at all, is
   * refused with 422 rather than silently accepted as an answer to nothing.
   *
   * This route stays disposition-agnostic at propose time — see the module
   * docstring. It never gates on the row's current disposition/canReply/effect.
   *
   * @route POST /api/proxy/rulings/:decisionId/suggest-answer
   */
  router.post(
    '/api/proxy/rulings/:decisionId/suggest-answer',
    proxyLimiter,
    authenticateProxyToken,
    requireWriteScope,
    async (req, res) => {
      const { decisionId } = req.params;
      const { optionId, reason, decisionLoopId } = req.body || {};
      const routeLabel = '/api/proxy/rulings/suggest-answer';

      if (!decisionId || typeof decisionId !== 'string') {
        logEvent(req, routeLabel, 400);
        return badRequest.json(res, 'decisionId is required');
      }
      // LIN-2756: OPTIONAL, same convention as suggest-dismissal — see that
      // route's own comment for why decisionLoopId's absence is a documented
      // wide/legacy shape, not an error.
      if (decisionLoopId !== undefined && (typeof decisionLoopId !== 'string' || !decisionLoopId)) {
        logEvent(req, routeLabel, 400);
        return badRequest.json(res, 'decisionLoopId, when given, must be a non-empty string');
      }
      if (typeof optionId !== 'string' || !optionId.trim()) {
        logEvent(req, routeLabel, 400);
        return badRequest.json(res, 'optionId is required');
      }
      if (typeof reason !== 'string' || !reason.trim()) {
        logEvent(req, routeLabel, 400);
        return badRequest.json(res, 'A reason is required — an answer proposal nobody justified is one the operator cannot agree to');
      }
      if (reason.trim().length > MAX_REASON_LENGTH) {
        logEvent(req, routeLabel, 400);
        return badRequest.json(res, `reason must be ${MAX_REASON_LENGTH} characters or fewer`);
      }
      if (!dismissalSuggestionsStore) {
        logEvent(req, routeLabel, 503);
        return jsonError(res, 503, 'Dismissal-suggestions store not configured');
      }

      try {
        const row = await resolveTargetRuling(req, res, { decisionId, decisionLoopId, routeLabel });
        if (!row) return; // resolveTargetRuling already sent the 404

        // LIN-2790: refuse rather than silently drop — the predicate mirrors
        // `recommended`'s validation (lib/session-telemetry.js), but this
        // route REFUSES an invalid/absent option instead of dropping the
        // field, since silently accepting it would record an answer proposal
        // to nothing.
        const options = row.decision?.options;
        if (!Array.isArray(options) || options.length === 0) {
          logEvent(req, routeLabel, 422);
          return jsonError(res, 422, 'This decision has no options — it cannot be proposed as answered by option id', {
            code: 'NO_OPTIONS_AVAILABLE'
          });
        }
        if (!options.some(o => o.id === optionId)) {
          logEvent(req, routeLabel, 422);
          return jsonError(res, 422, `optionId "${optionId}" is not one of this decision's options`, {
            code: 'OPTION_NOT_FOUND'
          });
        }

        const suggestedBy = attributionFromToken(req);
        const record = await dismissalSuggestionsStore.suggest({
          urlKey: req.proxyUrlKey,
          decisionId,
          decisionLoopId: decisionLoopId || undefined,
          proposedOutcome: 'answered',
          optionId,
          reason,
          suggestedBy
        });
        if (!record) {
          logEvent(req, routeLabel, 500);
          return jsonError(res, 500, 'Failed to record the suggestion');
        }
        // LIN-2755: uniform invalidation, same reasoning as suggest-dismissal above.
        if (sessionsFeedCache) sessionsFeedCache.clear(req.proxyUrlKey);
        logEvent(req, routeLabel, 201);
        res.status(201).json({
          success: true,
          suggestion: record,
          // Said plainly on the wire, because the whole risk of this endpoint
          // is a caller believing it discharged the ruling.
          note: 'Recorded as a SUGGESTION only. The ruling is still unanswered until a human dismisses or answers it.'
        });
      } catch (error) {
        console.error('Proxy ruling suggest-answer error:', error);
        logEvent(req, routeLabel, 500);
        jsonError(res, 500, 'Failed to record the suggestion');
      }
    }
  );

  return router;
}
