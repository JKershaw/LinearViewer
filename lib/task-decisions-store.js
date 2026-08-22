/**
 * Task-decision store: task-keyed record of scan-produced decisions (LIN-2197
 * Phase 2 — the third producer into the operator decision queue, LIN-1721).
 *
 * A human-triggered "scan for blockers" (`lib/scan.js` + the scan routes,
 * LIN-2197 Phase 4) reads a task's description, comments and subtask state
 * and, where it finds a decision that genuinely requires the operator,
 * writes a record here. This is the
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
 * one needs only a single canonical-identity index: every call site that
 * reaches this store (the scan routes) already fetches the issue context
 * first, so a canonical UUID is always available up front — there is no
 * fire-and-forget capture path needing an identifier-only fallback lookup,
 * so no dual index/fallback query is needed.
 *
 * `_id = scan_<issueId8>_<inputHash12>` — idempotent per (issue, content): the
 * same formula `lib/scan.js` injects as a claimed decision's own
 * `decision_id` (`TaskDecisionsStore.buildId`, reused rather than
 * re-derived), so the store's document id and the decision's own id
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
 *
 * Canonical-UUID guard (LIN-2197 Phase 4): `recordScan`/`getStatus`/
 * `markOutcome` all reject a non-UUID-shaped `issueId` rather than silently
 * keying a durable record under a raw dispatch/route identifier fallback
 * (e.g. `context.issue?.id || issueId` resolving to `issueId` when the
 * fetch's own canonical id was unexpectedly absent). A durable ruling
 * written under the wrong key is a ruling that a canonical-UUID `getStatus`
 * lookup can never find again — worse than rejecting the write outright.
 */

import { UUID_REGEX } from './workspace.js';

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
    if (!UUID_REGEX.test(issueId)) return null; // canonical-UUID guard — see class docstring

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

      // Single atomic upsert — replaces the prior deleteOne+insertOne pair,
      // which left a window where a write failure after the delete lost the
      // row entirely (Phase 2 close-out ledger item 5). Same idiom as
      // lib/observation-sessions-store.js's upsertSession.
      await this.collection.updateOne({ _id, urlKey }, { $set: doc }, { upsert: true });
      await this._pruneToCapacity(urlKey, issueId);
      return toRecord(doc);
    } catch (err) {
      console.error('Error recording task decision scan:', err);
      return null;
    }
  }

  /**
   * The current scan status for a task. `null` means "never scanned" —
   * distinct from a persisted zero-finding row (`decision: null` on a real
   * record) and from an outcome-stamped one (`outcome` set).
   *
   * When `inputHash` (the caller's freshly computed content hash) is given,
   * the row for THAT exact hash is preferred over "latest scanned" — this is
   * what makes a GET status call agree with what a POST scan call would
   * return for the SAME current content (Phase 4 ledger item 4: without
   * this, a task dismissed at content A, changed to B, then reverted back to
   * A would report the intervening B row as current forever, even though a
   * POST at that same reverted content resolves straight back to A via
   * `buildId`). Falls back to the latest scanned row (any hash) when no row
   * matches the given hash, or when no hash is given at all — the caller
   * distinguishes "fresh" from "stale" by comparing the returned
   * `inputHash` to its own, exactly as the brief/recap cache routes do.
   *
   * @param {string} urlKey
   * @param {string} issueId - canonical provider issue id (UUID)
   * @param {string} [inputHash] - the caller's current content hash
   * @returns {Promise<Object|null>}
   */
  async getStatus(urlKey, issueId, inputHash) {
    if (!this.collection || !urlKey || !issueId) return null;
    if (!UUID_REGEX.test(issueId)) return null; // canonical-UUID guard — see class docstring
    try {
      if (inputHash) {
        const current = await this.collection.findOne({ _id: TaskDecisionsStore.buildId(issueId, inputHash), urlKey });
        if (current) return toRecord(current);
      }
      return toRecord((await this._docsFor(urlKey, issueId))[0] || null);
    } catch (err) {
      console.error('Error reading task decision status:', err);
      return null;
    }
  }

  /**
   * Stamp a specific scan row with a terminal outcome ('answered' or
   * 'dismissed'). Idempotent: a row that already carries an outcome is
   * returned unchanged rather than re-stamped — first stamp wins, mirroring
   * `recordScan`'s own terminal-row-never-overwritten discipline, so a
   * double-submitted dismiss/answer can never flip an already-recorded one.
   *
   * @param {Object} entry
   * @param {string} entry.urlKey
   * @param {string} entry.issueId - canonical provider issue id (UUID); must match the row's own
   * @param {string} entry.id - the scan row's `_id` (from a prior recordScan/getStatus result)
   * @param {string} entry.outcome - 'answered' | 'dismissed'
   * @returns {Promise<Object|null>} the (possibly already-terminal) record, or null if not found/bad input
   */
  async markOutcome({ urlKey, issueId, id, outcome } = {}) {
    if (!this.collection || !urlKey || !issueId || !id) return null;
    if (outcome !== 'answered' && outcome !== 'dismissed') return null;
    if (!UUID_REGEX.test(issueId)) return null; // canonical-UUID guard — see class docstring

    try {
      const existing = await this.collection.findOne({ _id: id, urlKey, issueId });
      if (!existing) return null;
      if (existing.outcome) return toRecord(existing); // first stamp wins

      const outcomeAt = new Date();
      await this.collection.updateOne({ _id: id, urlKey }, { $set: { outcome, outcomeAt } });
      return toRecord({ ...existing, outcome, outcomeAt });
    } catch (err) {
      console.error('Error marking task decision outcome:', err);
      return null;
    }
  }

  /** Delete every scan row for a workspace (test-harness only; see routes/test.js). */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing task decisions:', err);
      return 0;
    }
  }

  /**
   * Bulk-list every unanswered, decision-bearing scan row across a
   * workspace set (LIN-2215) — the rulings feed's second input alongside
   * `loops` (`routes/dashboard.js`'s `/api/dashboard/rulings`).
   *
   * Scope is workspace-set membership + terminal-state filtering ONLY:
   * `outcome == null` (an `'answered'`/`'dismissed'` row is resolved, not
   * unanswered) and `decision != null` (a persisted `decision: null` row is
   * a zero-finding scan — nothing to rule on). Deliberately does NOT dedup
   * to latest-row-per-(urlKey,issueId) — `collectUnansweredDecisions`
   * (`lib/unanswered-decisions.js`) already owns and is already tested for
   * that reduction; doing it twice would be exactly the two-places-drift
   * this feature's own client-side caption bug (F2) is a cautionary tale
   * for. Callers get raw candidate rows and must go through that predicate.
   *
   * @param {Array<string>} urlKeys
   * @returns {Promise<Array<Object>>} unordered public-shape records (see `toRecord`)
   */
  async listUnansweredForWorkspaces(urlKeys) {
    if (!this.collection || !Array.isArray(urlKeys) || urlKeys.length === 0) return [];
    try {
      const docs = await this.collection.find({ urlKey: { $in: urlKeys } }).toArray();
      return docs.filter(doc => !doc.outcome && doc.decision).map(toRecord);
    } catch (err) {
      console.error('Error listing unanswered task decisions:', err);
      return [];
    }
  }

  /** Docs for a task, newest-first (scannedAt primary, seq breaks same-ms ties). */
  async _docsFor(urlKey, issueId) {
    const docs = await this.collection.find({ urlKey, issueId }).toArray();
    docs.sort((a, b) => (toMillis(b.scannedAt) - toMillis(a.scannedAt)) || ((b.seq || 0) - (a.seq || 0)));
    return docs;
  }

  /**
   * Delete anything beyond the newest `maxPerTask` scan rows for a task,
   * EXCEPT a row that carries a terminal `outcome` (LIN-2197 Phase 5, ledger
   * item L2). `getStatus` prefers the row matching the caller's current
   * content hash over "latest scanned" (Phase 4 ledger item 4), which means
   * an outcome-stamped row can be the CURRENT row for its own content hash
   * even when it is no longer the newest row overall — an oldest-first
   * capacity prune that ignored `outcome` could delete it, and a later
   * revert to that exact content would then re-escalate a ruling the
   * operator already answered/dismissed (the false-escalation failure
   * `docs/escalation-philosophy.md` measures this feature against). An
   * outcome-stamped row is therefore retained unconditionally, regardless of
   * position in the newest-first order — this store's per-task growth is
   * bounded by `maxPerTask` non-terminal rows plus however many distinct
   * content-hashes the operator has actually answered/dismissed, not by
   * `maxPerTask` alone.
   *
   * Invariant: the current live (non-terminal) row is never pruned either.
   * `_docsFor` sorts newest-first, and among the non-terminal candidates
   * beyond `maxPerTask`, the single most-recently-scanned row — which is
   * always what `getStatus` falls back to as current when no exact-hash row
   * matches — survives as long as `maxPerTask >= 1` (`MAX_SCANS_PER_TASK`
   * above is 50; a caller cannot construct a `0` cap through the public
   * constructor, since `options.maxPerTask || MAX_SCANS_PER_TASK` treats `0`
   * as unset). Do not change this to an oldest-first slice, a different sort
   * key, or a cap that can reach `0` without re-checking this invariant.
   */
  async _pruneToCapacity(urlKey, issueId) {
    try {
      const docs = await this._docsFor(urlKey, issueId);
      for (const doc of docs.slice(this.maxPerTask)) {
        if (doc.outcome) continue; // terminal row: never pruned, see docstring above
        await this.collection.deleteOne({ _id: doc._id, urlKey });
      }
    } catch (err) {
      console.error('Error pruning task decision scans:', err);
    }
  }
}
