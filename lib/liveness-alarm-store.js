/**
 * Liveness alarm store (LIN-3258, M21 option A): the durable sink for the
 * dispatcher-silent and stopped-or-circular-wait detectors.
 *
 * ALARM ONLY. This store never aborts, re-dispatches, or messages an agent —
 * it is a read model the Flight Companion reads back through
 * `GET /api/proxy/alarms`. One document per incident, deduped while the
 * incident persists: `_id` is deterministic over `rule + shape + sorted
 * member lineage ids`, so a wait that is re-worded every hour updates the
 * same row instead of minting a second.
 *
 * Schema:
 * {
 *   _id:          string,  // deterministic dedupe key, see livenessAlarmId
 *   urlKey:       string,
 *   rule:         'dispatcher-silent' | 'stopped-or-circular-wait',
 *   shape:        null | 'cycle' | 'orphan',
 *   members:      string[],// lineage ids the incident is about (Rule S: [urlKey])
 *   dispatchIds:  string[],// every dispatch row id in the incident
 *   tickets:      string[],// issue identifiers involved
 *   startedAt:    Date,    // onset (last poll, or the later of the waits)
 *   firedAt:      Date,    // first tick the condition held
 *   lastSeenAt:   Date,    // refreshed on every confirming tick (LIN-2438)
 *   missCount:    number,  // consecutive evaluated ticks without the condition
 *   clearedAt:    Date|null,
 *   updatedAt:    Date,    // moves only on a genuine change, never on a confirm
 *   detail:       Object   // why it fired (edge kinds, member states)
 * }
 *
 * Writes use the house bare-`_id` `$setOnInsert` upsert idiom (the scheduler's
 * lock seed, lib/scheduler.js:109). A confirm is a NON-upsert `updateOne` that
 * merely refreshes `lastSeenAt`, so a stale witness can never re-create a
 * cleared row.
 */

export const LIVENESS_ALARM_COLLECTION = 'liveness-alarms';

export const LIVENESS_ALARM_RULES = Object.freeze({
  DISPATCHER_SILENT: 'dispatcher-silent',
  STOPPED_OR_CIRCULAR_WAIT: 'stopped-or-circular-wait'
});

/**
 * Deterministic dedupe id: `rule:shape:sortedMembers`. Rule S passes
 * `members: [urlKey]` (one open silence alarm per workspace); D2 passes the
 * sorted lineage ids of the chain, so re-wording a wait never mints a second
 * record.
 *
 * @param {Object} key
 * @param {string} key.rule
 * @param {string|null} [key.shape]
 * @param {Array<string>} [key.members]
 * @returns {string}
 */
export function livenessAlarmId({ rule, shape = null, members = [] } = {}) {
  const sorted = [...members].map(String).sort();
  return `${rule}:${shape || '-'}:${sorted.join(',')}`;
}

/**
 * MongoDB/MangoDB-backed durable liveness-alarm store.
 */
export class LivenessAlarmStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Open (or confirm) the one alarm record for the given dedupe key.
   *
   * - absent      → insert with `$setOnInsert` (never clobbers a concurrent insert).
   * - open        → refresh `lastSeenAt`, reset `missCount` (a confirming tick).
   * - cleared     → reopen in place: the same liveness condition recurred, and
   *                 this store keeps one durable row per condition key rather
   *                 than minting an id per occurrence.
   *
   * @returns {Promise<Object|null>} the stored document, or null with no collection.
   */
  async open({ urlKey, rule, shape = null, members = [], dispatchIds = [], tickets = [], startedAt, firedAt, detail = {} } = {}) {
    if (!this.collection) return null;
    if (!urlKey || !rule) throw new Error('liveness-alarm-store: open() requires urlKey and rule');
    const at = toDate(firedAt);
    const _id = livenessAlarmId({ rule, shape, members });

    const existing = await this.getById(_id);
    if (!existing) {
      await this.collection.updateOne(
        { _id },
        {
          $setOnInsert: {
            _id,
            urlKey,
            rule,
            shape: shape || null,
            members: [...members],
            dispatchIds: [...dispatchIds],
            tickets: [...tickets],
            startedAt: toDate(startedAt) || at,
            firedAt: at,
            lastSeenAt: at,
            missCount: 0,
            clearedAt: null,
            updatedAt: at,
            detail
          }
        },
        { upsert: true }
      );
      return this.getById(_id);
    }

    if (existing.clearedAt) {
      // Reopen in place — a recurrence of the same condition key.
      await this.collection.updateOne(
        { _id, clearedAt: { $ne: null } },
        {
          $set: {
            urlKey,
            members: [...members],
            dispatchIds: [...dispatchIds],
            tickets: [...tickets],
            startedAt: toDate(startedAt) || at,
            firedAt: at,
            lastSeenAt: at,
            missCount: 0,
            clearedAt: null,
            updatedAt: at,
            detail
          }
        }
      );
      return this.getById(_id);
    }

    // Still open: a confirming tick refreshes lastSeenAt only (LIN-2438's
    // seen-vs-changed split — updatedAt must NOT move here).
    await this.collection.updateOne(
      { _id, clearedAt: null },
      { $set: { lastSeenAt: at, missCount: 0 } }
    );
    return this.getById(_id);
  }

  /**
   * Record one evaluated tick that did NOT re-detect this alarm. The clear
   * needs `CLEAR_CONFIRM_TICKS` consecutive misses before the sweep calls
   * `clear`, so a single tick landing inside a runner's ~16 s hourly resume
   * cannot flap the record.
   *
   * @returns {Promise<Object|null>} the document after the increment.
   */
  async markMiss(id, { at } = {}) {
    if (!this.collection || !id) return null;
    await this.collection.updateOne(
      { _id: id, clearedAt: null },
      { $inc: { missCount: 1 }, $set: { lastEvaluatedAt: toDate(at) || new Date() } }
    );
    return this.getById(id);
  }

  /**
   * Clear an open alarm. A non-upsert `updateOne`, so a stale witness can
   * never re-create the row.
   *
   * @returns {Promise<Object|null>} the cleared document.
   */
  async clear(id, { clearedAt } = {}) {
    if (!this.collection || !id) return null;
    const at = toDate(clearedAt) || new Date();
    await this.collection.updateOne(
      { _id: id, clearedAt: null },
      { $set: { clearedAt: at, updatedAt: at, missCount: 0 } }
    );
    return this.getById(id);
  }

  /**
   * Point-read one alarm by its deterministic id.
   *
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getById(id) {
    if (!this.collection || !id) return null;
    return this.collection.findOne({ _id: id });
  }

  /**
   * List a workspace's alarms, newest-fired first.
   *
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {'open'|'cleared'|'all'} [options.state='open']
   * @param {number} [options.limit=200]
   * @returns {Promise<Array<Object>>}
   */
  async list(urlKey, { state = 'open', limit = 200 } = {}) {
    if (!this.collection || !urlKey) return [];
    const query = { urlKey };
    if (state === 'open') query.clearedAt = null;
    else if (state === 'cleared') query.clearedAt = { $ne: null };
    let cursor = this.collection.find(query);
    if (typeof cursor.sort === 'function') cursor = cursor.sort({ firedAt: -1, _id: 1 });
    if (limit && typeof cursor.limit === 'function') cursor = cursor.limit(limit);
    const rows = await cursor.toArray();
    return rows || [];
  }

  /**
   * Distinct workspace keys that currently have at least one open alarm — the
   * second half of the sweep roster (a workspace can drop off the observed
   * roster while its alarm is still open, and it must keep being swept until
   * the alarm clears).
   *
   * @returns {Promise<Array<string>>}
   */
  async listOpenWorkspaceKeys() {
    if (!this.collection) return [];
    try {
      if (typeof this.collection.distinct === 'function') {
        return (await this.collection.distinct('urlKey', { clearedAt: null })) || [];
      }
      const rows = await this.collection.find({ clearedAt: null }, { projection: { urlKey: 1 } }).toArray();
      return [...new Set((rows || []).map((r) => r.urlKey).filter(Boolean))];
    } catch (err) {
      console.error('Error listing open liveness-alarm workspaces:', err.message);
      return [];
    }
  }

  /**
   * Retention-agnostic cleanup hook used by the server's periodic cleanup
   * loop. Retains cleared alarms for `retainMs` then removes them; open
   * alarms are never evicted. Returns the number removed.
   *
   * @param {Object} [options]
   * @param {Date} [options.now]
   * @param {number} [options.retainMs]
   * @returns {Promise<number>}
   */
  async cleanup({ now = new Date(), retainMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
    if (!this.collection || typeof this.collection.deleteMany !== 'function') return 0;
    const cutoff = new Date(toDate(now).getTime() - retainMs);
    const result = await this.collection.deleteMany({ clearedAt: { $ne: null, $lt: cutoff } });
    return result?.deletedCount ?? result?.modifiedCount ?? 0;
  }
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
