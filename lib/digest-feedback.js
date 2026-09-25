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
  buildRunTelemetry, deriveRuntime, parseDecision, __internal as SESSION_TELEMETRY_INTERNAL,
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
 * Collect `reversedIds` from every valid `kind: 'decision-withdrawal-reversed'`
 * entry (any order — order-independence is what makes reversal terminal
 * regardless of whether the reversal or the withdrawal it cancels comes
 * first in `feedback`), then scan `feedback` backwards for the last
 * `kind: 'decision-withdrawn'` entry whose message parses to
 * `{decision_id, reason}` (both non-empty strings) and whose `decision_id`
 * is not in `reversedIds`. A malformed or incomplete entry — either kind —
 * is skipped and the scan continues, mirroring `_findDecisionAnswer`'s
 * fail-closed discipline. Returns `null` when no live withdrawal remains.
 *
 * LIN-2891 (LIN-3034): sibling of `_findDecisionAnswer` above, for the new
 * decision-withdrawal concept — distinct from the dismissal-suggestion
 * `withdrawn` flag (`lib/dismissal-suggestions-store.js`), which this
 * function does not read.
 *
 * @param {Array<{kind?: string, message?: string, timestamp?: string}>} feedback
 * @returns {{decisionId: string, reason: string, timestamp: string|null}|null}
 */
export function _findDecisionWithdrawal(feedback) {
  if (!Array.isArray(feedback)) return null;

  const reversedIds = new Set();
  for (const entry of feedback) {
    if (entry?.kind !== 'decision-withdrawal-reversed') continue;
    try {
      const parsed = JSON.parse(entry.message);
      if (parsed && typeof parsed.decision_id === 'string' && parsed.decision_id.length > 0) {
        reversedIds.add(parsed.decision_id);
      }
    } catch {
      // Malformed reversal stamp — treat as absent, keep collecting.
    }
  }

  for (let i = feedback.length - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (entry?.kind !== 'decision-withdrawn') continue;
    try {
      const parsed = JSON.parse(entry.message);
      if (
        parsed &&
        typeof parsed.decision_id === 'string' && parsed.decision_id.length > 0 &&
        typeof parsed.reason === 'string' && parsed.reason.length > 0 &&
        !reversedIds.has(parsed.decision_id)
      ) {
        return { decisionId: parsed.decision_id, reason: parsed.reason, timestamp: entry.timestamp ?? null };
      }
    } catch {
      // Malformed stamp — treat as absent and keep scanning backward for an
      // earlier valid one, mirroring `_findDecisionAnswer`'s discipline.
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
 * Every decision raised in a loop's feedback, paired with its resolution (if
 * any) by `decision_id` — the loop-backed half of the escalation KPIs' time-
 * to-response and false-escalation inputs (LIN-1736); the task-bound half is
 * `TaskDecisionsStore#listResolvedForWorkspaces` (lib/task-decisions-store.js).
 * Moved here from `lib/pipeline-loops.js` (LIN-3022/LIN-2991 Surface 2): this
 * module now also feeds `deriveLoopFacingFacts`'s `answeredDecisions` set
 * below, and `pipeline-loops.js` already imports FROM this module — calling
 * it the other way round would open a cycle. `pipeline-loops.js` re-exports
 * this unchanged for its one existing consumer
 * (`routes/dashboard.js`'s `computeWorkspaceEscalationKpis`), which follows
 * the LIN-3008 precedent for the same kind of move.
 *
 * A decision-answer stamp (`markDecisionAnswered`, LIN-1728/LIN-2225) is the
 * ONLY write path for resolution and always carries the SAME `decision_id`
 * as the decision it resolves, tagged `outcome: 'dismissed'` in the stamp
 * message when the operator dismissed rather than answered (an omitted
 * `outcome` means 'answered' — see `lib/dispatch-store.js#markDecisionAnswered`).
 * A decision with no matching stamp is still-unanswered and is deliberately
 * excluded here — `collectUnansweredDecisions` (lib/unanswered-decisions.js)
 * already owns "is this unanswered"; this function answers "of the ones that
 * WERE resolved, when and how", and duplicating the other's question would be
 * exactly the two-places-drift this epic's own F2 caption bug already taught.
 *
 * FIRST occurrence wins on both sides, mirroring this module's forward
 * (oldest-first) reading elsewhere: the first time a `decision_id` is raised
 * is when the operator was first asked, and the first stamp for it is its
 * true resolution instant — a later, redundant re-post of either kind (a
 * dedup-retry double-stamp, LIN-2208) must not shift either number.
 *
 * @param {Array<{kind?: string, message?: string, timestamp?: string}>} feedback
 * @returns {Array<{decisionId: string, raisedAt: string|null, resolvedAt: string|null, outcome: 'answered'|'dismissed'}>}
 */
export function resolvedDecisionEvents(feedback) {
  if (!Array.isArray(feedback)) return [];
  const raisedAt = new Map();
  const resolvedIds = new Set();
  const resolved = [];
  for (const entry of feedback) {
    if (entry?.kind === 'decision') {
      const decision = parseDecision(entry?.message);
      if (decision?.decision_id && !raisedAt.has(decision.decision_id)) {
        raisedAt.set(decision.decision_id, entry.timestamp || null);
      }
      continue;
    }
    if (!isDecisionAnswerEntry(entry)) continue;
    try {
      const parsed = JSON.parse(entry.message);
      if (parsed && typeof parsed.decision_id === 'string' && !resolvedIds.has(parsed.decision_id)) {
        resolvedIds.add(parsed.decision_id);
        resolved.push({
          decisionId: parsed.decision_id,
          raisedAt: raisedAt.get(parsed.decision_id) || null,
          resolvedAt: entry.timestamp || null,
          outcome: parsed.outcome === 'dismissed' ? 'dismissed' : 'answered'
        });
      }
    } catch {
      // Malformed stamp — skip it, mirroring this module's tolerant-scan
      // discipline elsewhere (never throw on stored data it did not itself
      // validate at write time).
    }
  }
  return resolved;
}

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
 * `answeredDecisions` (LIN-3022) is the set-derived sibling of the scalar
 * `answeredDecisionId` below: every distinct `decision_id` this loop's own
 * feedback has a `decision-answer` stamp for, via `resolvedDecisionEvents`.
 * Admit/discharge (`lib/unanswered-decisions.js`) reads ONLY this set, never
 * the scalar — `answeredDecisionId` is kept for whatever else already read
 * it, but is no longer the source of truth for "is this decision answered".
 *
 * @param {Array<Object>} feedback - formatted feedback (ISO timestamps)
 * @param {string|null} isoDispatchedAt
 * @returns {{terminal: Object|null, wake: {marker,waitingMessage}|null,
 *   decision: Object|null, decisionEntryIndex: number, decisionCase: Array,
 *   answeredDecisionId: string|null, answeredDecisions: Array,
 *   withdrawal: {decisionId: string, reason: string, timestamp: string|null}|null,
 *   telemetry: Object}}
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
  const answeredDecisions = resolvedDecisionEvents(feedback);
  const withdrawal = _findDecisionWithdrawal(feedback);

  const telemetry = buildRunTelemetry({ dispatchedAt: isoDispatchedAt, feedback });

  return { terminal, wake, decision, decisionEntryIndex, decisionCase, answeredDecisionId, answeredDecisions, withdrawal, telemetry };
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
    .map(entry => ({ message: entry.message, timestamp: entry.timestamp ?? null }));

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

// ─── isFreshDigest(doc) — V1/V2 freshness predicate (LIN-3011) ──────────────

/**
 * True when `doc.feedbackDigest` is trustworthy for THIS row as it stands —
 * i.e. it was computed at the row's current `feedbackVersion` and can be read
 * straight off the row instead of re-deriving from `feedback`. Mirrors Phase
 * 4's Mongo `FRESH_DIGEST` `$cond` in JS; the two must agree on every row
 * shape (see the real-`mongod` agreement test in `tests/unit/mongo-smoke.test.js`).
 *
 * `v(doc) = doc.feedbackVersion ?? 0` — an absent `feedbackVersion` (a legacy,
 * pre-LIN-3009 row) is version 0, matching `_archiveItem`'s seeding of new
 * rows at `feedbackVersion: 0`. A row is fresh iff `feedbackDigest` is a
 * non-null object whose own `.version` equals `v(doc)`; a `feedbackDigest`
 * missing its `.version` key (never ruled out for a hand-inserted or
 * historical row) is never fresh, not even against `v(doc) === 0`.
 *
 * @param {{feedbackVersion?: number, feedbackDigest?: Object|null}} doc
 * @returns {boolean}
 */
export function isFreshDigest(doc) {
  const v = doc?.feedbackVersion ?? 0;
  const digest = doc?.feedbackDigest;
  return !!(digest && typeof digest === 'object' && digest.version === v);
}

// ─── applyHarvestedAbortToDigest(digest, abortEntry, dispatchedAt) — V4 + W1 ─

/**
 * The digest-shaped sibling of `dispatch-terminal.js`'s
 * `feedbackWithHarvestedAbort` (LIN-1257/1261): composes an abort row's own
 * harvested `[aborted]` entry onto a TARGET row's digest, instead of
 * re-deriving from a feedback array. Used by the lean, digest-backed
 * `_buildLoops` path (LIN-3011) in place of appending the entry and
 * re-scanning — the digest has no feedback array to append to.
 *
 * F1 guard (millisecond-exact, unchanged from `feedbackWithHarvestedAbort`):
 * never let an EARLIER abort override a LATER genuine terminal or rewind
 * `completedAt` — only apply when `abortEntry` is STRICTLY later than the
 * digest's existing `terminal.entry.timestamp`, or when there is no existing
 * terminal at all. When ordering can't be established (a missing/unparseable
 * timestamp on either side), the existing terminal is kept. Both sides are
 * always ISO strings under the digest's own input contract (W1: loop-facing
 * fields derive from the formatted, not raw, shape) — never a raw `Date`,
 * which is what made the ordering comparison lose sub-second precision before
 * W1's correction.
 *
 * When the abort wins: `terminal` becomes the abort (narrowed to
 * `{message, timestamp}`, matching `digestFeedback`'s own narrowing);
 * `wake: {marker:'aborted', waitingMessage:null}`; the digest's TOP-LEVEL
 * `parkedWait` becomes `null` (an abort ends any async wait); `telemetry.
 * runtime` is recomputed via `deriveRuntime(dispatchedAt, abortEntry.
 * timestamp, [abortEntry])`, reproducing today's `ms`/`completedAt`/
 * `crossCheck`. Decision fields (`decision`/`decisionCase`/
 * `answeredDecisionId`) and every other digest field are untouched.
 *
 * Pure: returns a NEW object when the abort is applied, or the SAME `digest`
 * reference unchanged when it is not (mirrors `feedbackWithHarvestedAbort`'s
 * return-base-unchanged convention).
 *
 * @param {Object} digest - the target row's own feedbackDigest
 * @param {{message?: string, timestamp?: string}|null|undefined} abortEntry
 *   - the abort row's own harvested `[aborted]` entry (ISO timestamp), or
 *   falsy when the abort row's own last terminal isn't `aborted`
 * @param {string|null} dispatchedAt - the TARGET row's ISO dispatchedAt
 * @returns {Object} the digest to derive the loop from
 */
export function applyHarvestedAbortToDigest(digest, abortEntry, dispatchedAt) {
  if (!digest || !abortEntry) return digest;
  const existing = digest.terminal;
  if (existing) {
    const existingMs = Date.parse(existing.entry?.timestamp);
    const abortMs = Date.parse(abortEntry.timestamp);
    if (!(Number.isFinite(existingMs) && Number.isFinite(abortMs) && abortMs > existingMs)) {
      return digest;
    }
  }
  return {
    ...digest,
    terminal: { status: 'aborted', entry: { message: abortEntry.message ?? null, timestamp: abortEntry.timestamp ?? null } },
    wake: { marker: 'aborted', waitingMessage: null },
    parkedWait: null,
    telemetry: {
      ...digest.telemetry,
      runtime: deriveRuntime(dispatchedAt, abortEntry.timestamp, [abortEntry]),
    },
  };
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
    answeredDecisions: facts.answeredDecisions,
    withdrawal: facts.withdrawal ?? null,
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
