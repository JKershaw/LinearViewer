/**
 * lib/escalation-kpis.js
 *
 * Pure, network-free escalation KPI computation (LIN-1736) — the numbers
 * behind the operator-facing audit page, per docs/escalation-philosophy.md
 * §7 ("the tuning loop that keeps the whole system honest"):
 *
 *   - escalation rate: how many NEW decisions were raised in the window
 *   - time-to-response: raisedAt -> resolvedAt, for decisions resolved in
 *     the window
 *   - false-escalation rate: dismissed / (answered + dismissed) among
 *     decisions resolved in the window — dismiss is the "why was I asked
 *     this?" signal (LIN-1727's disposal-reasons ruling: dismiss clears a
 *     row without answering, and is the direct measure of Principle 0 being
 *     violated)
 *   - unanswered age: how long CURRENTLY unanswered rulings have been
 *     waiting, and how many are past the stale threshold
 *
 * Sources two already-existing predicates rather than re-deriving them —
 * `resolvedDecisionEvents` (lib/pipeline-loops.js, a per-loop feedback scan)
 * for the loop-backed half, and `TaskDecisionsStore#listResolvedForWorkspaces`
 * for the task-bound half — the SAME split `collectUnansweredDecisions`
 * (lib/unanswered-decisions.js) already uses for the live queue, so this
 * module never re-derives "is this a decision" or "is this unanswered".
 *
 * "Escalation rate per human" (the philosophy doc's own phrase) reduces here
 * to "per workspace": this app has no per-operator identity on a ruling's
 * resolution today (a comment is attributed to whichever session
 * authenticated it, not tracked as a distinct "who resolved this" field) —
 * building genuine multi-operator attribution is a separate, larger feature,
 * not invented here. A workspace is, in today's usage, one human's queue.
 * The "sustainable target" the philosophy doc calls for is deliberately NOT
 * a hardcoded number here — EEMUA's own reference figures are explicitly
 * refinery-specific ("the absolute figures will not be ours"), and no
 * software-engineering-context figure has been established for this product.
 * `targetPerDay` is an optional caller-supplied value (operator-configured);
 * omitting it reports the raw rate with no pass/fail judgment rather than a
 * fabricated threshold.
 *
 * `now`-injected throughout (no `Date.now()`), matching this codebase's
 * pure-module discipline (lib/dispatch-terminal.js, lib/credential-state.js,
 * lib/live-console.js, …) — testable without a clock, no network, no I/O.
 */

import { median } from './wall-clock-summary.js';

function toMs(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {Object} input
 * @param {Array<{decisionId: string, raisedAt: string|Date|null, resolvedAt: string|Date|null, outcome: 'answered'|'dismissed'}>} input.resolvedEvents
 *   Merged loop-backed (`resolvedDecisionEvents`) + task-bound
 *   (`TaskDecisionsStore#listResolvedForWorkspaces`, normalised to this same
 *   shape) resolution events, from any time — this function does its own
 *   window filtering on `resolvedAt`/`raisedAt`.
 * @param {Array<{decisionId: string, raisedAt: string|Date|null}>} input.unansweredRows
 *   Currently-unanswered rulings (from `collectUnansweredDecisions`'s output,
 *   or an equivalent projection) — no window filtering; age is always
 *   measured against `now`, regardless of when the ruling was raised.
 * @param {number} [input.windowMs=30*24*60*60*1000] - the rate/time-to-response/
 *   false-escalation window, ending at `now`. Default 30 days.
 * @param {number} [input.staleThresholdMs=24*60*60*1000] - an unanswered
 *   ruling older than this counts as "stale" (docs/escalation-philosophy.md
 *   §4: a stale escalation is a defect signal, not furniture). Default 24h.
 * @param {number|null} [input.targetPerDay=null] - operator-configured
 *   sustainable escalation-rate target; `null` reports the raw rate with no
 *   verdict.
 * @param {Date} [input.now] - injected clock; defaults to `new Date()`.
 * @returns {{
 *   windowMs: number,
 *   escalationRate: {raisedInWindow: number, perDay: number, targetPerDay: number|null, overTarget: boolean|null},
 *   timeToResponse: {count: number, medianMs: number|null, maxMs: number|null},
 *   falseEscalation: {dismissed: number, answered: number, total: number, rate: number|null},
 *   unansweredAge: {count: number, staleCount: number, maxAgeMs: number, staleThresholdMs: number}
 * }}
 */
export function computeEscalationKpis({
  resolvedEvents = [],
  unansweredRows = [],
  windowMs = 30 * 24 * 60 * 60 * 1000,
  staleThresholdMs = 24 * 60 * 60 * 1000,
  targetPerDay = null,
  now,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const windowStartMs = nowMs - windowMs;
  const windowDays = windowMs / (24 * 60 * 60 * 1000);

  const events = Array.isArray(resolvedEvents) ? resolvedEvents : [];
  const unanswered = Array.isArray(unansweredRows) ? unansweredRows : [];

  // Escalation rate: decisions RAISED in the window, regardless of whether
  // they have since been resolved (a still-unanswered one was still raised
  // in-window and still counts as an escalation that happened).
  let raisedInWindow = 0;
  for (const row of unanswered) {
    const raisedMs = toMs(row?.raisedAt);
    if (raisedMs !== null && raisedMs >= windowStartMs && raisedMs <= nowMs) raisedInWindow++;
  }
  for (const e of events) {
    const raisedMs = toMs(e?.raisedAt);
    if (raisedMs !== null && raisedMs >= windowStartMs && raisedMs <= nowMs) raisedInWindow++;
  }
  const perDay = windowDays > 0 ? raisedInWindow / windowDays : 0;
  const overTarget = targetPerDay == null ? null : perDay > targetPerDay;

  // Time-to-response + false-escalation: decisions RESOLVED in the window.
  const durations = [];
  let dismissed = 0;
  let answered = 0;
  for (const e of events) {
    const resolvedMs = toMs(e?.resolvedAt);
    if (resolvedMs === null || resolvedMs < windowStartMs || resolvedMs > nowMs) continue;
    if (e.outcome === 'dismissed') dismissed++;
    else answered++;
    const raisedMs = toMs(e?.raisedAt);
    if (raisedMs !== null && resolvedMs >= raisedMs) durations.push(resolvedMs - raisedMs);
  }
  const totalResolved = dismissed + answered;

  // Unanswered age: always measured against `now`, independent of the window
  // (a stale ruling from before the window is exactly what §4 warns about —
  // windowing it out would hide the defect it exists to surface).
  let staleCount = 0;
  let maxAgeMs = 0;
  let ageCount = 0;
  for (const row of unanswered) {
    const raisedMs = toMs(row?.raisedAt);
    if (raisedMs === null) continue;
    ageCount++;
    const age = Math.max(0, nowMs - raisedMs);
    if (age > maxAgeMs) maxAgeMs = age;
    if (age > staleThresholdMs) staleCount++;
  }

  return {
    windowMs,
    escalationRate: { raisedInWindow, perDay, targetPerDay, overTarget },
    timeToResponse: {
      count: durations.length,
      medianMs: durations.length ? median(durations) : null,
      maxMs: durations.length ? Math.max(...durations) : null,
    },
    falseEscalation: {
      dismissed,
      answered,
      total: totalResolved,
      rate: totalResolved > 0 ? dismissed / totalResolved : null,
    },
    unansweredAge: {
      count: ageCount,
      staleCount,
      maxAgeMs,
      staleThresholdMs,
    },
  };
}
