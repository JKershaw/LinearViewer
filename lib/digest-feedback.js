/**
 * lib/digest-feedback.js
 *
 * LIN-2996 Phase 0 (LIN-3008): the pure extraction every later phase depends
 * on. Lands the shared per-row derivations plus `digestFeedback` itself, with
 * NO production reader or writer wired to the digest yet — that is Phase 1
 * (writers), Phase 3 (lean read) and Phase 4 (`/kpis`).
 *
 * `digestFeedback(doc, { now } = {})` derives the full persisted
 * `feedbackDigest` shape from a raw dispatch history doc — `doc.feedback`
 * (Mongo `Date` timestamps) and `doc.dispatchedAt` (a `Date` or ISO string)
 * — without mutating either and without any I/O.
 *
 * Two input shapes feed two different field groups (LIN-2996 Revision 5,
 * "W1" — the corrected digest-shape contract):
 *  - Loop-facing fields (`terminal`/`wake`/`decision`/`parkedWait`/`telemetry`)
 *    derive from `formatFeedbackEntries(doc.feedback)` — the SAME formatted
 *    (ISO-timestamp) shape `_formatHistoryItem` already hands `_buildLoops`
 *    today. This module and `lib/pipeline-loops.js`'s `_buildLoops` share the
 *    SAME per-row helper (`deriveLoopFacingFacts`) for exactly this reason —
 *    non-lean `_buildLoops` output must stay byte-identical whichever module
 *    the derivation physically runs in.
 *  - `kpi*` fields derive from `doc.feedback` RAW (Date timestamps
 *    preserved), narrowed exactly the way `lib/kpi-stats.js`'s
 *    `loadDispatchHistory` aggregation narrows them — reusing its own
 *    selectors (`usageOf`/`evidenceCountOf`) and the shared `TICKET_PREFIX`
 *    regex rather than retyping the selection logic a second time. A digest's
 *    `kpiEvidenceCount` therefore gates on `kind === 'evidence'`, not the
 *    loop-side `EVIDENCE_PREFIX` regex — the one place the two derivations
 *    deliberately diverge, inherited unchanged from `loadDispatchHistory`.
 *
 * Absence convention: every optional field is `null`, never `undefined` — the
 * Mongo driver would silently coerce the latter to the former on write
 * anyway, and every existing persisted shape in this codebase already uses
 * `null` for "absent" (see the LIN-3008 beat-1 grounding comment on the
 * ticket for the full reasoning).
 */
import { formatFeedbackEntries } from './dispatch-store.js';
import { findTerminalFeedback, findWakeEvent } from './dispatch-terminal.js';
import {
  buildRunTelemetry, parseDecision, __internal as SESSION_TELEMETRY_INTERNAL,
} from './session-telemetry.js';
import { usageOf, evidenceCountOf } from './kpi-stats.js';
import { PULSE_MAX_WINDOW_MS } from './live-console.js';

const { TICKET_PREFIX } = SESSION_TELEMETRY_INTERNAL;

// The wake markers that mean a run is *paused waiting on a human*, as opposed
// to the terminal wake markers (done/complete/failed/aborted). Moved here
// from `lib/pipeline-loops.js` (LIN-3008) — the single definition this
// module's `deriveLoopFacingFacts` and `_buildLoops` both need; that file
// imports it back rather than keeping its own copy. See the original
// docstring (pipeline-loops.js git history, LIN-1005/LIN-1025) for why only
// `[blocked]` belongs here and `[pending]` is deliberately excluded. Mirror
// any change here in routes/dashboard.js (loopIsWaiting).
export const WAITING_WAKE_MARKERS = new Set(['blocked']);

// ─── Decision derivation (LIN-2182 / H3) — moved from pipeline-loops.js ──────

/**
 * True for a `kind: 'decision-answer'` feedback entry (LIN-1728) — the typed
 * answer-state stamp `markDecisionAnswered` (dispatch-store.js) writes.
 * Moved here from `lib/pipeline-loops.js` (LIN-3008), which re-exports it
 * unchanged for its existing consumers (sessions-view.js, run-summary.js,
 * chat-tools.js, run-summary-cache.js) — exactly one definition.
 *
 * @param {{kind?: string}} entry
 * @returns {boolean}
 */
export function isDecisionAnswerEntry(entry) {
  return entry?.kind === 'decision-answer';
}

/**
 * Scan `feedback` backwards for the last entry with `kind === 'decision'`
 * whose message parses via `parseDecision`, returning both the parsed object
 * and its index (or `{ decision: null, decisionEntryIndex: -1 }` when none
 * parse). Moved verbatim from `lib/pipeline-loops.js`'s private
 * `_findLastDecision` (LIN-2182/H3) — see that history for the full
 * backward-scan rationale.
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @returns {{decision: Object|null, decisionEntryIndex: number}}
 */
export function _findLastDecision(feedback) {
  if (!Array.isArray(feedback)) return { decision: null, decisionEntryIndex: -1 };
  for (let i = feedback.length - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (entry?.kind !== 'decision') continue;
    const decision = parseDecision(entry?.message);
    if (decision) return { decision, decisionEntryIndex: i };
  }
  return { decision: null, decisionEntryIndex: -1 };
}

/**
 * Scan `feedback` backwards for the last `kind: 'decision-answer'` entry and
 * return the `decision_id` it names, or `null` when none exists / the entry
 * fails to parse. Moved verbatim from `lib/pipeline-loops.js`'s private
 * `_findDecisionAnswer` (LIN-1728).
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @returns {string|null}
 */
export function _findDecisionAnswer(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (let i = feedback.length - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (!isDecisionAnswerEntry(entry)) continue;
    try {
      const parsed = JSON.parse(entry.message);
      if (parsed && typeof parsed.decision_id === 'string') return parsed.decision_id;
    } catch {
      // Malformed stamp — treat as absent and keep scanning backward for an
      // earlier valid one, mirroring `_findLastDecision`'s discipline.
    }
  }
  return null;
}

/**
 * Pure helper: the maximal contiguous run of `kind: 'assistant-text'` entries
 * immediately preceding `decisionEntryIndex`, as an array of message strings.
 * Moved verbatim from `lib/pipeline-loops.js`'s private `correlateDecisionCase`
 * (LIN-2182/H3/LIN-1535: correlation is POSITIONAL only).
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @param {number} decisionEntryIndex
 * @returns {Array<string>}
 */
export function correlateDecisionCase(feedback, decisionEntryIndex) {
  if (!Array.isArray(feedback) || !Number.isInteger(decisionEntryIndex)) return [];
  const run = [];
  for (let i = decisionEntryIndex - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (entry?.kind !== 'assistant-text') break;
    run.push(entry?.message || '');
  }
  run.reverse();
  return run;
}

// ─── Shared per-row loop-facing derivation (_buildLoops ∩ digestFeedback) ────

/**
 * The shared per-row C3 derivation `_buildLoops` and `digestFeedback` both
 * call — operates on an already-FORMATTED feedback array (ISO timestamps)
 * plus an ISO `dispatchedAt`. Pure; never mutates its inputs.
 *
 * The two CROSS-row C3 members — abort harvest and the lineage heartbeat
 * union — are NOT here: they stay composed at read time in
 * `lib/pipeline-loops.js` (`_buildLoops` applies `feedbackWithHarvestedAbort`
 * to its own per-row `feedback` BEFORE calling this; `digestFeedback` never
 * harvests at all — that composition is Phase 3's job, not Phase 0's).
 *
 * @param {Array<Object>} feedback - formatted feedback (ISO timestamps)
 * @param {string|null} isoDispatchedAt
 * @returns {{terminal: Object|null, wake: {marker,waitingMessage}|null,
 *   decision: Object|null, decisionEntryIndex: number, decisionCase: Array,
 *   answeredDecisionId: string|null, telemetry: Object}}
 */
export function deriveLoopFacingFacts(feedback, isoDispatchedAt) {
  const terminal = findTerminalFeedback(feedback);

  const wakeEvent = findWakeEvent(feedback);
  const wake = wakeEvent
    ? {
      marker: wakeEvent.marker,
      waitingMessage: WAITING_WAKE_MARKERS.has(wakeEvent.marker) ? (wakeEvent.entry?.message || null) : null,
    }
    : null;

  const { decision, decisionEntryIndex } = _findLastDecision(feedback);
  const decisionCase = decision ? correlateDecisionCase(feedback, decisionEntryIndex) : [];
  const answeredDecisionId = _findDecisionAnswer(feedback);

  const telemetry = buildRunTelemetry({ dispatchedAt: isoDispatchedAt, feedback });

  return { terminal, wake, decision, decisionEntryIndex, decisionCase, answeredDecisionId, telemetry };
}

// ─── kpi* derivation (raw doc.feedback, Date timestamps preserved) ──────────

// Ledger L8: absent `message`/`timestamp` on a raw entry must normalize to
// `null` (this module's absence convention), never ride through as
// `undefined` — a present `Date` timestamp is passed through unchanged.
function narrowToMessageTimestamp(entry) {
  return entry ? { message: entry.message ?? null, timestamp: entry.timestamp ?? null } : null;
}

/**
 * The four `kpi*` fields, derived from RAW `doc.feedback` (Date timestamps
 * preserved) via the exact selectors `lib/kpi-stats.js`'s `loadDispatchHistory`
 * aggregation uses — reused, not reimplemented: `findTerminalFeedback` shares
 * `TERMINAL_FEEDBACK_REGEX` with the aggregation's own `$regexMatch`, `usageOf`/
 * `evidenceCountOf` are kpi-stats.js's own find-path selectors (last
 * `kind:'usage'` wins; count of `kind:'evidence'`), and the ticket-marker
 * filter reuses the SAME `TICKET_PREFIX` regex the aggregation's `$regexMatch`
 * uses (`session-telemetry.js`'s `__internal`, already shared this way for
 * LIN-2253). Each selected entry is narrowed to the aggregation's own
 * projected shape so a persisted digest matches `loadDispatchHistory`'s
 * output byte-for-byte.
 *
 * @param {Array<Object>} rawFeedback - doc.feedback, unformatted (Date timestamps)
 * @returns {{kpiTerminalEntry, kpiUsageEntry, kpiEvidenceCount, kpiTicketMarkerEntries}}
 */
function deriveKpiFacts(rawFeedback) {
  const terminal = findTerminalFeedback(rawFeedback);
  const kpiTerminalEntry = terminal ? narrowToMessageTimestamp(terminal.entry) : null;

  const usageEntry = usageOf({ feedback: rawFeedback });
  const kpiUsageEntry = usageEntry
    ? { message: usageEntry.message ?? null, timestamp: usageEntry.timestamp ?? null, kind: usageEntry.kind ?? null }
    : null;

  const kpiEvidenceCount = evidenceCountOf({ feedback: rawFeedback });

  const kpiTicketMarkerEntries = rawFeedback
    .filter(entry => TICKET_PREFIX.test(entry?.message || ''))
    .map(entry => ({ message: entry.message, timestamp: entry.timestamp }));

  return { kpiTerminalEntry, kpiUsageEntry, kpiEvidenceCount, kpiTicketMarkerEntries };
}

// ─── Metric retention + toolPeak (persisted digest only, R4/dashboard.js parity) ──

/**
 * Peak tool-activity figure across a run's FULL heartbeat list, before
 * retention trims it. Mirrors `routes/dashboard.js`'s private `peakToolCount`
 * exactly (same `m.total ?? m.toolCount` precedence, same max-over-list); not
 * imported from there since routes must depend on lib, never the reverse —
 * this is a fresh application of the same semantics to a new field, not a
 * modification of the existing one.
 *
 * @param {Array<Object>} metrics - the FULL parseHeartbeats() list, pre-retention
 * @returns {number|null}
 */
function toolPeakOf(metrics) {
  let best = null;
  for (const m of metrics) {
    const v = m && m.total != null ? m.total : (m ? m.toolCount : null);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/**
 * Retention rule for the PERSISTED digest's `telemetry.metrics` only (R4):
 * the union of every metric newer than `nowMs - PULSE_MAX_WINDOW_MS` (6h,
 * `lib/live-console.js`) and the last 6 metrics (`routes/dashboard.js`'s
 * `.slice(-6)`), de-duplicated, in original chronological order. Non-lean
 * `_buildLoops` builds never call this — they keep the full
 * `parseHeartbeats(feedback)` list via `deriveLoopFacingFacts`'s `telemetry`
 * untouched.
 *
 * @param {Array<Object>} metrics - full parseHeartbeat() objects, ISO timestamps
 * @param {number} nowMs
 * @returns {Array<Object>}
 */
function retainMetrics(metrics, nowMs) {
  const cutoffMs = nowMs - PULSE_MAX_WINDOW_MS;
  const last6 = new Set(metrics.slice(-6));
  return metrics.filter(m => {
    if (last6.has(m)) return true;
    const t = m?.timestamp ? Date.parse(m.timestamp) : NaN;
    return Number.isFinite(t) && t >= cutoffMs;
  });
}

// ─── digestFeedback(doc, { now }) ────────────────────────────────────────────

/**
 * The pure, complete `feedbackDigest` shape for one raw dispatch history doc.
 * `doc` carries the raw `.feedback` (Mongo `Date` timestamps) and
 * `.dispatchedAt` (a `Date` or an ISO string) — NEVER a bare feedback array;
 * a bare array has no `dispatchedAt` for `telemetry.runtime` and gives this
 * function no way to produce both the formatted (loop-facing) and raw
 * (`kpi*`) shapes it needs internally.
 *
 * `version` is NOT set here — it is the writer's own guard counter
 * (`doc.feedbackVersion`, LIN-1343-preserving `$inc`), stamped onto the
 * returned object by the Phase 1 write path, not derived from feedback.
 *
 * @param {{feedback?: Array, dispatchedAt?: (Date|string)}} doc
 * @param {{now?: number}} [options]
 * @returns {Object} the base feedbackDigest shape (see module docstring)
 */
export function digestFeedback(doc, { now } = {}) {
  // Ledger L1: `doc` must be the raw dispatch document, never a bare feedback
  // array — a bare array has no `.dispatchedAt` for `telemetry.runtime` and
  // would otherwise silently coerce to an empty-but-fresh digest (the "wrong
  // but fresh" shape N1 warns about). A doc whose `.feedback` is simply
  // missing or not an array is unaffected — that already falls through to
  // an empty feedback list below, unchanged.
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new TypeError('digestFeedback: doc must be a raw dispatch document ({ feedback, dispatchedAt }), not a bare array, null, or a non-object');
  }

  const rawFeedback = Array.isArray(doc?.feedback) ? doc.feedback : [];
  const formattedFeedback = formatFeedbackEntries(rawFeedback);
  const isoDispatchedAt = doc?.dispatchedAt?.toISOString?.() || doc?.dispatchedAt || null;

  const facts = deriveLoopFacingFacts(formattedFeedback, isoDispatchedAt);
  const kpiFacts = deriveKpiFacts(rawFeedback);

  const fullMetrics = facts.telemetry.metrics;
  const toolPeak = toolPeakOf(fullMetrics);
  const nowMs = typeof now === 'number' ? now : Date.now();
  const metrics = retainMetrics(fullMetrics, nowMs);

  return {
    version: null,
    count: rawFeedback.length,

    terminal: facts.terminal
      ? { status: facts.terminal.status, entry: narrowToMessageTimestamp(facts.terminal.entry) }
      : null,
    wake: facts.wake,
    decision: facts.decision,
    decisionEntryIndex: facts.decisionEntryIndex === -1 ? null : facts.decisionEntryIndex,
    decisionCase: facts.decisionCase,
    answeredDecisionId: facts.answeredDecisionId,
    parkedWait: facts.telemetry.parkedWait ?? null,
    telemetry: {
      model: facts.telemetry.model ?? null,
      evidence: facts.telemetry.producedArtifacts,
      usage: facts.telemetry.usage ?? null,
      resources: facts.telemetry.resources ?? null,
      ticketMarkers: facts.telemetry.ticketWalk ?? [],
      metrics,
      toolPeak,
      runtime: facts.telemetry.runtime,
    },

    kpiTerminalEntry: kpiFacts.kpiTerminalEntry,
    kpiUsageEntry: kpiFacts.kpiUsageEntry,
    kpiEvidenceCount: kpiFacts.kpiEvidenceCount,
    kpiTicketMarkerEntries: kpiFacts.kpiTicketMarkerEntries,
  };
}
