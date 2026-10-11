/**
 * Dispatch-lineage helpers (LIN-2388): normalising a dispatch row's feedback in
 * either load shape and grouping rows into per-lineage accumulators. Moved
 * verbatim out of `lib/kpi-stats.js` so its peers (`terminal-marked-task-cost`,
 * `weekly-budget`, `digest-feedback`) can import them without importing back up
 * into `kpi-stats`, which itself imports them. This is a LEAF: it imports no
 * peer among those modules, and must not (a module-scope read of a peer here
 * would reintroduce an order-dependent TDZ hazard).
 */

import { findTerminalFeedback, harvestAbortedTargets, feedbackWithHarvestedAbort } from './dispatch-terminal.js';
import { parseTicketMarkers } from './session-telemetry.js';
import { toEpochMs } from './utils/time.js';

// The outcome headline's own window. Wider than the 4×7-day trend span so the
// headline uses the full 30-day reporting window; a lineage aged 28-30 days
// therefore counts toward the rate and coverage label but lands in no weekly
// bucket. Deliberately a literal, not derived from READ_HORIZON_DAYS.
export const OUTCOME_WINDOW_DAYS = 30;

/**
 * The feedback entries to derive a dispatch's terminal facts from, in either
 * shape — the exact sibling of `feedbackLen` above, and the ONE place the two
 * load paths differ. The find path (mock, and the aggregation fallback) carries
 * the raw `feedback` array; the aggregation path carries at most one derived
 * `terminalEntry`. Everything downstream — harvest, the F1 guard, status
 * derivation, grouping, bucketing — runs on this normalized value, so the paths
 * cannot drift. Queue rows never carry feedback at all (`addFeedback` writes
 * only to history), so they normalize to [].
 */
function terminalFeedbackOf(doc) {
  if (Array.isArray(doc.feedback)) return doc.feedback;
  return doc.terminalEntry ? [doc.terminalEntry] : [];
}

/**
 * A dispatch's raw execution harness (LIN-1957), e.g. 'claude-code'/'opencode',
 * or null when absent. Unlike feedbackLen/terminalFeedbackOf above, `harness`
 * is a plain top-level field on BOTH load paths — the find path carries it
 * natively (dispatch-store.js stores it there), and the aggregation path now
 * projects it explicitly (`harness: 1`) — so there is no dual-shape derivation
 * to reconcile, only a type guard.
 */
export function harnessOf(doc) {
  return typeof doc.harness === 'string' ? doc.harness : null;
}

/**
 * A dispatch's LAST `kind: 'usage'` feedback entry, in either shape — the
 * sibling of `terminalFeedbackOf` for the LIN-1957 numerator. The find path
 * (mock, and the aggregation fallback) scans the raw `feedback` array itself,
 * last-wins (mirrors `parseUsage`'s own last-wins walk); the aggregation path
 * carries the pre-derived `usageEntry` the $project above computes with
 * $last, so this never re-scans an unbounded array.
 */
export function usageOf(doc) {
  if (Array.isArray(doc.feedback)) {
    let last = null;
    for (const entry of doc.feedback) {
      if (entry?.kind === 'usage') last = entry;
    }
    return last;
  }
  return doc.usageEntry || null;
}

/**
 * Count of a dispatch's `kind: 'evidence'` feedback entries, in either shape —
 * the exact sibling of `feedbackLen` for the LIN-1957 numerator.
 */
export function evidenceCountOf(doc) {
  if (Array.isArray(doc.feedback)) return doc.feedback.filter(entry => entry?.kind === 'evidence').length;
  return Number.isFinite(doc.evidenceCount) ? doc.evidenceCount : 0;
}

/**
 * A dispatch's raw `[ticket] ...` marker feedback entries, in either shape
 * (LIN-2253) — the exact sibling of `evidenceCountOf`/`usageOf` above. The
 * find path (mock, and the aggregation fallback) hands back the WHOLE raw
 * feedback array — safe because `parseTicketMarkers` already ignores every
 * non-matching entry itself, so passing the unfiltered array is equivalent
 * to pre-filtering it. The aggregation path carries the pre-filtered
 * `ticketMarkerEntries` the $project above computes server-side.
 */
export function ticketMarkerEntriesOf(doc) {
  if (Array.isArray(doc.feedback)) return doc.feedback;
  return Array.isArray(doc.ticketMarkerEntries) ? doc.ticketMarkerEntries : [];
}

/**
 * Normalise → harvest aborted-row markers (at ROW level, BEFORE grouping) →
 * derive each row's terminal → group survivors into per-lineage accumulators
 * keyed on `rootItemId` (falling back to `_id` for pre-LIN-1468 rows with no
 * anchor). Steps 1-4 of the pipeline `computeDispatchOutcomes` below used to
 * inline directly; extracted here (LIN-1957) because it now has a genuine
 * SECOND consumer — the terminal-marked-task-cost numerator
 * (`lib/terminal-marked-task-cost.js`, beat 4) — not written speculatively. A
 * hand-written second copy of this pipeline is exactly the correctness risk
 * this extraction exists to avoid.
 *
 * ORDERING IS STILL THE MOST ERROR-PRONE PART OF THIS FUNCTION, and it is NOT
 * implicit once extracted: the harvest below runs over ALL of `normalized`
 * (abort rows included) BEFORE the loop that drops them, because the harvest
 * map is keyed on a dispatch *id* an abort TARGETS — an id that stops being
 * independently addressable once rows are grouped into lineages. Reverse the
 * two steps and one cancelled task yields two wrong lineages (this exact
 * failure mode is what beat 1's mutation probe reproduced and beat 3's
 * mutation probe below re-confirms against this extracted home).
 *
 * `computeDispatchOutcomes` reads only `earliest`/`status`/`statusMs` from the
 * returned accumulator, byte-for-byte as before extraction. The three added
 * fields are for the LIN-1957 numerator only:
 * - `harness` — captured ONCE from the lineage's EARLIEST row only (by
 *   `dispatchedAt`, not by iteration/array order — same non-order-dependent
 *   rule `earliest` itself already followed), never overwritten by a later
 *   row's own harness. Grounded in dispatcher.js:562-566 (simple-dispatcher):
 *   a follow-up's executing engine is inherited from the ORIGINAL session and
 *   "never re-resolved from the follow-up item," so a follow-up's stored
 *   harness is not authoritative for the lineage.
 * - `rowUsage` — each contributing row's own raw usage entry (via `usageOf`),
 *   sorted by the contributing row's OWN `dispatchedAt` (LIN-1957 review F3 —
 *   the input is an unsorted concatenation of an unsorted aggregate and an
 *   unsorted find, so array/iteration order is not a fact about the data and
 *   must not change the result), rows with none omitted. Beat 4's
 *   harness-conditional reduce (opencode sums, claude-code/unknown last-wins
 *   over the LAST entry) and cost parsing (`parseUsage([entry])`, decision
 *   (b)) consume this sorted form — parsing deliberately stays out of this
 *   extraction, which moves existing behavior rather than adding new
 *   business logic.
 * - `issueIdentifier` — LIN-1957 review F2: decoupled from `harness`, NOT the
 *   same earliest row. Captured from the EARLIEST row that actually CARRIES
 *   one (by `dispatchedAt`, same non-order-dependent comparison `earliest`
 *   and `harness` use — a null-identifier earliest row must not blank out a
 *   later row's identifier). For beat 4's issue-level (not lineage-level)
 *   denominator. Internal grouping key only; must never reach
 *   `computeDispatchOutcomes`'s or `collectKpiStats`'s output. LIN-2121 L1:
 *   rows with `kind: 'wake'` are EXCLUDED from this capture — a wake may
 *   inherit a lineage's attribution but never found it.
 * - `ticketMarkers` (LIN-2253) — every `[ticket] LIN-XXXX <state>[ —
 *   <outcome>]` marker posted anywhere across the lineage's rows, parsed via
 *   `parseTicketMarkers` (one entry per identifier, latest state wins,
 *   first-seen order preserved — same rules that module documents). A
 *   worker-lane session's own `issueIdentifier` covers only the dispatch's
 *   anchor ticket; this is what lets a cost/coverage consumer see the OTHER
 *   tickets the same lane landed, which have no lineage of their own at all.
 *   `parseTicketMarkers` is last-ARRAY-POSITION-wins, not timestamp-aware —
 *   correctness depends on its input already being chronological. Raw marker
 *   entries accumulate per row during the main pass below, GROUPED by each
 *   contributing row's own `dispatchedAt`, then sorted by that same key at
 *   finalize time before being flattened and parsed — the exact F3 discipline
 *   `rowUsage` already follows, applied here for the same reason (`rows` is
 *   an unsorted concatenation of an unsorted aggregate and an unsorted find,
 *   so push/iteration order is not a fact about the data).
 *
 * @param {Array<Object>} rows - history + queue dispatch rows, either shape
 * @returns {Map<string, {earliest: number|null, status: string|null, statusMs: number|null, harness: string|null, rowUsage: Array<Object>, issueIdentifier: string|null, ticketMarkers: Array<Object>}>}
 */
export function groupDispatchLineages(rows) {
  // 1. Normalize both load paths to one feedback shape, once.
  const normalized = rows.map(row => ({ row, feedback: terminalFeedbackOf(row) }));

  // 2. Harvest at ROW level, before any grouping — the map is keyed on the
  //    dispatch id an abort TARGETS, which no longer exists after grouping.
  const abortedTargets = harvestAbortedTargets(normalized.map(({ row, feedback }) => ({
    abort: row.abort,
    abortTo: row.abortTo == null ? row.abortTo : String(row.abortTo),
    feedback
  })));

  // 3. Attach the harvested abort, derive each row's terminal, then drop the
  //    abort rows themselves; 4. group the survivors into lineages.
  const lineages = new Map();
  for (const { row, feedback } of normalized) {
    if (row.abort === true) continue;
    const terminal = findTerminalFeedback(feedbackWithHarvestedAbort(feedback, abortedTargets.get(String(row._id))));
    const key = String(row.rootItemId || row._id);
    const dispatched = toEpochMs(row.dispatchedAt);
    // A missing/unparseable terminal timestamp orders last-place rather than
    // discarding the marker: with one terminal in the lineage it still wins.
    const terminalMs = terminal ? toEpochMs(terminal.entry?.timestamp) : null;

    let lineage = lineages.get(key);
    if (!lineage) {
      lineage = {
        earliest: dispatched, status: null, statusMs: null,
        harness: harnessOf(row), rowUsage: [], issueIdentifier: null, _issueIdentifierAt: null,
        _ticketMarkerRaw: []
      };
      lineages.set(key, lineage);
    } else if (dispatched !== null && (lineage.earliest === null || dispatched < lineage.earliest)) {
      lineage.earliest = dispatched;
      // The row that becomes the new earliest re-captures harness too, so
      // "earliest row only" holds regardless of iteration order. issueIdentifier
      // is decoupled below (LIN-1957 review F2) — it does NOT move with harness.
      lineage.harness = harnessOf(row);
    }
    // F2: issueIdentifier — captured from the EARLIEST row that actually
    // CARRIES one (may differ from the row that is `earliest` overall), same
    // non-order-dependent dispatchedAt comparison as `earliest`/`harness`
    // above. A null-identifier earliest row must not blank out a later row's
    // identifier — the approved plan's "set from any row carrying one".
    //
    // LIN-2121 L1: a wake row may INHERIT a lineage's attribution, never FOUND
    // it. Since LIN-2121 wake rows carry the triggering dispatch's
    // `issueIdentifier`, and LIN-1468's self-heal can reconcile a wake row onto
    // an identifier-LESS parent lineage (an autopilot/general run whose root has
    // no issue). Without this exclusion that wake would found the whole
    // lineage's attribution, moving its cost from the overhead bucket into the
    // wake's issue. Skip wake rows here so an identifier-less root lineage stays
    // identifier-less (in overhead) exactly as before the wake stamp, while a
    // lineage whose root carries an identifier is unchanged.
    if (row.kind !== 'wake' && row.issueIdentifier && (
      lineage.issueIdentifier === null ||
      (dispatched !== null && (lineage._issueIdentifierAt === null || dispatched < lineage._issueIdentifierAt))
    )) {
      lineage.issueIdentifier = row.issueIdentifier;
      lineage._issueIdentifierAt = dispatched;
    }
    const usage = usageOf(row);
    // F3: pushed with the row's own dispatchedAt attached and sorted once
    // below — `rows` is an unsorted concatenation of an unsorted aggregate
    // and an unsorted find, so push/iteration order is not a fact about the
    // data and must not leak into the claude-code/unknown last-wins reduce.
    if (usage) lineage.rowUsage.push({ dispatched, usage });
    // LIN-2253: raw ticket-marker entries accumulate per row, each tagged
    // with the CONTRIBUTING ROW's own dispatchedAt — same F3 discipline as
    // rowUsage above, and for the same reason: parseTicketMarkers is a
    // last-ARRAY-POSITION-wins fold (a later marker for the same identifier
    // overwrites the earlier one in place), so its input must already be in
    // chronological order for "last" to mean "latest state" rather than
    // "whichever row the unsorted input concatenation happened to visit
    // last." Sorted once at finalize time below, mirroring rowUsage's F3 sort
    // exactly.
    const ticketEntries = ticketMarkerEntriesOf(row);
    if (ticketEntries.length) lineage._ticketMarkerRaw.push({ dispatched, entries: ticketEntries });
    if (terminal && (lineage.status === null || (terminalMs !== null && (lineage.statusMs === null || terminalMs > lineage.statusMs)))) {
      lineage.status = terminal.status;
      lineage.statusMs = terminalMs;
    }
  }

  // F3: finalize rowUsage — sort each lineage's contributions by the
  // contributing row's own dispatchedAt (unknown-time entries sort last,
  // since an unknown position is the least authoritative choice for
  // last-wins), then strip back down to the plain usage-entry shape
  // consumers already expect. issueIdentifier's internal bookkeeping field
  // is also stripped here — never part of the public accumulator shape.
  for (const lineage of lineages.values()) {
    lineage.rowUsage = lineage.rowUsage
      .sort((a, b) => (a.dispatched ?? Infinity) - (b.dispatched ?? Infinity))
      .map(({ usage }) => usage);
    delete lineage._issueIdentifierAt;
    // LIN-2253 review: parseTicketMarkers is last-ARRAY-POSITION-wins, not
    // timestamp-aware, so its input must be sorted first — same F3 rule as
    // rowUsage just above, applied per-CONTRIBUTING-ROW group (`entries`)
    // rather than per-individual-marker, since a marker's own timestamp is
    // author-supplied prose-adjacent metadata, not a reliable sort key on
    // its own, while the contributing row's dispatchedAt already IS.
    lineage.ticketMarkers = parseTicketMarkers(
      lineage._ticketMarkerRaw
        .sort((a, b) => (a.dispatched ?? Infinity) - (b.dispatched ?? Infinity))
        .flatMap(({ entries }) => entries)
    );
    delete lineage._ticketMarkerRaw;
  }

  return lineages;
}
