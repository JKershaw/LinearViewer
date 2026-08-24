/**
 * Weekly-budget burn gauge (LIN-2118).
 *
 * Harbour cannot read Anthropic's own subscription meter directly, so this
 * module produces an ESTIMATE of the current weekly window's consumption —
 * calibrated from the one recorded checkpoint-series/spend correlation on
 * LIN-2087 (2026-08-14 capacity test day: 27 checkpointed weekly-window
 * points, 31%→58%, measured against $1,070.58 of API-rate-equivalent spend
 * the same day — docs/reviews/capacity-test-run-review-2026-08-14.md), then
 * projected forward using the SAME windowed `[usage]` telemetry and
 * harness-conditional cost reduce the terminal-marked-task-cost card already
 * uses (`reduceLineageCost`, imported rather than re-derived).
 *
 * An operator-entered checkpoint reading (`WEEKLY_BUDGET_CHECKPOINT_PERCENT`
 * + `WEEKLY_BUDGET_CHECKPOINT_AT`, mirroring the existing
 * `PLAN_FEE_MONTHLY_USD` operator-config seam from LIN-1958 — no new DB/route
 * surface) acts as a recalibration point: when present and dated inside the
 * CURRENT window, it replaces the telemetry-from-zero baseline, and
 * telemetry fills in only the gap since that reading. Absent a reading, the
 * estimate runs from telemetry alone, from zero at the window's Thursday
 * 06:00Z reset.
 *
 * Never a false precision: an unpriced/partially-priced lineage is excluded
 * from every sum (the same `fullyPriced`-gates-the-sum discipline
 * terminal-marked-task-cost.js already follows), and the share of the
 * window's lineages that DID price is published alongside so a reader can
 * see how much of the estimate's own input is missing.
 */

import { groupDispatchLineages } from './kpi-stats.js';
import { reduceLineageCost } from './terminal-marked-task-cost.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// The window resets Thursdays 06:00Z (John's subscription; LIN-2087 comment
// 2026-08-14T17:52:39.900Z: "Thursdays 07:00 BST (06:00Z)").
export const RESET_WEEKDAY_UTC = 4; // 0 = Sunday, per Date#getUTCDay
export const RESET_HOUR_UTC = 6;

// The one recorded checkpoint/spend correlation available (LIN-2087):
// 27 weekly-window points (31%→58%, 2026-08-14) measured against $1,070.58
// API-rate-equivalent spend the same day. Used only as the DEFAULT
// calibration factor — an operator can override via
// WEEKLY_BUDGET_USD_PER_POINT once more correlated readings exist.
export const DEFAULT_USD_PER_POINT = 1070.58 / 27;

function asShare(count, of) {
  return of > 0 ? Math.round((count / of) * 1000) / 1000 : null;
}

function round(value, dp) {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

function dayKeyOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The most recent Thursday 06:00Z at or before `now` — the start of the
 * current subscription window.
 * @param {Date} now
 * @returns {number} epoch ms
 */
export function currentWindowStartMs(now) {
  const nowMs = now.getTime();
  // Anchor to today's 06:00Z, then walk back by day-of-week difference.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RESET_HOUR_UTC, 0, 0, 0));
  const dowDiff = (today.getUTCDay() - RESET_WEEKDAY_UTC + 7) % 7;
  let candidate = today.getTime() - dowDiff * DAY_MS;
  if (candidate > nowMs) candidate -= WEEK_MS;
  return candidate;
}

function resolveUsdPerPoint(env) {
  const raw = env ? env.WEEKLY_BUDGET_USD_PER_POINT : undefined;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_PER_POINT;
}

/**
 * An operator-entered checkpoint reading, valid only when it names a
 * timestamp inside the CURRENT window — a reading from a prior (already
 * reset) window is not a recalibration point for this one and is ignored
 * (never silently reinterpreted as "now").
 */
function resolveCheckpoint(env, windowStartMs, nowMs) {
  if (!env) return null;
  const percent = Number(env.WEEKLY_BUDGET_CHECKPOINT_PERCENT);
  const atMs = env.WEEKLY_BUDGET_CHECKPOINT_AT ? new Date(env.WEEKLY_BUDGET_CHECKPOINT_AT).getTime() : NaN;
  if (!Number.isFinite(percent) || percent < 0 || !Number.isFinite(atMs)) return null;
  if (atMs < windowStartMs || atMs > nowMs) return null;
  return { percent, atMs };
}

/**
 * Sum of fully-priced windowed spend across lineages whose `earliest`
 * dispatch falls in `[sinceMs, nowMs)`, plus a per-UTC-day breakdown and the
 * priced/total lineage counts for the provenance disclosure. Every lineage in
 * the window counts (done, in-flight, issue-less alike) — the weekly meter
 * does not care whether work resolved, only that it ran.
 */
function windowedSpend(lineages, sinceMs, nowMs) {
  let totalUsd = 0;
  let lineageCount = 0;
  let pricedCount = 0;
  const byDay = new Map();

  for (const lineage of lineages.values()) {
    if (lineage.earliest === null || lineage.earliest < sinceMs || lineage.earliest >= nowMs) continue;
    if (lineage.status === 'skipped') continue; // benign: nothing ended (same exclusion as kpi-stats.js)
    lineageCount++;
    const reduced = reduceLineageCost(lineage);
    if (!reduced.priced || !reduced.fullyPriced) continue;
    pricedCount++;
    totalUsd += reduced.costUsd;
    const key = dayKeyOf(lineage.earliest);
    byDay.set(key, (byDay.get(key) || 0) + reduced.costUsd);
  }

  // Deliberately unrounded: this feeds percent/rate/projection arithmetic
  // downstream, and rounding here (then dividing) is exactly how the
  // projectedExhaustionAt test drifted by fractions of a second in review —
  // rounding happens once, at the final return below, never mid-calculation.
  return {
    totalUsd,
    lineageCount,
    pricedCount,
    byDay
  };
}

/**
 * Compute the weekly-budget burn gauge.
 *
 * @param {Array<Object>} rows - history + queue dispatch rows (same shape as
 *   computeTerminalMarkedTaskCost's input)
 * @param {Date} now
 * @param {Object} [env] - defaults to process.env; injectable for tests
 * @returns {Object}
 */
export function computeWeeklyBudgetGauge(rows, now, env = process.env) {
  const nowMs = now.getTime();
  const windowStartMs = currentWindowStartMs(now);
  const nextResetMs = windowStartMs + WEEK_MS;
  const usdPerPoint = resolveUsdPerPoint(env);
  const checkpoint = resolveCheckpoint(env, windowStartMs, nowMs);

  const lineages = groupDispatchLineages(rows);
  const sinceReset = windowedSpend(lineages, windowStartMs, nowMs);

  let percentConsumed = null;
  let percentSource = 'none';
  if (checkpoint) {
    const sinceCheckpoint = windowedSpend(lineages, checkpoint.atMs, nowMs);
    percentConsumed = checkpoint.percent + sinceCheckpoint.totalUsd / usdPerPoint;
    percentSource = 'operator-reading';
  } else if (sinceReset.lineageCount > 0) {
    percentConsumed = sinceReset.totalUsd / usdPerPoint;
    percentSource = 'telemetry-estimate';
  }

  const hoursElapsed = (nowMs - windowStartMs) / HOUR_MS;
  const recentWindowHours = Math.min(24, hoursElapsed);
  const recentStartMs = nowMs - recentWindowHours * HOUR_MS;
  const recent = recentWindowHours > 0 ? windowedSpend(lineages, recentStartMs, nowMs) : null;
  const burnRatePerHour = (recent && recentWindowHours > 0)
    ? (recent.totalUsd / usdPerPoint) / recentWindowHours
    : null;

  const projectedExhaustionAtMs = (
    percentConsumed !== null && percentConsumed < 100 && burnRatePerHour !== null && burnRatePerHour > 0
  )
    ? nowMs + ((100 - percentConsumed) / burnRatePerHour) * HOUR_MS
    : null;

  // Enumerate on the SAME basis `byDay` is keyed on — the calendar UTC day
  // (`dayKeyOf`) — rather than stepping 24h from the 06:00Z-anchored
  // `windowStartMs` and comparing against `nowMs` directly. That stepping
  // used to stop one day short whenever `now` fell between 00:00Z and
  // 06:00Z: today's calendar day had already started (and `byDay` already
  // has spend keyed under it), but its 06:00Z-anchored day-start hadn't
  // been "reached" yet.
  const days = [];
  const costUsd = [];
  const todayKey = dayKeyOf(nowMs);
  for (let dayStart = windowStartMs; dayKeyOf(dayStart) <= todayKey; dayStart += DAY_MS) {
    const key = dayKeyOf(dayStart);
    days.push(key);
    costUsd.push(Math.round((sinceReset.byDay.get(key) || 0) * 100) / 100);
  }

  return {
    resetAt: new Date(windowStartMs).toISOString(),
    nextResetAt: new Date(nextResetMs).toISOString(),
    hoursElapsed: round(hoursElapsed, 1),
    usdPerPoint: round(usdPerPoint, 2),
    percentConsumed: percentConsumed === null ? null : round(percentConsumed, 1),
    percentSource,
    burnRatePerHour: burnRatePerHour === null ? null : round(burnRatePerHour, 2),
    projectedExhaustionAt: projectedExhaustionAtMs === null ? null : new Date(projectedExhaustionAtMs).toISOString(),
    checkpoint: checkpoint ? { percent: checkpoint.percent, at: new Date(checkpoint.atMs).toISOString() } : null,
    windowLineageCount: sinceReset.lineageCount,
    windowPricedLineageShare: asShare(sinceReset.pricedCount, sinceReset.lineageCount),
    dayBars: { days, costUsd }
  };
}
