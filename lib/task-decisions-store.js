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
 *   basisHash:       string|null,  // LIN-2241: scan-BASIS digest (lib/scan-fingerprint.js).
 *                                  // A second, narrower digest with a different job from
 *                                  // `inputHash`: that one is the row's IDENTITY (buildId
 *                                  // derives `_id` from it, and lib/scan.js reuses the same
 *                                  // formula for the decision's own `decision_id`), so it can
 *                                  // never be narrowed in place. This one answers "has the
 *                                  // content this ruling was raised FROM moved?" and therefore
 *                                  // deliberately excludes labels/priority/assignee/updatedAt,
 *                                  // which `inputHash` (labels) and the scan's own rendered
 *                                  // input (updatedAt) both carry. `null` on any row written
 *                                  // before LIN-2241 — read as UNKNOWN, never as "unchanged".
 *   basisVersion:    number|null,  // lib/scan-fingerprint.js's BASIS_VERSION at raise time.
 *                                  // Stored beside the hash so a comparison across a projection
 *                                  // change resolves to UNKNOWN instead of flagging every pending
 *                                  // ruling at once. `null` on pre-LIN-2241 rows.
 *   dueBasisHash:    string|null,  // LIN-2649 WS2: due-BASIS digest (lib/scan-fingerprint.js's
 *                                  // dueBasisHashFromContext) — a THIRD, additive digest, distinct
 *                                  // from both `inputHash` (row identity) and `basisHash` (tier-1,
 *                                  // untouched): the same projection as `basisHash` with
 *                                  // Harbour-ledger-recorded comments filtered out before hashing,
 *                                  // for "is this scanned task worth spending another scan on?"
 *                                  // rather than "has a pending ruling's basis moved?". Compared via
 *                                  // `basisVersion` (shared with `basisHash`, never a separate
 *                                  // version field) and `lib/scan-fingerprint.js`'s `dueChanged`.
 *                                  // `null` on any row written before LIN-2649 WS2, or on a
 *                                  // terminal row until the [F-2] patch below back-fills it.
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
    basisHash: doc.basisHash ?? null,
    basisVersion: doc.basisVersion ?? null,
    dueBasisHash: doc.dueBasisHash ?? null,
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
   * @param {string|null} [entry.basisHash] - scan-basis digest (lib/scan-fingerprint.js); omitted
   *   leaves the row's basis UNKNOWN rather than asserting it never changed
   * @param {number|null} [entry.basisVersion] - BASIS_VERSION that produced `basisHash` (and, since
   *   LIN-2649 WS2, `dueBasisHash` — the two share one version field)
   * @param {string|null} [entry.dueBasisHash] - due-basis digest (lib/scan-fingerprint.js's
   *   dueBasisHashFromContext); omitted leaves the row's due-basis UNKNOWN, same discipline as `basisHash`
   * @param {Object|null} [entry.decision] - parseDecision's shape, or null (zero-finding)
   * @returns {Promise<Object|null>} the stored record (new, refreshed, or preserved), or null on bad input/error
   */
  async recordScan({ urlKey, issueId, issueIdentifier, inputHash, basisHash = null, basisVersion = null, dueBasisHash = null, decision = null } = {}) {
    if (!this.collection || !urlKey || !issueId || !inputHash) return null;
    if (!UUID_REGEX.test(issueId)) return null; // canonical-UUID guard — see class docstring

    try {
      const _id = TaskDecisionsStore.buildId(issueId, inputHash);
      const existing = await this.collection.findOne({ _id, urlKey });
      if (existing && existing.outcome) {
        // [F-2] terminal-row write gap (LIN-2649 WS2, disposition (a) — widen the
        // write, not the copy): a fingerprint is not the outcome. An
        // answered/dismissed row whose content hasn't changed still deserves a
        // due-basis fingerprint, or the due tab's own "scan to establish a
        // baseline" remedy can never be fulfilled for this population. Patch
        // ONLY dueBasisHash/basisVersion — outcome/outcomeAt/decision/basisHash
        // are NEVER in this $set, so the terminal-row invariant (never silently
        // un-dismissing/un-answering a prior ruling) holds by field list, by
        // construction, not by convention. basisVersion is patched alongside
        // because the two are compared together in dueChanged — a stale version
        // beside a fresh hash would reintroduce a version-mismatch bug.
        const freshDueBasisHash = dueBasisHash != null ? String(dueBasisHash) : null;
        const storedDueBasisHash = existing.dueBasisHash ?? null;
        if (freshDueBasisHash && freshDueBasisHash !== storedDueBasisHash) {
          const freshBasisVersion = Number.isFinite(basisVersion) ? basisVersion : null;
          await this.collection.updateOne({ _id, urlKey }, { $set: { dueBasisHash: freshDueBasisHash, basisVersion: freshBasisVersion } });
          return toRecord({ ...existing, dueBasisHash: freshDueBasisHash, basisVersion: freshBasisVersion });
        }
        return toRecord(existing); // terminal row: never silently un-dismissed/un-answered
      }

      const doc = {
        _id,
        urlKey,
        issueId,
        issueIdentifier: issueIdentifier != null ? String(issueIdentifier) : '',
        inputHash: String(inputHash),
        basisHash: basisHash != null ? String(basisHash) : null,
        basisVersion: Number.isFinite(basisVersion) ? basisVersion : null,
        dueBasisHash: dueBasisHash != null ? String(dueBasisHash) : null,
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
   * Count every scan row for a workspace, regardless of outcome (test-harness
   * only; see routes/test.js). The verification counterpart to `clear` —
   * LIN-2270 was a `clear` call silently targeting a urlKey the fixtures
   * never wrote to, so a passing suite gave no signal that cleanup actually
   * worked. `find().toArray().length` rather than `countDocuments` mirrors
   * `_docsFor`/`clear`'s own MangoDB-safe convention elsewhere in this file.
   */
  async count(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      return docs.length;
    } catch (err) {
      console.error('Error counting task decisions:', err);
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
      // LIN-2227: filter in the query, not in JS — this store is deliberately
      // durable with no TTL, so fetching every answered/dismissed/zero-finding
      // row on every rulings poll (the ambient badge polls on an interval on
      // every page that carries it) grows monotonically. `recordScan` always
      // writes `outcome`/`decision` explicitly (never absent), so the shape
      // below is exact, not an approximation. `$ne` is documented dual-backend
      // safe (Mongo + file-backed) elsewhere in this codebase
      // (lib/dispatch-store.js). Still raw candidate rows, unchanged contract —
      // no dedup here; collectUnansweredDecisions owns that reduction.
      const docs = await this.collection.find({ urlKey: { $in: urlKeys }, outcome: null, decision: { $ne: null } }).toArray();
      return docs.map(toRecord);
    } catch (err) {
      console.error('Error listing unanswered task decisions:', err);
      return [];
    }
  }

  /**
   * Bulk-list every RESOLVED (`outcome` set), decision-bearing scan row
   * across a workspace set (LIN-1736) — the task-bound half of the
   * escalation KPIs' time-to-response and false-escalation inputs; the
   * loop-backed half is `resolvedDecisionEvents` (lib/pipeline-loops.js).
   *
   * `outcomeAt` is the resolution instant `markOutcome` stamps; `scannedAt`
   * is when the row was raised. Recency filtering (`sinceMs`) is done here
   * in JS rather than pushed into the query the way `listUnansweredForWorkspaces`
   * (LIN-2227) does — that method is read on every ambient-badge poll and
   * durable-with-no-TTL growth matters there; this one is read only on
   * demand (the KPI page load), and the outcome-not-null filter already
   * excludes the store's dominant rows (unanswered + zero-finding).
   *
   * @param {Array<string>} urlKeys
   * @param {number} sinceMs - only rows whose `outcomeAt` is at or after this epoch ms
   * @returns {Promise<Array<Object>>} unordered public-shape records (see `toRecord`)
   */
  async listResolvedForWorkspaces(urlKeys, sinceMs) {
    if (!this.collection || !Array.isArray(urlKeys) || urlKeys.length === 0) return [];
    try {
      const docs = await this.collection.find({ urlKey: { $in: urlKeys }, outcome: { $ne: null } }).toArray();
      const cutoff = Number.isFinite(sinceMs) ? sinceMs : -Infinity;
      return docs.filter(doc => toMillis(doc.outcomeAt) >= cutoff).map(toRecord);
    } catch (err) {
      console.error('Error listing resolved task decisions:', err);
      return [];
    }
  }

  /**
   * List due-check candidates for a workspace (LIN-2649 WS2/S3) — one row per
   * distinct `issueId` (the latest by `(scannedAt, seq)`), keyset-paginated
   * `(scannedAt asc, issueId asc)`. Never-scanned tasks are absent by
   * construction: the candidate population is exactly the distinct issueIds
   * already in this store, not a sweep of every open issue.
   *
   * Plain find + JS-side reduction/sort/keyset-filter, deliberately NOT a
   * `$group` aggregation — every other method in this store (see above) does
   * its reduction in JS, so this stays consistent with that convention rather
   * than introducing a second query shape; the route this feeds is on-demand,
   * not polled, so the full-workspace read is bounded by usage frequency, not
   * request volume. `lib/dispatch-store.js` / `lib/kpi-stats.js` establish the
   * aggregation pattern and are the precedented escape hatch if a workspace's
   * population ever grows large enough to need it — not built here.
   *
   * KNOWN, RECORDED property, not a bug: under CONCURRENT scanning the
   * `(scannedAt asc, issueId asc)` keyset can return an already-returned
   * candidate again on a later page — a re-scan can only move a row FORWARD
   * in this ordering (a later `scannedAt`), so it can land past a cursor a
   * second time. Forward motion only means this can never create a GAP; a
   * duplicated row on an on-demand tab is cosmetic. Left as-is.
   *
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {{scannedAt: string, issueId: string}|null} [options.cursor] - opaque
   *   keyset position from a prior page's `nextCursor`; null/absent starts at the beginning
   * @param {number} [options.limit=40]
   * @returns {Promise<{items: Array<Object>, nextCursor: {scannedAt: string, issueId: string}|null, totalCandidateCount: number}>}
   */
  async listCandidatesForWorkspace(urlKey, { cursor = null, limit = 40 } = {}) {
    if (!this.collection || !urlKey) return { items: [], nextCursor: null, totalCandidateCount: 0 };
    try {
      const docs = await this.collection.find({ urlKey }).toArray();

      // Latest row per issueId — same (scannedAt, seq) comparator _docsFor's
      // newest-first sort uses, kept as a running max rather than a full sort.
      const latestByIssueId = new Map();
      for (const doc of docs) {
        const prior = latestByIssueId.get(doc.issueId);
        if (!prior) {
          latestByIssueId.set(doc.issueId, doc);
          continue;
        }
        const docMs = toMillis(doc.scannedAt);
        const priorMs = toMillis(prior.scannedAt);
        if (docMs > priorMs || (docMs === priorMs && (doc.seq || 0) > (prior.seq || 0))) {
          latestByIssueId.set(doc.issueId, doc);
        }
      }

      const candidates = Array.from(latestByIssueId.values())
        .sort((a, b) => (toMillis(a.scannedAt) - toMillis(b.scannedAt)) || (a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0));
      const totalCandidateCount = candidates.length;

      const afterCursor = cursor
        ? candidates.filter(doc => {
            const docMs = toMillis(doc.scannedAt);
            const cursorMs = toMillis(cursor.scannedAt);
            return docMs > cursorMs || (docMs === cursorMs && doc.issueId > cursor.issueId);
          })
        : candidates;

      // Slice to limit+1 to derive hasMore/nextCursor without a second query.
      const page = afterCursor.slice(0, limit + 1);
      const hasMore = page.length > limit;
      const items = page.slice(0, limit).map(toRecord);
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? { scannedAt: last.scannedAt, issueId: last.issueId } : null;

      return { items, nextCursor, totalCandidateCount };
    } catch (err) {
      console.error('Error listing due-check candidates:', err);
      return { items: [], nextCursor: null, totalCandidateCount: 0 };
    }
  }

  /** Docs for a task, newest-first (scannedAt primary, seq breaks same-ms ties). */
  async _docsFor(urlKey, issueId) {
    const docs = await this.collection.find({ urlKey, issueId }).toArray();
    docs.sort((a, b) => (toMillis(b.scannedAt) - toMillis(a.scannedAt)) || ((b.seq || 0) - (a.seq || 0)));
    return docs;
  }

  /**
   * Cap a task's retained scan rows at `maxPerTask` by priority-ordered
   * eviction, not position (LIN-2211, ruling on top of LIN-2197 Phase 5
   * ledger item L2). A decision-bearing, unanswered row (`!outcome &&
   * decision`, the same predicate `listUnansweredForWorkspaces` above uses)
   * is an escalation still waiting on a human — capacity pruning is a TTL
   * with a different clock, and `docs/escalation-philosophy.md` rejected a
   * TTL for exactly this reason: it must never silently delete an unanswered
   * ruling. Such a row is therefore EXEMPT from eviction unconditionally,
   * even past `maxPerTask`.
   *
   * Eviction order for the rest: zero-finding rows (`!outcome && !decision`,
   * a persisted no-op) first, oldest-first; then terminal rows (`outcome`
   * set — their information is spent) oldest-first. Evict
   * `max(0, docs.length - maxPerTask)` rows total, draining bucket 1 then
   * bucket 2, and stop once both are exhausted — if every remaining row is a
   * live unanswered ruling, the cap is silently exceeded on purpose (the
   * "pressure valve": a task with that many unanswered rulings has a
   * false-escalation problem, not a storage problem).
   *
   * Newest-row exemption (LIN-2230 review fix, restoring the pre-LIN-2211
   * invariant on top of the bucket rewrite above): `docs[0]` — the row
   * `recordScan` just wrote, and what `getStatus` falls back to as current
   * when no exact-hash row matches — is excluded from both buckets
   * unconditionally, not just when it happens to be decision-bearing. Without
   * this, a zero-finding row (`decision: null`, bucket 1) written at
   * capacity could be evicted in the SAME `recordScan` call that wrote it —
   * "scan found nothing" becomes unrecordable, and the task is pinned
   * `stale` forever, since every rescan repeats the same delete. This only
   * ever excludes the single newest row; it does not change which bucket a
   * non-newest row falls into or the oldest-first order within a bucket.
   */
  async _pruneToCapacity(urlKey, issueId) {
    try {
      const docs = await this._docsFor(urlKey, issueId);
      let toEvict = Math.max(0, docs.length - this.maxPerTask);
      if (toEvict === 0) return;

      // docs[0] (newest — the row this recordScan call just wrote) is never
      // a candidate; see the newest-row exemption note above.
      const candidates = docs.slice(1);

      const zeroFinding = [];
      const terminal = [];
      for (const doc of candidates) {
        if (!doc.outcome && !doc.decision) zeroFinding.push(doc);
        else if (doc.outcome) terminal.push(doc);
        // else: decision-bearing, unanswered — exempt, never evicted
      }
      // Both buckets are newest-first (from `_docsFor`); evict oldest-first.
      zeroFinding.reverse();
      terminal.reverse();

      for (const doc of [...zeroFinding, ...terminal]) {
        if (toEvict <= 0) break;
        await this.collection.deleteOne({ _id: doc._id, urlKey });
        toEvict--;
      }
    } catch (err) {
      console.error('Error pruning task decision scans:', err);
    }
  }
}
