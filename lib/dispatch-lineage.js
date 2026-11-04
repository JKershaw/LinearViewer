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
import { lastUsageEntry } from './row-usage.js';
import { anchorOf } from './lineage-membership.js';

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
 * A dispatch's LAST `kind: 'usage'` entry, raw, in either shape (lib/row-usage.js, LIN-4134).
 * The aggregation path carries the pre-derived `usageEntry` from the $project's $last.
 */
export function usageOf(doc) {
  if (Array.isArray(doc.feedback)) return lastUsageEntry(doc.feedback);
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
 * derive each row's terminal → group survivors into per-lineage outcomes keyed
 * on `anchorOf` (lib/lineage-membership.js). Steps 1-4 of the pipeline
 * `computeDispatchOutcomes` below used to inline directly; extracted here
 * (LIN-1957) because it has a genuine SECOND consumer — the terminal-marked-
 * task-cost numerator (`lib/terminal-marked-task-cost.js`) — not written
 * speculatively. A hand-written second copy of this pipeline is exactly the
 * correctness risk this extraction exists to avoid.
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
 * Per lineage this returns the outcome facts only, read by `computeDispatchOutcomes`
 * (`earliest`, `status`, `statusMs`) and by the terminal-marked numerator
 * (`ticketMarkers`, LIN-2253):
 * - `earliest` — the earliest dispatch of any non-abort row in the lineage,
 *   never-ran rows included, exactly as before LIN-4147.
 * - `status` / `statusMs` — the latest terminal marker across the lineage's rows.
 * - `ticketMarkers` — every `[ticket] LIN-XXXX <state>[ — <outcome>]` marker posted
 *   across the lineage's rows, parsed via `parseTicketMarkers` (one entry per
 *   identifier, latest state wins, first-seen order preserved). A worker-lane
 *   session's own `issueIdentifier` covers only the dispatch's anchor ticket; this
 *   is what lets a cost/coverage consumer see the OTHER tickets the same lane
 *   landed. Raw marker entries are grouped per contributing row by its own
 *   `dispatchedAt`, sorted by that key, then flattened and parsed:
 *   `parseTicketMarkers` is last-ARRAY-POSITION-wins, not timestamp-aware, so its
 *   input must already be chronological. Rows arrive unsorted, so push order is not
 *   a fact about the data.
 *
 * Cost membership and the issue a lineage counts under are NOT decided here (LIN-4147):
 * the cost read (lib/cost-read.js) takes them from `groupLineageMembership`, so an abort row or a
 * never-ran row can found nothing there.
 *
 * @param {Array<Object>} rows - history + queue dispatch rows, either shape
 * @returns {Map<string, {earliest: number|null, status: string|null, statusMs: number|null, ticketMarkers: Array<Object>}>}
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
    const key = String(anchorOf(row));
    const dispatched = toEpochMs(row.dispatchedAt);
    // A missing/unparseable terminal timestamp orders last-place rather than
    // discarding the marker: with one terminal in the lineage it still wins.
    const terminalMs = terminal ? toEpochMs(terminal.entry?.timestamp) : null;

    let lineage = lineages.get(key);
    if (!lineage) {
      lineage = { earliest: dispatched, status: null, statusMs: null, _ticketMarkerRaw: [] };
      lineages.set(key, lineage);
    } else if (dispatched !== null && (lineage.earliest === null || dispatched < lineage.earliest)) {
      lineage.earliest = dispatched;
    }
    // LIN-2253: raw ticket-marker entries accumulate per row, each tagged with
    // the CONTRIBUTING ROW's own dispatchedAt, sorted once at finalize time below.
    const ticketEntries = ticketMarkerEntriesOf(row);
    if (ticketEntries.length) lineage._ticketMarkerRaw.push({ dispatched, entries: ticketEntries });
    if (terminal && (lineage.status === null || (terminalMs !== null && (lineage.statusMs === null || terminalMs > lineage.statusMs)))) {
      lineage.status = terminal.status;
      lineage.statusMs = terminalMs;
    }
  }

  // Finalize ticketMarkers: sort each lineage's contributions by the contributing
  // row's own dispatchedAt (unknown-time entries sort last), then parse. The sort is
  // per CONTRIBUTING-ROW group (`entries`), not per marker, since a marker's own
  // timestamp is author-supplied prose-adjacent metadata, while the row's dispatchedAt
  // already is a reliable sort key.
  for (const lineage of lineages.values()) {
    lineage.ticketMarkers = parseTicketMarkers(
      lineage._ticketMarkerRaw
        .sort((a, b) => (a.dispatched ?? Infinity) - (b.dispatched ?? Infinity))
        .flatMap(({ entries }) => entries)
    );
    delete lineage._ticketMarkerRaw;
  }

  return lineages;
}

