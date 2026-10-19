/**
 * KPI statistics for ONE workspace (LIN-3689) — the data behind the in-Harbour
 * `/workspace/:urlKey/kpis` page.
 *
 * Counts and app-defined labels only: no issue identifiers, prompt text, account
 * ids, other workspaces' keys or any instance-wide figure. Every read is
 * filtered to `urlKey` in the query itself (the stores' indexes lead with
 * `urlKey`), and every figure comes from the same math the public page uses
 * (`summarizeActivity`, `buildFunnel`, `medianQueueToTakeMinutes`,
 * `tallyLabels`, `rank` in lib/kpi-stats.js), so a number cannot drift between
 * the two pages. Reads stop at the shared 30-day read horizon on purpose; only
 * the `stored` block is unwindowed.
 */

import {
  AGENT_STATUS_FIELDS,
  buildFunnel,
  loadDispatchHistory,
  loadProxyBins,
  medianQueueToTakeMinutes,
  rank,
  summarizeActivity,
  tallyLabels,
  windowsAt
} from './kpi-stats.js';
import { readHorizonStart } from './read-horizon.js';
import { MAX_REPORTS_PER_WORKSPACE } from './report-history-store.js';

const SHORT_WINDOW_DAYS = 7;
const LONG_WINDOW_DAYS = 30;

const roundTo1 = value => Math.round(value * 10) / 10;

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
  const short = summarizeActivity(rows, windowsAt(now, { days: SHORT_WINDOW_DAYS }));
  const long = summarizeActivity(rows, windowsAt(now, { days: LONG_WINDOW_DAYS }));

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
    stored: {
      customPrompts: customPromptCount,
      roadmapReports: reportCount,
      roadmapReportsCap: MAX_REPORTS_PER_WORKSPACE
    },
    empty: long.totals.dispatches === 0 && long.totals.agentActions === 0
  };
}
