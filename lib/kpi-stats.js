/**
 * KPI statistics collector for the public /kpis page.
 *
 * Aggregates instance-wide activity from the operational collections.
 * The consuming page is public and unauthenticated, so this module is the
 * privacy boundary: it returns only counts, day buckets, and app-defined
 * labels (parameterized endpoint templates, dispatch kind names) — never
 * workspace urlKeys, prompt text, summaries, tokens, or issue content.
 *
 * Works against both MongoDB and MangoDB by sticking to the smallest shared
 * collection surface: `countDocuments()` (no filter or simple equality) and
 * `find({}).toArray()`, with date filtering/bucketing done in JS. Every
 * collection read in full is TTL-bounded (≤30 days) or small by design
 * (preferences, report history capped at 20/workspace).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACTIVITY_WINDOW_DAYS = 30;
export const FREE_TIER_WINDOW_DAYS = 7;
const TOP_LIST_LIMIT = 8;

/**
 * UTC day key ('YYYY-MM-DD') for a Date or date-like value.
 * Returns null for missing/invalid values so callers can skip them.
 */
function dayKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Ordered list of UTC day keys ending at `now`, oldest first.
 */
function buildDayWindow(now, days) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(dayKey(new Date(now.getTime() - i * DAY_MS)));
  }
  return keys;
}

/**
 * Count docs per day for a timestamp field, aligned to the given day keys.
 * Docs outside the window (or with invalid dates) are ignored.
 */
function bucketByDay(docs, field, dayKeys) {
  const counts = Object.fromEntries(dayKeys.map(key => [key, 0]));
  for (const doc of docs) {
    const key = dayKey(doc[field]);
    if (key !== null && key in counts) counts[key]++;
  }
  return dayKeys.map(key => counts[key]);
}

/**
 * Top distinct string values of a field by frequency.
 * Ties break alphabetically for deterministic output.
 */
function topCounts(docs, field, limit = TOP_LIST_LIMIT) {
  const counts = new Map();
  for (const doc of docs) {
    const raw = doc[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function addKeys(set, docs, field) {
  for (const doc of docs) {
    const value = doc[field];
    if (typeof value === 'string' && value) set.add(value);
  }
}

/**
 * Collect instance KPIs.
 *
 * @param {Object} collections - Collection handles (MongoDB or MangoDB)
 * @param {Object} collections.sessions
 * @param {Object} collections.userPreferences
 * @param {Object} collections.workspacePreferences
 * @param {Object} collections.customPrompts
 * @param {Object} collections.localIssues
 * @param {Object} collections.dispatchQueue
 * @param {Object} collections.dispatchHistory
 * @param {Object} collections.dispatchTokens
 * @param {Object} collections.proxyTokens
 * @param {Object} collections.proxyEvents
 * @param {Object} collections.foremanStatus
 * @param {Object} collections.freeTier
 * @param {Object} collections.recapCache
 * @param {Object} collections.briefCache
 * @param {Object} collections.reportHistory
 * @param {Object} [options]
 * @param {Date} [options.now] - Clock override for tests
 * @param {string|null} [options.dbBackend] - 'mongodb' | 'mangodb' vanity label
 * @returns {Promise<Object>} Aggregate stats, safe for public display
 */
export async function collectKpiStats(collections, { now = new Date(), dbBackend = null } = {}) {
  const {
    sessions, userPreferences, workspacePreferences, customPrompts, localIssues,
    dispatchQueue, dispatchHistory, dispatchTokens,
    proxyTokens, proxyEvents, foremanStatus,
    freeTier, recapCache, briefCache, reportHistory
  } = collections;

  const [
    sessionDocs,
    usersCount,
    workspacePrefDocs,
    customPromptDocs,
    localIssuesCount,
    localProjectsCount,
    queueDocs,
    historyDocs,
    dispatchTokensCount,
    proxyTokensCount,
    proxyEventDocs,
    foremanDocs,
    freeTierDocs,
    recapCount,
    briefCount,
    reportDocs
  ] = await Promise.all([
    sessions.find({}).toArray(),
    userPreferences.countDocuments({}),
    workspacePreferences.find({}).toArray(),
    customPrompts.find({}).toArray(),
    localIssues.countDocuments({ kind: 'issue' }),
    localIssues.countDocuments({ kind: 'project' }),
    dispatchQueue.find({}).toArray(),
    dispatchHistory.find({}).toArray(),
    dispatchTokens.countDocuments({}),
    proxyTokens.countDocuments({}),
    proxyEvents.find({}).toArray(),
    foremanStatus.find({}).toArray(),
    freeTier.find({}).toArray(),
    recapCache.countDocuments({}),
    briefCache.countDocuments({}),
    reportHistory.find({}).toArray()
  ]);

  // Workspaces seen: union of workspace keys across configuration and
  // activity collections. Only the count is exposed — never the keys.
  const workspaceKeys = new Set();
  addKeys(workspaceKeys, workspacePrefDocs, '_id'); // workspace-preferences keyed by urlKey
  addKeys(workspaceKeys, customPromptDocs, 'urlKey');
  addKeys(workspaceKeys, queueDocs, 'urlKey');
  addKeys(workspaceKeys, historyDocs, 'urlKey');
  addKeys(workspaceKeys, proxyEventDocs, 'urlKey');
  addKeys(workspaceKeys, foremanDocs, 'urlKey');
  addKeys(workspaceKeys, reportDocs, 'urlKey');
  addKeys(workspaceKeys, freeTierDocs, 'urlKey'); // global hourly records have urlKey: null

  const activeSessions = sessionDocs.filter(doc => {
    const expires = doc.expires ? new Date(doc.expires) : null;
    return expires && expires.getTime() > now.getTime();
  }).length;

  // Activity over the last 30 days, bucketed per UTC day. Sources are the
  // three operational logs (all 30-day TTL, so a full read covers the window).
  // 'steps' are foreman-status entries — the progress reports that agents
  // (including autopilot orchestrators) post per work step.
  const activityDays = buildDayWindow(now, ACTIVITY_WINDOW_DAYS);
  const dispatchDocs = [...historyDocs, ...queueDocs];
  const activity = {
    days: activityDays,
    proxy: bucketByDay(proxyEventDocs, 'timestamp', activityDays),
    steps: bucketByDay(foremanDocs, 'timestamp', activityDays),
    dispatch: bucketByDay(dispatchDocs, 'dispatchedAt', activityDays)
  };

  // Busiest day across all three activity sources (vanity stat).
  let busiestDay = null;
  activityDays.forEach((day, i) => {
    const total = activity.proxy[i] + activity.steps[i] + activity.dispatch[i];
    if (total > 0 && (!busiestDay || total > busiestDay.count)) {
      busiestDay = { day, count: total };
    }
  });

  // Autopilot runs: kickoff dispatches carry the explicit meta-kind
  // 'autopilot' (never derived from promptName). The worker steps an
  // autopilot spawns show up as the other kinds in dispatchKinds below.
  const autopilotRuns = dispatchDocs.filter(doc => doc.kind === 'autopilot').length;

  // Step outcomes: agents report per-step results to the foreman-status log
  // with conventional statuses; anything unconventional lands in 'other'.
  const stepOutcomes = { completed: 0, failed: 0, blocked: 0, other: 0 };
  for (const doc of foremanDocs) {
    const status = typeof doc.status === 'string' ? doc.status.toLowerCase() : '';
    // Object.hasOwn so consumer-supplied statuses like 'constructor' can't
    // reach the prototype chain and pollute the buckets.
    if (status !== 'other' && Object.hasOwn(stepOutcomes, status)) stepOutcomes[status]++;
    else stepOutcomes.other++;
  }

  // Dispatch outcomes: current queue plus resolved history statuses.
  const dispatchOutcomes = { queued: queueDocs.length, taken: 0, expired: 0, cancelled: 0 };
  for (const doc of historyDocs) {
    if (typeof doc.status === 'string' && Object.hasOwn(dispatchOutcomes, doc.status)) {
      dispatchOutcomes[doc.status]++;
    }
  }

  const feedbackNotes = historyDocs.reduce(
    (sum, doc) => sum + (Array.isArray(doc.feedback) ? doc.feedback.length : 0), 0
  );

  // Proxy response classes (2xx/3xx grouped as ok).
  const proxyStatus = { ok: 0, clientError: 0, serverError: 0 };
  for (const doc of proxyEventDocs) {
    const status = Number(doc.status);
    if (status >= 500) proxyStatus.serverError++;
    else if (status >= 400) proxyStatus.clientError++;
    else if (status >= 100) proxyStatus.ok++;
  }

  // Free tier prompts, last 7 days. Workspace daily docs have a non-null
  // urlKey and a 'YYYY-MM-DD' date; global hourly docs are excluded.
  const freeTierDays = buildDayWindow(now, FREE_TIER_WINDOW_DAYS);
  const freeTierByDay = Object.fromEntries(freeTierDays.map(key => [key, 0]));
  for (const doc of freeTierDocs) {
    if (!doc.urlKey || typeof doc.date !== 'string' || doc.date.length !== 10) continue;
    if (doc.date in freeTierByDay) freeTierByDay[doc.date] += doc.count || 0;
  }

  return {
    generatedAt: now.toISOString(),
    totals: {
      workspaces: workspaceKeys.size,
      users: usersCount,
      activeSessions,
      agentActions: proxyEventDocs.length + foremanDocs.length,
      dispatches: dispatchDocs.length,
      autopilotRuns,
      feedbackNotes,
      aiSummaries: recapCount + briefCount,
      roadmapReports: reportDocs.length,
      customPrompts: customPromptDocs.length,
      localIssues: localIssuesCount,
      localProjects: localProjectsCount,
      activeTokens: proxyTokensCount + dispatchTokensCount
    },
    activity,
    dispatchOutcomes,
    dispatchKinds: topCounts(dispatchDocs, 'kind'),
    stepOutcomes,
    proxyStatus,
    topEndpoints: topCounts(proxyEventDocs, 'endpoint'),
    freeTier: {
      days: freeTierDays,
      counts: freeTierDays.map(key => freeTierByDay[key])
    },
    vanity: {
      busiestDay,
      dbBackend
    }
  };
}
