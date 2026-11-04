/**
 * lib/request-usage-store.js — the `request-usage` collection (LIN-4198, piece 1 of LIN-4195).
 *
 * One document per model request a runner (or opencode) session made, posted by
 * the runner and summed at read time by the cost read (piece 4). Nothing reads
 * this collection yet except `listForAnchors`, and that has a single caller in
 * a later piece. The collection is new: it is NOT `llm-call-log`, which about 42
 * readers treat as Harbour's own calls (LIN-4195 D1).
 *
 * Document shape:
 *   identity   urlKey, rootItemId, requestId        unique key {urlKey, rootItemId, requestId}
 *   metadata   itemId, issueIdentifier, harness, model, effort, lane, agent, at
 *                                                   set once, on insert ($setOnInsert)
 *   usage      inputTokens, outputTokens, cacheCreationInputTokens,
 *              cacheCreation1hInputTokens, cacheReadInputTokens   grow only ($max)
 *              costUsd (native, optional)                         grows only ($max)
 *   bookkeeping updatedAt                            the latest post that touched it ($max)
 *
 * No price is stored. Pricing happens at read, per record (lib/model-pricing.js).
 * When a native `costUsd` is present it wins over the read-time price for that
 * record (LIN-4195 review note 4; the same precedence as lib/session-telemetry.js).
 *
 * `rootItemId` on a stored record is the INFORMATIONAL stamp: the lineage anchor the
 * posting row had at post time (the intake route derives it from the taken row via
 * `anchorOf` and never reads it from the request body). Nothing reads by it. A wake
 * row is minted with its own id as its anchor and re-pointed to its lineage root at
 * its first tagged feedback, so a stamp can name an anchor no row carries any more
 * (LIN-4212). The read is therefore by the POSTING ROW: `listForAnchors` resolves
 * the member rows from `dispatch-history`, reads records by `itemId`, and relabels
 * each record to its row's CURRENT anchor.
 *
 * History dependency (LIN-4212, invariant): `dispatch-history` is not pruned on its
 * own. The history expiry delete was removed (lib/dispatch-store.js:1591-1595,
 * "retained for the project's lifetime", LIN-3163). The only history `deleteMany`
 * is `clearHistory` (lib/dispatch-store.js:2798), whose only caller is the test
 * route routes/test.js:884, mounted only under NODE_ENV === 'test'. Account erasure
 * deletes a workspace's history and records by the same urlKey
 * (lib/account-erasure.js:909). A row deleted by either takes its records out of
 * every read: there is no stamp fallback, by design.
 *
 * Upsert semantics: a streamed message grows across lines, so a repost of the
 * same request carries a larger (or equal) count. `$max` keeps the largest value
 * of each usage field, so a repost never shrinks a record and a larger one grows
 * it. Insert-if-absent would lose the growth, which is why it is not used.
 *
 * Intake guards (zero-token records, the 2M prompt bound, per-record rejection)
 * are NOT here; they belong to the shared intake handler (LIN-4198, piece 3).
 * This module assumes its records already passed them.
 */

export const REQUEST_USAGE_COLLECTION = 'request-usage';

/** The five token counters (identity fields are not among them). */
export const USAGE_TOKEN_FIELDS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'cacheCreationInputTokens',
  'cacheCreation1hInputTokens',
  'cacheReadInputTokens'
]);

/** Fields that grow monotonically across reposts of one request. */
const GROWING_FIELDS = Object.freeze([...USAGE_TOKEN_FIELDS, 'costUsd']);

/** The collection the member rows are read from (lib/dispatch-store.js; lib/db-indexes.js). */
export const HISTORY_COLLECTION = 'dispatch-history';

/**
 * The fields `listForAnchors` returns. `itemId` is returned because the read keys on it
 * (LIN-4212): the posting row, whose current anchor the record is relabelled to. The
 * stored stamp is read only as the projection's `rootItemId`, and that is overwritten by
 * the relabel. `updatedAt` is returned for the post-time coverage read (the LIN-4200
 * measurement); a folded record carries the latest of its documents' `updatedAt`.
 * `issueIdentifier` is left out.
 */
export const LIST_PROJECTION = Object.freeze({
  _id: 0,
  rootItemId: 1,
  requestId: 1,
  itemId: 1,
  updatedAt: 1,
  harness: 1,
  model: 1,
  effort: 1,
  lane: 1,
  agent: 1,
  at: 1,
  costUsd: 1,
  ...Object.fromEntries(USAGE_TOKEN_FIELDS.map((f) => [f, 1]))
});

const DUPLICATE_KEY_CODE = 11000;

/** Error code of one `writeErrors` entry: the driver puts it at `.code`, MangoDB at `.error.code`. */
const writeErrorCode = (entry) => entry?.code ?? entry?.error?.code;

const isDuplicateKeyOnly = (err) =>
  Array.isArray(err?.writeErrors) && err.writeErrors.length > 0 &&
  err.writeErrors.every((entry) => writeErrorCode(entry) === DUPLICATE_KEY_CODE);

/**
 * `bulkWrite` one batch unordered. When two posts upsert the same request at
 * once, one insert loses to the unique index (E11000). If EVERY write error is
 * E11000, the batch is retried once: the row now exists, so the same upsert
 * becomes an update, and `$max` makes that retry idempotent. Anything else, or a
 * second failure, propagates. Mirrors lib/kpi-daily-rollup.js.
 */
async function bulkWriteWithRetry(collection, ops) {
  try {
    return await collection.bulkWrite(ops, { ordered: false });
  } catch (err) {
    if (!isDuplicateKeyOnly(err)) throw err;
    return collection.bulkWrite(ops, { ordered: false });
  }
}

/**
 * Build one upsert op for a record. Exported for the tests, which assert the
 * operator split (identity in the filter, metadata `$setOnInsert`, usage `$max`).
 *
 * @param {Object} args
 * @param {string} args.urlKey
 * @param {string} args.rootItemId
 * @param {string} args.itemId - the posting row's id (stored, not read here)
 * @param {string|null} args.issueIdentifier - stored, not read here
 * @param {Object} args.record - one validated record: requestId, harness, model, effort, lane, agent, the five token counts, optional costUsd
 * @param {Date} args.now
 * @returns {Object} a `bulkWrite` updateOne operation
 */
export function upsertOpFor({ urlKey, rootItemId, itemId, issueIdentifier, record, now }) {
  const usage = {};
  for (const field of GROWING_FIELDS) {
    if (typeof record[field] === 'number') usage[field] = record[field];
  }
  return {
    updateOne: {
      filter: { urlKey, rootItemId, requestId: record.requestId },
      update: {
        $setOnInsert: {
          itemId,
          issueIdentifier: issueIdentifier ?? null,
          harness: record.harness ?? null,
          model: record.model ?? null,
          effort: record.effort ?? null,
          lane: record.lane ?? null,
          agent: record.agent ?? 'main',
          at: record.at ?? now
        },
        $max: { ...usage, updatedAt: now }
      },
      upsert: true
    }
  };
}

/** Milliseconds of an `at` value; a missing or unparseable time sorts last. */
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const atMs = (value) => {
  if (value === null || value === undefined) return Infinity;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? Infinity : ms;
};

/** Earliest `at` first; on a tie, the smallest `itemId`. Stable, so the fold is order-independent. */
const earliestFirst = (a, b) => (atMs(a.at) - atMs(b.at)) || byString(String(a.itemId), String(b.itemId));

/**
 * Fold records to one per (rootItemId, requestId). Pure: no store, no clock. Applied after
 * the read, because a re-post split (one document under the wake id and one under the root:
 * the upsert key includes the stamp) is only visible there. The write path is unchanged.
 *
 * - Metadata (`itemId`, `issueIdentifier`, `harness`, `model`, `effort`, `lane`, `agent`,
 *   `at`) comes from the EARLIEST document: the smallest `at`, and on a tie the smallest
 *   `itemId`. Two documents of one request usually share `at` (the record's own first-line
 *   time), so `at` alone cannot pick one. The stored stamp plays no part: the rows are
 *   relabelled to their current anchor before this fold.
 * - Each field in GROWING_FIELDS takes the `$max` over the documents, as the write path does.
 * - Output is sorted by (rootItemId, requestId), so the result does not depend on input order.
 *
 * @param {Array<Object>} rows - records already relabelled to their current anchor
 * @returns {Array<Object>}
 */
export function oneRecordPerRequest(rows) {
  // Group by anchor, then by requestId inside it. The two levels sort on short keys (about a thousand
  // anchors, then a few hundred requests each), which is what keeps the fold cheap on a large workspace.
  const byAnchor = new Map();
  for (const row of rows) {
    const list = byAnchor.get(row.rootItemId);
    if (list === undefined) byAnchor.set(row.rootItemId, [row]);
    else list.push(row);
  }

  const folded = [];
  for (const anchor of [...byAnchor.keys()].sort()) {
    const byRequest = new Map();
    for (const row of byAnchor.get(anchor)) {
      const group = byRequest.get(row.requestId);
      if (group === undefined) byRequest.set(row.requestId, row);
      else if (Array.isArray(group)) group.push(row);
      else byRequest.set(row.requestId, [group, row]);
    }
    for (const requestId of [...byRequest.keys()].sort()) {
      const entry = byRequest.get(requestId);
      if (!Array.isArray(entry)) {
        folded.push({ ...entry });
        continue;
      }
      entry.sort(earliestFirst);
      const out = { ...entry[0] };
      for (const field of GROWING_FIELDS) {
        let max;
        for (const row of entry) {
          const value = row[field];
          if (typeof value === 'number' && (max === undefined || value > max)) max = value;
        }
        if (max !== undefined) out[field] = max;
        else delete out[field];
      }
      // The latest post that touched the request (the write path's `$max` on updatedAt).
      let latest;
      for (const row of entry) {
        if (row.updatedAt === null || row.updatedAt === undefined) continue;
        if (latest === undefined || atMs(row.updatedAt) > atMs(latest)) latest = row.updatedAt;
      }
      if (latest !== undefined) out.updatedAt = latest;
      else delete out.updatedAt;
      folded.push(out);
    }
  }
  return folded;
}

export class RequestUsageStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - the `request-usage` collection handle
   * @param {Object} options.historyCollection - the `dispatch-history` collection handle. REQUIRED, not
   *   optional: a store built without it would silently read by the stamp (LIN-4212).
   */
  constructor(options = {}) {
    if (!options.collection) throw new Error('RequestUsageStore: collection is required');
    if (!options.historyCollection) throw new Error('RequestUsageStore: historyCollection is required');
    this.collection = options.collection;
    this.historyCollection = options.historyCollection;
  }

  /**
   * Upsert one batch of records for one lineage. Re-posting a record leaves one
   * document; a larger repost grows its usage fields; a smaller one leaves them.
   *
   * The caller passes at most 100 records (the intake cap) and only records that
   * have passed the intake guards. One `bulkWrite`, unordered.
   *
   * @param {Object} args
   * @param {string} args.urlKey
   * @param {string} args.rootItemId - from the taken row via `anchorOf`
   * @param {string} args.itemId - the posting row's id
   * @param {string|null} [args.issueIdentifier]
   * @param {Array<Object>} args.records
   * @param {Date} [args.now]
   * @returns {Promise<{upserted: number}>} the number of records sent
   */
  async upsertRecords({ urlKey, rootItemId, itemId, issueIdentifier = null, records, now = new Date() }) {
    if (!Array.isArray(records) || records.length === 0) return { upserted: 0 };
    const ops = records.map((record) => upsertOpFor({ urlKey, rootItemId, itemId, issueIdentifier, record, now }));
    await bulkWriteWithRetry(this.collection, ops);
    return { upserted: ops.length };
  }

  /**
   * Every request record of the given lineage anchors within one workspace (LIN-4212).
   *
   * The read is by the POSTING ROW, not the stored stamp:
   *   1. member rows: `dispatch-history` rows of this urlKey whose current `rootItemId` is
   *      in `anchors`. Projection `{_id, rootItemId}`. No status or `isMember` filter: a
   *      posting row always counts, and a row is taken by definition before it posts.
   *   2. records: `request-usage` rows of this urlKey whose `itemId` is one of those member
   *      ids (index `{urlKey, itemId}`; correct without it, only slower).
   *   3. relabel each record's `rootItemId` to its row's CURRENT anchor. A record whose
   *      `itemId` has no member row is dropped, not guessed: no fallback to the stamp, which
   *      could double count a re-pointed row.
   *   4. fold to one record per requestId (`oneRecordPerRequest`).
   *
   * Callers pass only anchors. Member rows are resolved here, never trusted from a caller.
   * Records come back sorted by (rootItemId, requestId).
   *
   * @param {string} urlKey
   * @param {Array<string>} anchors - lineage anchors (current rootItemId values)
   * @returns {Promise<Array<Object>>}
   */
  async listForAnchors(urlKey, anchors) {
    const ids = [...new Set((anchors || []).filter((a) => typeof a === 'string' && a !== ''))];
    if (!urlKey || ids.length === 0) return [];

    const members = await this.historyCollection
      .find({ urlKey, rootItemId: { $in: ids } }, { projection: { _id: 1, rootItemId: 1 } })
      .toArray();
    if (members.length === 0) return [];

    const anchorOfItem = new Map(members.map((m) => [String(m._id), m.rootItemId]));
    const records = await this.collection
      .find({ urlKey, itemId: { $in: [...anchorOfItem.keys()] } }, { projection: LIST_PROJECTION })
      .toArray();

    const relabelled = [];
    for (const record of records) {
      const anchor = anchorOfItem.get(String(record.itemId));
      if (anchor === undefined) continue;
      relabelled.push({ ...record, rootItemId: anchor });
    }
    return oneRecordPerRequest(relabelled);
  }
}
