/**
 * Runner proxy routes (LIN-3130 S2a / LIN-3059 P4) — the server-side runner
 * surface over the proxy credential:
 *
 *   GET  /api/proxy/runner/poll
 *   POST /api/proxy/runner/take/:id
 *   POST /api/proxy/runner/feedback/:id
 *
 * Mount shape (F2). `routes/proxy.js` mounts this factory PATH-LESS, like the
 * halt/kickoff/dispatch sub-routers, and this factory's FIRST statement is the
 * PATH-SCOPED gate `router.use('/api/proxy/runner', proxyLimiter,
 * authenticateProxyToken, requireGrant('take'))`. The gate is never repeated
 * inside a handler:
 *
 *   - a path-less `router.use(gate)` here would run for EVERY proxy request
 *     that reached this sub-router — a path-scoped mount is required;
 *   - Express matches a `use` path by segment prefix, so `/api/proxy/runner-x`
 *     and every other proxy path fall through untouched, leaving unrelated
 *     routes' own auth/limiter chains intact.
 *
 * `haltReadTimeoutMs` is a defaulted param and is NOT passed from the composer
 * (it is not bound there), so the factory default applies. `sessionsFeedCache`
 * is defaulted too.
 *
 * The routes land DORMANT: no production path can mint a `take` grant until
 * S2b, so a token reaching these handlers is already grant-bearing. There is no
 * `resolveProviderAccess` call site here (no provider lane, no credential
 * fingerprint) — the runner talks to the dispatch stores directly.
 *
 * The three handlers reuse the shared helpers extracted in S2a.0
 * (lib/dispatch-feedback-validation.js, lib/wake-credential.js,
 * lib/poll-halt.js) rather than forking the dispatch route's logic.
 */
import { Router } from 'express';
import { badRequest, jsonError, notFound } from '../lib/errors.js';
import { validateFeedbackBody } from '../lib/dispatch-feedback-validation.js';
import { buildWakeCredentialProvisioner } from '../lib/wake-credential.js';
import { readHaltForPoll, POLL_HALT_READ_TIMEOUT_MS } from '../lib/poll-halt.js';
import { getConsumerLastSeenAt } from '../lib/consumer-poll-warning.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const POLL_ROUTE = '/api/proxy/runner/poll';
const TAKE_ROUTE = '/api/proxy/runner/take/:id';
const FEEDBACK_ROUTE = '/api/proxy/runner/feedback/:id';

/**
 * @param {Object} deps
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware
 * @param {Function} deps.authenticateProxyToken - Proxy bearer-token auth middleware
 * @param {Function} deps.requireGrant - Grant-gate middleware factory (lib/require-grant.js)
 * @param {Function} deps.logEvent - Proxy event/audit logger
 * @param {Object} deps.dispatchQueueStore - Dispatch queue store (pollAvailable/takeItem/addFeedback)
 * @param {Object} deps.dispatchTokenStore - Dispatch token store, for other-consumer recency
 * @param {Object} deps.proxyTokenStore - Proxy token store, used to provision wake credentials
 * @param {Object} deps.workspaceHaltStore - Durable per-workspace operator halt store
 * @param {Object} [deps.sessionsFeedCache] - Sessions-feed cache; cleared on decision-withdrawn
 * @param {number} [deps.haltReadTimeoutMs] - Bounded halt-read timeout (default POLL_HALT_READ_TIMEOUT_MS)
 */
export function createProxyRunnerRoutes({
  proxyLimiter,
  authenticateProxyToken,
  requireGrant,
  logEvent,
  dispatchQueueStore,
  dispatchTokenStore,
  proxyTokenStore,
  workspaceHaltStore,
  sessionsFeedCache = null,
  haltReadTimeoutMs = POLL_HALT_READ_TIMEOUT_MS
}) {
  const router = Router();

  // PATH-SCOPED gate at the runner mount — the factory's first statement. See
  // the module header for why a path-less gate is forbidden here.
  router.use('/api/proxy/runner', proxyLimiter, authenticateProxyToken, requireGrant('take'));

  /**
   * GET /api/proxy/runner/poll
   * Poll the dispatch queue for the authenticated runner's workspace.
   *
   * Additive to the consumer poll contract: this response is
   * `{ items, halt?, otherConsumerLastSeenAt }`. `otherConsumerLastSeenAt` is
   * DELIBERATELY dispatch-token-only (the store call below passes no
   * `proxyTokenStore`) — it is what detects a separate Simple Dispatcher
   * consumer, and must not be diluted by the runner's own token.
   *
   * The halt read is bounded by `haltReadTimeoutMs` and never turns the poll
   * into a non-2xx (lib/poll-halt.js); on a cold cache the key is omitted.
   * `pollAvailable` is never timed out, and its own rejection still 500s.
   */
  router.get(POLL_ROUTE, async (req, res) => {
    try {
      const itemsPromise = dispatchQueueStore.pollAvailable(req.proxyUrlKey);
      // Mark the promise handled immediately so a pollAvailable rejection
      // arriving while the (independently bounded) halt read is still in
      // flight never surfaces as an unhandledRejection. `await itemsPromise`
      // below still throws with the original error.
      itemsPromise.catch(() => {});
      const [halt, otherConsumerLastSeenAt, items] = await Promise.all([
        readHaltForPoll(workspaceHaltStore, req.proxyUrlKey, haltReadTimeoutMs),
        getConsumerLastSeenAt(dispatchTokenStore, req.proxyUrlKey),
        itemsPromise
      ]);
      logEvent(req, POLL_ROUTE, 200);
      res.json({ items, ...(halt ? { halt } : {}), otherConsumerLastSeenAt });
    } catch (err) {
      logEvent(req, POLL_ROUTE, 500);
      console.error('Runner poll error:', err.message);
      jsonError(res, 500, 'Failed to poll dispatch queue');
    }
  });

  /**
   * POST /api/proxy/runner/take/:id
   * Atomically claim and remove an item from the authenticated runner's own
   * workspace queue. Mirrors the consumer take contract: `{ item, dispatchId }`.
   */
  router.post(TAKE_ROUTE, async (req, res) => {
    const { id } = req.params;

    if (!UUID_REGEX.test(id)) {
      logEvent(req, TAKE_ROUTE, 400);
      return badRequest.json(res, 'Invalid item ID format');
    }

    try {
      const item = await dispatchQueueStore.takeItem(id, req.proxyUrlKey, req.proxyTokenLabel);

      if (!item) {
        logEvent(req, TAKE_ROUTE, 404);
        return notFound.json(res, 'Item not found or already taken');
      }

      logEvent(req, TAKE_ROUTE, 200);
      res.json({ item, dispatchId: item.id });
    } catch (err) {
      logEvent(req, TAKE_ROUTE, 500);
      console.error('Runner take error:', err.message);
      jsonError(res, 500, 'Failed to take item');
    }
  });

  /**
   * POST /api/proxy/runner/feedback/:id
   * Post feedback on a taken item. Ownership is enforced inside the store's
   * single atomic update; a bearer that did not take the item gets a 404.
   * Mirrors /api/dispatch/feedback, including clearing `sessionsFeedCache` only
   * on kind:'decision-withdrawn'.
   */
  router.post(FEEDBACK_ROUTE, async (req, res) => {
    const { id } = req.params;

    if (!UUID_REGEX.test(id)) {
      logEvent(req, FEEDBACK_ROUTE, 400);
      return badRequest.json(res, 'Invalid item ID format');
    }

    // Wake-path credential provisioning policy — shared with the dispatch
    // feedback route (lib/wake-credential.js).
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const createdBy = req.proxyCreatedBy ?? null;
    const provisionWakeCredential = buildWakeCredentialProvisioner({
      proxyTokenStore,
      urlKey: req.proxyUrlKey,
      baseUrl,
      createdBy
    });

    const validation = validateFeedbackBody(req.body);
    if (validation.error) {
      logEvent(req, FEEDBACK_ROUTE, 400);
      return badRequest.json(res, validation.error);
    }
    const feedback = validation.value;

    try {
      const result = await dispatchQueueStore.addFeedback(
        id,
        req.proxyUrlKey,
        feedback,
        req.proxyTokenLabel,
        provisionWakeCredential
      );

      if (!result) {
        logEvent(req, FEEDBACK_ROUTE, 404);
        return notFound.json(res, 'Item not found or feedback not allowed');
      }

      // Only decision-withdrawn needs a hard invalidation; ordinary feedback
      // relies on the cache's 5s TTL (review R1 / Surface 3).
      if (feedback.kind === 'decision-withdrawn') {
        sessionsFeedCache?.clear(req.proxyUrlKey);
      }

      logEvent(req, FEEDBACK_ROUTE, 200);
      res.json(result);
    } catch (err) {
      logEvent(req, FEEDBACK_ROUTE, 500);
      console.error('Runner feedback error:', err.message);
      jsonError(res, 500, 'Failed to post feedback');
    }
  });

  return router;
}
