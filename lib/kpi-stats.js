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

import { LINEAR_CALL_OUTCOMES } from './linear-call-log.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const ACTIVITY_WINDOW_DAYS = 30;
export const HOURLY_WINDOW_HOURS = 24;
export const FREE_TIER_WINDOW_DAYS = 7;
export const WEEKLY_WINDOW_WEEKS = 5;
const TOP_LIST_LIMIT = 8;
const WEEKLY_KIND_LIMIT = 5;

/**
 * Parse a Date or date-like value to epoch ms; null for missing/invalid.
 */
function toTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * UTC day key ('YYYY-MM-DD') for a Date or date-like value.
 * Returns null for missing/invalid values so callers can skip them.
 */
function dayKey(value) {
  const time = toTime(value);
  return time === null ? null : new Date(time).toISOString().slice(0, 10);
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
 * UTC hour key ('YYYY-MM-DDTHH') for a Date or date-like value.
 * Returns null for missing/invalid values so callers can skip them.
 */
function hourKey(value) {
  const time = toTime(value);
  return time === null ? null : new Date(time).toISOString().slice(0, 13);
}

/**
 * Ordered list of UTC hour keys ending at `now`, oldest first.
 */
function buildHourWindow(now, hours) {
  const keys = [];
  for (let i = hours - 1; i >= 0; i--) {
    keys.push(hourKey(new Date(now.getTime() - i * HOUR_MS)));
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
 * Classify a proxy API call into a phase of the agent loop. The phases are
 * the page's narrative vocabulary: agents orient (read state), decide (ask
 * for recommendations / kick off runs), act (write changes), watch (poll
 * dispatched work), and report (post step results). Unknown endpoints fall
 * back by method — reads orient, writes act — so new endpoints degrade
 * gracefully instead of needing an 'other' bucket.
 */
export function categorizeProxyEvent(method, endpoint) {
  const m = typeof method === 'string' ? method.toUpperCase() : 'GET';
  const e = typeof endpoint === 'string' ? endpoint : '';
  // agent/status is canonical (LIN-533); foreman/status is the deprecated alias and
  // still appears in historical audit events, so both are matched.
  if (e.startsWith('/api/proxy/agent/status') || e.startsWith('/api/proxy/foreman/status')) return m === 'GET' ? 'watching' : 'reporting';
  if (e.startsWith('/api/proxy/foreman/sessions') || e.startsWith('/api/proxy/foreman/tasks')) return 'watching';
  if (e.startsWith('/api/proxy/dispatch')) return m === 'GET' ? 'watching' : 'deciding';
  if (
    e.startsWith('/api/proxy/recommend') ||
    e.startsWith('/api/proxy/prompt') ||
    e.startsWith('/api/proxy/autopilot') ||
    e.startsWith('/api/proxy/foreman/playbook')
  ) return 'deciding';
  return m === 'GET' ? 'orienting' : 'acting';
}

export const PROXY_PHASES = ['orienting', 'deciding', 'acting', 'watching', 'reporting'];

/**
 * Median of a numeric array; null when empty.
 */
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
 * @param {Object} collections.agentStatus
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
    proxyTokens, proxyEvents, agentStatus,
    freeTier, recapCache, briefCache, reportHistory, linearCalls
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
    agentStatusDocs,
    freeTierDocs,
    recapCount,
    briefCount,
    reportDocs,
    linearCallDocs
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
    agentStatus.find({}).toArray(),
    freeTier.find({}).toArray(),
    recapCache.countDocuments({}),
    briefCache.countDocuments({}),
    reportHistory.find({}).toArray(),
    // Optional source (LIN-538): tolerate older deployments without the collection.
    linearCalls ? linearCalls.find({}).toArray() : Promise.resolve([])
  ]);

  // Workspaces seen: union of workspace keys across configuration and
  // activity collections. Only the count is exposed — never the keys.
  const workspaceKeys = new Set();
  addKeys(workspaceKeys, workspacePrefDocs, '_id'); // workspace-preferences keyed by urlKey
  addKeys(workspaceKeys, customPromptDocs, 'urlKey');
  addKeys(workspaceKeys, queueDocs, 'urlKey');
  addKeys(workspaceKeys, historyDocs, 'urlKey');
  addKeys(workspaceKeys, proxyEventDocs, 'urlKey');
  addKeys(workspaceKeys, agentStatusDocs, 'urlKey');
  addKeys(workspaceKeys, reportDocs, 'urlKey');
  addKeys(workspaceKeys, freeTierDocs, 'urlKey'); // global hourly records have urlKey: null

  const activeSessions = sessionDocs.filter(doc => {
    const expires = toTime(doc.expires);
    return expires !== null && expires > now.getTime();
  }).length;

  const activityDays = buildDayWindow(now, ACTIVITY_WINDOW_DAYS);
  const dayIndex = Object.fromEntries(activityDays.map((key, i) => [key, i]));
  const dispatchDocs = [...historyDocs, ...queueDocs];

  // Proxy calls by phase of the agent loop, per UTC day. This is the page's
  // hero chart: composition over volume — what agents *do*, not how much.
  // The hourly variant backs the chart's 24h toggle.
  const activityHours = buildHourWindow(now, HOURLY_WINDOW_HOURS);
  const hourIndex = Object.fromEntries(activityHours.map((key, i) => [key, i]));
  const proxyCategories = { days: activityDays };
  const proxyCategoriesHourly = { hours: activityHours };
  for (const phase of PROXY_PHASES) {
    proxyCategories[phase] = new Array(activityDays.length).fill(0);
    proxyCategoriesHourly[phase] = new Array(activityHours.length).fill(0);
  }
  let proxyReads = 0;
  let proxyWrites = 0;
  for (const doc of proxyEventDocs) {
    const method = typeof doc.method === 'string' ? doc.method.toUpperCase() : 'GET';
    if (method === 'GET') proxyReads++;
    else proxyWrites++;
    const phase = categorizeProxyEvent(doc.method, doc.endpoint);
    const dKey = dayKey(doc.timestamp);
    if (dKey !== null && dKey in dayIndex) proxyCategories[phase][dayIndex[dKey]]++;
    const hKey = hourKey(doc.timestamp);
    if (hKey !== null && hKey in hourIndex) proxyCategoriesHourly[phase][hourIndex[hKey]]++;
  }

  // Busiest day across all activity sources (vanity stat).
  const stepsByDay = bucketByDay(agentStatusDocs, 'timestamp', activityDays);
  const dispatchByDay = bucketByDay(dispatchDocs, 'dispatchedAt', activityDays);
  let busiestDay = null;
  activityDays.forEach((day, i) => {
    const proxyTotal = PROXY_PHASES.reduce((sum, phase) => sum + proxyCategories[phase][i], 0);
    const total = proxyTotal + stepsByDay[i] + dispatchByDay[i];
    if (total > 0 && (!busiestDay || total > busiestDay.count)) {
      busiestDay = { day, count: total };
    }
  });

  // Autopilot runs: kickoff dispatches carry the explicit meta-kind
  // 'autopilot' (never derived from promptName). The worker steps an
  // autopilot spawns show up as the other kinds in dispatchKinds below.
  const autopilotRuns = dispatchDocs.filter(doc => doc.kind === 'autopilot').length;

  // Dispatched work by kind per week: the adoption story over time. Five
  // 7-day windows ending at `now`; the top kinds get their own series and
  // the long tail folds into 'other'.
  const weekStarts = [];
  for (let i = WEEKLY_WINDOW_WEEKS; i >= 1; i--) {
    weekStarts.push(now.getTime() - i * WEEK_MS);
  }
  const topKindLabels = topCounts(dispatchDocs, 'kind', WEEKLY_KIND_LIMIT).map(e => e.label);
  const weeklySeries = new Map(topKindLabels.map(label => [label, new Array(weekStarts.length).fill(0)]));
  const weeklyOther = new Array(weekStarts.length).fill(0);
  let hasWeeklyOther = false;
  for (const doc of dispatchDocs) {
    const time = toTime(doc.dispatchedAt);
    if (time === null) continue;
    const idx = weekStarts.findIndex(start => time >= start && time < start + WEEK_MS);
    if (idx === -1) continue;
    const kind = typeof doc.kind === 'string' && doc.kind.trim() ? doc.kind.trim() : 'other';
    if (weeklySeries.has(kind)) {
      weeklySeries.get(kind)[idx]++;
    } else {
      weeklyOther[idx]++;
      hasWeeklyOther = true;
    }
  }
  const dispatchByWeek = {
    weeks: weekStarts.map(start => dayKey(new Date(start))),
    kinds: [...weeklySeries].map(([label, counts]) => ({ label, counts }))
      .concat(hasWeeklyOther ? [{ label: 'other', counts: weeklyOther }] : [])
  };

  // Work funnel: dispatched → taken (claimed by a worker) → reported (the
  // worker sent feedback, or a step was posted against the dispatch) →
  // completed (a linked step reports 'completed'). The gaps between stages
  // are the honest part of the story: expiry, silence, and failure.
  const takenCount = historyDocs.filter(doc => doc.status === 'taken').length;
  const dispatchIds = new Set(dispatchDocs.map(doc => String(doc._id)));
  const reportedIds = new Set();
  const completedIds = new Set();
  for (const doc of agentStatusDocs) {
    if (!doc.dispatchId) continue;
    const id = String(doc.dispatchId);
    if (!dispatchIds.has(id)) continue;
    reportedIds.add(id);
    if (typeof doc.status === 'string' && doc.status.toLowerCase() === 'completed') {
      completedIds.add(id);
    }
  }
  for (const doc of historyDocs) {
    if (Array.isArray(doc.feedback) && doc.feedback.length > 0) reportedIds.add(String(doc._id));
  }
  const funnel = {
    dispatched: dispatchDocs.length,
    taken: takenCount,
    reported: reportedIds.size,
    completed: completedIds.size
  };

  // Median queue→take latency for taken dispatches, in minutes. resolvedAt is
  // stamped when the runner *claims* the item (take/archive time), NOT when the
  // work finishes — so this is dispatch→claim wait, not task duration. Labelling
  // it "resolution"/"dispatch→done" was the LIN-400 leak; the true completion
  // time lives in the terminal feedback timestamp (proxy deriveCompletedAt), not
  // in resolvedAt, and is not aggregated here.
  const queueToTakeMinutes = [];
  for (const doc of historyDocs) {
    if (doc.status !== 'taken') continue;
    const dispatched = toTime(doc.dispatchedAt);
    const taken = toTime(doc.resolvedAt);
    if (dispatched === null || taken === null || taken < dispatched) continue;
    queueToTakeMinutes.push((taken - dispatched) / 60000);
  }
  const medianQueueToTake = median(queueToTakeMinutes);

  const feedbackNotes = historyDocs.reduce(
    (sum, doc) => sum + (Array.isArray(doc.feedback) ? doc.feedback.length : 0), 0
  );

  // Step outcomes: agents report per-step results to the agent-status log
  // with conventional statuses; anything unconventional lands in 'other'.
  const stepOutcomes = { completed: 0, failed: 0, blocked: 0, other: 0 };
  for (const doc of agentStatusDocs) {
    const status = typeof doc.status === 'string' ? doc.status.toLowerCase() : '';
    // Object.hasOwn so consumer-supplied statuses like 'constructor' can't
    // reach the prototype chain and pollute the buckets.
    if (status !== 'other' && Object.hasOwn(stepOutcomes, status)) stepOutcomes[status]++;
    else stepOutcomes.other++;
  }

  // Proxy response classes (2xx/3xx grouped as ok).
  const proxyStatus = { ok: 0, clientError: 0, serverError: 0 };
  for (const doc of proxyEventDocs) {
    const status = Number(doc.status);
    if (status >= 500) proxyStatus.serverError++;
    else if (status >= 400) proxyStatus.clientError++;
    else if (status >= 100) proxyStatus.ok++;
  }

  // When the instance works: all agent actions histogrammed by UTC hour.
  const hourOfDay = new Array(24).fill(0);
  const hourSources = [
    [proxyEventDocs, 'timestamp'],
    [agentStatusDocs, 'timestamp'],
    [dispatchDocs, 'dispatchedAt']
  ];
  for (const [docs, field] of hourSources) {
    for (const doc of docs) {
      const time = toTime(doc[field]);
      if (time !== null) hourOfDay[new Date(time).getUTCHours()]++;
    }
  }

  // Free tier prompts, last 7 days. Workspace daily docs have a non-null
  // urlKey and a 'YYYY-MM-DD' date; global hourly docs are excluded.
  const freeTierDays = buildDayWindow(now, FREE_TIER_WINDOW_DAYS);
  const freeTierByDay = Object.fromEntries(freeTierDays.map(key => [key, 0]));
  for (const doc of freeTierDocs) {
    if (!doc.urlKey || typeof doc.date !== 'string' || doc.date.length !== 10) continue;
    if (doc.date in freeTierByDay) freeTierByDay[doc.date] += doc.count || 0;
  }

  // Linear API calls (LIN-538): volume + outcome, so a request burst and a
  // failure spike (e.g. undici "Premature close") are visible side by side on a
  // page that does NOT itself depend on Linear. Hourly window backs the chart;
  // 24h/30d totals back the cards. Counts only — never tokens/workspaces/content.
  const linearHours = buildHourWindow(now, HOURLY_WINDOW_HOURS);
  const linearHourIndex = Object.fromEntries(linearHours.map((key, i) => [key, i]));
  const linearHourly = { hours: linearHours, ok: new Array(linearHours.length).fill(0), failed: new Array(linearHours.length).fill(0) };
  const linearByOutcome = Object.fromEntries(LINEAR_CALL_OUTCOMES.map(o => [o, 0]));
  let linearTotal24h = 0;
  let linearFailed24h = 0;
  const dayAgo = now.getTime() - DAY_MS;
  for (const doc of linearCallDocs) {
    const outcome = LINEAR_CALL_OUTCOMES.includes(doc.outcome) ? doc.outcome : 'internal';
    linearByOutcome[outcome]++;
    const time = toTime(doc.timestamp);
    if (time === null || time < dayAgo) continue;
    linearTotal24h++;
    const failed = outcome !== 'ok';
    if (failed) linearFailed24h++;
    const hKey = hourKey(new Date(time));
    if (hKey in linearHourIndex) linearHourly[failed ? 'failed' : 'ok'][linearHourIndex[hKey]]++;
  }
  const linearStats = {
    total24h: linearTotal24h,
    failed24h: linearFailed24h,
    total30d: linearCallDocs.length,
    failureRatePct: linearTotal24h > 0 ? Math.round((linearFailed24h / linearTotal24h) * 1000) / 10 : null,
    byOutcome: linearByOutcome,
    hourly: linearHourly
  };

  return {
    generatedAt: now.toISOString(),
    totals: {
      workspaces: workspaceKeys.size,
      users: usersCount,
      activeSessions,
      agentActions: proxyEventDocs.length + agentStatusDocs.length,
      dispatches: dispatchDocs.length,
      autopilotRuns,
      feedbackNotes,
      aiSummaries: recapCount + briefCount,
      roadmapReports: reportDocs.length,
      customPrompts: customPromptDocs.length,
      localIssues: localIssuesCount,
      localProjects: localProjectsCount,
      activeTokens: proxyTokensCount + dispatchTokensCount,
      linearCalls24h: linearTotal24h,
      linearFailures24h: linearFailed24h
    },
    linearCalls: linearStats,
    proxyCategories,
    proxyCategoriesHourly,
    dispatchByWeek,
    dispatchKinds: topCounts(dispatchDocs, 'kind'),
    funnel,
    stepOutcomes,
    proxyStatus,
    topEndpoints: topCounts(proxyEventDocs, 'endpoint'),
    hourOfDay,
    freeTier: {
      days: freeTierDays,
      counts: freeTierDays.map(key => freeTierByDay[key])
    },
    vanity: {
      busiestDay,
      // Reads per write across all proxy traffic (null until the first write)
      readsPerWrite: proxyWrites > 0 ? Math.round((proxyReads / proxyWrites) * 10) / 10 : null,
      // Median minutes from dispatch to claim (queue→take latency) for taken
      // items. NOT task duration — resolvedAt is take time, not completion (LIN-400).
      medianQueueToTakeMinutes: medianQueueToTake === null ? null : Math.round(medianQueueToTake * 10) / 10,
      dbBackend
    }
  };
}
