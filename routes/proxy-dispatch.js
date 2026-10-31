/**
 * Group I dispatch routes (LIN-679 Stage 6 / LIN-2540: extracted from
 * routes/proxy.js, byte-identical handler bodies; rebuilt design-first in LIN-3592:
 * the same routes, bodies, refusals and audit events, with each body's checks written
 * down once as an ordered list and the replies the arms share written once).
 *
 * POST /api/proxy/dispatch, POST /api/proxy/recommend-and-dispatch,
 * GET /api/proxy/dispatch, GET /api/proxy/dispatch/:id,
 * GET /api/proxy/dispatch/:id/prompt, GET /api/proxy/wake-shadow.
 */
import { Router } from 'express';
import { armKeepalive } from '../lib/http-keepalive.js';
import { jsonError, keepaliveError, notFound, replyStoreFault } from '../lib/errors.js';
import { MAX_NAME_LENGTH, DANGEROUS_CHARS_REGEX } from '../lib/issue-write-validation.js';
import { deriveCompletedAt, deriveWireStatus, deriveWireTerminal, closedProjection } from '../lib/dispatch-terminal.js';
import { wireStatusOf } from '../lib/dispatch-lineage-status.js';
import { buildQueuedPollWarning, getConsumerLastSeenAt } from '../lib/consumer-poll-warning.js';
import { redactSessionItem } from '../lib/dispatch-session-redaction.js';
import { enterProxyDispatch, enterRecommendDispatch, refuseWithoutStore, rejectAudited } from '../lib/dispatch-entrance.js';

// Dispatch input limits. The prompt/url caps for the POST /dispatch payload now
// live in lib/dispatch-validation.js (shared with the session-auth twin via
// validateDispatchPayload, LIN-1139); MAX_IDENTIFIER_LENGTH remains for the other
// proxy handlers that cap an identifier directly.
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers

// Long-poll tuning for GET /api/proxy/dispatch/:id?wait=Ns (LIN-392).
// DISPATCH_WAIT_MAX_S caps the hold below the ~60s ceiling that armKeepalive
// (flush at 25s) buys us past Heroku's 30s H12; the re-check interval bounds
// worst-case detection latency. Module-level so tests can drive the loop at
// short `wait` values instead of real-time waits.
const DISPATCH_WAIT_MAX_S = 50;
const DISPATCH_WAIT_POLL_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A dispatch id as the watch and prompt reads take it from the path: present, short and
// free of control characters. The store lookup is workspace-scoped on top of this.
const isBadDispatchId = (id) => !id || id.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(id);

// Shapes a store item into the watch-endpoint response body. Shared by the
// immediate short-poll and the long-poll.
//
// `meta` (long-poll only) makes the response self-describing about WHY it
// returned, so a held-the-full-window return is distinguishable from a
// short-circuit — they were previously byte-identical, which made a working
// 50s hold look like a fast empty return to a caller with no wall-clock on its
// own calls. `reason` ∈ 'terminal' (already done before the hold), 'change'
// (status transition or new feedback during the hold), 'timeout' (held the full
// window, nothing new); `waitedMs` is how long the handler actually held. Omitted
// on the plain short-poll (no `?wait`) so that path stays byte-identical.
//
// `wakeShadow` (LIN-3257) is the read-only shadow verdict for a `kind:'wake'`
// row — `{ wouldSkip, reason }` — or null on every non-wake row. It is a
// READ-ONLY annotation: the shadow is recorded at mint time and nothing here
// can suppress a wake.
function formatDispatchWatch(item, meta = null, wakeShadow = null, liveConsumerLastSeenAt = null) {
  // LIN-2079: the REPORTED status is the lifecycle one (terminal, else `blocked`
  // when the lineage is parked on a human). `item.feedback` is already
  // lineage-merged by getItemStatus({includeGroupFeedback:true}).
  // LIN-3364: a row stamped `bookkeeping` (closed at the source) reads `closed`
  // (terminal > closed > blocked). `alreadyTerminal`, the long-poll baseline and
  // `dispatchWatchChanged` call `deriveWireTerminal` (terminal or closed), never
  // this: a `blocked` item is NOT terminal and must keep holding the long poll.
  const terminalStatus = deriveWireStatus(item);
  const body = {
    id: item.id,
    status: terminalStatus || item.status,
    promptName: item.promptName,
    kind: item.kind || 'custom',
    issueIdentifier: item.issueIdentifier,
    issueUrl: item.issueUrl,
    target: item.target,
    model: item.model || null,
    harness: item.harness || null,
    terminal: item.terminal || null,
    effort: item.effort || null,
    presetName: item.presetName || null,
    followUpTo: item.followUpTo || null,
    force: item.force === true,
    abort: item.abort === true,
    abortTo: item.abortTo || null,
    cascade: item.cascade === true,
    sessionId: item.sessionId || null,
    // Scope bound (LIN-1751): visible on the poll/watch response like every
    // other stored field, so a caller inspecting its own run can see the
    // declared budget without guessing. null ⇒ unbounded.
    maxTasks: item.maxTasks ?? null,
    repo: item.repo || null,
    dispatchedAt: item.dispatchedAt,
    // Attribution (LIN-1948, fix 3b): the detail/watch read is where a human
    // asking "who dispatched this?" actually looks. Paired with the
    // `_formatHistoryItem` fix so the queued and taken halves agree. This is
    // the DETAIL read — `GET /api/proxy/dispatch` (list/poll) re-projects
    // through its own explicit field allow-list, which does not include this
    // and is deliberately left alone.
    dispatchedBy: item.dispatchedBy || null,
    // resolvedAt is take/archive time (when the runner claimed the item), NOT
    // completion. completedAt is the real completion time, null until terminal.
    resolvedAt: item.resolvedAt || null,
    completedAt: deriveCompletedAt(item.feedback),
    // LIN-3364: the closed-row fact (`bookkeeping` stamp), normalised to the documented enum.
    ...closedProjection(item.bookkeeping),
    // Consumer poll-recency stamp + derived warning (LIN-2885): the stamp is
    // whatever createDispatchItem persisted at enqueue time (informational).
    // LIN-3367: the warning is derived from the LIVE poll recency
    // (`liveConsumerLastSeenAt`, read by the caller) against the CURRENT clock,
    // and ONLY while the row is still queued — null once it is taken/terminal/
    // closed, and null when the workspace is (or has become) actively polled.
    consumerLastSeenAt: item.consumerLastSeenAt || null,
    consumerPollWarning: buildQueuedPollWarning(terminalStatus || item.status, liveConsumerLastSeenAt),
    feedback: (item.feedback || []).map(f => {
      const entry = {
        message: f.message,
        url: f.url || null,
        urlLabel: f.urlLabel || null,
        timestamp: f.timestamp || null
      };
      // Additive-only (LIN-1297 idiom, matching _formatFeedbackEntries):
      // assign only when present, never emit `rootItemId: null` (LIN-1468).
      if (f.rootItemId) entry.rootItemId = f.rootItemId;
      // Additive-only (LIN-1297 idiom, matching _formatFeedbackEntries):
      // assign only when present, never emit `kind: null` (LIN-1475).
      if (f.kind) entry.kind = f.kind;
      return entry;
    }),
    // LIN-3257: read-only shadow verdict. Present (null) on every row so the
    // shape is stable; non-null only for a `kind:'wake'` row that has a recorded
    // shadow. Never suppressable — display/telemetry only.
    wakeShadow: (item.kind === 'wake' ? (wakeShadow || null) : null)
  };
  if (meta) {
    body.reason = meta.reason;
    body.waitedMs = meta.waitedMs;
  }
  return body;
}

// A dispatch item has "changed" for long-poll purposes when its derived
// terminal status appears (or shifts — last-marker-wins is not monotonic) or
// new feedback arrives. Compared against a baseline snapshot captured on the
// handler's first read.
function dispatchWatchChanged(baseline, item) {
  return (
    (deriveWireTerminal(item) || item.status) !== baseline.status ||
    (item.feedback || []).length !== baseline.feedbackLength
  );
}

/**
 * @param {Object} deps
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.chargeFreeTierOrReject - Free-tier quota gate for a recommendation-style call (closure-local)
 * @param {Function} deps.computeRecommendation - Shared recommendation compute path (closure-local, also injected into group F's routes/proxy-compute.js)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Object} deps.dispatchQueueStore - Dispatch queue storage instance
 * @param {Object} [deps.dispatchTokenStore] - Consumer-token store (LIN-2885):
 *   threaded into `createDispatchItem` to stamp `consumerLastSeenAt`. Optional —
 *   an absent store just means every dispatch stamps null (never seen).
 * @param {Function} deps.getWorkspaceOpenRouterKey - Resolves the token-creator's OAuth OpenRouter key for a workspace (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local, the route's own registry-bound error mapper)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Function} deps.logOpenRouterCredentialSource - Logs which OpenRouter credential source served a request (closure-local)
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is)
 * @param {string} deps.PROXY_ATTACH_FAILED_MESSAGE - 503 message when the out-of-band bootstrap token could not be minted (module-scope)
 * @param {Object} deps.proxyTokenStore - Proxy token storage instance
 * @param {Function} deps.recommendErrorResponse - Shapes a recommendation-path error into a status+body pair (closure-local)
 * @param {number} deps.RECOMMEND_DESCENT_BUDGET_MS - Shared cross-hop budget for the recommend recursion (module-scope)
 * @param {Function} deps.relayDispatchRefusal - replies to a tagged factory refusal (closure-local)
 * @param {Function} deps.requireGrant - The grant gate middleware factory (module-scope in routes/proxy.js); gates POST /dispatch and /recommend-and-dispatch on the `dispatch` grant, after the scope check (LIN-3136)
 * @param {Function} deps.requireWriteScope - Requires readWrite scope on the token (closure-local)
 * @param {Function} deps.resolvePromptIssueContext - Resolves the issue + prompt context for deterministic, server-side prompt generation (module-scope, shared with groups F/H)
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Object} deps.workspacePreferencesStore - Workspace-level preference storage
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 */
export function createDispatchRoutes({
  authenticateProxyToken,
  chargeFreeTierOrReject,
  computeRecommendation,
  denyIfUnsupported,
  dispatchQueueStore,
  dispatchTokenStore = null,
  getWorkspaceOpenRouterKey,
  graphqlErrorStatus,
  logEvent,
  logOpenRouterCredentialSource,
  proxyLimiter,
  PROXY_ATTACH_FAILED_MESSAGE,
  proxyTokenStore,
  recommendErrorResponse,
  RECOMMEND_DESCENT_BUDGET_MS,
  relayDispatchRefusal,
  freeTierStore = null,
  accountStore = null,
  requireGrant,
  requireWriteScope,
  resolvePromptIssueContext,
  resolveProviderAccess,
  workspacePreferencesStore,
  workspaceUnavailable,
}) {
  const router = Router();

  // ===========================================================================
  // Dispatch Endpoints (proxy-token twin of routes/dispatch.js)
  // ===========================================================================

  // The store is optional in the factory's dependencies; every route answers 503 without it, and
  // a 400 for a query or path the caller got wrong is audited, then relayed. (Both are the
  // enqueue lanes' answers too, written once in lib/dispatch-entrance.js.)
  const storeMissing = (req, res, endpoint) => refuseWithoutStore({ req, res, endpoint, logEvent, dispatchQueueStore });
  const reject400 = (req, res, endpoint, message) => rejectAudited({ req, res, endpoint, logEvent, message });

  // What the two enqueue verbs below need from this factory: the stores and the Agent API closures
  // lib/dispatch-entrance.js calls (it imports nothing from routes/).
  const lane = {
    dispatchQueueStore,
    dispatchTokenStore,
    workspacePreferencesStore,
    proxyTokenStore,
    freeTierStore,
    accountStore,
    logEvent,
    resolveProviderAccess,
    workspaceUnavailable,
    denyIfUnsupported,
    resolvePromptIssueContext,
    relayDispatchRefusal,
    graphqlErrorStatus,
    getWorkspaceOpenRouterKey,
    chargeFreeTierOrReject,
    computeRecommendation,
    logOpenRouterCredentialSource,
    recommendErrorResponse,
    RECOMMEND_DESCENT_BUDGET_MS,
    PROXY_ATTACH_FAILED_MESSAGE
  };

  /**
   * POST /api/proxy/dispatch
   * Queue a prompt for the workspace's dispatch consumer (the runner).
   * Proxy-token equivalent of POST /workspace/:urlKey/api/dispatch: scoped by the
   * token's workspace, requiring readWrite scope plus the `dispatch` grant, and
   * checking the fields it takes by the same rules. It takes fewer than the
   * session route (no presetId, stopAt, variant, attachProxy, entryRung, surface
   * or composedRunMarker) and adds appendProxyContext. Excludes target 'local'
   * (Harbour OS spawns on the server's own tty, which a remote consumer can't
   * drive). This is the write half the autopilot orchestrator uses to dispatch a
   * chosen task.
   */
  router.post('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async (req, res) => {
    await enterProxyDispatch({ ...lane, req, res, endpoint: '/api/proxy/dispatch' });
  });

  /**
   * POST /api/proxy/recommend-and-dispatch
   * Fused verb (LIN-321): run /recommend and forward the recommended prompt
   * straight into a dispatch, SERVER-SIDE, returning only the task header.
   * The prompt body never reaches the caller, so the orchestrator's context-
   * economy rule (autopilot invariant 4) becomes mechanical instead of a rule
   * it must remember. `kind` is derived from the recommendation's own action
   * signal — no need to read the prompt to classify the task.
   *
   * Optional verb override (LIN-573): when the caller supplies `kind` (a
   * PROMPT_TEMPLATES key), the LLM recommendation + descent is bypassed and the
   * body is generated deterministically for the NAMED issue with that template —
   * "autopilot picks the verb, never the words." The body is still server-
   * generated and never returned; only the verb key is caller-supplied. Omitting
   * `kind` leaves the original LLM-driven behaviour byte-identical.
   *
   * `periodicalId` (LIN-1825/LIN-2385): optional periodical-template join key,
   * registry-validated exactly like `POST /api/proxy/dispatch`'s field of the
   * same name. Stamped onto the row of BOTH arms — the verb-override branch
   * AND the recommendation-derived one — because
   * this fused verb, not `POST /dispatch`, is what every autopilot loop
   * actually calls to continue a tracked task (see `lib/prompts/
   * autopilot-kickoff.js`'s "Trigger the next step"), and the normal trigger
   * carries no `kind`, landing on the recommendation-derived branch.
   *
   * `followUpTo` (LIN-2869): optional well-formed UUID, cli/web targets only,
   * threaded onto whichever arm's row this route resolves to —
   * the recommendation still runs and the generated body becomes a follow-up
   * instruction resuming the prior session. A fused follow-up is exempt from
   * the duplicate guard by the factory's own gate, and suppresses the
   * proxy-context prose append by default (LIN-805).
   *
   * `force` (LIN-2872): optional boolean. Forwarded verbatim onto the item so
   * `force: true` bypasses the duplicate-dispatch guard on THIS verb too — the
   * documented operator escape hatch (`dispatch-factory.js`) is now reachable
   * on both dispatch verbs.
   */
  router.post('/api/proxy/recommend-and-dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async (req, res) => {
    await enterRecommendDispatch({ ...lane, req, res, endpoint: '/api/proxy/recommend-and-dispatch' });
  });

  /**
   * GET /api/proxy/dispatch
   * List the workspace's dispatch items across both the live queue (status
   * 'queued') and recent history (taken/cancelled/expired, with feedback),
   * newest first. Lets the orchestrator discover its own in-flight items
   * without having to remember every id it dispatched. Optional filters:
   *   ?issueIdentifier=LIN-42   exact match on the issue identifier
   *   ?status=queued|taken|...  exact match on lifecycle status
   *   ?limit=N                  cap (default 20, max 100)
   */
  router.get('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (storeMissing(req, res, '/api/proxy/dispatch')) return;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    let issueIdentifier = null;
    if (req.query.issueIdentifier !== undefined) {
      issueIdentifier = String(req.query.issueIdentifier);
      if (issueIdentifier.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(issueIdentifier)) {
        return reject400(req, res, '/api/proxy/dispatch', 'Invalid issueIdentifier');
      }
    }

    let statusFilter = null;
    if (req.query.status !== undefined) {
      statusFilter = String(req.query.status);
      if (statusFilter.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(statusFilter)) {
        return reject400(req, res, '/api/proxy/dispatch', 'Invalid status');
      }
    }

    try {
      // Live queue (still 'queued') + resolved history, merged, newest dispatch first.
      //
      // LIN-3812 (closes LIN-2120): the list used to read the newest 200 history rows plus up
      // to 2,000 lineage siblings and derive each row's status/completedAt/feedbackCount in
      // JS (LIN-1470 join, LIN-1261 abort attribution), so `?status=` could not see past the
      // window. Those three lineage values are now persisted at feedback-write time
      // (lib/dispatch-lineage-status.js), and the history half is ONE paged, counted read
      // that evaluates `?status=` in the database. The same path serves scoped and unscoped
      // lists; a row's lineage is no longer capped, and an abort attributes to its target
      // whatever the list's scope (an abort row's own issue scope no longer hides it).
      // The list is metadata-only: the store's read never carries `prompt` or `feedback[]`.
      const scopeOpts = issueIdentifier ? { issueIdentifier } : {};
      // Only the queue half is not a history row; only a queued filter wants it.
      const wantsQueue = !statusFilter || statusFilter === 'queued';
      const lineageDerived = statusFilter && !['queued', 'cancelled', 'expired'].includes(statusFilter);
      // A lineage-status filter reads the persisted field, so rows from before it existed
      // are derived first (once per process per workspace).
      if (lineageDerived) await dispatchQueueStore.ensureLineageStatus(req.proxyUrlKey);
      const [queued, history] = await Promise.all([
        wantsQueue ? dispatchQueueStore.listItems(req.proxyUrlKey, scopeOpts) : [],
        dispatchQueueStore.listHistoryLineageRows(req.proxyUrlKey, { ...scopeOpts, status: statusFilter, limit })
      ]);

      const merged = [
        ...queued.map(i => ({ ...i, status: 'queued', completedAt: null, feedbackCount: 0 })),
        // The reported status is the lineage one (terminal, closed, blocked), else the stored one
        // (LIN-2122: `wireStatusOf`, shared with the Dispatch page's history so they agree).
        ...history.items.map(i => ({
          ...i,
          status: wireStatusOf(i),
          completedAt: i.lineage.completedAt?.toISOString?.() ?? i.lineage.completedAt,
          feedbackCount: i.lineage.feedbackCount
        }))
      ];
      merged.sort((a, b) => {
        const at = new Date(a.dispatchedAt || 0).getTime();
        const bt = new Date(b.dispatchedAt || 0).getTime();
        return bt - at;
      });

      // LIN-3367: live poll recency, once per list request (async, lists tokens) —
      // only needed when some returned row is still queued.
      const liveConsumerLastSeenAt = merged.slice(0, limit).some(i => i.status === 'queued')
        ? await getConsumerLastSeenAt(dispatchTokenStore, req.proxyUrlKey, proxyTokenStore)
        : null;
      const items = merged.slice(0, limit).map(i => ({
        id: i.id,
        status: i.status,
        promptName: i.promptName,
        kind: i.kind || 'custom',
        issueIdentifier: i.issueIdentifier,
        issueUrl: i.issueUrl,
        target: i.target,
        // LIN-2975: budget/lineage fields (present on the detail/watch read
        // above) so a list reader can confirm sessionId/maxTasks stamping
        // without a per-row GET. Explicit allow-list keys, not a spread of
        // `i` — see the bootstrapToken caveat below.
        sessionId: i.sessionId || null,
        maxTasks: i.maxTasks ?? null,
        dispatchedAt: i.dispatchedAt,
        // resolvedAt = take/archive time; completedAt = real completion (null until terminal).
        resolvedAt: i.resolvedAt || null,
        completedAt: i.completedAt,
        // LIN-3364: explicit allow-list entries (this list is not a spread of `i`).
        ...closedProjection(i.bookkeeping),
        // LIN-1470: lineage-wide (own + verified siblings), not just this row's
        // own stored feedback. Excludes any synthetic harvested-abort entry.
        feedbackCount: i.feedbackCount,
        // Consumer poll-recency stamp + derived warning (LIN-2885) — same
        // fields, same pure derivation as the `:id` watch endpoint above, so a
        // lean-list reader doesn't need a second GET to see whether a queued
        // row is sitting unpolled.
        // LIN-3367: warning from the live stamp (read once above), queued rows only.
        consumerLastSeenAt: i.consumerLastSeenAt || null,
        consumerPollWarning: buildQueuedPollWarning(i.status, liveConsumerLastSeenAt)
      }));

      logEvent(req, '/api/proxy/dispatch', 200);
      // LIN-1494 / LIN-3812: `total` is the exact count of matching rows (queued + the
      // database's count of matching history), under `?status=` too. There is no read
      // window any more, so `truncated` (which disclosed the newest-200 window) is
      // always false; the key stays so existing readers keep parsing.
      const total = queued.length + history.total;
      res.json({ items, total, truncated: false });
    } catch (err) {
      // LIN-3805: a store fault is a retryable 503, never a final 500.
      if (replyStoreFault(res, err, { logEvent: (status) => logEvent(req, '/api/proxy/dispatch', status) })) return;
      logEvent(req, '/api/proxy/dispatch', 500);
      console.error('Proxy dispatch list error:', err.message);
      jsonError(res, 500, 'Failed to list dispatch items');
    }
  });

  /**
   * GET /api/proxy/dispatch/:id
   * Watch a dispatched item: report whether it is still queued or has been
   * taken by the runner, plus any feedback the runner has posted. This is the
   * poll half of the autopilot loop — the orchestrator reads feedback here to
   * decide its next step. Feedback is free-form by design; the orchestrator
   * (the judge) reads it rather than relying on a structured "done" flag.
   *
   * Optional ?wait=Ns (LIN-392) turns this into a server-side long-poll: the
   * handler holds the request open (re-checking the store every ~1.5s) and
   * returns the instant the derived status transitions or new feedback arrives,
   * else returns the current snapshot at a ~50s cap so the caller simply calls
   * again. This collapses the autopilot watch loop to a no-sleep/no-backoff
   * `do { GET ...?wait=50 } while (!terminal)`. No ?wait preserves today's
   * immediate short-poll, byte-for-byte.
   */
  router.get('/api/proxy/dispatch/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (storeMissing(req, res, '/api/proxy/dispatch/:id')) return;

    const { id } = req.params;
    if (isBadDispatchId(id)) return reject400(req, res, '/api/proxy/dispatch/:id', 'Invalid dispatch id');

    // Parse + clamp ?wait. Garbage / non-positive → 0 → unchanged short-poll.
    const waitSeconds = Math.min(
      Math.max(0, Math.floor(Number(req.query.wait)) || 0),
      DISPATCH_WAIT_MAX_S
    );

    // LIN-3805 / LIN-3465: hoisted so the catch below replies through the keepalive once
    // it is armed; after its first flush the headers are committed and `res.status()`
    // would throw ERR_HEADERS_SENT.
    let keepalive = null;
    try {
      // This watch/poll seam reads `feedback` to derive terminal status, so it's the one
      // caller that opts into the (indexed-query-plus-merge) group feedback read —
      // see getItemFeedback's includeGroupFeedback doc (LIN-1461).
      // LIN-3812: the change token is read BEFORE the body, so a change landing between the
      // two reads moves the token off the body's baseline and is re-checked, never missed.
      let watchToken = waitSeconds > 0 ? await dispatchQueueStore.getItemWatchToken(req.proxyUrlKey, id) : null;
      const item = await dispatchQueueStore.getItemFeedback(req.proxyUrlKey, id, { includeGroupFeedback: true });
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id', 404);
        return notFound.json(res, 'Dispatch item not found');
      }

      // First read short-circuits: no wait requested, or already terminal.
      // (The terminal short-circuit also keeps re-polling a finished item free
      // — the caller can re-verify without ever incurring the hold.)
      let current = item;
      // LIN-3257: the read-only shadow verdict, for a wake row only. Computed
      // once — it is written at mint time and never changes. A read failure
      // degrades to null (the store's getWakeShadow swallows), so it can never
      // fail the watch response.
      const wakeShadow = item.kind === 'wake'
        ? await dispatchQueueStore.getWakeShadow(req.proxyUrlKey, item.id)
        : null;
      // LIN-3367: live poll recency for the queued-only warning, read once per
      // response (at the point the snapshot is final), and only for a queued row.
      const liveSeen = async (row) => (deriveWireStatus(row) || row.status) === 'queued'
        ? getConsumerLastSeenAt(dispatchTokenStore, req.proxyUrlKey, proxyTokenStore)
        : null;
      const alreadyTerminal = deriveWireTerminal(current) !== null;
      if (waitSeconds > 0) {
        // Long-poll path. The response carries `reason`/`waitedMs` so the caller
        // can tell WHY it came back (see formatDispatchWatch) — a terminal item
        // short-circuits with no hold; otherwise we hold and report 'change' vs
        // 'timeout'.
        if (alreadyTerminal) {
          logEvent(req, '/api/proxy/dispatch/:id', 200);
          return res.json(formatDispatchWatch(current, { reason: 'terminal', waitedMs: 0 }, wakeShadow, await liveSeen(current)));
        }
        // Hold the request open. armKeepalive flushes 200 + JSON whitespace at
        // 25s so the connection survives Heroku's 30s H12 while we wait; the
        // baseline is this first (non-terminal) read, so a change that already
        // landed is reflected in the baseline AND in whatever we ultimately
        // return — the caller never loses data, only an early return.
        keepalive = armKeepalive(res);
        const baseline = {
          status: deriveWireTerminal(current) || current.status,
          feedbackLength: (current.feedback || []).length
        };
        const waitStart = Date.now();
        const deadline = waitStart + waitSeconds * 1000;
        let reason = 'timeout'; // default: held the full window, nothing new
        while (Date.now() < deadline) {
          await sleep(DISPATCH_WAIT_POLL_MS);
          if (res.writableEnded || res.destroyed) {
            keepalive.stop();
            return; // client gave up
          }
          // LIN-3805: a fault here is NOT swallowed into "unchanged snapshot" (a hidden
          // sibling `[done]` would read as still running); it propagates to the catch.
          // LIN-3812: scalars only per tick; the whole document plus lineage feedback is re-read
          // only when the token moved. The re-read body (not the token) decides 'change'.
          const nextToken = await dispatchQueueStore.getItemWatchToken(req.proxyUrlKey, id);
          if (nextToken === watchToken) continue;
          watchToken = nextToken;
          const next = await dispatchQueueStore.getItemFeedback(req.proxyUrlKey, id, { includeGroupFeedback: true });
          if (!next) break; // item genuinely expired mid-wait; return last known snapshot
          current = next;
          if (dispatchWatchChanged(baseline, current)) { reason = 'change'; break; }
        }
        logEvent(req, '/api/proxy/dispatch/:id', 200);
        return keepalive.send(200, formatDispatchWatch(current, { reason, waitedMs: Date.now() - waitStart }, wakeShadow, await liveSeen(current)));
      }

      logEvent(req, '/api/proxy/dispatch/:id', 200);
      res.json(formatDispatchWatch(current, null, wakeShadow, await liveSeen(current)));
    } catch (err) {
      if (replyStoreFault(res, err, { keepalive, logEvent: (status) => logEvent(req, '/api/proxy/dispatch/:id', status) })) return;
      logEvent(req, '/api/proxy/dispatch/:id', 500);
      console.error('Proxy dispatch watch error:', err.message);
      if (keepalive) return keepaliveError(keepalive, 500, 'Failed to read dispatch item');
      jsonError(res, 500, 'Failed to read dispatch item');
    }
  });

  /**
   * GET /api/proxy/dispatch/:id/prompt
   * Return the CANONICAL prompt Harbour dispatched for this item, so a consuming
   * agent can CONFIRM a task it received against the trusted dispatch record. A
   * task arriving in a live session as plain conversational text (carrying a
   * token + an external host) is indistinguishable from prompt injection unless
   * the agent can check it against what Harbour actually dispatched — this is
   * that check, fetched over the same authenticated Bearer channel it already
   * trusts (LIN-1128).
   *
   * The watch twin (GET .../:id) deliberately OMITS `prompt` — a payload /
   * Heroku-H12 defense on the long-poll + list paths, not a security choice. This
   * targeted single-item read adds it back: bounded (one item), exactly like
   * poll/take which already hand the full prompt to the runner. Read scope is
   * sufficient (reading the workspace's own record, not a mutation), and the
   * lookup is workspace-scoped via req.proxyUrlKey like every sibling read, so a
   * token can only see its own workspace's dispatches.
   *
   * Returns only THIS item's prompt — no followUpTo/root walk (the agent can
   * chase followUpTo itself if it ever needs the chain root).
   */
  router.get('/api/proxy/dispatch/:id/prompt', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (storeMissing(req, res, '/api/proxy/dispatch/:id/prompt')) return;

    const { id } = req.params;
    if (isBadDispatchId(id)) return reject400(req, res, '/api/proxy/dispatch/:id/prompt', 'Invalid dispatch id');

    try {
      const item = await dispatchQueueStore.getItemPrompt(req.proxyUrlKey, id);
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id/prompt', 404);
        return notFound.json(res, 'Dispatch item not found');
      }

      logEvent(req, '/api/proxy/dispatch/:id/prompt', 200);
      res.json({
        id: item.id,
        promptName: item.promptName,
        kind: item.kind || 'custom',
        // LIN-3384: only the row's own dispatcher sees its prose unmasked.
        prompt: redactSessionItem({ prompt: item.prompt, dispatchedBy: item.dispatchedBy }, req.proxyCreatedBy).prompt || null,
        issueIdentifier: item.issueIdentifier || null,
        issueUrl: item.issueUrl || null,
        target: item.target,
        followUpTo: item.followUpTo || null,
        sessionId: item.sessionId || null,
        dispatchedAt: item.dispatchedAt
      });
    } catch (err) {
      if (replyStoreFault(res, err, { logEvent: (status) => logEvent(req, '/api/proxy/dispatch/:id/prompt', status) })) return;
      logEvent(req, '/api/proxy/dispatch/:id/prompt', 500);
      console.error('Proxy dispatch prompt read error:', err.message);
      jsonError(res, 500, 'Failed to read dispatch prompt');
    }
  });

  /**
   * GET /api/proxy/wake-shadow?days=N
   *
   * LIN-3257 (M1 shadow): read-only per-day tally of the shadow wake
   * classification — how many wakes were minted, how many the classifier WOULD
   * skip, and the breakdown by reason. The Flight Companion reads this to build
   * the evidence for a later switch-on. Nothing was suppressed; this is a
   * measurement.
   *
   * Read scope only (no write verb). `days` defaults to 7, clamped to [1, 31].
   * Workspace-scoped via req.proxyUrlKey like every sibling read. When no shadow
   * collection is wired the store returns an empty, well-formed summary (the
   * documented no-op degrade) rather than an error.
   *
   * → { "days": [{ "day": "YYYY-MM-DD", "minted": N, "wouldSkip": N, "byReason": { ... } }],
   *     "totals": { "minted": N, "wouldSkip": N, "share": 0.35, "byReason": { ... } } }
   */
  router.get('/api/proxy/wake-shadow', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (storeMissing(req, res, '/api/proxy/wake-shadow')) return;

    const rawDays = Number(req.query.days);
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(31, Math.floor(rawDays))) : undefined;

    try {
      const summary = await dispatchQueueStore.getWakeShadowTally(req.proxyUrlKey, days ? { days } : {});
      logEvent(req, '/api/proxy/wake-shadow', 200);
      res.json(summary);
    } catch (err) {
      logEvent(req, '/api/proxy/wake-shadow', 500);
      console.error('Proxy wake-shadow read error:', err.message);
      jsonError(res, 500, 'Failed to read wake-shadow tally');
    }
  });

  return router;
}
