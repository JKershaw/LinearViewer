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

import {
  findTerminalFeedback, harvestAbortedTargets, feedbackWithHarvestedAbort, __internal as TERMINAL_INTERNAL
} from './dispatch-terminal.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const ACTIVITY_WINDOW_DAYS = 30;
export const HOURLY_WINDOW_HOURS = 24;
export const FREE_TIER_WINDOW_DAYS = 7;
// Weekly buckets for the dispatch-outcome trend. Four whole weeks (28 days),
// not the full 30-day retention window: `historyTtl` defaults to 30 days
// (lib/dispatch-store.js), so a 30-day span split into whole weeks would still
// leave its oldest partial-week bucket under-filled. Four whole weeks is the
// largest span that fits entirely inside the retention window.
export const OUTCOME_WINDOW_WEEKS = 4;
// The outcome headline's own window. Wider than the 4×7-day trend span so the
// headline uses the full retained history; a lineage aged 28-30 days therefore
// counts toward the rate and coverage label but lands in no weekly bucket.
export const OUTCOME_WINDOW_DAYS = 30;
const TOP_LIST_LIMIT = 8;
const DISPATCH_DAY_KIND_LIMIT = 5;

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
 * Epoch ms cutoff `days` before `now` — the single source for every 30-day
 * (or other explicit-length) window cutoff, so a future window-length change
 * can't update one call site and miss another.
 */
function windowStartMs(now, days) {
  return now.getTime() - days * DAY_MS;
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
 * its length (`feedbackCount`) and by at most ONE derived terminal entry
 * (`terminalEntry`). That array grows on every heartbeat (LIN-594 telemetry)
 * and is the fattest field in the collection; reading it whole is what pushed
 * /kpis past the 30s router timeout, so it is never projected raw.
 *
 * The outcome metric (LIN-1596) needs the terminal marker, so the derivation
 * runs INSIDE the pipeline: `$map` narrows each entry to `{message, timestamp}`,
 * `$filter` keeps only the ones matching the shared terminal regex, and `$last`
 * reduces those to a single object — the same last-marker-wins scan
 * `findTerminalFeedback` performs in JS, so the two load paths agree. `$last`
 * yields *missing* for an empty match set, which is how a row with no marker
 * (including `[ended·unconfirmed]`, invisible to the terminal regex) arrives.
 * The regex pattern is read off the shared seam rather than retyped, so there
 * is still exactly one definition of what a terminal marker is.
 *
 * The four lineage/abort scalars are opaque ids reduced to counts downstream
 * and never emitted — same posture as the already-projected `urlKey`.
 *
 * Falls back to a raw find({}) when aggregate() is unavailable (the unit-test
 * mock keeps the real feedback array, which feedbackLen()/terminalFeedbackOf()
 * read directly). That fallback is the unbounded read the projection exists to
 * avoid, so a pipeline failure is warned about rather than degrading silently.
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
            rootItemId: 1, followUpTo: 1, abort: 1, abortTo: 1,
            feedbackCount: { $size: { $ifNull: ['$feedback', []] } },
            terminalEntry: {
              $last: {
                $filter: {
                  input: {
                    $map: {
                      input: { $ifNull: ['$feedback', []] },
                      as: 'f',
                      in: { message: '$$f.message', timestamp: '$$f.timestamp' }
                    }
                  },
                  as: 'entry',
                  cond: {
                    $regexMatch: {
                      input: { $ifNull: ['$$entry.message', ''] },
                      regex: TERMINAL_INTERNAL.TERMINAL_FEEDBACK_REGEX.source,
                      options: 'i'
                    }
                  }
                }
              }
            }
          }
        }
      ]).toArray();
    } catch (err) {
      // Falling through means the unbounded raw read returns — the exact
      // timeout the projection above exists to prevent. Never silent.
      console.warn('kpi-stats: dispatch-history aggregation failed, falling back to a raw read:', err?.message || err);
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
 * The feedback entries to derive a dispatch's terminal facts from, in either
 * shape — the exact sibling of `feedbackLen` above, and the ONE place the two
 * load paths differ. The find path (mock, and the aggregation fallback) carries
 * the raw `feedback` array; the aggregation path carries at most one derived
 * `terminalEntry`. Everything downstream — harvest, the F1 guard, status
 * derivation, grouping, bucketing — runs on this normalized value, so the paths
 * cannot drift. Queue rows never carry feedback at all (`addFeedback` writes
 * only to history), so they normalize to [].
 */
function terminalFeedbackOf(doc) {
  if (Array.isArray(doc.feedback)) return doc.feedback;
  return doc.terminalEntry ? [doc.terminalEntry] : [];
}

/**
 * The page's headline metric (LIN-1596): what fraction of dispatched work
 * landed. `done ÷ (done + failed + aborted)` over RESOLVED dispatch lineages in
 * the last 30 days, plus a weekly trend inside that window.
 *
 * Four rules make this measure outcomes rather than volume, and each is
 * load-bearing:
 *
 * 1. **The unit is the lineage, not the dispatch row.** One piece of work is
 *    frequently an original plus several follow-ups. Counting rows would let a
 *    task that needed four follow-ups contribute four dispatches and up to four
 *    `[done]`s — inflating the rate precisely on the work that needed the most
 *    human help. Group on `rootItemId` (the per-runner-session lineage anchor,
 *    LIN-1468, inherited only through `followUpTo`) and take the LAST terminal
 *    marker in the lineage. Pre-LIN-1468 rows carry no anchor and degrade to
 *    per-row counting via the `_id` fallback; within a 30-day TTL they are
 *    effectively extinct.
 * 2. **Abort rows are excluded, but the aborts they represent are not.** An
 *    abort is its own dispatch row carrying no prompt, and Simple Dispatcher
 *    posts `[aborted]` to THAT row, never to the target's stored feedback. An
 *    abort row also mints its own `rootItemId` (the anchor inherits through
 *    `followUpTo`; an abort carries `abortTo` instead), so counting naively
 *    records two lineages for one cancelled task: an `[aborted]` one that was
 *    never real work, and a target one with no marker at all. ORDERING IS THE
 *    MOST ERROR-PRONE PART OF THIS FUNCTION: the harvest map is keyed on a
 *    dispatch *id* while lineages are keyed on `rootItemId`, so harvesting must
 *    happen at ROW level BEFORE grouping, and abort rows are dropped only AFTER
 *    their marker has been attributed. Reverse either step and one cancelled
 *    task yields two wrong lineages. The shared LIN-1257/LIN-1261 pair is
 *    consumed unchanged, which also inherits the F1 guard for free (an EARLIER
 *    abort never overrides a LATER genuine terminal).
 * 3. **`[skipped]` is excluded entirely** — numerator and denominator. It means
 *    the runner REFUSED a cascade abort because a human was still in that
 *    session (LIN-946/951): terminal but benign, so nothing ended and it is not
 *    an outcome of the work. `harvestAbortedTargets` already refuses to harvest
 *    a `[skipped]` abort row; a non-abort row whose OWN terminal is `[skipped]`
 *    is not the harvest seam's business and is dropped here.
 * 4. **The denominator is resolved lineages only.** A queued or still-running
 *    dispatch has no outcome yet; including it would make the headline measure
 *    queue latency. `total` is published alongside so the coverage sub-label can
 *    say how much of the window the rate actually covers.
 *
 * Buckets are keyed on the lineage's EARLIEST `dispatchedAt`, so one lineage
 * lands in exactly one bucket and the coverage label and trend share one key.
 * The newest bucket is under-*resolved* (recent work hasn't finished), but
 * because unresolved lineages leave numerator and denominator together that is
 * a smaller sample rather than a biased rate — hence `weeklyResolved` rides
 * alongside `weeklyRate` so a thin bucket reads honestly.
 *
 * Emits only integers, `YYYY-MM-DD` bucket keys and ratios: no urlKey, no
 * marker text, no per-workspace or per-user split.
 *
 * @param {Array<Object>} rows - history + queue dispatch rows, either shape
 * @param {Date} now
 * @returns {Object} the `dispatchOutcomes` block
 */
function computeDispatchOutcomes(rows, now) {
  // 1. Normalize both load paths to one feedback shape, once.
  const normalized = rows.map(row => ({ row, feedback: terminalFeedbackOf(row) }));

  // 2. Harvest at ROW level, before any grouping — the map is keyed on the
  //    dispatch id an abort TARGETS, which no longer exists after grouping.
  const abortedTargets = harvestAbortedTargets(normalized.map(({ row, feedback }) => ({
    abort: row.abort,
    abortTo: row.abortTo == null ? row.abortTo : String(row.abortTo),
    feedback
  })));

  // 3. Attach the harvested abort, derive each row's terminal, then drop the
  //    abort rows themselves; 4. group the survivors into lineages.
  const lineages = new Map();
  for (const { row, feedback } of normalized) {
    if (row.abort === true) continue;
    const terminal = findTerminalFeedback(feedbackWithHarvestedAbort(feedback, abortedTargets.get(String(row._id))));
    const key = String(row.rootItemId || row._id);
    const dispatched = toTime(row.dispatchedAt);
    // A missing/unparseable terminal timestamp orders last-place rather than
    // discarding the marker: with one terminal in the lineage it still wins.
    const terminalMs = terminal ? toTime(terminal.entry?.timestamp) : null;

    let lineage = lineages.get(key);
    if (!lineage) {
      lineage = { earliest: dispatched, status: null, statusMs: null };
      lineages.set(key, lineage);
    } else if (dispatched !== null && (lineage.earliest === null || dispatched < lineage.earliest)) {
      lineage.earliest = dispatched;
    }
    if (terminal && (lineage.status === null || (terminalMs !== null && (lineage.statusMs === null || terminalMs > lineage.statusMs)))) {
      lineage.status = terminal.status;
      lineage.statusMs = terminalMs;
    }
  }

  // 5. Window + exclusions, and 6. weekly bucketing, in one pass over the
  //    lineage set so `total`, `resolved` and the buckets cannot disagree.
  const nowMs = now.getTime();
  const windowStart = nowMs - OUTCOME_WINDOW_DAYS * DAY_MS;
  const weekStarts = [];
  for (let i = OUTCOME_WINDOW_WEEKS; i >= 1; i--) weekStarts.push(nowMs - i * WEEK_MS);
  const weeklyDone = new Array(weekStarts.length).fill(0);
  const weeklyResolved = new Array(weekStarts.length).fill(0);

  const counts = { done: 0, failed: 0, aborted: 0 };
  let total = 0;
  let resolved = 0;
  for (const lineage of lineages.values()) {
    if (lineage.earliest === null || lineage.earliest < windowStart || lineage.earliest > nowMs) continue;
    if (lineage.status === 'skipped') continue; // benign: nothing ended
    total++;
    const week = weekStarts.findIndex(start => lineage.earliest >= start && lineage.earliest < start + WEEK_MS);
    if (lineage.status === null) continue; // unresolved: in `total`, not `resolved`
    resolved++;
    counts[lineage.status]++;
    if (week !== -1) {
      weeklyResolved[week]++;
      if (lineage.status === 'done') weeklyDone[week]++;
    }
  }

  // Ratios round to 3dp (0.1% once rendered), the existing `readsPerWrite`
  // idiom; null — never 0 — when there is nothing to divide by.
  const asRate = (done, of) => (of > 0 ? Math.round((done / of) * 1000) / 1000 : null);

  return {
    windowDays: OUTCOME_WINDOW_DAYS,
    total,
    resolved,
    done: counts.done,
    failed: counts.failed,
    aborted: counts.aborted,
    rate: asRate(counts.done, resolved),
    weeks: weekStarts.map(start => dayKey(new Date(start))),
    weeklyRate: weeklyResolved.map((of, i) => asRate(weeklyDone[i], of)),
    weeklyResolved
  };
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

  // The 30-day cutoff shared by every metric below that has no window of its
  // own. Built once and reused rather than re-filtered per metric.
  const activityWindowStart = windowStartMs(now, ACTIVITY_WINDOW_DAYS);
  const windowedDispatchDocs = dispatchDocs.filter(doc => {
    const time = toTime(doc.dispatchedAt);
    return time !== null && time >= activityWindowStart;
  });
  const windowedDispatchIds = new Set(windowedDispatchDocs.map(doc => String(doc._id)));
  const windowedHistoryDocs = historyDocs.filter(doc => {
    const time = toTime(doc.dispatchedAt);
    return time !== null && time >= activityWindowStart;
  });
  const windowedAgentStatusDocs = agentStatusDocs.filter(doc => {
    const time = toTime(doc.timestamp);
    return time !== null && time >= activityWindowStart;
  });

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
  let windowedProxyEventCount = 0;
  for (const bin of proxyBins) {
    const method = typeof bin.method === 'string' ? bin.method.toUpperCase() : 'GET';
    if (method === 'GET') proxyReads += bin.count;
    else proxyWrites += bin.count;
    const phase = categorizeProxyEvent(bin.method, bin.endpoint);
    if (bin.day !== null && bin.day in dayIndex) {
      proxyCategories[phase][dayIndex[bin.day]] += bin.count;
      windowedProxyEventCount += bin.count;
    }
    if (bin.hour !== null && bin.hour in hourIndex) proxyCategoriesHourly[phase][hourIndex[bin.hour]] += bin.count;
  }

  // Busiest day across all activity sources (vanity stat).
  const stepsByDay = bucketByDay(agentStatusDocs, 'timestamp', activityDays);
  const dispatchCountsByDay = bucketByDay(dispatchDocs, 'dispatchedAt', activityDays);
  let busiestDay = null;
  activityDays.forEach((day, i) => {
    const proxyTotal = PROXY_PHASES.reduce((sum, phase) => sum + proxyCategories[phase][i], 0);
    const total = proxyTotal + stepsByDay[i] + dispatchCountsByDay[i];
    if (total > 0 && (!busiestDay || total > busiestDay.count)) {
      busiestDay = { day, count: total };
    }
  });

  // Autopilot runs: kickoff dispatches carry the explicit meta-kind
  // 'autopilot' (never derived from promptName). The worker steps an
  // autopilot spawns show up as the other kinds in dispatchKinds below.
  const autopilotRuns = windowedDispatchDocs.filter(doc => doc.kind === 'autopilot').length;

  // Dispatched work by kind per day: the adoption story over time, in the
  // same 30-day window as the rest of the page (previously 5×7-day = 35
  // days, which exceeded the 30-day history retention and under-filled its
  // oldest bucket). Top kinds within the window get their own series; the
  // long tail folds into 'other'.
  const topDayKindLabels = topCounts(windowedDispatchDocs, 'kind', DISPATCH_DAY_KIND_LIMIT).map(e => e.label);
  const dailySeries = new Map(topDayKindLabels.map(label => [label, new Array(activityDays.length).fill(0)]));
  const dailyOther = new Array(activityDays.length).fill(0);
  let hasDailyOther = false;
  for (const doc of windowedDispatchDocs) {
    const key = dayKey(doc.dispatchedAt);
    if (key === null || !(key in dayIndex)) continue;
    const idx = dayIndex[key];
    const kind = typeof doc.kind === 'string' && doc.kind.trim() ? doc.kind.trim() : 'other';
    if (dailySeries.has(kind)) {
      dailySeries.get(kind)[idx]++;
    } else {
      dailyOther[idx]++;
      hasDailyOther = true;
    }
  }
  const dispatchByDay = {
    days: activityDays,
    kinds: [...dailySeries].map(([label, counts]) => ({ label, counts }))
      .concat(hasDailyOther ? [{ label: 'other', counts: dailyOther }] : [])
  };

  // The headline outcome rate: what fraction of dispatched work landed. Runs
  // over history AND queue rows (queue rows never carry feedback, so they
  // contribute unresolved lineages) — see computeDispatchOutcomes for why the
  // unit is the lineage and how abort rows are handled.
  const dispatchOutcomes = computeDispatchOutcomes(dispatchDocs, now);

  // Work funnel: dispatched → taken (claimed by a worker) → reported (the
  // worker sent feedback, or a step was posted against the dispatch) →
  // completed (a linked step reports 'completed'). The gaps between stages
  // are the honest part of the story: expiry, silence, and failure.
  //
  // Windowed on the DISPATCH's own 30-day window, followed by dispatch id —
  // not by the agent-status report's own timestamp. The funnel answers "of
  // the dispatches made in the last 30 days, how far did they get", so a
  // report that lands a few hours after its dispatch just outside a naive
  // report-timestamp window must still count.
  const takenCount = historyDocs.filter(doc => doc.status === 'taken' && windowedDispatchIds.has(String(doc._id))).length;
  const reportedIds = new Set();
  const completedIds = new Set();
  for (const doc of agentStatusDocs) {
    if (!doc.dispatchId) continue;
    const id = String(doc.dispatchId);
    if (!windowedDispatchIds.has(id)) continue;
    reportedIds.add(id);
    if (typeof doc.status === 'string' && doc.status.toLowerCase() === 'completed') {
      completedIds.add(id);
    }
  }
  for (const doc of historyDocs) {
    if (!windowedDispatchIds.has(String(doc._id))) continue;
    if (feedbackLen(doc) > 0) reportedIds.add(String(doc._id));
  }
  const funnel = {
    dispatched: windowedDispatchDocs.length,
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

  const feedbackNotes = windowedHistoryDocs.reduce(
    (sum, doc) => sum + feedbackLen(doc), 0
  );

  // Step outcomes: agents report per-step results to the agent-status log
  // with conventional statuses; anything unconventional lands in 'other'.
  // Windowed on the report's OWN timestamp — "step outcomes posted in the
  // last 30 days" is the right reading here, unlike the funnel's
  // dispatch-anchored join above.
  const stepOutcomes = { completed: 0, failed: 0, blocked: 0, other: 0 };
  for (const doc of windowedAgentStatusDocs) {
    const status = typeof doc.status === 'string' ? doc.status.toLowerCase() : '';
    // Object.hasOwn so consumer-supplied statuses like 'constructor' can't
    // reach the prototype chain and pollute the buckets.
    if (status !== 'other' && Object.hasOwn(stepOutcomes, status)) stepOutcomes[status]++;
    else stepOutcomes.other++;
  }

  // Proxy response classes (2xx/3xx grouped as ok), windowed to the same
  // 30-day span as the rest of the page (bin.day membership, matching
  // proxyCategories' own filter). The hourly sibling backs the 24h toggle —
  // free to compute since loadProxyBins already groups on the UTC hour, so
  // this adds no new reads.
  const proxyStatus = { ok: 0, clientError: 0, serverError: 0 };
  const proxyStatusHourly = { ok: 0, clientError: 0, serverError: 0 };
  for (const bin of proxyBins) {
    const status = Number(bin.status);
    let bucket = null;
    if (status >= 500) bucket = 'serverError';
    else if (status >= 400) bucket = 'clientError';
    else if (status >= 100) bucket = 'ok';
    if (bucket === null) continue;
    if (bin.day !== null && bin.day in dayIndex) proxyStatus[bucket] += bin.count;
    if (bin.hour !== null && bin.hour in hourIndex) proxyStatusHourly[bucket] += bin.count;
  }

  // Top proxy endpoints by call volume (count-weighted across the bins),
  // windowed the same way, plus the hourly sibling for the 24h toggle.
  const endpointCounts = new Map();
  const endpointHourlyCounts = new Map();
  for (const bin of proxyBins) {
    const endpoint = typeof bin.endpoint === 'string' ? bin.endpoint.trim() : '';
    if (!endpoint) continue;
    if (bin.day !== null && bin.day in dayIndex) {
      endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + bin.count);
    }
    if (bin.hour !== null && bin.hour in hourIndex) {
      endpointHourlyCounts.set(endpoint, (endpointHourlyCounts.get(endpoint) || 0) + bin.count);
    }
  }
  const rankEndpoints = (counts) => [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_LIST_LIMIT)
    .map(([label, count]) => ({ label, count }));
  const topEndpoints = rankEndpoints(endpointCounts);
  const topEndpointsHourly = rankEndpoints(endpointHourlyCounts);

  // When the instance works: all agent actions histogrammed by UTC hour, over
  // the same 30-day window as the rest of the page (a fixed hour-of-day
  // profile, not a 24h series — it stays toggle-free). Proxy events come from
  // the pre-binned day key (count-weighted); the others from their raw
  // timestamps, already restricted to the same window.
  const hourOfDay = new Array(24).fill(0);
  for (const bin of proxyBins) {
    if (bin.day === null || !(bin.day in dayIndex) || bin.hour === null) continue;
    const h = Number(bin.hour.slice(11, 13));
    if (Number.isInteger(h) && h >= 0 && h < 24) hourOfDay[h] += bin.count;
  }
  const hourSources = [
    [windowedAgentStatusDocs, 'timestamp'],
    [windowedDispatchDocs, 'dispatchedAt']
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
      agentActions: windowedProxyEventCount + windowedAgentStatusDocs.length,
      dispatches: windowedDispatchDocs.length,
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
    dispatchByDay,
    dispatchKinds: topCounts(windowedDispatchDocs, 'kind'),
    dispatchOutcomes,
    funnel,
    stepOutcomes,
    proxyStatus,
    proxyStatusHourly,
    topEndpoints,
    topEndpointsHourly,
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
