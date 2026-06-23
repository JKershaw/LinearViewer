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

// Proxy-event fields the page actually reads. Projecting to these keeps the
// read small even though proxyEvents is the highest-volume collection.
const PROXY_FIELDS = { method: 1, endpoint: 1, status: 1, timestamp: 1, urlKey: 1 };
// Agent-status fields the page reads; drops the bulky summary/metrics/evidence
// payloads carried on each status record.
const AGENT_STATUS_FIELDS = { dispatchId: 1, status: 1, timestamp: 1, urlKey: 1 };

/**
 * Load proxy events as pre-binned rows: one row per distinct
 * (method, endpoint, status, UTC-hour) with a count and the set of urlKeys
 * seen. proxyEvents is the busiest collection (one row per proxy API call), so
 * loading it raw with find({}).toArray() pulls every event into memory — the
 * read that pushed /kpis past the 30s router timeout. Grouping in the DB
 * collapses millions of repetitive rows into thousands; the page's day/hour
 * buckets, phase categories, status classes, top endpoints and totals are all
 * recoverable from the bins (count-weighted). `hour` is null for missing/invalid
 * timestamps — the count still lands in the totals, mirroring the raw path.
 *
 * Falls back to a projected find({}) when the collection has no aggregate()
 * (the unit-test mock), so the math stays covered by the existing tests.
 * @param {Object} proxyEvents
 * @returns {Promise<Array<{method,endpoint,status,hour,day,count,urlKeys:string[]}>>}
 */
async function loadProxyBins(proxyEvents) {
  if (typeof proxyEvents.aggregate === 'function') {
    try {
      const grouped = await proxyEvents.aggregate([
        {
          $group: {
            _id: {
              method: '$method',
              endpoint: '$endpoint',
              status: '$status',
              hour: { $dateToString: { format: '%Y-%m-%dT%H', date: '$timestamp', timezone: 'UTC' } }
            },
            count: { $sum: 1 },
            urlKeys: { $addToSet: '$urlKey' }
          }
        }
      ]).toArray();
      return grouped.map(g => ({
        method: g._id.method,
        endpoint: g._id.endpoint,
        status: g._id.status,
        hour: g._id.hour || null,
        day: g._id.hour ? g._id.hour.slice(0, 10) : null,
        count: g.count || 0,
        urlKeys: Array.isArray(g.urlKeys) ? g.urlKeys : []
      }));
    } catch {
      // fall through to the projected find path
    }
  }
  const docs = await proxyEvents.find({}, { projection: PROXY_FIELDS }).toArray();
  return docs.map(d => {
    const hour = hourKey(d.timestamp);
    return {
      method: d.method,
      endpoint: d.endpoint,
      status: d.status,
      hour,
      day: hour ? hour.slice(0, 10) : null,
      count: 1,
      urlKeys: d.urlKey ? [d.urlKey] : []
    };
  });
}

/**
 * Load dispatch history with the per-heartbeat `feedback[]` array replaced by
 * its length (`feedbackCount`). That array grows on every heartbeat (LIN-594
 * telemetry) and is the fattest field in the collection; the page only needs
 * its length, never its content. Falls back to a raw find({}) when aggregate()
 * is unavailable (the unit-test mock keeps the real feedback array, which
 * feedbackLen() reads directly).
 * @param {Object} dispatchHistory
 * @returns {Promise<Array<Object>>}
 */
async function loadDispatchHistory(dispatchHistory) {
  if (typeof dispatchHistory.aggregate === 'function') {
    try {
      return await dispatchHistory.aggregate([
        {
          $project: {
            urlKey: 1, status: 1, dispatchedAt: 1, resolvedAt: 1, kind: 1,
            feedbackCount: { $size: { $ifNull: ['$feedback', []] } }
          }
        }
      ]).toArray();
    } catch {
      // fall through to the raw find path
    }
  }
  return dispatchHistory.find({}).toArray();
}

/**
 * Length of a dispatch's feedback list, from either shape: the raw `feedback`
 * array (find path) or the pre-computed `feedbackCount` (aggregation path).
 */
function feedbackLen(doc) {
  if (Array.isArray(doc.feedback)) return doc.feedback.length;
  return Number.isFinite(doc.feedbackCount) ? doc.feedbackCount : 0;
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
    proxyBins,
    agentStatusDocs,
    freeTierDocs,
    recapCount,
    briefCount,
    reportDocs
  ] = await Promise.all([
    // Sessions can carry a bulky per-workspace blob; the page only needs expiry.
    sessions.find({}, { projection: { expires: 1 } }).toArray(),
    userPreferences.countDocuments({}),
    workspacePreferences.find({}).toArray(),
    customPrompts.find({}).toArray(),
    localIssues.countDocuments({ kind: 'issue' }),
    localIssues.countDocuments({ kind: 'project' }),
    dispatchQueue.find({}).toArray(),
    loadDispatchHistory(dispatchHistory),
    dispatchTokens.countDocuments({}),
    proxyTokens.countDocuments({}),
    loadProxyBins(proxyEvents),
    agentStatus.find({}, { projection: AGENT_STATUS_FIELDS }).toArray(),
    freeTier.find({}).toArray(),
    recapCache.countDocuments({}),
    briefCache.countDocuments({}),
    reportHistory.find({}).toArray()
  ]);
  // Total proxy events across all bins (each bin carries its own count).
  const proxyEventCount = proxyBins.reduce((sum, bin) => sum + bin.count, 0);

  // Workspaces seen: union of workspace keys across configuration and
  // activity collections. Only the count is exposed — never the keys.
  const workspaceKeys = new Set();
  addKeys(workspaceKeys, workspacePrefDocs, '_id'); // workspace-preferences keyed by urlKey
  addKeys(workspaceKeys, customPromptDocs, 'urlKey');
  addKeys(workspaceKeys, queueDocs, 'urlKey');
  addKeys(workspaceKeys, historyDocs, 'urlKey');
  for (const bin of proxyBins) {
    for (const key of bin.urlKeys) {
      if (typeof key === 'string' && key) workspaceKeys.add(key);
    }
  }
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
  for (const bin of proxyBins) {
    const method = typeof bin.method === 'string' ? bin.method.toUpperCase() : 'GET';
    if (method === 'GET') proxyReads += bin.count;
    else proxyWrites += bin.count;
    const phase = categorizeProxyEvent(bin.method, bin.endpoint);
    if (bin.day !== null && bin.day in dayIndex) proxyCategories[phase][dayIndex[bin.day]] += bin.count;
    if (bin.hour !== null && bin.hour in hourIndex) proxyCategoriesHourly[phase][hourIndex[bin.hour]] += bin.count;
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
    if (feedbackLen(doc) > 0) reportedIds.add(String(doc._id));
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
    (sum, doc) => sum + feedbackLen(doc), 0
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
  for (const bin of proxyBins) {
    const status = Number(bin.status);
    if (status >= 500) proxyStatus.serverError += bin.count;
    else if (status >= 400) proxyStatus.clientError += bin.count;
    else if (status >= 100) proxyStatus.ok += bin.count;
  }

  // Top proxy endpoints by call volume (count-weighted across the bins).
  const endpointCounts = new Map();
  for (const bin of proxyBins) {
    const endpoint = typeof bin.endpoint === 'string' ? bin.endpoint.trim() : '';
    if (!endpoint) continue;
    endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + bin.count);
  }
  const topEndpoints = [...endpointCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_LIST_LIMIT)
    .map(([label, count]) => ({ label, count }));

  // When the instance works: all agent actions histogrammed by UTC hour. Proxy
  // events come from the pre-binned hour key (count-weighted); the others from
  // their raw timestamps.
  const hourOfDay = new Array(24).fill(0);
  for (const bin of proxyBins) {
    if (bin.hour === null) continue;
    const h = Number(bin.hour.slice(11, 13));
    if (Number.isInteger(h) && h >= 0 && h < 24) hourOfDay[h] += bin.count;
  }
  const hourSources = [
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

  return {
    generatedAt: now.toISOString(),
    totals: {
      workspaces: workspaceKeys.size,
      users: usersCount,
      activeSessions,
      agentActions: proxyEventCount + agentStatusDocs.length,
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
    proxyCategories,
    proxyCategoriesHourly,
    dispatchByWeek,
    dispatchKinds: topCounts(dispatchDocs, 'kind'),
    funnel,
    stepOutcomes,
    proxyStatus,
    topEndpoints,
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
