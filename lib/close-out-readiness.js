// The close-out read chain, in one place (LIN-3634).
//
// The check route (`POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/check`,
// LIN-3248) re-reads a task's PRs live and derives the close-out state. LIN-3418 step 2
// ("re-derive readiness server-side on the press") was dropped because that chain lived
// inside the route's closure, so the dispatch path could not call it. Lifted here, every
// caller shares one read chain, and `closeOutDecision` (lib/run-closeout-state.js,
// LIN-4460) is the only close-out decision: both guard lanes below render its refusal and
// decide nothing themselves.

import { landingPrRefs } from './run-evidence.js';
import { readPrStatusOf } from './github-pr-status.js';
import { trailForTicket } from './task-standing.js';
import { deriveCloseOutState, blindReadMissingState, closeOutRefusalCopy, CLOSE_OUT_ACTOR, CLOSE_OUT_REASON } from './run-closeout-state.js';
import { readOpenFindings, findingsNotRead } from './close-out-findings.js';
import { readTaskRunFacts } from './task-run-facts.js';
import { resolveIssueBinding } from './workspace.js';

/** The 409 code a stale close-out press is refused with. Distinct from CLOSE_OUT_IS_THE_PERSONS / CLOSE_OUT_ALREADY_MERGED. */
export const CLOSE_OUT_NOT_READY_CODE = 'CLOSE_OUT_NOT_READY';

// Live status of each PR asked for, one per PR in the order asked (the ci-wake sweep reads one).
// The close-out chain keys them by URL at the read (LIN-4458). LIN-3443: a bound repo is
// read with the workspace's own token. Fail open: an unreadable PR is "unknown",
// never a 500.
// LIN-3285: a Linear- or Jira-bound workspace (`providerKind`) reads with the
// owner's GitHub App installation token (`installationTokenFor`). The resolve
// runs per PR, here, so `closeOutNotReady`'s stop-at check (which runs first)
// still pays no GitHub call for an ordinary ladder close-out (its one comment
// read, LIN-4438, needs no token).
export function readPrStatuses({ prUrls, callScope, workspace, seam, prStatusCache, providerKind = null, workspaceId = null, installationTokenFor = null }) {
  // LIN-4515: the per-PR read is readPrStatusOf, the one path every PR-state reader shares (lib/github-pr-status.js).
  return Promise.all(prUrls.map(async ({ repo, number }) => {
    try {
      return await readPrStatusOf({ repo, number, callScope, workspace, seam, prStatusCache, providerKind, workspaceId, installationTokenFor });
    } catch (err) {
      return { repo, readable: false, state: 'unknown', reason: err?.message || 'not checked' };
    }
  }));
}

/** The ticket's trail from records (lib/task-standing.js trailForTicket); throws when it cannot be read, so no caller decides on none. */
async function recordsTrailOf({ recordsStore, workspace, issueIdentifier }) {
  const trail = await trailForTicket({ recordsStore, urlKey: workspace?.urlKey, ticket: issueIdentifier });
  if (!trail) throw new Error(`the ticket's records could not be read (${workspace?.urlKey} ${issueIdentifier})`);
  return trail;
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
 * comments → the trail (review, landing) → each landing PR's status → stop-at → `deriveCloseOutState`.
 *
 * LIN-4458: the PRs are the landing's (the records trail, lib/task-standing.js trailForTicket), the same list the box counts,
 * so the stop-at guard, the owner's check and the merge recorder decide from the PRs the gate reads,
 * never every PR ever cited. `prStatuses` is keyed by PR URL. LIN-4460: `actor` is who asks: the
 * owner's check is `'person'` (the only actor that may set Done), every Harbour caller is `'harbour'`.
 *
 * @param {Object} args
 * @param {Object} args.workspace
 * @param {string} args.issueIdentifier
 * @param {string|null} [args.source] - the issue's provider-kind `issueSource`
 * @param {Object} [args.store] - dispatch queue store, for the default stop-at read
 * @param {Object} [args.seam] - the `closeOut` test seam
 * @param {boolean} args.runnerReady
 * @param {boolean} args.owner
 * @param {('person'|'harbour')} args.actor - who asks (lib/run-closeout-state.js CLOSE_OUT_ACTOR)
 * @param {Map} [args.prStatusCache] - a cache for the PR reads; omitted → the reader's shared 60 s cache
 * @param {('pr'|null)} [args.stopAt] - already read by the caller; omitted → read here, after the ledger
 * @param {Function} [args.installationTokenFor] - LIN-3285: the owner-installation token seam
 * @returns {Promise<{provider, callScope, prs, prStatuses: Map<string, Object>, ledger, landingPrs, stopAt, state}>}
 */
export async function readCloseOutChain({ workspace, issueIdentifier, source = null, store, seam = {}, runnerReady, owner, actor, prStatusCache, stopAt: knownStopAt, installationTokenFor = null, recordsStore = null, openFindings = null }) {
  const { provider, callScope } = (seam.resolveProvider || resolveIssueBinding)(workspace, source);

  // LIN-4518 step 3: the review, the latest blind read and the landing come from the ticket's records (lib/task-standing.js), not
  // from its comments. The decision takes the trail whole. An unread ticket throws: a close-out never reads as "no review".
  const trail = await recordsTrailOf({ recordsStore, workspace, issueIdentifier });
  const { review, landing } = trail;
  // LIN-4495: the open findings to close-out, read once per chain (a caller that holds the reading passes it, or the
  // `seam.openFindings` test seam does; production passes the records store).
  const findings = openFindings || seam.openFindings || await readOpenFindings({
    store: recordsStore, urlKey: workspace?.urlKey, ticket: issueIdentifier,
  });
  const prs = landingPrRefs(landing);
  const read = await readPrStatuses({
    prUrls: prs, callScope, workspace, seam, prStatusCache,
    providerKind: provider?.name, workspaceId: workspace?.id, installationTokenFor,
  });
  // Keyed by URL here, at the read, over the very list it was asked for: nothing downstream lines a
  // status up with a PR by position.
  const prStatuses = new Map(prs.map((pr, i) => [pr.url, read[i]]));

  const stopAt = knownStopAt !== undefined
    ? knownStopAt
    : await readStopAt({ workspace, issueIdentifier, seam, store });
  const state = deriveCloseOutState({
    prs,
    prStatuses,
    landingPrs: landing,
    review,
    runnerReady,
    owner,
    stopAt,
    actor,
    openFindings: findings,
  });
  return { provider, callScope, prs, prStatuses, ledger: review, landingPrs: landing, stopAt, state, openFindings: findings };
}

/**
 * The 409 body for a refused close-out (LIN-3657), as `jsonError(res, 409, error, extra)`
 * takes it. One source for the dispatch lane (LIN-3634) and the press route, so the two
 * refusals cannot drift. The reason and its error text come from the decision's reason table
 * (lib/run-closeout-state.js CLOSE_OUT_REASONS, LIN-4460): `head-moved` or `blind-read-missing`. Open findings to close-out
 * never refuse a dispatch (LIN-4495), so they have no refusal copy.
 */
export function closeOutNotReadyRefusal(state) {
  return {
    error: closeOutRefusalCopy(state?.reason) ?? String(state?.message || ''),
    extra: { code: CLOSE_OUT_NOT_READY_CODE, reason: state?.reason ?? null, state },
  };
}

/**
 * The ladder lane's answer (LIN-4438): an ordinary close-out on a task that does not stop at the PR. One records read of
 * the trail (LIN-4518 step 3), and no PR read, so the decision sees the landing with no status: its one refusal here is
 * the gate (`blind-read-missing`). No review on record admits (LIN-3497).
 */
async function ladderNotReady({ workspace, issueIdentifier, recordsStore }) {
  const { review, landing } = await recordsTrailOf({ recordsStore, workspace, issueIdentifier });
  // LIN-4495: open findings to close-out hold readiness, never the dispatch (close-out ends them), and the gate
  // (`blind-read-missing`) is the only refusal here, so no findings read is made: the decision needs a reading to
  // exist, and this fixed one is never consulted for the refusal.
  const state = deriveCloseOutState({
    landingPrs: landing, review, actor: CLOSE_OUT_ACTOR.HARBOUR,
    openFindings: findingsNotRead('the ladder guard refuses on the blind read only and reads no findings'),
  });
  if (state.refuses === CLOSE_OUT_REASON.BLIND_READ_MISSING) return blindReadMissingState(state, null);
  return null;
}

/**
 * The server-side readiness guard for a close-out dispatch (LIN-3634, LIN-4438). Answers
 * the state when the dispatch must be refused, else `null`. Never throws: every unreadable
 * read admits, and logs.
 *
 * `stopAt` is read FIRST, from the store alone. Then one of two lanes:
 *   - stop-at-PR: the whole chain (comments, the landing PRs' live status, the review) through
 *     `deriveCloseOutState`, refusing whatever the decision refuses (`head-moved`, or the gate). Open findings to
 *     close-out never refuse here: close-out is the stage that ends them (LIN-4495);
 *     the PR reads use a fresh Map, so the guard sees the live head rather than the shared 60 s
 *     cache and writes nothing into it;
 *   - the ordinary ladder: one store read (`stopAt`) and ONE comment read, no PR, GitHub or records read,
 *     refusing the gate only (LIN-4438).
 */
export async function closeOutNotReady({ workspace, issueIdentifier, source = null, store, seam = {}, installationTokenFor = null, recordsStore = null, openFindings = null }) {
  try {
    const stopAt = await readStopAt({ workspace, issueIdentifier, seam, store });
    if (stopAt !== 'pr') return await ladderNotReady({ workspace, issueIdentifier, recordsStore });
    const { state, prStatuses } = await readCloseOutChain({
      workspace, issueIdentifier, source, store, seam, stopAt, installationTokenFor,
      runnerReady: true, owner: true, actor: CLOSE_OUT_ACTOR.HARBOUR,
      prStatusCache: new Map(), recordsStore, openFindings,
    });
    if (state.refuses === CLOSE_OUT_REASON.HEAD_MOVED) return state;
    if (state.refuses === CLOSE_OUT_REASON.BLIND_READ_MISSING) return blindReadMissingState(state, state.pr ?? null);
    // Fail-open on an unreadable PR does not throw, so it needs its own line: this
    // and the catch below are the only trace of how often the guard admits blind.
    if ([...prStatuses.values()].some(s => s?.readable === false)) {
      console.warn('[close-out-readiness] PR unreadable, admitting:', issueIdentifier);
    }
    return null;
  } catch (err) {
    console.error('[close-out-readiness] guard read failed, admitting:', err?.message || err);
    return null;
  }
}
