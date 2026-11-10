/**
 * lib/task-cost-read.js: one task's own cost read, over its whole life (LIN-4404, part 1 of LIN-4395).
 *
 * The fetch the `/cost/:identifier` route used to build inline, lifted so the route and the task page's session
 * timeline (LIN-4405) make the same read. Its substance is unchanged: own rows, then the founder identity, then the
 * lineage siblings, then `readCost({ perDispatch: true })` (lib/cost-read.js), which does every lineage decision. This
 * file only fetches the read's inputs.
 *
 * The read follows the TASK-LIFE rule (lib/read-horizon.js): a task's own reads cover its whole life. The two
 * dispatch-history reads are bounded by their identity keys (`issueIdentifier`, `rootItemId`) and pass no `since`,
 * so a row with no `dispatchedAt` is not skipped, and `readCost` gets no `windowStart`. The call-log read stays in
 * the route (`listInHorizon` is allowed only there, tests/unit/cost-read-census.test.js `CALL_ALLOW`): the route
 * passes its summary in as `appSummary`, and a caller that wants no Harbour calls (the timeline) passes none.
 *
 * Truncation: the sibling read keeps the newest `lineageLimit` rows. On a whole-life read the rows it drops are the
 * oldest, which are exactly the ones the task-life rule admits, so the read returns `lineagesTruncated` as well as
 * logging it. The flag is coarse: the cap is shared by every anchor, including a parent's lineage pulled in by one
 * wake. Each lineage's own `incomplete` (kept on `workerSessions` here; the route strips it from the wire) says
 * which lineage lost a member that could change its figure.
 *
 * Request spans: `dispatches[*].firstRequestAt`/`lastRequestAt` exist only where `dispatches` does (a lineage read
 * from request records). Request records began about 4 Nov 2026 and have no backfill, so the old lineages this rule
 * newly admits are snapshot-only, with `dispatches: null`.
 */

import { readCost } from './cost-read.js';
import { requireRequestUsageLoader } from './request-usage-loader.js';
import { anchorOf, isMember } from './lineage-membership.js';

/**
 * The task's own cost read, over its whole life.
 *
 * @param {Object} deps
 * @param {Object} deps.dispatchQueueStore  `listItems`, `listHistory`, `lineageIdentityRows`
 * @param {Object} deps.requestUsageLoader  the request-usage loader (required, lib/request-usage-loader.js)
 * @param {number} deps.lineageLimit  the cap on the lineage-sibling read (routes/proxy.js `LINEAGE_QUERY_LIMIT`)
 * @param {Object} params
 * @param {string} params.urlKey
 * @param {string} params.identifier  the human issue identifier (e.g. LIN-123), never a UUID; the caller validates it
 * @param {Object|Promise<Object>} [params.appSummary]  the issue's Harbour-call summary (`appCallsOf`); none means
 *   no calls are read (`readCost`'s empty summary)
 * @param {boolean} [params.foundedElsewhere]  also return lineages founded on another issue with a member tagged
 *   with this one (`readCost`'s opt-in, LIN-4404). `/cost` does not pass it.
 * @param {string} [params.caller]  names the caller in the loader's missing-dependency error
 * @returns {Promise<Object>} `readCost`'s result (`workerSessions` keep `telemetry` and `incomplete`), plus
 *   `lineagesTruncated`: true when the sibling read hit `lineageLimit`
 */
export async function readTaskCost({ dispatchQueueStore, requestUsageLoader, lineageLimit } = {}, { urlKey, identifier, appSummary, foundedElsewhere = false, caller = 'readTaskCost' } = {}) {
  if (!dispatchQueueStore) throw new TypeError('readTaskCost: dispatchQueueStore is required');
  if (!Number.isInteger(lineageLimit) || lineageLimit <= 0) throw new TypeError('readTaskCost: lineageLimit must be a positive integer');
  if (!urlKey || !identifier) throw new TypeError('readTaskCost: urlKey and identifier are required');
  const requestSource = requireRequestUsageLoader(requestUsageLoader, caller);

  // LIN-4177: the lineage's identity (issue, base kind, true members) comes from the founder lookup: scalar, uncapped
  // and never windowed, so a lineage keeps its true issue whatever the age of its founder (LIN-4148).
  const [queued, history, ownIdentity] = await Promise.all([
    dispatchQueueStore.listItems(urlKey, { issueIdentifier: identifier, projection: { prompt: 0 } }),
    dispatchQueueStore.listHistory(urlKey, { issueIdentifier: identifier, projection: { prompt: 0 } }),
    dispatchQueueStore.lineageIdentityRows(urlKey, { issueIdentifier: identifier })
  ]);
  const ownRows = [
    ...queued.map(i => ({ ...i, status: 'queued', feedback: [] })),
    ...history.items
  ];

  // Every lineage with a member row tagged with this issue, any age: the ones it founded, and the ones founded on
  // another issue that it took part in (a parent's autopilot woken by this task). `readCost` counts only the first
  // kind under this issue; the second is what its `foundedElsewhere` opt-in reports.
  const anchors = [...new Set(ownIdentity.filter(isMember).map(anchorOf).filter(Boolean))];
  const identityRows = anchors.length
    ? [...ownIdentity, ...await dispatchQueueStore.lineageIdentityRows(urlKey, { anchors })]
    : ownIdentity;

  let lineagesTruncated = false;
  const siblingRowsByAnchor = new Map();
  if (anchors.length) {
    // Unscoped by issue: a cross-issue follow-up's usage must merge into its anchor's one total.
    const { items: lineageSiblings, total: lineageTotal } = await dispatchQueueStore.listHistory(urlKey, {
      rootItemId: { $in: anchors },
      limit: lineageLimit,
      projection: { prompt: 0 }
    });
    if (lineageTotal > lineageLimit) {
      lineagesTruncated = true;
      console.warn(`Lineage query exceeded LINEAGE_QUERY_LIMIT (${lineageLimit}) for urlKey=${urlKey}, identifier=${identifier}, anchors=${anchors.length}, total=${lineageTotal} — result truncated to the newest ${lineageLimit}`);
    }
    for (const sib of lineageSiblings) {
      const bucket = siblingRowsByAnchor.get(sib.rootItemId);
      if (bucket) bucket.push(sib);
      else siblingRowsByAnchor.set(sib.rootItemId, [sib]);
    }
  }

  // Fetched usage rows: the siblings, then the own rows (the pool order the fold has always read). LIN-4201 / LIN-4226:
  // the read loads the request records of every lineage it sees, through the one loader. LIN-4263: `perDispatch`
  // builds each records lineage's `dispatches`.
  const fetchedRows = [...[...siblingRowsByAnchor.values()].flat(), ...ownRows];
  const result = await readCost({
    fetchedRows,
    identityRows,
    requestSource,
    urlKey,
    appSummary: await appSummary,
    issueIdentifier: identifier,
    perDispatch: true,
    foundedElsewhere
  });
  return { ...result, lineagesTruncated };
}
