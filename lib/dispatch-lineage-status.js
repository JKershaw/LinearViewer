/**
 * Write-time persistence of a dispatch row's LINEAGE-level list fields (LIN-3812,
 * LIN-3810 H2, closes LIN-2120).
 *
 * `GET /api/proxy/dispatch` reports, per row, a lineage-wide `status`,
 * `completedAt` and `feedbackCount`: the row's own feedback merged with the
 * feedback its `rootItemId` siblings posted (LIN-1470), with an abort attributed
 * to the row it targets (LIN-1261 F2). That used to be derived in JS on every
 * list read from a 200 + 2,000-row window, which is why `?status=` could not see
 * past the window (LIN-2120). The same derivation now runs when a feedback write
 * (or a closer, or a take) changes one of its inputs, and the result is persisted
 * on the history row:
 *
 *   lineageStatus          deriveWireStatus(...) of the merged feedback, or null
 *   lineageCompletedAt     deriveCompletedAt(...) of the merged feedback, or null
 *   lineageFeedbackCount   own feedback + the siblings' forward-only tagged entries
 *   lineageBasis           input counter: bumped by every write that changes an input
 *   lineageStatusBasis     the lineageBasis the three values above were derived from
 *                          (null = never derived; the self-heal fills it on read)
 *
 * A row is FRESH when `lineageStatusBasis === lineageBasis`. A mismatch is how a
 * raced write is detected (a sibling's fan-out landing after a recompute already
 * counted its entry), and the read-time self-heal re-derives it.
 *
 * `deriveLineageFields` is the ONE derivation. The list used to inline it
 * (`resolveListRows`); the writers, the self-heal, the backfill and the
 * characterization oracle all call this instead.
 */
import { deriveCompletedAt, deriveWireStatus, feedbackWithHarvestedAbort, harvestAbortedTargets, isStatusBearingMessage, mergeLineageFeedback } from './dispatch-terminal.js';

/** CAS attempts a recompute makes on a row before it logs and leaves the previous values. */
export const LINEAGE_RECOMPUTE_ATTEMPTS = 3;

/** Wire statuses `deriveTerminalStatus` can return: a closer never overrides one (terminal > closed > blocked). */
export const LINEAGE_TERMINAL_STATUSES = Object.freeze(['done', 'failed', 'aborted', 'skipped']);

/** The columns a derivation reads. Exclusion form: the only projection the mock and MangoDB are known to share. */
export const LINEAGE_ROW_PROJECTION = Object.freeze({ prompt: 0, feedbackDigest: 0 });

/**
 * Seed for a row that never joins a lineage (`cancelled` / `expired` archives,
 * `joinsLineage`): nothing can ever change its derivation, so it is born fresh.
 * A `taken` archive is NOT seeded fresh (see `LINEAGE_TAKEN_SEED`).
 */
export const LINEAGE_STATIC_SEED = Object.freeze({
  lineageStatus: null,
  lineageCompletedAt: null,
  lineageFeedbackCount: 0,
  lineageBasis: 0,
  lineageStatusBasis: 0
});

/**
 * Seed for a `taken` archive: `lineageStatusBasis: null` is the "not yet derived"
 * marker legacy rows carry too, so a crash between the insert and its recompute is
 * healed by the read-time self-heal and `ensureLineageStatus`.
 */
export const LINEAGE_TAKEN_SEED = Object.freeze({ ...LINEAGE_STATIC_SEED, lineageStatusBasis: null });

const rowKey = (row) => row.id ?? row._id;

/**
 * The lineage anchor of a history row (LIN-1470): the doc-level rootItemId, else the
 * first OWN feedback entry carrying one, else the row's own id. NEVER sessionId /
 * sessionGroupId: every worker an autopilot spawns shares its orchestrator's sessionId,
 * so grouping on it would collapse all siblings onto one anchor and reinstate the
 * LIN-1461 production bug. Reads raw docs (`_id`) and formatted rows (`id`) alike.
 */
export const anchorFor = (row) => row.rootItemId ?? row.feedback?.find(f => f.rootItemId)?.rootItemId ?? rowKey(row);

/** A row whose anchor came from an entry-level tag only (no doc-level `rootItemId`): see `recomputeLineageRows`. */
const anchorFromEntryOnly = (row) => !row.rootItemId && !!row.feedback?.some(f => f.rootItemId);

/**
 * A row's three lineage values, derived. Pure.
 *
 *  - Only a row that RAN (`status === 'taken'`) joins its lineage (LIN-1470 F1): a
 *    queued/cancelled/expired row keeps its own (empty) feedback, so a cancelled
 *    follow-up never inherits a sibling's `[done]`.
 *  - FORWARD-ONLY (LIN-1470 F7): `mergeLineageFeedback` takes the row's own
 *    `dispatchedAt` as `since`, so a sibling entry only counts if stamped at or after it.
 *  - The lineage merge runs BEFORE abort attribution (LIN-1261 F2): the F1 guard only
 *    lets an abort win when strictly later than the lineage's real terminal.
 *    `lineageFeedbackCount` excludes the synthetic abort entry.
 *
 * @param {Object} row  raw history doc (or formatted row) with `feedback`, `bookkeeping`, `status`, `dispatchedAt`
 * @param {Array<Object>} siblingRows  rows sharing the anchor (the row itself is skipped)
 * @param {Object|null} [abortEntry]  the `[aborted]` entry of an abort row targeting `row`
 * @returns {{lineageStatus: string|null, lineageCompletedAt: *, lineageFeedbackCount: number}}
 */
export function deriveLineageFields(row, siblingRows = [], abortEntry = null) {
  const joinsLineage = row.status === 'taken';
  const own = row.feedback || [];
  let lineageFeedback = own;
  if (joinsLineage) {
    const anchor = anchorFor(row);
    const siblings = siblingRows.filter(s => rowKey(s) !== rowKey(row));
    lineageFeedback = mergeLineageFeedback(own, siblings, anchor, row.dispatchedAt);
  }
  const terminalFeedback = feedbackWithHarvestedAbort(lineageFeedback, abortEntry);
  return {
    lineageStatus: deriveWireStatus({ feedback: terminalFeedback, bookkeeping: row.bookkeeping }) || null,
    // Passed through as stored (a Date for every real entry): the wire formats it, so an
    // entry with a junk timestamp reports the same junk the pre-persistence list did.
    lineageCompletedAt: deriveCompletedAt(terminalFeedback),
    lineageFeedbackCount: lineageFeedback.length
  };
}

/** True when the persisted values were derived from the row's current inputs. */
export function isLineageFresh(doc) {
  return typeof doc.lineageStatusBasis === 'number' && doc.lineageStatusBasis === (doc.lineageBasis ?? 0);
}

/**
 * Re-derive and persist the lineage fields of `ids` (history rows of one workspace).
 * One batched read of the rows, one of every lineage's members, one of the abort rows
 * targeting them; then a per-row write that is a compare-and-set on the row's own
 * `lineageBasis` AND `feedbackVersion`, so any input write that landed after the read
 * makes it lose and retry (up to LINEAGE_RECOMPUTE_ATTEMPTS, then it logs and leaves
 * the previous values: the row stays stale and the read-time self-heal retries).
 *
 * Values are written ABSOLUTELY, so a recompute also corrects any count drift.
 * A row whose anchor came from an entry-level tag only (a pre-LIN-1468 row) is
 * never marked fresh (`lineageStatusBasis: null`): later siblings' fan-out cannot
 * reach it by query, so it is re-derived on every read instead of trusted.
 *
 * @param {Object} history  the history collection
 * @param {string} urlKey
 * @param {string[]} ids
 * @returns {Promise<Map<string, {lineageStatus: *, lineageCompletedAt: *, lineageFeedbackCount: number}>>}
 *   the derived values per row found (also for a row whose write lost every CAS attempt)
 */
export async function recomputeLineageRows(history, urlKey, ids, { attempts = LINEAGE_RECOMPUTE_ATTEMPTS } = {}) {
  const derived = new Map();
  let pending = [...new Set(ids)];
  for (let attempt = 1; pending.length > 0 && attempt <= attempts; attempt++) {
    const rows = await history.find({ urlKey, _id: { $in: pending } }, { projection: LINEAGE_ROW_PROJECTION }).toArray();
    if (rows.length === 0) break;

    const anchors = [...new Set(rows.filter(r => r.status === 'taken').map(anchorFor))];
    const byAnchor = new Map();
    if (anchors.length) {
      const members = await history.find({ urlKey, rootItemId: { $in: anchors } }, { projection: LINEAGE_ROW_PROJECTION }).toArray();
      for (const m of members) {
        const bucket = byAnchor.get(m.rootItemId);
        if (bucket) bucket.push(m);
        else byAnchor.set(m.rootItemId, [m]);
      }
    }
    // Same order the list read its rows in (resolvedAt desc, last abort row for a target wins).
    const aborts = await history
      .find({ urlKey, abort: true, abortTo: { $in: rows.map(r => r._id) } }, { projection: LINEAGE_ROW_PROJECTION })
      .sort({ resolvedAt: -1 })
      .toArray();
    const abortedTargets = harvestAbortedTargets(aborts);

    const lost = [];
    for (const row of rows) {
      const fields = deriveLineageFields(row, row.status === 'taken' ? (byAnchor.get(anchorFor(row)) || []) : [], abortedTargets.get(row._id));
      derived.set(row._id, fields);
      const cas = { _id: row._id, urlKey };
      if (row.lineageBasis !== undefined) cas.lineageBasis = row.lineageBasis;
      if (row.feedbackVersion !== undefined) cas.feedbackVersion = row.feedbackVersion;
      const res = await history.updateOne(cas, {
        $set: { ...fields, lineageStatusBasis: anchorFromEntryOnly(row) ? null : (row.lineageBasis ?? 0) }
      });
      if (!res || res.matchedCount === 0) lost.push(row._id);
    }
    pending = lost;
  }
  if (pending.length > 0) {
    console.error(`Lineage recompute lost its compare-and-set ${attempts}x for ${pending.length} row(s) (e.g. ${pending[0]}); leaving them stale for the read-time self-heal.`);
  }
  return derived;
}

/**
 * After a feedback entry has been pushed onto `doc` (the post-write document): keep the
 * persisted lineage fields of every row the entry touches current.
 *
 * Own row: the `$inc lineageFeedbackCount` rides the SAME atomic update as the `$push`
 * (the store does it), so an entry and its count can never be seen apart.
 *
 * A TAGGED entry (`rootItemId = A`) also counts for the OTHER `taken` rows anchored at
 * A that were dispatched at or before it (forward-only): a count `$inc` plus a
 * `lineageBasis` bump, in two statements. The second exists only for a legacy root row
 * whose anchor falls back to its own id (no doc-level `rootItemId`): a modern root has
 * `rootItemId === _id`, already matches the first statement, and must not be counted
 * twice, hence `rootItemId: null`. The own `$push` has already landed when these run:
 * in the reverse order a recompute could read the bumped basis without the entry and
 * leave an undercount with equal bases that nothing heals.
 *
 * A STATUS-BEARING entry (`isStatusBearingMessage`) can change a status, so the affected
 * rows are re-derived: the own row, for a tagged entry every `taken` row of the lineage,
 * and, for an `[aborted]` posted by an abort row, the row it targets (LIN-1261 F2).
 */
export async function persistLineageForEntry(history, doc, entry) {
  const urlKey = doc.urlKey;
  const anchor = entry.rootItemId || null;
  if (anchor) {
    const bump = { $inc: { lineageFeedbackCount: 1, lineageBasis: 1 } };
    const since = { $lte: entry.timestamp };
    await history.updateMany(
      { urlKey, status: 'taken', rootItemId: anchor, _id: { $ne: doc._id }, dispatchedAt: since },
      bump
    );
    if (doc._id !== anchor) {
      await history.updateMany({ urlKey, status: 'taken', _id: anchor, rootItemId: null, dispatchedAt: since }, bump);
    }
  }
  if (!isStatusBearingMessage(entry.message)) return;

  const affected = new Set([doc._id]);
  if (anchor) {
    const members = await history.find({ urlKey, rootItemId: anchor }, { projection: LINEAGE_ROW_PROJECTION }).toArray();
    for (const m of members) if (m.status === 'taken') affected.add(m._id);
    const root = await history.findOne({ _id: anchor, urlKey }, { projection: LINEAGE_ROW_PROJECTION });
    if (root?.status === 'taken') affected.add(root._id);
  }
  if (doc.abort === true && doc.abortTo && /^\s*\[aborted\]/i.test(entry.message || '')) affected.add(doc.abortTo);
  await recomputeLineageRows(history, urlKey, [...affected]);
}

/**
 * A closer stamped `bookkeeping` on `ids` without a feedback write. Terminal > closed >
 * blocked, so a non-terminal row's lineage status is `closed` and a terminal one is
 * unchanged: one guarded write, no feedback read. `lineageBasis` is bumped so a row that
 * was fresh is re-derived once on its next read (cheap and exact) instead of being
 * trusted on a value the closer only approximated.
 */
export async function persistClosedLineage(history, urlKey, ids) {
  if (!ids || ids.length === 0) return;
  await history.updateMany(
    { urlKey, _id: { $in: ids }, lineageStatus: { $nin: LINEAGE_TERMINAL_STATUSES } },
    { $set: { lineageStatus: 'closed' }, $inc: { lineageBasis: 1 } }
  );
  // A terminal row's value is unchanged, but the stamp is still an input change.
  await history.updateMany(
    { urlKey, _id: { $in: ids }, lineageStatus: { $in: LINEAGE_TERMINAL_STATUSES } },
    { $inc: { lineageBasis: 1 } }
  );
}
