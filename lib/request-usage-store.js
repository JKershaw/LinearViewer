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
 * `rootItemId` is the caller's job to set: the intake route derives it from the
 * taken row via `anchorOf` and never reads it from the request body. This module
 * takes it as an argument and does not validate where it came from.
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

/**
 * The fields `listForAnchors` returns. A minimal projection: `itemId` and
 * `issueIdentifier` are stored but nothing in this ticket reads them, so they are
 * left out, as is `updatedAt`.
 */
export const LIST_PROJECTION = Object.freeze({
  _id: 0,
  rootItemId: 1,
  requestId: 1,
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

export class RequestUsageStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - the `request-usage` collection handle
   */
  constructor(options = {}) {
    if (!options.collection) throw new Error('RequestUsageStore: collection is required');
    this.collection = options.collection;
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
   * Every request record of the given lineage anchors within one workspace, with
   * only the fields the cost read needs (`LIST_PROJECTION`). Piece 4 is the only
   * caller. Records come back unsorted; the read orders them.
   *
   * Uses the `{urlKey, rootItemId}` index declared in lib/db-indexes.js.
   *
   * @param {string} urlKey
   * @param {Array<string>} anchors - lineage anchors (rootItemId values)
   * @returns {Promise<Array<Object>>}
   */
  async listForAnchors(urlKey, anchors) {
    const ids = [...new Set((anchors || []).filter((a) => typeof a === 'string' && a !== ''))];
    if (ids.length === 0) return [];
    return this.collection
      .find({ urlKey, rootItemId: { $in: ids } }, { projection: LIST_PROJECTION })
      .toArray();
  }
}
