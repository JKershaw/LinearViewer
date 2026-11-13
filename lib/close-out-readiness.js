// The close-out read chain, in one place (LIN-3634).
//
// The check route (`POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/check`,
// LIN-3248) re-reads a task's PRs live and derives the close-out state with
// `deriveCloseOutState`. LIN-3418 step 2 ("re-derive readiness server-side on the
// press") was dropped because that chain lived inside the route's closure, so the
// dispatch path could not call it. Lifted here, both callers share one chain and
// `deriveCloseOutState` stays the only stop-at-PR readiness predicate. The blind-read
// gate inside it (LIN-4438) is `closeOutWaitsOn`, which the ladder lane below asks
// directly, so both lanes answer one rule.

import { extractPrUrls } from './run-evidence.js';
import { readPrStatusFailOpen, resolvePrReadToken } from './github-pr-status.js';
import { readGateTrail } from './run-trail.js';
import { deriveCloseOutState, closeOutWaitsOn, blindReadMissingState } from './run-closeout-state.js';
import { readTaskRunFacts } from './task-run-facts.js';
import { resolveIssueBinding } from './workspace.js';

/** The 409 code a stale close-out press is refused with. Distinct from CLOSE_OUT_IS_THE_PERSONS / CLOSE_OUT_ALREADY_MERGED. */
export const CLOSE_OUT_NOT_READY_CODE = 'CLOSE_OUT_NOT_READY';

// Live status of every PR the run's comments mention. LIN-3443: a bound repo is
// read with the workspace's own token. Fail open: an unreadable PR is "unknown",
// never a 500.
// LIN-3285: a Linear- or Jira-bound workspace (`providerKind`) reads with the
// owner's GitHub App installation token (`installationTokenFor`). The resolve
// runs per PR, here, so `closeOutNotReady`'s stop-at check (which runs first)
// still pays no GitHub call for an ordinary ladder close-out (its one comment
// read, LIN-4438, needs no token).
export function readPrStatuses({ prUrls, callScope, workspace, seam, prStatusCache, providerKind = null, workspaceId = null, installationTokenFor = null }) {
  const readPrStatus = seam.readPrStatus || readPrStatusFailOpen;
  return Promise.all(prUrls.map(async ({ repo, number }) => {
    try {
      const token = await resolvePrReadToken({ callScope, repo, providerKind, workspaceId, installationTokenFor });
      return await readPrStatus({
        repo,
        number,
        doFetch: seam.githubFetch || null,
        // Only forwarded when given, so the check route keeps the reader's shared cache.
        ...(prStatusCache ? { cache: prStatusCache } : {}),
        ...(token ? { token, scopeKey: workspace.urlKey } : {}),
      });
    } catch (err) {
      return { repo, readable: false, state: 'unknown', reason: err?.message || 'not checked' };
    }
  }));
}

/**
 * The stop-at boundary for a task: the seam's read, else the task's dispatch rows
 * (the same read the dispatch guard makes, LIN-3340). One store read, no provider
 * or GitHub call.
 */
export async function readStopAt({ workspace, issueIdentifier, seam = {}, store }) {
  return seam.isStopAtRun
    ? seam.isStopAtRun({ workspace, issueIdentifier })
    : (await readTaskRunFacts({ store, urlKey: workspace.urlKey, issueIdentifier })).stopAt;
}

/**
 * comments → PR urls → every PR status → ledger → stop-at → `deriveCloseOutState`.
 *
 * @param {Object} args
 * @param {Object} args.workspace
 * @param {string} args.issueIdentifier
 * @param {string|null} [args.source] - the issue's provider-kind `issueSource`
 * @param {Object} [args.store] - dispatch queue store, for the default stop-at read
 * @param {Object} [args.seam] - the `closeOut` test seam
 * @param {boolean} args.runnerReady
 * @param {boolean} args.owner
 * @param {boolean} args.byPersonCheck
 * @param {Map} [args.prStatusCache] - a cache for the PR reads; omitted → the reader's shared 60 s cache
 * @param {('pr'|null)} [args.stopAt] - already read by the caller; omitted → read here, after the ledger
 * @param {Function} [args.installationTokenFor] - LIN-3285: the owner-installation token seam
 * @returns {Promise<{provider, callScope, prUrls, prStatuses, ledger, landingPrs, stopAt, state}>}
 */
export async function readCloseOutChain({ workspace, issueIdentifier, source = null, store, seam = {}, runnerReady, owner, byPersonCheck, prStatusCache, stopAt: knownStopAt, installationTokenFor = null }) {
  const { provider, callScope } = (seam.resolveProvider || resolveIssueBinding)(workspace, source);

  const comments = await provider.fetchIssueComments(callScope, issueIdentifier);
  const prUrls = extractPrUrls(comments);
  const prStatuses = await readPrStatuses({
    prUrls, callScope, workspace, seam, prStatusCache,
    providerKind: provider?.name, workspaceId: workspace?.id, installationTokenFor,
  });

  // LIN-4438: the ledger (with its blind read) passes whole to the gate, beside the landing.
  const { ledger, landingPrs } = readGateTrail(comments);
  const stopAt = knownStopAt !== undefined
    ? knownStopAt
    : await readStopAt({ workspace, issueIdentifier, seam, store });
  const state = deriveCloseOutState({
    prs: prUrls,
    prStatuses,
    landingPrs,
    review: ledger,
    runnerReady,
    owner,
    stopAt,
    byPersonCheck,
  });
  return { provider, callScope, prUrls, prStatuses, ledger, landingPrs, stopAt, state };
}

/**
 * The 409 body for a refused close-out (LIN-3657), as `jsonError(res, 409, error, extra)`
 * takes it. One source for the dispatch lane (LIN-3634) and the press route, so the two
 * refusals cannot drift. The reason and its copy come from the state (LIN-4438): `head-moved`
 * or `blind-read-missing`.
 */
export function closeOutNotReadyRefusal(state) {
  const message = String(state?.message || '');
  return {
    error: message.charAt(0).toUpperCase() + message.slice(1),
    extra: { code: CLOSE_OUT_NOT_READY_CODE, reason: state?.reason ?? null, state },
  };
}

/** The reasons the stop-at-PR guard refuses a close-out on; every other state admits. */
const REFUSED_REASONS = new Set(['head-moved', 'blind-read-missing']);

/**
 * The ladder lane's answer (LIN-4438): an ordinary close-out on a task that does not stop at the
 * PR. One comment read and no PR read: `deriveCloseOutState` cannot answer for this task (it is
 * a stop-at-PR surface), so the gate asks `closeOutWaitsOn` directly. No review on record admits
 * (LIN-3497).
 */
async function ladderNotReady({ workspace, issueIdentifier, source, seam }) {
  const { provider, callScope } = (seam.resolveProvider || resolveIssueBinding)(workspace, source);
  const comments = await provider.fetchIssueComments(callScope, issueIdentifier);
  const { ledger, landingPrs } = readGateTrail(comments);
  if (!ledger || !closeOutWaitsOn(ledger, landingPrs)) return null;
  // No PR is read in this lane, so the box model it refuses with is the one for no PR read.
  return blindReadMissingState(deriveCloseOutState({ landingPrs, review: ledger }));
}

/**
 * The server-side readiness guard for a close-out dispatch (LIN-3634, LIN-4438). Answers
 * the state when the dispatch must be refused, else `null`. Never throws: every unreadable
 * read admits, and logs.
 *
 * `stopAt` is read FIRST, from the store alone. Then one of two lanes:
 *   - stop-at-PR: the whole chain (comments, every PR's live status, ledger) through
 *     `deriveCloseOutState`, refusing `head-moved` or `blind-read-missing`, and asking
 *     `closeOutWaitsOn` itself when the state names a merge instead. The PR reads use
 *     a fresh Map, so the guard sees the live head rather than the shared 60 s cache and
 *     writes nothing into it;
 *   - the ordinary ladder: one store read and ONE comment read, no PR or GitHub read,
 *     refusing `blind-read-missing` only (LIN-4438; before it this lane read nothing past
 *     the store).
 */
export async function closeOutNotReady({ workspace, issueIdentifier, source = null, store, seam = {}, installationTokenFor = null }) {
  try {
    const stopAt = await readStopAt({ workspace, issueIdentifier, seam, store });
    if (stopAt !== 'pr') return await ladderNotReady({ workspace, issueIdentifier, source, seam });
    const { state, prStatuses, ledger, landingPrs } = await readCloseOutChain({
      workspace, issueIdentifier, source, store, seam, stopAt, installationTokenFor,
      runnerReady: true, owner: true, byPersonCheck: true,
      prStatusCache: new Map(),
    });
    if (REFUSED_REASONS.has(state?.reason)) return state;
    // The box names a merge already made (merged, partial) ahead of the gate; the guard still asks
    // the gate, so a landing PR with no read is refused in this lane as in the ladder's.
    if (ledger && closeOutWaitsOn(ledger, landingPrs)) return blindReadMissingState(state, state.pr ?? null);
    // Fail-open on an unreadable PR does not throw, so it needs its own line: this
    // and the catch below are the only trace of how often the guard admits blind.
    if (prStatuses.some(s => s?.readable === false)) {
      console.warn('[close-out-readiness] PR unreadable, admitting:', issueIdentifier);
    }
    return null;
  } catch (err) {
    console.error('[close-out-readiness] guard read failed, admitting:', err?.message || err);
    return null;
  }
}
