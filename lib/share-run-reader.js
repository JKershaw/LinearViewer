/**
 * Owner-credential RUN reader for share refreshes (LIN-3313, Phase 3 of
 * LIN-2950; plan surface S2).
 *
 * The run counterpart of `createReadOwnerIssues` (lib/share-owner-reader.js):
 * a `run` share's refresh rebuilds the guest projection of one run on the
 * OWNER's credential, never on anything the anonymous viewer supplies.
 *
 *   - `readOwnerRun(urlKey, ownerAccountId, sessionId)` resolves the owner's
 *     credential through `resolveWorkspaceAccess` (never the UNSCOPED
 *     sentinel), reads the run's local half (`loadRunLocal`: Mongo only) and
 *     its external half (`readRunExternal`: tracker evidence + the one PR
 *     read), and returns `{ reason, run }` where `run` is the stored guest
 *     projection (`buildGuestRunProjection`, lib/guest-run.js). Same reason
 *     codes as `readOwnerIssues` (`ok`, or the credential's failure reason),
 *     plus `run_not_found` when the run is not in this workspace.
 *   - `probeRun(urlKey, sessionId)` is the cheap local probe the settled
 *     revalidate uses (S4): Mongo only, no credential, no tracker or GitHub
 *     read. It answers whether the run is still settled and its `settledKey`.
 *
 * Contract (plan S2, review N6):
 *   - no request-coupled input: the signature is `(urlKey, ownerAccountId,
 *     sessionId)`; there is no `req`, session, feature flag or decision feed;
 *   - the guest's fixed non-owner posture: `viewerIsOwner:false`,
 *     `runnerReady:false`, no run facts (so `stopAt:null`,
 *     `variant:'unknown'`), and `decisions` are never read (the projection has
 *     no slot for them) — nor are proposals;
 *   - PR state ONLY through the shared `prStateStore` (one 36/h budget and one
 *     `repo#number` cache with the dashboard router): an injected
 *     `readPrStatus` adapter around `readResult` records `{result, fetchedAt,
 *     via}` from the SAME `readRunEvidence` call that builds the evidence, so
 *     the header PR line, the evidence "now" row and `closeOut.status` share
 *     one read and one `asOf`. Never `readPrStatusFailOpen`;
 *   - the allowlist comes from the store's cached `allowlist` (the additive
 *     `allowlist` parameter on `readRunEvidence`);
 *   - a settled run's PR read carries `minFetchedAt = lastFinishedAt`, so a
 *     cache entry older than the last step forces one real read (budget
 *     permitting) before the snapshot may freeze (gate b);
 *   - the settle predicate and loop enrichment are injected from
 *     `routes/dashboard.js` (the `server.js` materializer pattern), keeping
 *     ONE definition of "terminal" (class N-H);
 *   - a thrown read propagates: the share route's L4 try/catch turns it into
 *     matrix row 6 (last-good) or row 7 (503). The external read is called
 *     with `failOpen:false` for that reason — a failed tracker read must not
 *     look like "no evidence" and settle a snapshot without it.
 */

import { buildGuestRunProjection, computeLastFinishedAt, guestParagraphKey, guestSession, guestSettledKey } from './guest-run.js';

/** Why a run read produced no projection although the credential resolved. */
export const RUN_NOT_FOUND = 'run_not_found';

/**
 * A `readPrStatus` adapter over the shared PR-state store. `readRunEvidence`
 * calls it at most once (only for a run with exactly one PR); the adapter
 * records the store's `readResult` so the caller can hand the SAME read to the
 * projection. Nothing read (budget spent with nothing cached) answers the
 * reader's "state not reported" shape rather than null.
 *
 * @param {Object} prStateStore - `createPrStateStore()` instance
 * @param {number} nowMs
 * @param {number|null} minFetchedAt
 * @returns {{ readPrStatus: Function, recorded: () => (Object|null) }}
 */
export function createStorePrStatusAdapter(prStateStore, nowMs, minFetchedAt = null) {
  let recorded = null;
  async function readPrStatus({ repo, number }) {
    const read = await prStateStore.readResult({ repo, number }, nowMs, { minFetchedAt });
    recorded = read;
    return read.result || { repo, readable: false, state: 'unknown', reason: 'state not reported' };
  }
  return { readPrStatus, recorded: () => recorded };
}

/**
 * @param {Object} deps
 * @param {(urlKey: string, ownerAccountId: string) => Promise<{token?: string, scope?: *, reason?: string, provider?: string}>} deps.resolveWorkspaceAccess
 * @param {(workspace: {provider: string}) => Object} deps.getProviderForWorkspace
 * @param {(urlKey: string, sessionId: string, opts?: Object) => Promise<Object|null>} deps.loadRunLocal - the dashboard router's `runLoader.loadRunLocal`
 * @param {(workspace: Object, session: Object, opts?: Object) => Promise<Object|null>} deps.readRunExternal - the dashboard router's `runLoader.readRunExternal`
 * @param {Object} deps.prStateStore - the ONE shared store (server.js)
 * @param {Function} deps.sessionSettleState - routes/dashboard.js
 * @param {Function} deps.sessionIsSettled - routes/dashboard.js
 * @param {Function} deps.enrichLoop - routes/dashboard.js
 * @param {() => number} [deps.now] - clock (ms)
 * @returns {{ readOwnerRun: Function, probeRun: Function }}
 */
export function createShareRunReader({
  resolveWorkspaceAccess,
  getProviderForWorkspace,
  loadRunLocal,
  readRunExternal,
  prStateStore,
  sessionSettleState,
  sessionIsSettled,
  enrichLoop,
  now = Date.now
} = {}) {
  /**
   * The local probe (S4 revalidate): Mongo only.
   *
   * @param {string} urlKey
   * @param {string} sessionId
   * @returns {Promise<{reason: string, settled: boolean, settledKey: (string|null)}>}
   */
  async function probeRun(urlKey, sessionId) {
    const local = await loadRunLocal(urlKey, sessionId, { now: new Date(now()) });
    if (!local || !local.session) return { reason: RUN_NOT_FOUND, settled: false, settledKey: null };
    const { session } = local;
    // The same key the projection stores: `guestSettledKey` over the stub's
    // paragraph key and the settle predicate's own per-loop output (R4).
    const settledKey = guestSettledKey(guestParagraphKey(guestSession(session)), sessionSettleState(session));
    return { reason: 'ok', settled: sessionIsSettled(session) === true, settledKey };
  }

  /**
   * The full owner-credential read → the stored guest projection.
   *
   * @param {string} urlKey
   * @param {string} ownerAccountId
   * @param {string} sessionId
   * @returns {Promise<{reason: string, run: (Object|null)}>}
   */
  async function readOwnerRun(urlKey, ownerAccountId, sessionId) {
    const { token, scope, reason, provider } = await resolveWorkspaceAccess(urlKey, ownerAccountId);
    if (!token) return { reason, run: null };

    const nowMs = now();
    const capturedAt = new Date(nowMs);
    const local = await loadRunLocal(urlKey, sessionId, { now: capturedAt });
    if (!local || !local.session) return { reason: RUN_NOT_FOUND, run: null };
    const { session, paragraph, anchorIssueTitle } = local;

    let runEvidence = null;
    let prRead = null;
    // The Linear test-token short-circuit (as `readOwnerIssues`): under
    // NODE_ENV=test the mock credential reaches no tracker, so the run is
    // projected from its local half alone (no evidence, no PR read).
    if (!(process.env.NODE_ENV === 'test' && token === 'test-token')) {
      const callScope = scope ?? token;
      const providerImpl = getProviderForWorkspace({ provider });
      const allowlist = await prStateStore.allowlist(urlKey, providerImpl, callScope, nowMs);
      // Gate (b): only a settled run needs its PR read to postdate its last
      // step; an unsettled one keeps the plain TTL read (no extra spend).
      const minFetchedAt = sessionIsSettled(session) === true
        ? toMs(computeLastFinishedAt(session, enrichLoop))
        : null;
      const adapter = createStorePrStatusAdapter(prStateStore, nowMs, minFetchedAt);
      runEvidence = await readRunExternal({ urlKey }, session, {
        asked: anchorIssueTitle || null,
        viewerIsOwner: false,
        runFacts: null,
        runnerReady: false,
        allowlist,
        readPrStatus: adapter.readPrStatus,
        binding: { provider: providerImpl, callScope },
        failOpen: false
      });
      prRead = adapter.recorded();
    }

    const run = buildGuestRunProjection({
      session,
      runEvidence,
      prRead,
      paragraph: paragraph || null,
      urlKey,
      capturedAt
    }, { sessionSettleState, enrichLoop });
    return { reason, run };
  }

  return { readOwnerRun, probeRun };
}

function toMs(iso) {
  if (iso == null) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}
