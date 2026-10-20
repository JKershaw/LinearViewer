/**
 * KPI statistics for ONE workspace (LIN-3689) — the data behind the in-Harbour
 * `/workspace/:urlKey/kpis` page.
 *
 * Counts, app-defined labels and this workspace's own API-equivalent cost
 * estimate (LIN-3711; an estimate from token usage, never cash): no issue
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
  buildDispatchByDay,
  buildFunnel,
  countByDay,
  loadDispatchHistory,
  loadProxyBins,
  medianQueueToTakeMinutes,
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
 * @param {Object} deps
 * @param {Object} deps.collections - dispatchQueue, dispatchHistory, proxyEvents,
 *   agentStatus, reportHistory, customPrompts
 * @param {string} deps.urlKey - the workspace; the only scope of every read
 * @param {Date} [deps.now]
 * @returns {Promise<Object>} counts and labels for this workspace only
 */
export async function collectWorkspaceKpis({ collections, urlKey, now = new Date() }) {
  if (typeof urlKey !== 'string' || !urlKey) throw new TypeError('collectWorkspaceKpis: urlKey is required');
  const { dispatchQueue, dispatchHistory, proxyEvents, agentStatus, reportHistory, customPrompts } = collections;
  const since = readHorizonStart(now);

  const [historyDocs, queueDocs, proxyBins, agentStatusDocs, reportCount, customPromptCount] = await Promise.all([
    loadDispatchHistory(dispatchHistory, { since, urlKey }),
    dispatchQueue.find({ urlKey }).toArray(),
    loadProxyBins(proxyEvents, { since, urlKey }),
    agentStatus.find({ urlKey, timestamp: { $gte: since } }, { projection: AGENT_STATUS_FIELDS }).toArray(),
    reportHistory.countDocuments({ urlKey }),
    customPrompts.countDocuments({ urlKey })
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
    kinds: rank(tallyLabels(long.windowedDispatchDocs, 'kind')),
    daily: buildDaily({ historyDocs, queueDocs, long, windows: longWindows }),
    stored: {
      customPrompts: customPromptCount,
      roadmapReports: reportCount,
      roadmapReportsCap: MAX_REPORTS_PER_WORKSPACE
    },
    empty: long.totals.dispatches === 0 && long.totals.agentActions === 0
  };
}
