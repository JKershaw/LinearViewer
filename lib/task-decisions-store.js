/**
 * Task-decision store: task-keyed record of scan-produced decisions (LIN-2197
 * Phase 2 — the third producer into the operator decision queue, LIN-1721).
 *
 * A human-triggered "scan for blockers" (a later phase) reads a task's
 * description, comments and subtask state and, where it finds a decision that
 * genuinely requires the operator, writes a record here. This is the
 * `taskDecisions` shape `lib/unanswered-decisions.js`'s `collectUnansweredDecisions`
 * was pre-authorised (LIN-1728 Phase 1) to read as a second source alongside
 * dispatch-loop decisions. A scan can also legitimately find nothing: a stored
 * `decision: null` is a persisted **zero-finding** record, not the absence of
 * one — "found nothing" must stay distinguishable from "never scanned", which
 * is what `getStatus` returning `null` means instead.
 *
 * Durable, NO TTL, per-task count-capped — modelled on
 * `lib/task-snapshot-store.js` rather than the 7-day-TTL brief/recap caches: a
 * TTL would silently delete an unanswered ruling, the exact "unanswered age"
 * failure `docs/escalation-philosophy.md` warns about. Unlike that store, this
 * one needs only a single canonical-identity index: every call site that will
 * reach this store (the scan routes, added in a later phase) already fetches
 * the issue context first, so a canonical UUID is always available up front —
 * there is no fire-and-forget capture path needing an identifier-only fallback
 * lookup, so no dual index/fallback query is needed.
 *
 * `_id = scan_<issueId8>_<inputHash12>` — idempotent per (issue, content): the
 * same formula a scan module (a later phase) injects as a claimed decision's
 * own `decision_id`, so the store's document id and the decision's own id
 * agree for a persisted (non-zero-finding) scan. Re-scanning unchanged content
 * recomputes the same `_id`; a genuinely changed task hashes to a new one.
 *
 * Outcome-stamped re-scan behaviour: `recordScan` never overwrites a row that
 * already carries a terminal `outcome` ('answered'/'dismissed') — it discards
 * the freshly generated result and returns the existing row unchanged. That
 * collision is reachable only when the content genuinely has not changed
 * since the operator actioned it (same hash => same `_id`); a real content
 * change hashes to a new `_id` and proceeds as an ordinary new record, never
 * silently un-dismissing/un-answering the prior one. `getStatus` returns the
 * latest row for a task regardless of outcome, so an answered/dismissed-but-
 * unchanged task reports its outcome rather than reading as `missing`
 * ("never scanned").
 *
 * Schema (one document per scanned content-hash):
 * {
 *   _id:             string,       // scan_<issueId8>_<inputHash12>
 *   urlKey:          string,       // workspace URL key (indexed)
 *   issueId:         string,       // canonical provider issue id, a UUID (indexed)
 *   issueIdentifier: string,       // display-only human identifier, e.g. "LIN-2197"
 *   inputHash:       string,       // hashContext digest of the scanned content
 *   decision:        Object|null,  // parseDecision's shape, or null (zero-finding)
 *   scannedAt:       Date,
 *   outcome:         string|null,  // 'answered' | 'dismissed' | null
 *   outcomeAt:       Date|null
 * }
 */

const MAX_SCANS_PER_TASK = 50;

function toMillis(date) {
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

/** Convert a stored document into the public record shape. */
function toRecord(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    urlKey: doc.urlKey,
    issueId: doc.issueId,
    issueIdentifier: doc.issueIdentifier,
    inputHash: doc.inputHash,
    decision: doc.decision ?? null,
    scannedAt: doc.scannedAt?.toISOString?.() || doc.scannedAt,
    outcome: doc.outcome ?? null,
    outcomeAt: doc.outcomeAt?.toISOString?.() || doc.outcomeAt || null
  };
}

/**
 * MongoDB/MangoDB-backed task-decision store.
 */
export class TaskDecisionsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.maxPerTask=50] - Per-task cap on retained scan rows.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxPerTask = options.maxPerTask || MAX_SCANS_PER_TASK;
    // Per-process monotonic counter, used only as a SECONDARY sort key to break
    // ties when two rows share the same `scannedAt` millisecond. Mirrors
    // lib/task-snapshot-store.js's `_seq`.
    this._seq = 0;
  }

  /** The deterministic, content-idempotent document id for (issueId, inputHash). */
  static buildId(issueId, inputHash) {
    return `scan_${String(issueId).slice(0, 8)}_${String(inputHash).slice(0, 12)}`;
  }

  /**
   * Record a scan result. Always computes the same `_id` for the same
   * (issueId, inputHash) pair, so calling this on unchanged content targets
   * the same row — except when that row already carries a terminal `outcome`,
   * in which case the new result is discarded and the existing row is
   * returned unchanged (see the outcome-stamped re-scan behaviour above).
   *
   * @param {Object} entry
   * @param {string} entry.urlKey
   * @param {string} entry.issueId - canonical provider issue id (UUID)
   * @param {string} [entry.issueIdentifier] - display-only human identifier
   * @param {string} entry.inputHash - hashContext digest of the scanned content
   * @param {Object|null} [entry.decision] - parseDecision's shape, or null (zero-finding)
   * @returns {Promise<Object|null>} the stored record (new, refreshed, or preserved), or null on bad input/error
   */
  async recordScan({ urlKey, issueId, issueIdentifier, inputHash, decision = null } = {}) {
    if (!this.collection || !urlKey || !issueId || !inputHash) return null;

    try {
      const _id = TaskDecisionsStore.buildId(issueId, inputHash);
      const existing = await this.collection.findOne({ _id, urlKey });
      if (existing && existing.outcome) {
        return toRecord(existing); // terminal row: never silently un-dismissed/un-answered
      }

      const doc = {
        _id,
        urlKey,
        issueId,
        issueIdentifier: issueIdentifier != null ? String(issueIdentifier) : '',
        inputHash: String(inputHash),
        decision: decision || null,
        scannedAt: new Date(),
        seq: this._seq++,
        outcome: null,
        outcomeAt: null
      };

      if (existing) {
        // Same content hash, no outcome stamped yet: refresh with the new result.
        await this.collection.deleteOne({ _id, urlKey });
      }
      await this.collection.insertOne(doc);
      await this._pruneToCapacity(urlKey, issueId);
      return toRecord(doc);
    } catch (err) {
      console.error('Error recording task decision scan:', err);
      return null;
    }
  }

  /**
   * The current scan status for a task: the latest scanned row for
   * (urlKey, issueId), regardless of whether it carries an outcome stamp.
   * `null` means "never scanned" — distinct from a persisted zero-finding
   * row (`decision: null` on a real record) and from an outcome-stamped one
   * (`outcome` set).
   *
   * @returns {Promise<Object|null>}
   */
  async getStatus(urlKey, issueId) {
    if (!this.collection || !urlKey || !issueId) return null;
    try {
      return toRecord((await this._docsFor(urlKey, issueId))[0] || null);
    } catch (err) {
      console.error('Error reading task decision status:', err);
      return null;
    }
  }

  /** Docs for a task, newest-first (scannedAt primary, seq breaks same-ms ties). */
  async _docsFor(urlKey, issueId) {
    const docs = await this.collection.find({ urlKey, issueId }).toArray();
    docs.sort((a, b) => (toMillis(b.scannedAt) - toMillis(a.scannedAt)) || ((b.seq || 0) - (a.seq || 0)));
    return docs;
  }

  /** Delete anything beyond the newest `maxPerTask` scan rows for a task. */
  async _pruneToCapacity(urlKey, issueId) {
    try {
      const docs = await this._docsFor(urlKey, issueId);
      for (const doc of docs.slice(this.maxPerTask)) {
        await this.collection.deleteOne({ _id: doc._id, urlKey });
      }
    } catch (err) {
      console.error('Error pruning task decision scans:', err);
    }
  }
}
