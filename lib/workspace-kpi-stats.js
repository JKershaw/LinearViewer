/**
 * KPI statistics for ONE workspace (LIN-3689) — the data behind the in-Harbour
 * `/workspace/:urlKey/kpis` page.
 *
 * Counts, app-defined labels, this workspace's own API-equivalent cost
 * estimate (LIN-3711; an estimate from token usage, never cash) and merge
 * times (LIN-3713; durations only, no PR urls or identifiers): no issue
 * identifiers, prompt text, account ids, other workspaces' keys or any
 * instance-wide figure. Every read is
 * filtered to `urlKey` in the query itself (the stores' indexes lead with
 * `urlKey`), and every figure comes from the same math the public page uses
 * (`summarizeActivity`, `buildFunnel`, `medianQueueToTakeMinutes`,
 * `tallyLabels`, `rank` in lib/kpi-stats.js), so a number cannot drift between
 * the two pages. Reads stop at the shared 30-day read horizon on purpose; only
 * the `stored` block is unwindowed.
 */

import {
  AGENT_STATUS_FIELDS,
  buildDailyDone,
  buildDoneTotal,
  buildDispatchByDay,
  buildFunnel,
  countByDay,
  loadDispatchHistory,
  loadDoneRollup,
  loadRollupThrough,
  loadProxyBins,
  median,
  medianQueueToTakeMinutes,
  percentile,
  proxyCallsByDay,
  rank,
  summarizeActivity,
  tallyLabels,
  windowsAt
} from './kpi-stats.js';
import { groupDispatchLineages } from './dispatch-lineage.js';
import { windowedSpend } from './weekly-budget.js';
import { readHorizonStart } from './read-horizon.js';
import { MAX_REPORTS_PER_WORKSPACE } from './report-history-store.js';

const SHORT_WINDOW_DAYS = 7;
const LONG_WINDOW_DAYS = 30;

const roundTo1 = value => Math.round(value * 10) / 10;
const roundTo4 = value => Math.round(value * 10000) / 10000;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Runs by kind: four whole 7-day buckets ending today (the last 28 of the 30
// days), top three kinds plus 'other'. The two oldest days are in no bucket.
const WEEK_DAYS = 7;
const WEEK_COUNT = 4;
const WEEK_KIND_LIMIT = 3;

/** Fold a 30-slot daily series into the last WEEK_COUNT 7-day sums, oldest first. */
function foldWeeks(counts) {
  const first = counts.length - WEEK_COUNT * WEEK_DAYS;
  return Array.from({ length: WEEK_COUNT }, (_, week) => {
    const from = first + week * WEEK_DAYS;
    return counts.slice(from, from + WEEK_DAYS).reduce((sum, n) => sum + n, 0);
  });
}

/**
 * The per-day series behind the trend charts (LIN-3711), all on the same 30-day
 * axis as the cards. Built from rows the reads already returned: no new read.
 */
function buildDaily({ historyDocs, queueDocs, long, windows }) {
  const { windowedDispatchDocs, windowedAgentStatusDocs, proxy } = long;
  const lineages = groupDispatchLineages([...historyDocs, ...queueDocs]);

  // Weeks cover days 2..29; rank kinds over those docs only, so a kind seen
  // only in the two uncovered days cannot take a legend slot with no data.
  const weeksStart = Date.parse(`${windows.days[windows.days.length - WEEK_COUNT * WEEK_DAYS]}T00:00:00.000Z`);
  const weekDocs = windowedDispatchDocs.filter(doc => new Date(doc.dispatchedAt).getTime() >= weeksStart);
  const byKind = buildDispatchByDay(weekDocs, tallyLabels(weekDocs, 'kind'), windows, WEEK_KIND_LIMIT);

  // Cost by the day the task STARTED; the window is the day axis, so a dispatch
  // stamped exactly `now` is inside it. Unpriced lineages never count as $0.
  const statusPerDay = countByDay(windowedAgentStatusDocs, 'timestamp', windows);
  const spend = windowedSpend(lineages, windows.activityStart, windows.activityStart + windows.days.length * DAY_MS);

  return {
    days: windows.days,
    dispatches: countByDay(windowedDispatchDocs, 'dispatchedAt', windows),
    autopilotRuns: countByDay(windowedDispatchDocs.filter(doc => doc.kind === 'autopilot'), 'dispatchedAt', windows),
    agentActions: proxyCallsByDay(proxy).map((n, i) => n + statusPerDay[i]),
    done: buildDailyDone(lineages, windows),
    runsByKind: {
      weeks: windows.days.slice(windows.days.length - WEEK_COUNT * WEEK_DAYS).filter((_, i) => i % WEEK_DAYS === 0),
      kinds: byKind.kinds.map(({ label, counts }) => ({ label, counts: foldWeeks(counts) }))
    },
    cost: {
      perDay: windows.days.map(day => roundTo4(spend.byDay.get(day) || 0)),
      pricedCount: spend.pricedCount,
      lineageCount: spend.lineageCount
    }
  };
}

/**
 * Time to merge from the forge's own PR times (LIN-3713). Input is this
 * workspace's merged close-out events; output is durations only.
 *
 * Left out: events without both times (older events, seeded statuses, a
 * `merged_at` GitHub had not set yet) and pairs merged before opened (clock or
 * data oddity: never a negative duration). Equal times are kept: a 0h merge is
 * real. A PR counts once even if a second row ever lands (the merge key includes
 * `by`), keeping its earliest-observed row. Never NaN: no usable events gives
 * `n: 0` and nulls.
 */
export function summarizeMergeTime(events) {
  const byPr = new Map();
  for (const event of events) {
    const opened = event.prOpenedAt == null ? NaN : new Date(event.prOpenedAt).getTime();
    const merged = event.prMergedAt == null ? NaN : new Date(event.prMergedAt).getTime();
    if (!Number.isFinite(opened) || !Number.isFinite(merged) || merged < opened) continue;
    const seen = byPr.get(event.prUrl);
    if (seen && new Date(seen.at).getTime() <= new Date(event.at).getTime()) continue;
    byPr.set(event.prUrl, { at: event.at, hours: (merged - opened) / HOUR_MS });
  }
  const hours = [...byPr.values()].map(entry => entry.hours);
  if (hours.length === 0) return { n: 0, medianHours: null, p90Hours: null };
  return { n: hours.length, medianHours: roundTo1(median(hours)), p90Hours: roundTo1(percentile(hours, 0.9)) };
}

/**
 * @param {Object} deps
 * @param {Object} deps.collections - dispatchQueue, dispatchHistory, proxyEvents,
 *   agentStatus, reportHistory, customPrompts, closeOutEvents
 * @param {string} deps.urlKey - the workspace; the only scope of every read
 * @param {Date} [deps.now]
 * @returns {Promise<Object>} counts and labels for this workspace only
 */
export async function collectWorkspaceKpis({ collections, urlKey, now = new Date() }) {
  if (typeof urlKey !== 'string' || !urlKey) throw new TypeError('collectWorkspaceKpis: urlKey is required');
  const { dispatchQueue, dispatchHistory, proxyEvents, agentStatus, reportHistory, customPrompts, closeOutEvents, kpiDailyRollup } = collections;
  if (!closeOutEvents) throw new TypeError('collectWorkspaceKpis: collections.closeOutEvents is required');
  if (!kpiDailyRollup) throw new TypeError('collectWorkspaceKpis: collections.kpiDailyRollup is required');
  const since = readHorizonStart(now);

  const [historyDocs, queueDocs, proxyBins, agentStatusDocs, reportCount, customPromptCount, mergeEvents, doneRollupRows, rollupThrough] = await Promise.all([
    loadDispatchHistory(dispatchHistory, { since, urlKey }),
    dispatchQueue.find({ urlKey }).toArray(),
    loadProxyBins(proxyEvents, { since, urlKey }),
    agentStatus.find({ urlKey, timestamp: { $gte: since } }, { projection: AGENT_STATUS_FIELDS }).toArray(),
    reportHistory.countDocuments({ urlKey }),
    customPrompts.countDocuments({ urlKey }),
    // LIN-3713: no new index. The urlKey prefix is served by the merge-key index
    // (lib/db-indexes.js); the rest filters one workspace's lifetime-retained
    // events once per page load. Reconsider if a workspace's count outgrows that.
    closeOutEvents.find(
      { urlKey, merged: true, prMergedAt: { $gte: since } },
      { projection: { prUrl: 1, at: 1, prOpenedAt: 1, prMergedAt: 1 } }
    ).toArray(),
    // LIN-3732: this workspace's rows only; a failed read gives [] (doneTotal null).
    loadDoneRollup(kpiDailyRollup, { urlKey }),
    // LIN-3733: the marker is instance-wide (no urlKey); caps `through` at the last completed day.
    loadRollupThrough(kpiDailyRollup)
  ]);

  const rows = { historyDocs, queueDocs, agentStatusDocs, proxyBins };
  const longWindows = windowsAt(now, { days: LONG_WINDOW_DAYS });
  const short = summarizeActivity(rows, windowsAt(now, { days: SHORT_WINDOW_DAYS }));
  const long = summarizeActivity(rows, longWindows);

  const funnel = buildFunnel({ historyDocs, agentStatusDocs, windowedDispatchDocs: long.windowedDispatchDocs });
  const medianWait = medianQueueToTakeMinutes(historyDocs);

  return {
    generatedAt: now.toISOString(),
    activity: { last7: short.totals, last30: long.totals },
    funnel: {
      dispatched: funnel.dispatched,
      taken: funnel.taken,
      reported: funnel.reported,
      completed: funnel.completed,
      medianWaitMinutes: medianWait === null ? null : roundTo1(medianWait)
    },
    mergeTime: summarizeMergeTime(mergeEvents),
    kinds: rank(tallyLabels(long.windowedDispatchDocs, 'kind')),
    daily: { ...buildDaily({ historyDocs, queueDocs, long, windows: longWindows }), doneTotal: buildDoneTotal(doneRollupRows, now, rollupThrough) },
    stored: {
      customPrompts: customPromptCount,
      roadmapReports: reportCount,
      roadmapReportsCap: MAX_REPORTS_PER_WORKSPACE
    },
    empty: long.totals.dispatches === 0 && long.totals.agentActions === 0
  };
}
