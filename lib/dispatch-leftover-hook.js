/**
 * The leftover step's hook (LIN-4373): the I/O half of `lib/dispatch-leftover.js`.
 *
 * Built ONCE in server.js and handed to both feedback entrances
 * (`routes/proxy-runner.js` and the dispatch-token route in `routes/dispatch.js`), so the
 * two decide and enqueue the same way. Each request asks `forRequest` for a hook bound to
 * its own base URL (`publicOrigin(req)`) and, where the request has it, its workspace id;
 * `addFeedback` calls that hook for every wake event, between building the wake and
 * delivering it (`_applyWakeHook`, lib/dispatch-store.js). The store keeps generic
 * held-wake primitives keyed on `heldWakeFor` (hold, claim, release, the stopped-run
 * cleanup) and knows no leftovers; what a leftover is, and what its wake says, is here.
 *
 * The hook answers in the store's words: `withhold` (after `enqueueFollowUp` returned
 * 200, or a hold) withholds the build's wake, with the reason `held-for-leftover
 * (queued|hold)`; `rewrite` rewords a wake the plan already owed (the outcome wake,
 * `outcomeWake` below); `skipped` lets it go ahead. What is held is the build's terminal
 * wake: while the step runs, a `[pending]` park in its lineage still wakes the parent at
 * once, labelled as the leftover step with the build's `[done]` and PR in hand. Every
 * other path, including a thrown hook, wakes the parent exactly as before this step
 * existed, and logs one searchable line: `[leftover] skipped reason=<why> item=<id>`
 * (a `[pending]` outside a held lineage returns quietly).
 *
 * Two `[done]` posts on the same row landing within the same moment both read "no
 * leftover row yet". Only the one that wins `claimHeldWake` (a compare-and-set on the
 * row's `HELD_WAKE_CLAIMED_AT` stamp) goes on to queue; the other withholds as a hold, so
 * exactly one leftover row is queued and the build wakes once (LIN-4375). If the winner
 * then skips (no base URL, no workspace, a refused enqueue), it first gives the claim
 * back (`releaseHeldWakeClaim`) and then its own wake goes ahead, which is the one wake
 * owed. The release matters because that wake is not always minted: `_deliverWake`
 * withdraws it on a transient fault (a declaration read, the parent's status, a
 * `grant-mint-transient` provisioner answer) for the runner's re-report to retry, and an
 * owner-check outage refuses the enqueue and the mint together. A claim still stamped
 * would make that re-report answer `hold claim-lost` with no leftover row to release it,
 * and the parent would never wake. Released, the re-report decides afresh: it queues the
 * step, or skips and wakes the parent, and `_mintWake`'s CAS keeps that to one wake. A
 * concurrent loser that already held is covered by the winner's own wake.
 *
 * Residuals, named: a server that dies between the claim and the enqueue, or a release
 * whose write fails (logged `[held-wake] claim-release-failed`), leaves the claimed build's
 * wake held with no leftover row to release it. And a second `[done]` that lands in the
 * moment between a skipping winner's release and its wake being minted can queue a
 * leftover row beside that wake, so the parent hears from the build and, later, from the
 * leftover step; it is the pre-claim behaviour, narrowed to that window.
 */
import { decideLeftover, leftoverPrompt, producingRowIneligibility } from './dispatch-leftover.js';
import { LEFTOVER_KIND } from './dispatch-fields.js';
import { enqueueFollowUp } from './follow-up-dispatch.js';
import { buildWakeFollowUp, formatHeldWakeNote, formatLeftoverPendingNote, withHeldWakeNote, prUrlOfFeedback } from './dispatch-wake.js';
import { deriveTerminalStatus, findWakeEvent } from './dispatch-terminal.js';

/**
 * Adapt a `createTickWorkspaceResolver` (lib/ci-wake-sweep.js) to the one question the
 * hook asks at a request with no workspace id (the dispatch-token route): which workspace
 * is this urlKey, for this account? Resets the resolver per call, because a request is not
 * a tick: nothing is memoised across feedback posts.
 *
 * @param {{resolve: Function, reset?: Function}} resolver
 * @param {() => number} [now]
 * @returns {(urlKey: string, dispatchedBy: string|null) => Promise<string|null>}
 */
export function workspaceIdResolverFrom(resolver, now = Date.now) {
  return async (urlKey, dispatchedBy) => {
    resolver.reset?.(now());
    const resolved = await resolver.resolve(urlKey, { dispatchedBy });
    return resolved?.workspaceId ?? null;
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.dispatchStore - `readFollowUpChain`, `findIssueRowsOfKind`, `claimHeldWake`, `releaseHeldWakeClaim`, `isRunStopped`, `setHeldWakeReleaseNote` (called once, here)
 * @param {Object} deps.workspacePreferencesStore
 * @param {Object} deps.proxyTokenStore
 * @param {Function} deps.ownerCheck - the hoisted workspace-owner seam (LIN-3383)
 * @param {(urlKey: string) => Promise<Object|null>} [deps.haltReader] - the workspace halt
 * @param {(urlKey: string, dispatchedBy: string|null) => Promise<string|null>} [deps.resolveWorkspaceId]
 * @param {Function} [deps.enqueue] - `enqueueFollowUp` seam
 * @param {Function} [deps.log]
 * @returns {{forRequest: (ctx: {baseUrl: string|null, workspaceId?: string|null}) => Function, releaseNote: (args: {status: string}) => string}}
 *   `forRequest`'s hook carries the same `releaseNote`; the step also binds it into
 *   `dispatchStore` (`setHeldWakeReleaseNote`) when built.
 */
export function createLeftoverStep({
  dispatchStore,
  workspacePreferencesStore = null,
  proxyTokenStore = null,
  ownerCheck = null,
  haltReader = null,
  resolveWorkspaceId = null,
  enqueue = enqueueFollowUp,
  log = console.log
} = {}) {
  if (!dispatchStore) throw new Error('leftover step: dispatchStore is required');

  const readHalt = async (urlKey) => {
    if (!haltReader) return null;
    try {
      return await haltReader(urlKey);
    } catch {
      return null; // the store's own halt read fails open the same way (LIN-4080)
    }
  };
  const runStopped = async (urlKey, runId) => {
    if (!runId) return false;
    try {
      return (await dispatchStore.isRunStopped(urlKey, runId)) === true;
    } catch {
      return false; // the wake gate still applies at delivery
    }
  };

  /**
   * The outcome wake (moved here from the store by LIN-4383): in a
   * leftover step's lineage (the held row itself, or its ci-wake `custom` continuation:
   * `heldWakeHolderOf`), a non-`[done]` terminal wakes the parent with the BUILD's
   * outcome and PR plus one line naming what happened to the step
   * (`formatHeldWakeNote({marker})`), and a `[pending]` opens with a line naming the
   * step and the build's `[done]` and PR already in hand (`formatLeftoverPendingNote`).
   * The guard key stays the producing row's own, so it still wakes once.
   *
   * Reads nothing unless the plan owes a wake and the marker is `[pending]` or a
   * non-`[done]` terminal. A faulted build read is logged and keeps the row's own wake.
   *
   * @returns {Promise<{outcome: 'rewrite', wakeFollowUp: Object}|null>}
   */
  const outcomeWake = async ({ urlKey, doc, entry, marker, wakeFollowUp, edgeDoc }) => {
    if (!wakeFollowUp || (marker !== 'pending' && deriveTerminalStatus([entry]) === 'done')) return null;
    try {
      const holder = await dispatchStore.heldWakeHolderOf(urlKey, doc);
      const build = holder ? await dispatchStore.heldWakeProducerOf(urlKey, holder) : null;
      if (!build) return null;
      if (marker === 'pending') {
        const note = formatLeftoverPendingNote({
          message: entry.message,
          buildOutcome: findWakeEvent(build.feedback || [])?.entry?.message ?? null,
          prUrl: prUrlOfFeedback(build.feedback)
        });
        return { outcome: 'rewrite', wakeFollowUp: { ...wakeFollowUp, prompt: `${note}\n\n${wakeFollowUp.prompt}` } };
      }
      const buildWake = buildWakeFollowUp(edgeDoc, build.feedback || []);
      if (!buildWake) return null;
      const note = formatHeldWakeNote({ marker, message: entry.message });
      return { outcome: 'rewrite', wakeFollowUp: withHeldWakeNote(buildWake, note, prUrlOfFeedback(build.feedback)) };
    } catch (err) {
      console.error(`[leftover] build read for the outcome wake failed item=${doc._id}:`, err?.message || err);
      return null;
    }
  };

  // The store's withhold reason, byte-identical to the one it wrote before LIN-4383.
  const withhold = (as, extra = {}) => ({ outcome: 'withhold', reason: `held-for-leftover (${as})`, ...extra });

  // LIN-4455: what a held wake's release says when the leftover row never ran (cancelled
  // or expired). The step owns this wording, not the store. It reaches the store two ways:
  // bound late here, once, for the releases that have no request (cancel, expiry, the
  // stopped-run cleanup), and as each request hook's `releaseNote` for the re-release
  // `_applyWakeHook` makes. Binding at construction means every store that has a leftover
  // step speaks for it, in server.js and in tests alike.
  const releaseNote = ({ status }) => formatHeldWakeNote({ status });
  dispatchStore.setHeldWakeReleaseNote(releaseNote);

  return {
    releaseNote,
    forRequest({ baseUrl = null, workspaceId = null } = {}) {
      const hook = async ({ urlKey, doc, entry, marker = null, wakeFollowUp = null, edgeDoc = null, alreadyWoken = false }) => {
        const skip = (reason) => {
          log(`[leftover] skipped reason=${reason} item=${doc?._id}`);
          return { outcome: 'skipped', reason };
        };
        const rewrite = await outcomeWake({ urlKey, doc, entry, marker, wakeFollowUp, edgeDoc });
        // A [pending] is never a leftover step's start: answer the rewrite, or nothing, quietly.
        if (marker === 'pending') return rewrite ?? { outcome: 'skipped', reason: 'pending' };

        // Cheap checks on the row itself first: an ordinary [failed], a leftover's own
        // [done] or a ticketless row reads nothing. A rewrite only ever lands here (it
        // needs a non-[done] terminal), and still logs its skip line as before.
        const early = producingRowIneligibility(doc, entry);
        if (early) {
          const skipped = skip(early);
          return rewrite ?? skipped;
        }

        const chain = await dispatchStore.readFollowUpChain(urlKey, doc);
        const root = chain[chain.length - 1];
        const leftoverRows = await dispatchStore.findIssueRowsOfKind(urlKey, doc.issueIdentifier, LEFTOVER_KIND);
        const parentRun = root?.sessionId && root.sessionId !== root._id ? root.sessionId : null;
        const decision = decideLeftover({
          doc,
          entry,
          chain,
          leftoverRows,
          halt: await readHalt(urlKey),
          parentStopped: await runStopped(urlKey, parentRun),
          alreadyWoken
        });
        if (decision.outcome === 'hold') {
          log(`[leftover] hold item=${doc._id} ${decision.reason}`);
          return withhold('hold', { release: decision.release });
        }
        if (decision.outcome !== 'queue') return skip(decision.reason);

        // A concurrent [done] on this row already claimed the step: its leftover row (or,
        // if it skips, its own wake) is the one owed, so this post holds.
        if (!(await dispatchStore.claimHeldWake(urlKey, doc._id))) {
          log(`[leftover] hold item=${doc._id} claim-lost`);
          return withhold('hold', { release: null });
        }
        // From here on this post holds the claim, and every skip gives it back first (see
        // the header): its wake may yet be withdrawn, and the re-report must claim again.
        const skipClaimed = async (reason) => {
          await dispatchStore.releaseHeldWakeClaim(urlKey, doc._id);
          return skip(reason);
        };

        if (!baseUrl) return skipClaimed('no-base-url');
        const dispatchedBy = root.dispatchedBy ?? null;
        let ownerWorkspaceId = workspaceId;
        if (!ownerWorkspaceId && resolveWorkspaceId) {
          ownerWorkspaceId = await resolveWorkspaceId(urlKey, dispatchedBy).catch(() => null);
        }
        if (!ownerWorkspaceId) return skipClaimed('no-workspace');

        const result = await enqueue({
          dispatchQueueStore: dispatchStore,
          workspacePreferencesStore,
          proxyTokenStore,
          urlKey,
          prompt: leftoverPrompt({ issueIdentifier: doc.issueIdentifier, prUrl: decision.prUrl }),
          baseUrl,
          dispatchedBy,
          ownerCheck,
          workspaceId: ownerWorkspaceId,
          followUpTo: doc._id,
          target: doc.target || 'cli',
          // The build has just posted its terminal: a session not yet flipped from
          // ACTIVE must not answer `session-busy`.
          force: true,
          sessionId: root.sessionId ?? root._id,
          kind: LEFTOVER_KIND,
          heldWakeFor: doc._id
        }).catch((err) => ({ status: 500, body: { error: err?.message || String(err) } }));

        if (result?.status !== 200) {
          return skipClaimed(`enqueue-${result?.status ?? 'none'}:${result?.body?.code || result?.body?.error || 'unknown'}`);
        }
        log(`[leftover] queued item=${doc._id} leftover=${result.body?.itemId} issue=${doc.issueIdentifier}`);
        return withhold('queued', { leftoverId: result.body?.itemId ?? null });
      };
      hook.releaseNote = releaseNote;
      return hook;
    }
  };
}
