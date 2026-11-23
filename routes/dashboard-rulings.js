/**
 * The rulings routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET  /workspace/:urlKey/api/dashboard/rulings                    — unanswered-decision feed (ambient count + rulings tab; LIN-1728)
 *   POST /workspace/:urlKey/api/dashboard/rulings/dismiss            — dismiss a loop-backed ruling with no comment (LIN-2225)
 *   POST /workspace/:urlKey/api/dashboard/rulings/reverse-withdrawal — reverse a `decision-withdrawn` stamp, terminal (LIN-2891/LIN-3035; session-auth-only, no UI button yet)
 *   POST /workspace/:urlKey/api/dashboard/rulings/answer             — stamp a TASK-BOUND ruling answered with no comment, durable optionId (LIN-2754 Track B)
 *   POST /workspace/:urlKey/api/dashboard/rulings/keep               — withdraw a proposed dismissal (LIN-2444; view-only — never touches answer state, arms no keepalive)
 *
 * The feed cache and `mergeLoops` arrive in `ctx` from the composer: the GET fills
 * the very `sessionsFeedCache` instance the feed and the run page read, and every
 * successful write clears it (LIN-2755).
 *
 * The four writes share one frame (`rulingWrite`): validate (400), the store gate
 * (503), then one try around the write. What differs per route is data in its
 * spec, including `storeFault`: dismiss and reverse-withdrawal answer a store
 * fault with `replyStoreFault` (503, LIN-3805); answer and keep still
 * answer it with their own 500. That inconsistency is today's behaviour and is
 * kept as it is; it is an open question for the owner, not a fix made here.
 */
import { Router, json } from 'express';
import { jsonError, keepaliveError, replyStoreFault } from '../lib/errors.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { collectUnansweredDecisions, openDecisionLoopIds, parseStampLoopIds, STAMP_LOOP_IDS_MESSAGE } from '../lib/unanswered-decisions.js';
import { attachStandingSuggestions } from '../lib/dismissal-suggestions-store.js';
import { RULING_SETTLED_REFUSAL } from '../lib/ruling-settled.js';
import { connectedWorkspaces, liveOnAnchor } from './dashboard-session-state.js';
import { openQuestionsFor } from '../lib/open-questions.js';
import { personAccountIdOf } from './task-records.js';

/**
 * LIN-4532 (P2b): the open question records addressed to the signed-in person, in each connected workspace, as rows of this feed
 * (`kind: 'question'`). They are read here, not in the loop/decision reduction, so the page, the count and the badge read one list.
 * The person is the canonical account (personAccountIdOf), the id the answer route files its decision under.
 */
async function openQuestionRowsFor({ session, workspaces, recordsStore, dispatchQueueStore, accountStore }) {
  if (!recordsStore || !dispatchQueueStore || !session?.accountId) return [];
  const accountId = await personAccountIdOf({ session }, accountStore);
  if (!accountId) return [];
  const rows = [];
  for (const w of workspaces) {
    const questions = await openQuestionsFor({ recordsStore, dispatchStore: dispatchQueueStore, urlKey: w.urlKey, accountId });
    for (const q of questions) {
      rows.push({
        kind: 'question',
        questionId: q.questionId,
        question: q.asks,
        options: q.options,
        recommended: q.recommended,
        ifUnanswered: q.ifUnanswered,
        interactive: q.interactive,
        state: q.state,
        reason: q.reason,
        askedAt: q.askedAt,
        // The task by its identifier (`ticket`, what a task page is keyed by), so the row heads like a ruling row (finding-9221fb7a).
        anchor: { workspaceUrlKey: w.urlKey, taskId: q.taskId, runId: q.runId, loopId: null, issueId: null, issueIdentifier: q.ticket ?? null, target: null },
      });
    }
  }
  return rows;
}

// ─── Filtered rulings feed (LIN-1728 Phase 2) ─────────────────────────────────

// One cached read backs both consumers (the ambient nav badge, Phase 3, and the
// rulings tab, Phase 4) — same `sessionsFeedCache` instance as `/sessions`, just
// a separate `rulings` view namespace so the two payload shapes never collide on
// one cache entry for the same workspace set (LIN-1728 plan decision 2/3).
// Cross-workspace by design (decision 2's "third obs-tab" host), but per the
// plan's constraint the ambient count stays scoped to `req.session.workspaces`
// like every other Observation read here — never fleet-wide.
function rulingsFeed({ sessionsFeedCache, mergeLoops, taskDecisionsStore, dismissalSuggestionsStore, recordsStore, dispatchQueueStore, accountStore }) {
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
      // Additive input (LIN-2444). Scoped to the same `workspaces` set
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
      // LIN-4532 (P2b): the person's open questions, appended as rows of this same list, so count, workspaceCount and the page agree.
      // A failed records or dispatch-store read costs only the questions, never the feed the 5s badge poll reads (finding-ab3270e4).
      const questionRows = await openQuestionRowsFor({ session: req.session, workspaces, recordsStore, dispatchQueueStore, accountStore })
        .catch(() => []);
      const rulings = [
        ...attachStandingSuggestions(
          collectUnansweredDecisions(
            { loops: merged, taskDecisions, newestScanByTask },
            {
              now: new Date(),
              liveDispatchOnAnchor: liveOnAnchor(merged)
            }
          ),
          suggestions
        ),
        ...questionRows,
      ];

      // LIN-3983: the loop ids whose question is open, by the builder's own
      // cluster rule (LIN-4003), over the SAME `merged` set as the rows above.
      // The Observation waiting block asks membership here instead of
      // re-deriving "is this run's question open?" on the client. Shelf-free,
      // by design (see openDecisionLoopIds).
      const openLoopIds = [...openDecisionLoopIds(merged)];

      // LIN-4103 beat 3: the badge on a workspace page counts that workspace's rulings (the URL's workspace, by each row's
      // anchor). `count` stays the all-workspaces count the Rulings tab reads; the badge reads `workspaceCount`.
      const pageUrlKey = req.params?.urlKey || null;
      const workspaceCount = rulings.filter((r) => r.anchor?.workspaceUrlKey === pageUrlKey).length;
      keepalive.send(200, {
        workspaces,
        count: rulings.length,
        workspaceCount,
        rulings,
        openLoopIds,
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
// Loop-backed only. A task-bound ruling's own dismiss went with the scan
// (LIN-4540): the scan was its only writer, and none was open at the cutover
// (LIN-4539). A loop-backed decision has no `outcome` column of its own: `dispatchQueueStore` only ever carries the single
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

// LIN-3959: a dismissal of a joined row dismisses every copy, so `decisionLoopIds`
// (the row's `stampLoopIds`) is stamped too. `decisionLoopId` is still the
// required, primary stamp and still the one that decides the 404. The other
// copies are best-effort: one with no match is logged, not a 404, because the
// primary already discharged the ruling.
function dismissSpec({ dispatchQueueStore }) {
  return {
    path: '/workspace/:urlKey/api/dashboard/rulings/dismiss',
    validate: (body) => validateLoopDecision(body)
      ?? (parseStampLoopIds(body.decisionLoopIds) === null ? STAMP_LOOP_IDS_MESSAGE : null),
    run: async (workspace, { decisionLoopId, decisionId, decisionLoopIds }) => {
      // LIN-4241: a stale dismissal is refused before anything is stamped. The
      // client sends the "proceed on your best judgment" follow-up only after a 2xx,
      // so this refusal is what keeps that run from starting.
      if (await dispatchQueueStore.isDecisionSettled(decisionLoopId, workspace.urlKey, decisionId)) {
        return { fail: RULING_SETTLED_REFUSAL };
      }
      const stamped = await dispatchQueueStore.markDecisionAnswered(decisionLoopId, workspace.urlKey, decisionId, 'dismissed');
      // LIN-4241: the CAS lost to an answer or dismissal that landed in between.
      if (stamped?.alreadySettled) return { fail: RULING_SETTLED_REFUSAL };
      if (!stamped) return { fail: [404, 'No matching ruling to dismiss'] };
      for (const loopId of parseStampLoopIds(decisionLoopIds)) {
        if (loopId === decisionLoopId) continue;
        const copy = await dispatchQueueStore.markDecisionAnswered(loopId, workspace.urlKey, decisionId, 'dismissed');
        if (!copy) console.error(`Ruling dismiss: copy ${loopId} not stamped (no matching item in workspace ${workspace.urlKey})`);
      }
      return { ok: { success: true } };
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
// the kinds table's docblock in lib/dispatch-feedback-kinds.js for the full
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
// is canonical by construction (the retired scan routes, LIN-4540, only ever
// wrote a UUID there), and `taskDecisionAnchor`
// (`lib/unanswered-decisions.js`) hands this route's caller that same
// already-canonical id unchanged — `markOutcome`'s own canonical-UUID guard
// is belt-and-braces behind it.
//
// `optionId` is NOT re-validated against `decision.options[].id` here — it
// was already validated once at propose time (Track A's suggest-answer
// route); re-deriving it needs a read this route does not otherwise take,
// for a value sourced from an already-validated standing suggestion.
//
// This route and `stampDecisionAnswers`'s task half (routes/workspace-api-issue-write.js)
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
    unavailable: { store: taskDecisionsStore, message: 'Task-decisions store not configured' },
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
      // LIN-4241: an answered or dismissed row is settled, not a generic conflict.
      if (record.outcome === 'answered' || record.outcome === 'dismissed') {
        return { fail: RULING_SETTLED_REFUSAL };
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

// LIN-2756: `decisionLoopId` is OPTIONAL on keep. `public/observation.js`
// always sends the row's own anchor.loopId/taskDecisionId, but the route stays
// tolerant of an omitted one (a stale cached tab mid-deploy, a future
// non-upgraded caller) rather than 400ing a previously-working call.
const badOptionalLoopId = ({ decisionLoopId }) =>
  decisionLoopId !== undefined && !nonEmptyString(decisionLoopId);
const OPTIONAL_LOOP_ID_MESSAGE = 'decisionLoopId, when given, must be a non-empty string';
const loopIdField = (decisionLoopId) => (decisionLoopId ? { decisionLoopId } : {});

// ─── Keep a ruling — withdraw a proposed dismissal (LIN-2444) ───────────────
//
// A proxy token may PROPOSE a dismissal but never perform one; "Keep" is the
// human declining that proposal. This is a VIEW operation only
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
    // LIN-2755: uniform invalidation on every ruling write —
    // dismissalSuggestionsStore is read live, not cached, so the frame's
    // clear is defensive/uniform rather than fixing an observable staleness bug.
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
  for (const spec of [dismissSpec, reverseWithdrawalSpec, answerSpec, keepSpec]) {
    rulingWrite(router, ctx, spec(ctx));
  }
  return router;
}
