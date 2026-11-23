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
 * LIN-4538 (LIN-4529 P7a): the inputs come from question records, not the
 * three ruling stores. `escalationEventsOfQuestions` (below) maps the question
 * facts (lib/records/question-facts.js) to the two input lists this module
 * takes: every question that ended with a settled outcome is a resolved event
 * (answered, dismissed by a person, or self-resolved when its ticket closed),
 * and every open question is an unanswered row. A question ended some other
 * way is raised, so it counts in the escalation rate, but it is no outcome.
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
import { toEpochMs } from './utils/time.js';

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
 *   unansweredAge: {count: number, staleCount: number, maxAgeMs: number, staleThresholdMs: number},
 *   selfResolved: {count: number}
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
    const raisedMs = toEpochMs(row?.raisedAt);
    if (raisedMs !== null && raisedMs >= windowStartMs && raisedMs <= nowMs) raisedInWindow++;
  }
  for (const e of events) {
    const raisedMs = toEpochMs(e?.raisedAt);
    if (raisedMs !== null && raisedMs >= windowStartMs && raisedMs <= nowMs) raisedInWindow++;
  }
  const perDay = windowDays > 0 ? raisedInWindow / windowDays : 0;
  const overTarget = targetPerDay == null ? null : perDay > targetPerDay;

  // Time-to-response + false-escalation: decisions RESOLVED in the window.
  // LIN-2650: 'self-resolved' gets its own bucket via an early `continue`
  // ahead of the dismissed/answered branch AND ahead of `durations.push` —
  // it must neither book into `falseEscalation` (today's bug: it would
  // silently fall into `answered`) nor contribute to `timeToResponse`, which
  // is computed as if self-resolved rows did not exist.
  const durations = [];
  let dismissed = 0;
  let answered = 0;
  let selfResolved = 0;
  for (const e of events) {
    const resolvedMs = toEpochMs(e?.resolvedAt);
    if (resolvedMs === null || resolvedMs < windowStartMs || resolvedMs > nowMs) continue;
    // LIN-4538: an event with no outcome is a question that ended with no settled answer (handed on, or withdrawn by an agent).
    // It was raised, so the rate above counts it; it is not an answer or a dismissal, so nothing below does.
    if (e.outcome == null) continue;
    if (e.outcome === 'self-resolved') { selfResolved++; continue; }
    if (e.outcome === 'dismissed') dismissed++;
    else answered++;
    const raisedMs = toEpochMs(e?.raisedAt);
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
    const raisedMs = toEpochMs(row?.raisedAt);
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
    // LIN-2650: additive — no self-resolved timing distribution (parked, a
    // nice-to-have dashboard tile per the ticket's own non-goals), and
    // lib/render-escalation-kpis.js destructures only the four keys above
    // today, so this key is inert until a future ticket wires a tile for it.
    selfResolved: {
      count: selfResolved,
    },
  };
}

/**
 * LIN-4538 (P7a): the KPI inputs for one set of question facts (lib/records/question-facts.js questionFacts, across the
 * workspaces the page reads). Pure: it takes the facts, it reads nothing.
 *
 * @param {Array<{questionId: string, raisedAt: string|null, resolvedAt: string|null, outcome: string|null}>} facts
 * @returns {{resolvedEvents: Array<{decisionId: string, raisedAt: string|null, resolvedAt: string, outcome: string|null}>,
 *   unansweredRows: Array<{decisionId: string, raisedAt: string|null}>}}
 */
export function escalationEventsOfQuestions(facts) {
  const list = Array.isArray(facts) ? facts : [];
  const resolvedEvents = list
    .filter((f) => f.resolvedAt)
    .map((f) => ({ decisionId: f.questionId, raisedAt: f.raisedAt, resolvedAt: f.resolvedAt, outcome: f.outcome }));
  const unansweredRows = list
    .filter((f) => f.state === 'open')
    .map((f) => ({ decisionId: f.questionId, raisedAt: f.raisedAt }));
  return { resolvedEvents, unansweredRows };
}
