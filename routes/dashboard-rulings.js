/**
 * The rulings routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET  /workspace/:urlKey/api/dashboard/rulings                    — unanswered-decision feed (ambient count + rulings tab; LIN-1728)
 *   POST /workspace/:urlKey/api/dashboard/rulings/dismiss            — dismiss a loop-backed ruling with no comment (LIN-2225; the task-bound sibling reuses the existing scan dismiss route instead)
 *   POST /workspace/:urlKey/api/dashboard/rulings/reverse-withdrawal — reverse a `decision-withdrawn` stamp, terminal (LIN-2891/LIN-3035; session-auth-only, no UI button yet)
 *   POST /workspace/:urlKey/api/dashboard/rulings/answer             — stamp a TASK-BOUND ruling answered with no comment, durable optionId (LIN-2754 Track B)
 *   POST /workspace/:urlKey/api/dashboard/rulings/shelve             — shelve any ruling with a reason + re-surface timer (LIN-1727; view-only)
 *   POST /workspace/:urlKey/api/dashboard/rulings/keep               — withdraw a proposed dismissal (LIN-2444; view-only — never touches answer state, arms no keepalive)
 *
 * The feed cache and `mergeLoops` arrive in `ctx` from the composer: the GET fills
 * the very `sessionsFeedCache` instance the feed and the run page read, and every
 * successful write clears it (LIN-2755).
 *
 * The five writes share one frame (`rulingWrite`): validate (400), the store gate
 * (503), then one try around the write. What differs per route is data in its
 * spec, including `storeFault`: dismiss and reverse-withdrawal answer a store
 * fault with `replyStoreFault` (503, LIN-3805); answer, shelve and keep still
 * answer it with their own 500. That inconsistency is today's behaviour and is
 * kept as it is; it is an open question for the owner, not a fix made here.
 */
import { Router, json } from 'express';
import { jsonError, keepaliveError, replyStoreFault } from '../lib/errors.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { collectUnansweredDecisions } from '../lib/unanswered-decisions.js';
import { attachStandingSuggestions } from '../lib/dismissal-suggestions-store.js';
import { connectedWorkspaces, liveOnAnchor } from './dashboard-session-state.js';

// ─── Filtered rulings feed (LIN-1728 Phase 2) ─────────────────────────────────

// One cached read backs both consumers (the ambient nav badge, Phase 3, and the
// rulings tab, Phase 4) — same `sessionsFeedCache` instance as `/sessions`, just
// a separate `rulings` view namespace so the two payload shapes never collide on
// one cache entry for the same workspace set (LIN-1728 plan decision 2/3).
// Cross-workspace by design (decision 2's "third obs-tab" host), but per the
// plan's constraint the ambient count stays scoped to `req.session.workspaces`
// like every other Observation read here — never fleet-wide.
function rulingsFeed({ sessionsFeedCache, mergeLoops, taskDecisionsStore, shelvedRulingsStore, dismissalSuggestionsStore }) {
  return async (req, res) => {
    const workspaces = connectedWorkspaces(req.session);

    const keepalive = armKeepalive(res);
    try {
      const merged = await sessionsFeedCache.get(
        sessionsFeedCache.keyFor(workspaces, 'rulings'),
        () => mergeLoops(workspaces)
      );
      const urlKeys = workspaces.map(w => w.urlKey);
      // Additive second input (LIN-2215) — same `workspaces` scope as the
      // loops read above, never fleet-wide. The store read is local/fast
      // (matching this route's other per-request store calls), so no second
      // caching layer is introduced here. The `loops` line/logic above is
      // untouched.
      const taskDecisions = taskDecisionsStore
        ? await taskDecisionsStore.listUnansweredForWorkspaces(urlKeys)
        : [];
      // LIN-2729 / LIN-2893 Step 5: the newest-scan-per-task input the
      // reduction needs to tell a candidate row apart from one already
      // superseded by a newer, outcome-bearing scan the query above
      // filtered out. Same `workspaces` scope as `taskDecisions` above.
      const newestScanByTask = taskDecisionsStore
        ? await taskDecisionsStore.listNewestScanPerTask(urlKeys)
        : {};
      // Additive THIRD input (LIN-1727) — same `workspaces` scope, same
      // local/fast-read discipline as taskDecisions above; no new caching
      // layer. Raw rows; collectUnansweredDecisions owns the active/lapsed
      // reduction.
      const shelvedRulings = shelvedRulingsStore
        ? await shelvedRulingsStore.listForWorkspaces(urlKeys)
        : [];
      // Additive FOURTH input (LIN-2444). Scoped to the same `workspaces` set
      // as every other read here, never fleet-wide; a WITHDRAWN row is not a
      // standing proposal (the human already pressed Keep) and is excluded
      // here rather than in the store, which returns raw rows so exactly one
      // place owns that predicate.
      const suggestions = dismissalSuggestionsStore
        ? await dismissalSuggestionsStore.listForWorkspaces(urlKeys)
        : [];
      // LIN-2756: loop-aware join, shared with routes/proxy-rulings.js's own
      // GET — see attachStandingSuggestions' own doc for the two-tier match
      // (a row's own loop segment first, falling back to a workspace-wide/
      // legacy suggestion). Previously this route and the proxy route each
      // hand-rolled their own (different, neither loop-aware) version of
      // this join — now there is exactly one.
      //
      // LIN-2773 Area 4: `liveDispatchOnAnchor` — is there a live (non-terminal)
      // run on this row's own anchor issue, elsewhere in the SAME already-fetched
      // `merged` set? Zero new reads: `merged` is the exact loop set this route
      // already holds above. `liveOnAnchor` (dashboard-session-state.js) is the
      // one predicate, null guard (LIN-2934 S4) included.
      // `anchorTerminal` is deliberately NOT passed here: this route backs the
      // 5s ambient nav-badge poll (see the comment atop this handler), which
      // must never evaluate it — full stop, not merely omitted by convention.
      const rulings = attachStandingSuggestions(
        collectUnansweredDecisions(
          { loops: merged, taskDecisions, shelvedRulings, newestScanByTask },
          {
            now: new Date(),
            liveDispatchOnAnchor: liveOnAnchor(merged)
          }
        ),
        suggestions
      );

      keepalive.send(200, {
        workspaces,
        count: rulings.length,
        rulings,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dashboard rulings error:', error);
      keepaliveError(keepalive, 500, 'Could not load rulings');
    }
  };
}

// ─── The write frame ──────────────────────────────────────────────────────────

/**
 * Register one ruling write. The frame owns the order every write shares:
 * `validate` → 400, `unavailable` store gate → 503, then inside one try `run`,
 * whose reply is `{ ok: body }` (clear the feed cache, then 200 JSON) or
 * `{ fail: [status, message, extra?] }` (no clear). A throw logs `logLabel` and
 * answers `failure` as a 500, after `replyStoreFault` when the spec opts in.
 *
 * @param {Router} router
 * @param {Object} ctx - `workspaceFromUrl`, `sessionsFeedCache`
 * @param {Object} spec
 * @param {string} spec.path
 * @param {(body: Object) => string|null} spec.validate - the 400 message, or null
 * @param {{store: any, message: string}} [spec.unavailable] - 503 when `store` is falsy
 * @param {(workspace: Object, body: Object) => Promise<Object>} spec.run
 * @param {string} spec.logLabel
 * @param {string} spec.failure
 * @param {boolean} spec.storeFault - answer a store fault with replyStoreFault (503)
 */
function rulingWrite(router, { workspaceFromUrl, sessionsFeedCache }, spec) {
  router.post(spec.path, workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace;
    const body = req.body || {};
    const invalid = spec.validate(body);
    if (invalid) return jsonError(res, 400, invalid);
    if (spec.unavailable && !spec.unavailable.store) {
      return jsonError(res, 503, spec.unavailable.message);
    }
    try {
      const reply = await spec.run(workspace, body);
      if (reply.fail) return jsonError(res, ...reply.fail);
      sessionsFeedCache.clear(workspace.urlKey);
      res.json(reply.ok);
    } catch (error) {
      console.error(spec.logLabel, error);
      if (spec.storeFault && replyStoreFault(res, error)) return;
      jsonError(res, 500, spec.failure);
    }
  });
}

const nonEmptyString = (v) => typeof v === 'string' && v !== '';

// ─── Dismiss a loop-backed ruling (LIN-2225) ──────────────────────────────
//
// The task-bound sibling already has a dismiss path — a scan-produced
// decision's own `outcome: 'dismissed'` column
// (`POST /workspace/:urlKey/api/scan/:issueId/dismiss`, LIN-2211/LIN-2197
// Phase 4) — so the Rulings page client calls that route directly for a
// task-bound row rather than duplicating it here. A loop-backed decision has
// no such column: `dispatchQueueStore` only ever carries the single
// `decision-answer` stamp, so dismiss reuses `markDecisionAnswered` verbatim
// with an explicit `'dismissed'` outcome tagged into that same stamp
// (`lib/dispatch-store.js`) — the ruling clears from the unanswered queue
// exactly like a genuine answer (`lib/pipeline-loops.js`'s
// `_findDecisionAnswer` only ever reads `decision_id`), while staying
// distinguishable in storage for a later false-escalation KPI read
// (LIN-1736). No comment is posted — dismiss is deliberately silent, unlike
// an answer.
//
// `:urlKey` targets the RULING's own workspace, mirroring the existing
// comment route the free-text/option reply already targets
// (`public/observation.js`'s `deliverRulingReply`) — the rulings feed is
// cross-workspace, so this is not necessarily the page being viewed from.
//
// LIN-2755: the frame clears the sessions-feed cache on success so the next
// poll of either namespace (rulings::… / proxy-rulings::…) reconstructs
// instead of serving the just-discharged row for up to the 5s TTL.
// `clear(urlKey)` matches any entry whose workspace set includes this
// key, which is why one call covers both namespaces + the merged
// dashboard keys — see lib/sessions-feed-cache.js.
const validateLoopDecision = ({ decisionLoopId, decisionId }) =>
  nonEmptyString(decisionLoopId) && nonEmptyString(decisionId)
    ? null
    : 'decisionLoopId and decisionId are both required';

function dismissSpec({ dispatchQueueStore }) {
  return {
    path: '/workspace/:urlKey/api/dashboard/rulings/dismiss',
    validate: validateLoopDecision,
    run: async (workspace, { decisionLoopId, decisionId }) => {
      const stamped = await dispatchQueueStore.markDecisionAnswered(decisionLoopId, workspace.urlKey, decisionId, 'dismissed');
      return stamped ? { ok: { success: true } } : { fail: [404, 'No matching ruling to dismiss'] };
    },
    logLabel: 'Ruling dismiss error:',
    failure: 'Failed to dismiss ruling',
    storeFault: true
  };
}

// ─── Reverse a decision withdrawal — session-auth-only, terminal (LIN-2891/LIN-3035) ──
//
// The write-side counterpart to `kind: 'decision-withdrawn'`
// (routes/dispatch.js, runner-writable behind a required `reason` — see
// `FEEDBACK_ENTRY_KINDS`'s docblock in lib/dispatch-store.js for the full
// credential-class audit). Reversal is deliberately the ONE decision-
// lifecycle transition no token can ever reach: mounted under the same
// session-only `workspaceFromUrl` as `.../dismiss` above, which never reads
// `Authorization`. There is no UI button for this yet — the route itself is
// this ticket's deliverable.
//
// `markDecisionWithdrawalReversed` (lib/dispatch-store.js) does the actual
// terminal check (a never-withdrawn or already-reversed `decisionId`
// returns `null`, with no append) and the CAS-guarded `$push`; this handler
// only translates its `null` to a 404 and clears the cache on success.
function reverseWithdrawalSpec({ dispatchQueueStore }) {
  return {
    path: '/workspace/:urlKey/api/dashboard/rulings/reverse-withdrawal',
    validate: validateLoopDecision,
    run: async (workspace, { decisionLoopId, decisionId }) => {
      const reversed = await dispatchQueueStore.markDecisionWithdrawalReversed(decisionLoopId, workspace.urlKey, decisionId);
      return reversed ? { ok: { success: true } } : { fail: [404, 'No matching withdrawal to reverse'] };
    },
    logLabel: 'Ruling withdrawal-reverse error:',
    failure: 'Failed to reverse withdrawal',
    storeFault: true
  };
}

// ─── Answer a task-bound ruling — human-authenticated, no comment (LIN-2754 Track B) ──
//
// Task-bound only — sibling to `.../rulings/dismiss` above, not a loop-backed
// route: the proposed answer already lives on the ticket (LIN-2754's whole
// point), so this is stamp-only bookkeeping. It posts no comment, starts no
// run, and resumes nothing.
//
// No canonical-id re-resolution: every `taskDecisionsStore` row's `issueId`
// is canonical by construction (`routes/workspace-api.js`'s scan/dismiss
// routes only ever write a UUID there), and `taskDecisionAnchor`
// (`lib/unanswered-decisions.js`) hands this route's caller that same
// already-canonical id unchanged — `markOutcome`'s own canonical-UUID guard
// is belt-and-braces behind it.
//
// `optionId` is NOT re-validated against `decision.options[].id` here — it
// was already validated once at propose time (Track A's suggest-answer
// route); re-deriving it needs a read this route does not otherwise take,
// for a value sourced from an already-validated standing suggestion.
//
// This route and `stampDecisionAnswers`'s task half (routes/workspace-api.js)
// both call the shared `TaskDecisionsStore.answer()` (LIN-2889), which
// un-retires a self-resolved row before re-stamping it — a human answer
// always outranks the model's earlier self-resolve guess — and reports
// `firstStampWins` from a conditional write (`matchedCount`), never from a
// read. Success requires `firstStampWins === true`; anything else is an
// explicit non-success, never an implicit 200 (plan-review F1). This
// replaces the earlier `outcomeAt`/`requestStartedAt` timestamp check
// (LIN-2791), which could not tell a self-resolved row apart from a
// genuine already-answered race.
//
// Store faults stay a plain 500 here (`storeFault: false`), unlike dismiss
// and reverse-withdrawal above: the LIN-3805 asymmetry, kept as it was.
const answerFields = ({ taskDecisionId, taskDecisionIssueId, optionId }) =>
  [taskDecisionId, taskDecisionIssueId, optionId];

function answerSpec({ taskDecisionsStore }) {
  return {
    path: '/workspace/:urlKey/api/dashboard/rulings/answer',
    validate: (body) => answerFields(body).every(v => typeof v === 'string' && v.trim())
      ? null
      : 'taskDecisionId, taskDecisionIssueId and optionId are all required',
    unavailable: { store: taskDecisionsStore, message: 'Scan store not configured' },
    run: async (workspace, { taskDecisionId, taskDecisionIssueId, optionId }) => {
      const { record, firstStampWins } = await taskDecisionsStore.answer({
        urlKey: workspace.urlKey, issueId: taskDecisionIssueId, id: taskDecisionId, optionId
      });
      if (!record) {
        return { fail: [404, 'No matching ruling to answer'] };
      }
      // Success clears the feed cache in the frame (LIN-2755), never on either
      // 409 branch below, which changed nothing this call can claim.
      if (firstStampWins) {
        return { ok: { success: true } };
      }
      if (record.outcome === 'answered' || record.outcome === 'dismissed') {
        const label = record.outcome === 'dismissed' ? 'dismissed' : 'answered';
        return { fail: [409, `This ruling was already ${label}`, { code: 'ALREADY_TERMINAL' }] };
      }
      // Leftover self-resolved state: reachable only through the genuinely
      // rare case answer()'s narrowed catch still lets through — a second,
      // independent retire landing in the sub-millisecond window between
      // this call's own un-retire and re-stamp. Never an implicit 200: the
      // client's un-retire-then-answer request is itself safe to resubmit
      // (answer() is idempotent from the caller's perspective), so ask for
      // a retry rather than guessing.
      return { fail: [409, 'Could not confirm the answer — please retry', { code: 'RETRY_REQUIRED' }] };
    },
    logLabel: 'Ruling answer error:',
    failure: 'Failed to answer ruling',
    storeFault: false
  };
}

// ─── Shelve a ruling (LIN-1727) ──────────────────────────────────────────
//
// A deliberate, designed defer — a reason and a re-surface timer are both
// required (docs/escalation-philosophy.md §6: silent muting is forbidden).
// Works uniformly for a loop-backed OR task-bound ruling — unlike answer/
// dismiss, a shelve never writes to the underlying loop/task-decision row
// at all (it is a VIEW operation only, keyed on `(urlKey, decisionId)` in
// `lib/shelved-rulings-store.js`), so this route needs no anchor/disposition
// branching the way `.../rulings/dismiss` above does.
const MIN_SHELVE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SHELVE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// LIN-2756: `decisionLoopId` is OPTIONAL on shelve and keep — see
// lib/shelved-rulings-store.js's back-compat note. `public/observation.js`'s
// shelveRulingRow always sends the row's own anchor.loopId/taskDecisionId, but
// these routes stay tolerant of an omitted one (a stale cached tab mid-deploy, a
// future non-upgraded caller) rather than 400ing a previously-working call.
const badOptionalLoopId = ({ decisionLoopId }) =>
  decisionLoopId !== undefined && !nonEmptyString(decisionLoopId);
const OPTIONAL_LOOP_ID_MESSAGE = 'decisionLoopId, when given, must be a non-empty string';
const loopIdField = (decisionLoopId) => (decisionLoopId ? { decisionLoopId } : {});

function shelveInvalid(body) {
  const { decisionId, reason, resurfaceInMs } = body;
  if (!nonEmptyString(decisionId)) return 'decisionId is required';
  if (badOptionalLoopId(body)) return OPTIONAL_LOOP_ID_MESSAGE;
  if (typeof reason !== 'string' || !reason.trim()) {
    return 'A shelve reason is required — silent muting is not allowed';
  }
  if (typeof resurfaceInMs !== 'number' || !Number.isFinite(resurfaceInMs) || resurfaceInMs < MIN_SHELVE_MS || resurfaceInMs > MAX_SHELVE_MS) {
    return `resurfaceInMs must be between ${MIN_SHELVE_MS} and ${MAX_SHELVE_MS}`;
  }
  return null;
}

function shelveSpec({ shelvedRulingsStore }) {
  return {
    path: '/workspace/:urlKey/api/dashboard/rulings/shelve',
    validate: shelveInvalid,
    unavailable: { store: shelvedRulingsStore, message: 'Shelved-rulings store not configured' },
    // LIN-2755: uniform invalidation on every ruling write, per the
    // ticket's Proposal — shelve never touches loop/task-decision data
    // itself (shelvedRulingsStore is read live, not cached), so the frame's
    // clear is defensive/uniform rather than fixing an observable staleness bug.
    run: async (workspace, { decisionId, decisionLoopId, reason, resurfaceInMs }) => {
      const record = await shelvedRulingsStore.shelve({
        urlKey: workspace.urlKey,
        decisionId,
        ...loopIdField(decisionLoopId),
        reason,
        resurfaceInMs
      });
      return record ? { ok: { success: true, shelf: record } } : { fail: [500, 'Failed to shelve ruling'] };
    },
    logLabel: 'Ruling shelve error:',
    failure: 'Failed to shelve ruling',
    storeFault: false
  };
}

// ─── Keep a ruling — withdraw a proposed dismissal (LIN-2444) ───────────────
//
// A proxy token may PROPOSE a dismissal but never perform one; "Keep" is the
// human declining that proposal. Like shelve, this is a VIEW operation only
// — it never touches the underlying loop/task-decision row, so it needs no
// anchor/disposition branching and, unlike a dismiss/answer route, must NOT
// arm keepalive (verified: neither sibling write route above arms it either).
// `withdraw()` is already idempotent (a second Keep returns the existing
// withdrawn record unchanged), so no idempotence handling is needed here.
// The optional `decisionLoopId` must match whatever the standing suggestion was
// proposed with, but an absent one is tolerated rather than refused.
function keepSpec({ dismissalSuggestionsStore }) {
  return {
    path: '/workspace/:urlKey/api/dashboard/rulings/keep',
    validate: (body) => {
      if (!nonEmptyString(body.decisionId)) return 'decisionId is required';
      return badOptionalLoopId(body) ? OPTIONAL_LOOP_ID_MESSAGE : null;
    },
    unavailable: { store: dismissalSuggestionsStore, message: 'Dismissal-suggestions store not configured' },
    // LIN-2755: uniform invalidation, same reasoning as shelve above —
    // dismissalSuggestionsStore is read live, not cached.
    run: async (workspace, { decisionId, decisionLoopId }) => {
      const record = await dismissalSuggestionsStore.withdraw({
        urlKey: workspace.urlKey,
        decisionId,
        ...loopIdField(decisionLoopId)
      });
      return record ? { ok: { success: true, suggestion: record } } : { fail: [404, 'No matching suggestion to keep'] };
    },
    logLabel: 'Ruling keep error:',
    failure: 'Failed to keep ruling',
    storeFault: false
  };
}

/**
 * @param {Object} ctx - the composer's resolved dependencies plus its shared closures
 * @returns {Router}
 */
export function createDashboardRulingsRoutes(ctx) {
  const { workspaceFromUrl } = ctx;
  const router = Router();
  router.get('/workspace/:urlKey/api/dashboard/rulings', workspaceFromUrl, rulingsFeed(ctx));
  for (const spec of [dismissSpec, reverseWithdrawalSpec, answerSpec, shelveSpec, keepSpec]) {
    rulingWrite(router, ctx, spec(ctx));
  }
  return router;
}
