/**
 * Sessions and run-evidence / close-out routes (LIN-3894, LIN-2246: extracted from
 * workspace-api.js): GET /api/sessions/:identifier, GET /api/run-evidence/:issueIdentifier,
 * and POST .../check and .../close-out-press, with the helpers only they use.
 * `registerSessionsRoutes` and `registerRunEvidenceRoutes` put them on the router
 * createWorkspaceApiRoutes hands them, each at the place its block sat in that file
 * (sessions after the issue-write routes; run-evidence after the openrouter models
 * route, before the roadmap mount), so the route table's order and each path's
 * `Allow` are unchanged.
 */
import { json } from 'express';
import { badRequest, jsonError, unauthorized } from '../lib/errors.js';
import { readRunEvidence } from '../lib/run-evidence.js';
import { closeOutSetsDone } from '../lib/run-closeout-state.js';
import { recordMergedPrs } from '../lib/close-out-merges.js';
import { readCloseOutChain, closeOutNotReady, closeOutNotReadyRefusal } from '../lib/close-out-readiness.js';
import { getLoopsForIssue, sessionIdByLoop } from '../lib/pipeline-loops.js';
import { sessionIdOf } from '../lib/live-console.js';
import { toSessionView } from '../lib/sessions-view.js';
import { resolveIssueBinding } from '../lib/workspace.js';
import { resolveStateRef } from '../lib/proxy-ref-resolver.js';
import { requestFeatureFlags } from '../lib/run-controls.js';

// ===========================================================================
// Close-out helpers (LIN-3248, P3 of LIN-2949)
// ===========================================================================

// A usable close-out/run-evidence identifier: present and at most 100 chars.
const validCloseOutIdentifier = (identifier) => !!identifier && identifier.length <= 100;

// The signed-in person's own session: an authenticated session (workspaceFromUrl
// already required one) and NOT a worker/proxy token. Computed from the
// request, never from the body, so the route can never be handed
// `byPersonCheck: true`.
function isPersonSession(req) {
  return !!req.session?.accountId && !req.proxyTokenId && !req.proxyUrlKey;
}

// Set the tracker issue Done. Resolves the issue's team, its completed
// workflow state, then transitions it. Throws on failure so the caller can
// record the error and retry on the next check.
async function defaultMarkDone({ provider, callScope, issueIdentifier }) {
  const { issue } = await provider.fetchIssueContext(callScope, issueIdentifier);
  const issueRef = issue?.id || issueIdentifier;
  const teamOf = (record) => record?.team?.id || null;

  let teamId = teamOf(issue);
  if (!teamId && typeof provider.issueWriteGuard === 'function') {
    teamId = teamOf(await provider.issueWriteGuard(callScope, issueRef));
  }
  if (!teamId) throw new Error('could not resolve the issue team for Done');

  const states = await provider.states(callScope, teamId);
  const completedId = (states || []).find((state) => state?.type === 'completed')?.id;
  return provider.updateIssue(callScope, issueRef, { stateId: completedId || resolveStateRef(states, 'Done') });
}

export function registerSessionsRoutes(router, { workspaceFromUrl, dispatchQueueStore, agentStatusStore, loadTaskState = null }) {
  // ===========================================================================
  // Dispatched Sessions API
  // ===========================================================================

  /**
   * GET the dispatched sessions (pipeline Loops) for a single issue.
   *
   * Reads the local dispatch + agent stores only — no Linear call, no access
   * token — so it's cheap and works offline. The `:identifier` is the Linear
   * identifier (e.g. LIN-42), which is the join key the Swipe card already holds.
   * Returns newest-first so the most recent session is at the top.
   *
   * @route GET /workspace/:urlKey/api/sessions/:identifier
   * @returns {Object} { sessions: Array<SessionView> }
   */
  router.get('/workspace/:urlKey/api/sessions/:identifier', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;

    if (!identifier || identifier.length > 100) {
      return badRequest.json(res, 'Invalid issue identifier');
    }
    if (!dispatchQueueStore || !agentStatusStore) {
      return jsonError(res, 503, 'Sessions are not available');
    }

    try {
      const loops = await getLoopsForIssue(workspace.urlKey, identifier, {
        dispatchStore: dispatchQueueStore,
        agentStatusStore,
        noPrompt: true // toSessionView never reads promptText (LIN-3812)
      });
      // The run's page is keyed by the session id the Live Console uses, so each session carries it for its run link
      // (LIN-4024). Same lookup as the Live Console, so the link and the console cannot disagree on a run.
      const sessionIds = sessionIdByLoop(loops);
      // getLoopsForIssue returns oldest-first; reverse for newest-first display.
      const sessions = loops.map((loop) => ({ ...toSessionView(loop), sessionId: sessionIdOf(loop, sessionIds) })).reverse();
      // LIN-4016: a waiting session reads "parked" on a parked task and "waiting on you" on a ruling. The task's decided
      // state (the reader its row and opened task use) says which, so the fold does not re-derive it. Read only when a
      // session waits.
      const taskParked = !!loadTaskState && sessions.some((s) => s.agentState === 'waiting')
        && (await loadTaskState({ urlKey: workspace.urlKey, identifier })).taskState.state === 'parked';
      res.json({ sessions, taskParked });
    } catch (error) {
      console.error('Sessions GET error:', error);
      jsonError(res, 500, 'Failed to fetch sessions', { message: error.message });
    }
  });
}

export function registerRunEvidenceRoutes(router, { workspaceFromUrl, dispatchQueueStore, runEvidence, closeOutEventsStore, closeOut, onTicketWrite, installationTokenFor }) {
  /**
   * Run evidence (LIN-3247, P2 of LIN-2949). The data half of the page seam:
   * returns `{ state, evidence, ledger, closeOut }` for a run's issue. The PR
   * URL comes from the run's OWN tracker comments (newest first); the live PR
   * state comes from the shared fail-open reader (never throws — unreadable →
   * `state: 'unknown'`). This fabricates nothing: `deriveCloseOutState` and the
   * press are P3.
   *
   * @route GET /workspace/:urlKey/api/run-evidence/:issueIdentifier
   */
  router.get('/workspace/:urlKey/api/run-evidence/:issueIdentifier', workspaceFromUrl, async (req, res) => {
    const { issueIdentifier } = req.params;
    if (!validCloseOutIdentifier(issueIdentifier)) return badRequest.json(res, 'Invalid issue identifier');

    const seam = runEvidence || {};
    const source = typeof req.query.source === 'string' ? req.query.source : null;
    try {
      const { provider, callScope } = (seam.resolveProvider || resolveIssueBinding)(req.workspace, source);
      const { state, evidence, ledger, closeOut: closeOutModel } = await readRunEvidence({
        issueIdentifier,
        provider,
        callScope,
        viewerIsOwner: (seam.viewerIsOwner || (() => true))(req),
        urlKey: req.workspace.urlKey,
        workspaceId: req.workspace.id,
        installationTokenFor,
        readPrStatus: seam.readPrStatus || undefined,
        githubFetch: seam.githubFetch || null,
      });
      res.json({ state, evidence, ledger, closeOut: closeOutModel });
    } catch (error) {
      console.error('Run evidence error:', error);
      jsonError(res, 500, 'Failed to build run evidence', { message: error.message });
    }
  });

  // ===========================================================================
  // Close-out (LIN-3248, P3 of LIN-2949)
  // ===========================================================================

  // Answers the close-out POST routes' two refusals — a bad identifier, then a
  // caller that is not the signed-in person's own session (never a worker or
  // proxy token) — and says whether it answered.
  function refusedCloseOutRequest(req, res, what) {
    if (!validCloseOutIdentifier(req.params.issueIdentifier)) {
      badRequest.json(res, 'Invalid issue identifier');
    } else if (!req.session?.accountId) {
      unauthorized.json(res, 'Not authenticated');
    } else if (!isPersonSession(req)) {
      jsonError(res, 403, `The close-out ${what} must use the signed-in person's own session`, { code: 'PERSON_SESSION_REQUIRED' });
    } else {
      return false;
    }
    return true;
  }

  // Stamp the merge's Done outcome on its stored event (when there is one).
  const stampMergeDone = (workspace, mergedEvent, outcome) => (
    mergedEvent && closeOutEventsStore
      ? closeOutEventsStore.stampDone({
        urlKey: workspace.urlKey, prUrl: mergedEvent.prUrl, headSha: mergedEvent.headSha, by: mergedEvent.by, ...outcome,
      })
      : null
  );

  // R1: set Done only when all four bounds hold (the caller checks them). F2: write
  // it once per merge — skip when this merge already carries a successful `doneAt`,
  // and retry only after a failed attempt. Returns what the response reports.
  async function settleDone({ workspace, provider, callScope, issueIdentifier, seam, mergedEvent }) {
    if (mergedEvent?.doneAt) {
      // already written for this merge; never repeat the provider write
      return { done: true, doneNow: false, doneError: null, mergedEvent };
    }
    try {
      const written = await (seam.markDone || defaultMarkDone)({ provider, callScope, issueIdentifier });
      // Seam 3 (LIN-3366): fires only on this fresh write, never on the
      // `doneAt` branch above, so a merge that already carries `doneAt` never
      // re-fires. `defaultMarkDone` returns `{success, issue}`; the helper unwraps.
      if (onTicketWrite) {
        void Promise.resolve()
          .then(() => onTicketWrite({ urlKey: workspace.urlKey, written, readBack: () => provider.fetchIssueContext(callScope, issueIdentifier) }))
          .catch(e => console.error('[ticket-closer] seam 3 failure:', e?.message || e));
      }
      const stamped = await stampMergeDone(workspace, mergedEvent, { doneAt: new Date(), doneError: null });
      return { done: true, doneNow: true, doneError: null, mergedEvent: stamped || mergedEvent };
    } catch (err) {
      const doneError = err?.message || 'could not set the task Done';
      await stampMergeDone(workspace, mergedEvent, { doneAt: null, doneError });
      return { done: false, doneNow: false, doneError, mergedEvent };
    }
  }

  /**
   * Close-out check (LIN-3248, P3 of LIN-2949). The page calls this on load and
   * on tab focus, only while the close-out state is `ready`. It re-reads the PR
   * live, derives the close-out state with `deriveCloseOutState` (never P2's
   * looser `closeOut.status`), records a `{ by: 'person' }` event when a PR is
   * merged, and sets Done only within R1's bounds — all on the signed-in
   * person's own provider session, never a worker or proxy token. Returns
   * `done` (a Done is recorded for the merge) and `doneNow` (THIS call wrote
   * the tracker's Done) so the client reloads only on the real transition.
   *
   * @route POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/check
   */
  router.post('/workspace/:urlKey/api/run-evidence/:issueIdentifier/check', workspaceFromUrl, json(), async (req, res) => {
    if (refusedCloseOutRequest(req, res, 'check')) return;

    const { workspace } = req;
    const { issueIdentifier } = req.params;
    const seam = closeOut || {};
    const source = [req.body?.source, req.query.source].find((v) => typeof v === 'string') ?? null;

    try {
      // LIN-3634: the read chain is `lib/close-out-readiness.js`, shared with the
      // dispatch guard. Same order as before: comments, PR urls, every PR status,
      // ledger, stop-at, then `deriveCloseOutState`.
      const { provider, callScope, prUrls, prStatuses, ledger, stopAt, state } = await readCloseOutChain({
        workspace,
        issueIdentifier,
        source,
        store: dispatchQueueStore,
        seam,
        runnerReady: seam.runnerReady ? !!seam.runnerReady(req) : (await requestFeatureFlags(req)).runControls === true,
        owner: true,
        byPersonCheck: true,
        installationTokenFor,
      });

      // B1' (review `a1845467`): `done` is true on EVERY later call once a merge
      // is recorded, so a client that reloads on `done` loops on a reopened task
      // (Done recorded, tracker back to In Progress). `doneNow` is true only on
      // the call that actually wrote the provider's Done, so the client reloads
      // on the real transition, never on a page that merely reports the record.
      let outcome = { done: false, doneNow: false, doneError: null };
      let recorded = [];

      // Close-out is a stop-at-PR surface only: a normal run records and sets
      // nothing here.
      if (stopAt === 'pr') {
        const merges = await recordMergedPrs({ store: closeOutEventsStore, workspace, accountId: req.session.accountId, issueIdentifier, prUrls, prStatuses, ledger });
        recorded = merges.recorded;
        let { mergedEvent } = merges;

        const prIndex = Math.max(merges.mergedPrIndex, 0);
        if (state.status === 'merged' && closeOutSetsDone({ prStatuses, prIndex, review: ledger, byPersonCheck: true })) {
          ({ mergedEvent, ...outcome } = await settleDone({ workspace, provider, callScope, issueIdentifier, seam, mergedEvent }));
        }

        // Show a press-then-merge as a close-out merge.
        if (mergedEvent?.by === 'close-out') {
          state.mergedBy = 'close-out';
          state.message = 'the pull request was merged by close-out';
        }
      }

      return res.json({ state, recorded, done: outcome.done, doneNow: outcome.doneNow, doneError: outcome.doneError });
    } catch (error) {
      console.error('Close-out check error:', error);
      jsonError(res, 500, 'Failed to check close-out state', { message: error.message });
    }
  });

  /**
   * Close-out press record (LIN-3248, P3 of LIN-2949). The press itself goes
   * through the existing dispatch path (GET /api/prompt/:issueId/close-out +
   * window.dispatchPrompt); this route only records what that path dispatched.
   * No new dispatch route.
   *
   * @route POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press
   */
  router.post('/workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press', workspaceFromUrl, json(), async (req, res) => {
    if (refusedCloseOutRequest(req, res, 'press')) return;

    const { urlKey } = req.workspace;
    const { prUrl, headSha, dispatchId } = req.body || {};
    try {
      // LIN-3395: once the PR's merge is on record, a press (e.g. from a stale
      // tab after a self-merge) is refused before anything is written, so the
      // next check cannot add a second `close-out` event or a second Done write.
      if (closeOutEventsStore && await closeOutEventsStore.hasMergedEvent({ urlKey, prUrl })) {
        return jsonError(res, 409, 'This pull request is already merged; the close-out press was not recorded', { code: 'CLOSE_OUT_ALREADY_MERGED' });
      }
      // LIN-3657: the dispatch lane refuses a head-moved close-out (LIN-3634); the
      // press asks the same question so it never records one. The guard keeps
      // `closeOutNotReady`'s scope (the task's sole open PR, not `prUrl`) and fails
      // open on an unreadable read. Source: the request's, else the named dispatch
      // row's (the clients' press body carries none; the row is what their dispatch
      // call stamped), and only when that row is this task's.
      let source = [req.body?.source, req.query.source].find((v) => typeof v === 'string') ?? null;
      if (source === null && typeof dispatchId === 'string' && typeof dispatchQueueStore?.getItemStatus === 'function') {
        const row = await Promise.resolve(dispatchQueueStore.getItemStatus(urlKey, dispatchId)).catch(() => null);
        if (row?.issueIdentifier === req.params.issueIdentifier) source = row.issueSource ?? null;
      }
      const notReady = await closeOutNotReady({ workspace: req.workspace, issueIdentifier: req.params.issueIdentifier, source, store: dispatchQueueStore, seam: closeOut || {}, installationTokenFor });
      if (notReady) {
        const refusal = closeOutNotReadyRefusal(notReady);
        return jsonError(res, 409, refusal.error, refusal.extra);
      }
      const event = closeOutEventsStore && await closeOutEventsStore.record({
        accountId: req.session.accountId,
        urlKey,
        issueId: null,
        issueIdentifier: req.params.issueIdentifier,
        by: 'press',
        dispatchId,
        prUrl,
        headSha: headSha ?? null,
        merged: false,
        openItems: { inside: 0, outside: 0, unknown: 0, total: 0 },
      });
      if (!event) return badRequest.json(res, 'Invalid close-out press');
      return res.status(201).json({
        success: true,
        event: { id: event._id, by: event.by, dispatchId: event.dispatchId, prUrl: event.prUrl, headSha: event.headSha },
      });
    } catch (error) {
      console.error('Close-out press record error:', error);
      jsonError(res, 500, 'Failed to record close-out press', { message: error.message });
    }
  });
}
