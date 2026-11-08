/**
 * The leftover step's hook (LIN-4373): the I/O half of `lib/dispatch-leftover.js`.
 *
 * Built ONCE in server.js and handed to both feedback entrances
 * (`routes/proxy-runner.js` and the dispatch-token route in `routes/dispatch.js`), so the
 * two decide and enqueue the same way. Each request asks `forRequest` for a hook bound to
 * its own base URL (`publicOrigin(req)`) and, where the request has it, its workspace id;
 * `addFeedback` calls that hook between building a wake and delivering it
 * (`_applyLeftoverStep`, lib/dispatch-store.js).
 *
 * The hook answers `{outcome: 'queued'|'hold'|'skipped', ...}`. Only `queued` (after
 * `enqueueFollowUp` returned 200) and `hold` withhold the build's wake. What is held is
 * the build's terminal wake: while the step runs, a `[pending]` park in its lineage still
 * wakes the parent at once, labelled as the leftover step with the build's `[done]` and PR
 * in hand (lib/dispatch-store.js `_applyLeftoverStep`). Every other path,
 * including a thrown hook, wakes the parent exactly as before this step existed, and logs
 * one searchable line: `[leftover] skipped reason=<why> item=<id>`.
 *
 * Residual, named: two `[done]` posts on the same row landing within the same moment can
 * each read "no leftover row yet" and each queue one. A LIN-3805 re-report comes after a
 * fault, by which time the first row exists, so this is not guarded with a claim write.
 */
import { decideLeftover, leftoverPrompt, producingRowIneligibility } from './dispatch-leftover.js';
import { LEFTOVER_KIND } from './dispatch-fields.js';
import { enqueueFollowUp } from './follow-up-dispatch.js';

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
 * @param {Object} deps.dispatchStore - `readFollowUpChain`, `findLeftoverRows`, `isRunStopped`
 * @param {Object} deps.workspacePreferencesStore
 * @param {Object} deps.proxyTokenStore
 * @param {Function} deps.ownerCheck - the hoisted workspace-owner seam (LIN-3383)
 * @param {(urlKey: string) => Promise<Object|null>} [deps.haltReader] - the workspace halt
 * @param {(urlKey: string, dispatchedBy: string|null) => Promise<string|null>} [deps.resolveWorkspaceId]
 * @param {Function} [deps.enqueue] - `enqueueFollowUp` seam
 * @param {Function} [deps.log]
 * @returns {{forRequest: (ctx: {baseUrl: string|null, workspaceId?: string|null}) => Function}}
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

  return {
    forRequest({ baseUrl = null, workspaceId = null } = {}) {
      return async ({ urlKey, doc, entry, alreadyWoken = false }) => {
        const skip = (reason) => {
          log(`[leftover] skipped reason=${reason} item=${doc?._id}`);
          return { outcome: 'skipped', reason };
        };
        // Cheap checks on the row itself first: an ordinary [failed], a leftover's own
        // [done] or a ticketless row reads nothing.
        const early = producingRowIneligibility(doc, entry);
        if (early) return skip(early);

        const chain = await dispatchStore.readFollowUpChain(urlKey, doc);
        const root = chain[chain.length - 1];
        const leftoverRows = await dispatchStore.findLeftoverRows(urlKey, doc.issueIdentifier);
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
          return { outcome: 'hold', reason: decision.reason, release: decision.release };
        }
        if (decision.outcome !== 'queue') return skip(decision.reason);

        if (!baseUrl) return skip('no-base-url');
        const dispatchedBy = root.dispatchedBy ?? null;
        let ownerWorkspaceId = workspaceId;
        if (!ownerWorkspaceId && resolveWorkspaceId) {
          ownerWorkspaceId = await resolveWorkspaceId(urlKey, dispatchedBy).catch(() => null);
        }
        if (!ownerWorkspaceId) return skip('no-workspace');

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
          return skip(`enqueue-${result?.status ?? 'none'}:${result?.body?.code || result?.body?.error || 'unknown'}`);
        }
        log(`[leftover] queued item=${doc._id} leftover=${result.body?.itemId} issue=${doc.issueIdentifier}`);
        return { outcome: 'queued', leftoverId: result.body?.itemId ?? null };
      };
    }
  };
}
