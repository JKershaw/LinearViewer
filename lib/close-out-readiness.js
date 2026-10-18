// The close-out read chain, in one place (LIN-3634).
//
// The check route (`POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/check`,
// LIN-3248) re-reads a task's PRs live and derives the close-out state with
// `deriveCloseOutState`. LIN-3418 step 2 ("re-derive readiness server-side on the
// press") was dropped because that chain lived inside the route's closure, so the
// dispatch path could not call it. Lifted here, both callers share one chain and
// `deriveCloseOutState` stays the only readiness predicate.

import { extractPrUrls } from './run-evidence.js';
import { readPrStatusFailOpen, prReadToken } from './github-pr-status.js';
import { readRunLedger } from './run-ledger.js';
import { deriveCloseOutState } from './run-closeout-state.js';
import { readTaskRunFacts } from './task-run-facts.js';
import { resolveIssueBinding } from './workspace.js';

/** The 409 code a stale close-out press is refused with. Distinct from CLOSE_OUT_IS_THE_PERSONS / CLOSE_OUT_ALREADY_MERGED. */
export const CLOSE_OUT_NOT_READY_CODE = 'CLOSE_OUT_NOT_READY';

// Live status of every PR the run's comments mention. LIN-3443: a bound repo is
// read with the workspace's own token. Fail open: an unreadable PR is "unknown",
// never a 500.
export function readPrStatuses({ prUrls, callScope, workspace, seam, prStatusCache }) {
  const readPrStatus = seam.readPrStatus || readPrStatusFailOpen;
  return Promise.all(prUrls.map(async ({ repo, number }) => {
    const token = prReadToken(callScope, repo);
    try {
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
 * @returns {Promise<{provider, callScope, prUrls, prStatuses, ledger, stopAt, state}>}
 */
export async function readCloseOutChain({ workspace, issueIdentifier, source = null, store, seam = {}, runnerReady, owner, byPersonCheck, prStatusCache, stopAt: knownStopAt }) {
  const { provider, callScope } = (seam.resolveProvider || resolveIssueBinding)(workspace, source);

  const comments = await provider.fetchIssueComments(callScope, issueIdentifier);
  const prUrls = extractPrUrls(comments);
  const prStatuses = await readPrStatuses({ prUrls, callScope, workspace, seam, prStatusCache });

  const ledger = readRunLedger(comments);
  const stopAt = knownStopAt !== undefined
    ? knownStopAt
    : await readStopAt({ workspace, issueIdentifier, seam, store });
  const state = deriveCloseOutState({
    prs: prUrls,
    prStatuses,
    review: ledger,
    runnerReady,
    owner,
    stopAt,
    byPersonCheck,
  });
  return { provider, callScope, prUrls, prStatuses, ledger, stopAt, state };
}

/**
 * The 409 body for a refused close-out (LIN-3657), as `jsonError(res, 409, error, extra)`
 * takes it. One source for the dispatch lane (LIN-3634) and the press route, so the two
 * refusals cannot drift.
 */
export function closeOutNotReadyRefusal(state) {
  return {
    error: 'The pull request changed since the review approved it',
    extra: { code: CLOSE_OUT_NOT_READY_CODE, reason: 'head-moved', state },
  };
}

/**
 * The server-side readiness guard for a close-out dispatch (LIN-3634). Answers the
 * derived state when the dispatch must be refused (a stop-at-PR task whose sole open
 * PR is `head-moved`), else `null`. Never throws: every unreadable read admits.
 *
 * `stopAt` is read FIRST, from the store alone: an ordinary ladder close-out (a task
 * that does not stop at the PR) returns before any provider or GitHub read, so it
 * pays one store read and nothing else. The PR reads use a fresh Map, so the guard
 * sees the live head rather than the shared 60 s cache and writes nothing into it.
 */
export async function closeOutNotReady({ workspace, issueIdentifier, source = null, store, seam = {} }) {
  try {
    const stopAt = await readStopAt({ workspace, issueIdentifier, seam, store });
    if (stopAt !== 'pr') return null;
    const { state, prStatuses } = await readCloseOutChain({
      workspace, issueIdentifier, source, store, seam, stopAt,
      runnerReady: true, owner: true, byPersonCheck: true,
      prStatusCache: new Map(),
    });
    if (state?.reason === 'head-moved') return state;
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
