/**
 * The one enqueue helper for a parked-only (`ifParked`) abort (LIN-3436, slice
 * H0 of LIN-3358).
 *
 * LIN-3358 ends a session that is PARKED on a ticket that has gone terminal by
 * asking the consumer to abort it, instead of stamping the Harbour row closed.
 * This helper is the single place that writes that request, so the LIN-3383
 * census can bound it with one `system-derived` row instead of gating every
 * seam file:
 *
 *  - the target is derived from the ticket's own lineages by the caller, never
 *    supplied by whoever moved the ticket;
 *  - the row is `abort:true, ifParked:true`, so the consumer cancels the
 *    session only if it is parked and otherwise acks `[skipped] not parked`
 *    (see `lib/runner-kit/runner.mjs` `abortAction`); an `ifParked` abort can
 *    therefore only end a session whose latest runner-kit park
 *    (`[blocked]`/`[pending]` feedback) has not been followed by a continued
 *    follow-up;
 *  - it is enqueued only when the workspace's consumer advertised `if-parked`
 *    (`workspaceConsumerAdvertises`), because a consumer that did not would run
 *    a plain abort. The delivery gate in `pollAvailable` backs that up for a
 *    consumer swap after enqueue.
 *
 * Authority to move the ticket terminal is therefore sufficient authority to
 * call this; the census (`tests/unit/lin-3383-runner-enqueue-census.test.js`)
 * records that bound and fails if this helper's `createDispatchItem(` call loses
 * `ifParked: true`, or if the helper is called from anywhere but the
 * ticket-write and park-time paths.
 *
 * Callers (pinned by the census): lib/ticket-close-closer.js (ticket write) and
 * the two runner feedback routes (park time).
 */
import { createDispatchItem } from './dispatch-factory.js';
import { workspaceConsumerAdvertises, CAP_IF_PARKED } from './consumer-caps.js';

/**
 * @param {Object} params
 * @param {Object} params.store - dispatch queue store (`addItem`)
 * @param {string} params.urlKey - workspace URL key
 * @param {string} params.abortTo - dispatch id of the session to end
 * @param {string} [params.target='cli'] - the abort row's OWN poll-eligible target
 * @param {string|null} [params.issueIdentifier]
 * @param {string|null} [params.dispatchedBy]
 * @param {Object} [params.dispatchTokenStore] - for the `consumerLastSeenAt` stamp
 * @param {Object} [params.proxyTokenStore]
 * @param {(urlKey: string, cap: string) => boolean} [params.advertises] - test seam
 * @returns {Promise<{enqueued: false, reason: string} | {enqueued: true, item: Object}>}
 */
export async function enqueueIfParkedAbort({
  store,
  urlKey,
  abortTo,
  target = 'cli',
  issueIdentifier = null,
  dispatchedBy = null,
  dispatchTokenStore = null,
  proxyTokenStore = null,
  advertises = workspaceConsumerAdvertises
}) {
  if (!urlKey || !abortTo) return { enqueued: false, reason: 'missing-target' };
  if (!advertises(urlKey, CAP_IF_PARKED)) return { enqueued: false, reason: 'consumer-not-advertised' };
  const item = await createDispatchItem({
    store,
    urlKey,
    dispatchTokenStore,
    proxyTokenStore,
    fields: {
      abort: true,
      abortTo,
      ifParked: true,
      target,
      issueIdentifier,
      dispatchedBy
    }
  });
  return { enqueued: true, item };
}
