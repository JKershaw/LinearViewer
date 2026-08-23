/**
 * Shelved-rulings store (LIN-1727) — the durable half of "shelve": a
 * deliberate, designed defer with a reason and a re-surface timer, so a
 * deferred ruling can never be silently lost (docs/escalation-philosophy.md
 * §6). Shelving is a VIEW operation only: it never touches the underlying
 * session or task-decision row — a shelved decision is still exactly as
 * unanswered as it was before, per the parked-session ruling this ticket
 * already settled (keep BLOCKED sessions parked; shelving must not mutate or
 * destroy the session).
 *
 * `lib/unanswered-decisions.js`'s `collectUnansweredDecisions` is the one
 * consumer: a decision whose shelf row is still active (`resurfaceAt` in the
 * future) is excluded from the live rulings feed; once `resurfaceAt` passes,
 * this store does nothing on its own — the underlying decision simply
 * reappears in the next feed read, because it was never actually resolved.
 * No cleanup/expiry job is needed for that reason; a shelf row is retained
 * after it lapses purely as the `lapseCount` history for the NEXT shelve
 * attempt on the same decision (docs/escalation-philosophy.md §6/§4: "a
 * shelved row may not be hidden indefinitely without resurfacing; repeated
 * lapses should surface/raise priority, not auto-destroy" — `lapseCount` is
 * what lets the UI raise that alarm).
 *
 * A "lapse" is precise: re-shelving a decision whose PRIOR shelf row had
 * already passed its `resurfaceAt` (the operator let it come back and shelved
 * it again, rather than deciding it) increments `lapseCount`. Adjusting an
 * still-ACTIVE shelf (re-shelving before it has resurfaced) is not a lapse —
 * it is just changing the reason/timer, and does not increment the count.
 *
 * Durable, no TTL — the same rationale `lib/task-decisions-store.js` and
 * `lib/task-snapshot-store.js` already use: a TTL on an operator disposition
 * record could silently erase "this was dismissed 3 times before being
 * decided", which is exactly the standing/stale signal §4 warns against
 * losing.
 *
 * Schema (one document per (urlKey, decisionId) — a re-shelve overwrites in
 * place, never a new row, since only the CURRENT shelf state matters plus
 * the running lapse count):
 * {
 *   _id:          string,       // `${urlKey}::${decisionId}`
 *   urlKey:       string,
 *   decisionId:   string,
 *   reason:       string,
 *   shelvedAt:    Date,
 *   resurfaceAt:  Date,
 *   lapseCount:   number        // times this decision has lapsed and been re-shelved
 * }
 */

function toMillis(date) {
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

function toRecord(doc) {
  if (!doc) return null;
  return {
    urlKey: doc.urlKey,
    decisionId: doc.decisionId,
    reason: doc.reason,
    shelvedAt: doc.shelvedAt?.toISOString?.() || doc.shelvedAt,
    resurfaceAt: doc.resurfaceAt?.toISOString?.() || doc.resurfaceAt,
    lapseCount: doc.lapseCount || 0,
  };
}

export class ShelvedRulingsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Shelve (or re-shelve) a decision. `reason` and `resurfaceInMs` are both
   * required — silent muting is forbidden (docs/escalation-philosophy.md §6).
   *
   * @param {Object} entry
   * @param {string} entry.urlKey
   * @param {string} entry.decisionId
   * @param {string} entry.reason - non-empty; the "why" a designed shelve requires
   * @param {number} entry.resurfaceInMs - positive; when this shelf expires, relative to now
   * @param {Date} [entry.now] - injected clock; defaults to `new Date()`
   * @returns {Promise<Object|null>} the stored record, or null on bad input/error
   */
  async shelve({ urlKey, decisionId, reason, resurfaceInMs, now } = {}) {
    if (!this.collection || !urlKey || !decisionId) return null;
    if (typeof reason !== 'string' || !reason.trim()) return null;
    if (!Number.isFinite(resurfaceInMs) || resurfaceInMs <= 0) return null;

    try {
      const nowDate = now instanceof Date ? now : new Date();
      const _id = `${urlKey}::${decisionId}`;
      const existing = await this.collection.findOne({ _id });
      const priorLapsed = !!existing && toMillis(existing.resurfaceAt) <= nowDate.getTime();
      const lapseCount = existing ? (existing.lapseCount || 0) + (priorLapsed ? 1 : 0) : 0;

      const doc = {
        _id,
        urlKey,
        decisionId,
        reason: reason.trim(),
        shelvedAt: nowDate,
        resurfaceAt: new Date(nowDate.getTime() + resurfaceInMs),
        lapseCount,
      };
      await this.collection.updateOne({ _id }, { $set: doc }, { upsert: true });
      return toRecord(doc);
    } catch (err) {
      console.error('Error shelving ruling:', err);
      return null;
    }
  }

  /**
   * Every shelf row (active or lapsed) across a workspace set — raw rows;
   * `collectUnansweredDecisions` (lib/unanswered-decisions.js) owns deciding
   * which are still active (`resurfaceAt` in the future) versus lapsed
   * history, mirroring the raw-rows convention `TaskDecisionsStore`'s own
   * list methods already use (never dedup/reduce in the store).
   *
   * @param {Array<string>} urlKeys
   * @returns {Promise<Array<Object>>}
   */
  async listForWorkspaces(urlKeys) {
    if (!this.collection || !Array.isArray(urlKeys) || urlKeys.length === 0) return [];
    try {
      const docs = await this.collection.find({ urlKey: { $in: urlKeys } }).toArray();
      return docs.map(toRecord);
    } catch (err) {
      console.error('Error listing shelved rulings:', err);
      return [];
    }
  }

  /** Delete every shelf row for a workspace (test-harness only; see routes/test.js). */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing shelved rulings:', err);
      return 0;
    }
  }
}
