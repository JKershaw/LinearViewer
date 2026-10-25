// Merged close-out events, in one place (LIN-3756).
//
// The writer of the merged event (`mergedEventFor` / `recordMergedPrs`) used to be
// two closures inside the workspace-API router, so only the signed-in task page's
// PR check could call it and a pipeline merge never recorded one (LIN-3734: 0
// events after nine merges). Lifted here, the check route and the Done writes
// (`createPipelineMergeRecorder`: the proxy's, and the person's on the task-edit
// path, LIN-3863) share one writer and one event shape.

import { readCloseOutChain } from './close-out-readiness.js';
import { readPrStatusFailOpen } from './github-pr-status.js';
import { ticketFromWrite } from './ticket-close-closer.js';
import { resolveWorkspaceIdMapFromSessions } from './credential-invariant-sweep.js';
import { findWorkspaceByUrlKey } from './workspace-lookup.js';

const LOG = '[close-out-merges]';

// The PR head the reader saw, or null.
function statusHeadSha(status) {
  return status?.readable === true ? (status.head?.sha || status.ref || null) : null;
}

// The open-ledger-item counts at merge: review-ledger items not yet
// discharged, by scope. Content-free — counts only (the audit trail says what
// "Done" meant).
function countOpenLedgerItems(review) {
  const open = (review?.ledger?.items || []).filter((item) => item && !item.discharged);
  const inScope = (scope) => open.filter((item) => item.scope === scope).length;
  const inside = inScope('inside');
  const outside = inScope('outside');
  return { inside, outside, unknown: open.length - inside - outside, total: open.length };
}

// The stored merged event for one merged PR: the one already on record, or one
// recorded now. LIN-3395: one event per merge — reusing the stored one matters
// because re-deriving `by` (a press row stored after the merge) would flip it,
// and `by` is part of the idempotency key, so a second merged event and a
// second Done write would follow. Without an events store there is no event.
// `unpressedBy` (LIN-3756) is the `by` of a merge with no press on record: the
// task-page check's own rule is 'person'; the pipeline's Done write passes 'close-out'.
async function mergedEventFor({ store, workspace, accountId, issueIdentifier, pr, headSha, openItems, prOpenedAt, prMergedAt, unpressedBy = 'person' }) {
  if (!store) return null;
  const { urlKey } = workspace;
  const stored = await store.findMergedByPr({ urlKey, prUrl: pr.url });
  if (stored) return stored;
  // F1/F4: a press recorded for this PR at ANY head means the close-out worker
  // merged it, not "you" (the head is dropped from the lookup so a push between
  // the press and the merge cannot hide the press).
  const pressed = await store.findAnyByPr({ urlKey, prUrl: pr.url, by: 'press' });
  return store.record({
    accountId,
    urlKey,
    issueId: null,
    issueIdentifier,
    by: pressed ? 'close-out' : unpressedBy,
    prUrl: pr.url,
    headSha,
    merged: true,
    openItems,
    // LIN-3713: the forge's own times, written on this first sighting only
    // (the `stored` return above means a repeat check never rewrites them).
    prOpenedAt,
    prMergedAt,
  });
}

/**
 * The check's merge bookkeeping: one stored merged event per merged PR, as
 * `recorded` entries, plus the first of them and its PR's index.
 *
 * @param {Object} args
 * @param {Object} args.store - the CloseOutEventsStore (null → nothing is recorded)
 * @param {string} [args.unpressedBy='person'] - `by` for a merge with no press on record
 */
export async function recordMergedPrs({ store, workspace, accountId, issueIdentifier, prUrls, prStatuses, ledger, unpressedBy = 'person' }) {
  const openItems = countOpenLedgerItems(ledger);
  const recorded = [];
  let first = { mergedEvent: null, mergedPrIndex: -1 };
  for (const [index, pr] of prUrls.entries()) {
    const status = prStatuses[index];
    if (status?.readable !== true || status.merged !== true) continue;
    const event = await mergedEventFor({ store, workspace, accountId, issueIdentifier, pr, headSha: statusHeadSha(status), openItems, prOpenedAt: status.created_at, prMergedAt: status.merged_at, unpressedBy });
    if (!event) continue;
    recorded.push({ id: event._id, by: event.by, prUrl: event.prUrl, headSha: event.headSha });
    if (!first.mergedEvent) first = { mergedEvent: event, mergedPrIndex: index };
  }
  return { recorded, ...first };
}

/**
 * A `resolveWorkspaceId(urlKey)` over the live sessions, for a legacy proxy token
 * that carries no workspace id. Session-bound like the ci-wake-sweep's resolver:
 * null when no live session names the workspace.
 */
export function createSessionWorkspaceIdResolver({ sessionsCollection, now = Date.now } = {}) {
  return async (urlKey) => {
    const sessions = await sessionsCollection.find({}).toArray();
    const list = [...resolveWorkspaceIdMapFromSessions(sessions, now()).values()];
    return findWorkspaceByUrlKey(list, urlKey)?.id ?? null;
  };
}

/**
 * LIN-3756: records the merge when the pipeline sets a task Done through the proxy.
 * The close-out worker merges and then writes Done; this reads the task's PRs at
 * that write and records each merged one, through the same writer the task-page
 * check uses. It acts only on a `completed` ticket, reads PR status only with a
 * GitHub token (no link, no read, nothing recorded), uses a fresh PR cache so a
 * pre-merge `open` read cannot hide the merge, and never throws.
 *
 * @param {Object} deps
 * @param {Object} deps.closeOutEventsStore
 * @param {Object} deps.dispatchStore - for the stop-at read
 * @param {Function} [deps.installationTokenFor] - the owner-installation token seam (LIN-3285)
 * @param {Function} [deps.resolveWorkspaceId] - `(urlKey) => id|null`, when the write carries none
 * @param {Function} [deps.githubFetch] - fetch seam for the PR reads
 * @param {Function} [deps.readPrStatus] - PR reader seam (defaults to the fail-open reader)
 * @param {Function} [deps.now]
 * @returns {Function} `async ({urlKey, workspaceId, accountId, provider, callScope, source, written, readBack, writer}) => {recorded}`
 *   where `writer` is who wrote the Done: `'pipeline'` (the default, seam 1) or `'person'` (seam 2, LIN-3863).
 */
export function createPipelineMergeRecorder({
  closeOutEventsStore, dispatchStore, installationTokenFor = null, resolveWorkspaceId = null,
  githubFetch = null, readPrStatus = readPrStatusFailOpen, now = Date.now, log = (m) => console.error(m),
} = {}) {
  // No token → no read at all: an anonymous status read is never made for this.
  const tokenGatedRead = (args) => (args?.token
    ? readPrStatus(args)
    : { repo: args?.repo, readable: false, state: 'unknown', reason: 'no GitHub link' });

  return async function recordPipelineMerge({ urlKey, workspaceId = null, accountId = null, provider, callScope, source = null, written, readBack, writer = 'pipeline' } = {}) {
    const none = { recorded: [] };
    try {
      if (!closeOutEventsStore || !urlKey || !provider) return none;
      const ticket = await ticketFromWrite(written, { readBack });
      if (ticket?.stateType !== 'completed') return none;

      let id = workspaceId;
      if (!id && resolveWorkspaceId) id = await resolveWorkspaceId(urlKey).catch(() => null);
      const workspace = { urlKey, id: id ?? null };
      if (!workspace.id) log(`${LOG} no workspace id for ${urlKey}: the owner-installation PR read is skipped`);

      const { prUrls, prStatuses, ledger, stopAt } = await readCloseOutChain({
        workspace,
        issueIdentifier: ticket.identifier,
        source,
        store: dispatchStore,
        // Mirrors closeOutNotReady's flags: the derived state is not used here, only the reads.
        runnerReady: true,
        owner: true,
        byPersonCheck: true,
        installationTokenFor,
        prStatusCache: new Map(),
        seam: { resolveProvider: () => ({ provider, callScope }), githubFetch, readPrStatus: tokenGatedRead },
      });

      const merges = await recordMergedPrs({
        store: closeOutEventsStore,
        workspace,
        accountId,
        issueIdentifier: ticket.identifier,
        prUrls,
        prStatuses,
        ledger,
        // A person's Done (LIN-3863) and a stop-at-PR task keep the check route's
        // rule (person unless pressed); a pipeline Done on an ordinary task is close-out.
        unpressedBy: writer === 'person' || stopAt === 'pr' ? 'person' : 'close-out',
      });

      // This Done is the Done for that merge: without the stamp a later person PR
      // check on a stop-at-PR task would see a merged, unstamped event and write
      // Done again (F2, once per merge). Ordinary tasks never read `doneAt`.
      const { mergedEvent } = merges;
      if (stopAt === 'pr' && mergedEvent && !mergedEvent.doneAt) {
        await closeOutEventsStore.stampDone({
          urlKey, prUrl: mergedEvent.prUrl, headSha: mergedEvent.headSha, by: mergedEvent.by, doneAt: now(),
        });
      }
      return { recorded: merges.recorded };
    } catch (err) {
      log(`${LOG} ${urlKey}: ${err?.message || err}`);
      return none;
    }
  };
}
