/**
 * KPI statistics collector for the public /kpis page.
 *
 * Aggregates instance-wide activity from the operational collections.
 * The consuming page is public and unauthenticated, so this module is the
 * privacy boundary: it returns only counts, day buckets, and app-defined
 * labels (parameterized endpoint templates, dispatch kind names) — never
 * workspace urlKeys, prompt text, summaries, tokens, or issue content.
 * Every string in the output is therefore a label, a date/hour key, or one of
 * this module's own words; every other value is a count or a ratio.
 *
 * LIN-1957 adds two further aggregate-only output categories, both subject
 * to the same boundary: nullable USD dollar figures (the terminal-marked
 * task cost and its cash/unknown-lane split — never a per-workspace or
 * per-issue breakdown, always an instance-wide sum) and ratio bias/coverage
 * shares (0-1, rounded to 3dp). `issueIdentifier` is an internal grouping
 * key used only to attribute a lineage's cost to its issue for the
 * issue-level denominator — it is never itself emitted.
 *
 * Works against both MongoDB and MangoDB. The two heavy collections (dispatch
 * history, proxy events) are reduced inside the database by `aggregate()` (the
 * unit-test mock has none, so each loader keeps a projected `find()` for it);
 * everything else is `countDocuments()` or `find().toArray()`, with date
 * filtering/bucketing done in JS. Every collection read in full is bounded by
 * the fixed 30-day READ horizon (evidence stores are lifetime-retained, so the
 * 30-day bound is pushed into the query rather than relying on eviction —
 * LIN-3157 A1/B) or small by design (preferences, report history capped at
 * 20/workspace).
 *
 * Shape of the module: the loaders read the two heavy collections, `readSources`
 * issues the one fan-out of store calls, `windowsAt` fixes every window once,
 * and a pure builder per output block turns the rows into that block.
 * `collectKpiStats` only wires them together in the output's key order.
 *
 * LIN-3689: the loaders take an optional `urlKey` and several builders are
 * exported (`summarizeActivity`, `windowsAt`, `tallyLabels`, `rank`,
 * `buildFunnel`, `medianQueueToTakeMinutes`) so lib/workspace-kpi-stats.js can
 * report one workspace from the same math. `collectKpiStats` never passes a
 * `urlKey`; it stays instance-wide and its reads are pinned by
 * tests/unit/kpi-stats-reads-pin.test.js.
 */

import { __internal as TERMINAL_INTERNAL } from './dispatch-terminal.js';
import { computeTerminalMarkedTaskCost } from './terminal-marked-task-cost.js';
import { computeWeeklyBudgetGauge } from './weekly-budget.js';
import { __internal as SESSION_TELEMETRY_INTERNAL } from './session-telemetry.js';
import { groupDispatchLineages, OUTCOME_WINDOW_DAYS } from './dispatch-lineage.js';
import { MAX_REPORTS_PER_WORKSPACE } from './report-history-store.js';
import { readHorizonStart } from './read-horizon.js';
import { collectMilestoneFunnel } from './milestone-funnel.js';
import { toEpochMs } from './utils/time.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// Lengths of the ISO prefixes that make a UTC day key and a UTC hour key.
const DAY_KEY_LENGTH = 'YYYY-MM-DD'.length;
const HOUR_KEY_LENGTH = 'YYYY-MM-DDTHH'.length;

export const ACTIVITY_WINDOW_DAYS = 30;
export const HOURLY_WINDOW_HOURS = 24;
export const FREE_TIER_WINDOW_DAYS = 7;
// Weekly buckets for the dispatch-outcome trend. Four whole weeks (28 days),
// not the full 30-day reporting window: evidence is lifetime-retained, so the
// 30-day window is a fixed READ horizon (lib/read-horizon.js), and a 30-day
// span split into whole weeks would still leave its oldest partial-week bucket
// under-filled. Four whole weeks is the largest span that fits entirely inside
// the reporting window.
export const OUTCOME_WINDOW_WEEKS = 4;
const TOP_LIST_LIMIT = 8;
const DISPATCH_DAY_KIND_LIMIT = 5;

export const PROXY_PHASES = ['orienting', 'deciding', 'acting', 'watching', 'reporting'];

// ---------------------------------------------------------------------------
// Keys, windows and rankings
// ---------------------------------------------------------------------------

/**
 * UTC key for a Date or date-like value, cut to `length` characters of its ISO
 * form (DAY_KEY_LENGTH → 'YYYY-MM-DD', HOUR_KEY_LENGTH → 'YYYY-MM-DDTHH').
 * Returns null for missing/invalid values so callers can skip them.
 */
function utcKey(value, length) {
  const time = toEpochMs(value);
  return time === null ? null : new Date(time).toISOString().slice(0, length);
}

/**
 * Ordered UTC keys of `count` steps of `stepMs`, the last one containing
 * `nowMs`, oldest first.
 */
function keysEndingAt(nowMs, count, stepMs, length) {
  return Array.from({ length: count }, (_, i) => utcKey(nowMs - (count - 1 - i) * stepMs, length));
}

const indexByKey = keys => new Map(keys.map((key, slot) => [key, slot]));
const zeros = length => new Array(length).fill(0);

/**
 * Every window the page reports on, derived once from the one injected `now`
 * (never an independent Date.now(), so a fixed `now` keeps tests deterministic).
 *
 * - `days` / `hours`: the 30 UTC-day and 24 UTC-hour chart axes.
 * - `activityStart`: the cutoff shared by every "· 30d" metric. It is anchored
 *   to midnight UTC of `days[0]` — the same UTC-calendar-day boundary
 *   `dayIndex` buckets against — rather than a raw rolling `now − 30×24h`
 *   instant (LIN-1846 close-out review). A rolling instant is *earlier* than
 *   that midnight by up to nearly a full day, so a document dispatched in that
 *   gap passed a rolling filter (counted in the stat cards, dispatch kinds, and
 *   funnel) while its calendar day fell before `days[0]` and got dropped from
 *   the `· 30d` daily chart (`dispatchByDay`) — cards and chart silently
 *   disagreeing over what "30d" meant. Anchoring both to the same calendar-day
 *   start makes every "· 30d" cutoff — cards, kinds, funnel, step outcomes,
 *   agent actions, and the daily chart — the identical window.
 * - `freeTierDays`: the 7-day free-tier axis.
 *
 * The outcome window (rolling `now − OUTCOME_WINDOW_DAYS`) is a different
 * window on purpose; see `buildDispatchOutcomes`.
 *
 * LIN-3689: `days` (default `ACTIVITY_WINDOW_DAYS`) sets the length of the day
 * axis and of `activityStart`, so the workspace KPIs page can ask for its 7-day
 * window from the same rule. The hour and free-tier axes do not move.
 */
export function windowsAt(now, { days: windowDays = ACTIVITY_WINDOW_DAYS } = {}) {
  const nowMs = now.getTime();
  const days = keysEndingAt(nowMs, windowDays, DAY_MS, DAY_KEY_LENGTH);
  const hours = keysEndingAt(nowMs, HOURLY_WINDOW_HOURS, HOUR_MS, HOUR_KEY_LENGTH);
  return {
    nowMs,
    days,
    hours,
    dayIndex: indexByKey(days),
    hourIndex: indexByKey(hours),
    activityStart: Math.floor((nowMs - (windowDays - 1) * DAY_MS) / DAY_MS) * DAY_MS,
    freeTierDays: keysEndingAt(nowMs, FREE_TIER_WINDOW_DAYS, DAY_MS, DAY_KEY_LENGTH)
  };
}

/** The slot of `value`'s UTC day in the 30-day window, or undefined. */
const daySlot = (value, windows) => windows.dayIndex.get(utcKey(value, DAY_KEY_LENGTH));

/** Docs whose `field` timestamp is usable and not before `start`. */
function notBefore(docs, field, start) {
  return docs.filter(doc => {
    const time = toEpochMs(doc[field]);
    return time !== null && time >= start;
  });
}

/** Per-day document counts for a timestamp field, aligned to the 30-day axis. */
function countByDay(docs, field, windows) {
  const counts = zeros(windows.days.length);
  for (const doc of docs) {
    const slot = daySlot(doc[field], windows);
    if (slot !== undefined) counts[slot]++;
  }
  return counts;
}

/** A trimmed string label, or '' for blank/non-string values. */
const labelOf = raw => (typeof raw === 'string' ? raw.trim() : '');

function addTo(tally, label, by = 1) {
  tally.set(label, (tally.get(label) || 0) + by);
}

/** Label tally of a field over docs, blank/non-string values skipped. */
export function tallyLabels(docs, field) {
  const tally = new Map();
  for (const doc of docs) {
    const label = labelOf(doc[field]);
    if (label) addTo(tally, label);
  }
  return tally;
}

/**
 * Top `limit` labels of a tally by count. Ties break alphabetically, then by
 * the order the tally was filled (source order), so output is deterministic.
 */
export function rank(tally, limit = TOP_LIST_LIMIT) {
  return [...tally]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

/**
 * How many distinct labels the top-`TOP_LIST_LIMIT` cut silently drops — the
 * shared "excluded distinct values" math for `dispatchKinds`/`topEndpoints`
 * (mirroring `dispatchByDay`'s `other` bucket), stated once so the call sites
 * can't drift (LIN-2325 F4).
 */
const excludedCount = tally => Math.max(0, tally.size - TOP_LIST_LIMIT);

/** Median of a numeric array; null when empty. */
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const roundTo1 = value => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Proxy event classification
// ---------------------------------------------------------------------------

const httpMethod = method => (typeof method === 'string' ? method.toUpperCase() : 'GET');

/**
 * Classify a proxy API call into a phase of the agent loop. The phases are
 * the page's narrative vocabulary: agents orient (read state), decide (ask
 * for recommendations / kick off runs), act (write changes), watch (poll
 * dispatched work), and report (post step results). Unknown endpoints fall
 * back by method — reads orient, writes act — so new endpoints degrade
 * gracefully instead of needing an 'other' bucket.
 */
export function categorizeProxyEvent(method, endpoint) {
  const isRead = httpMethod(method) === 'GET';
  const path = typeof endpoint === 'string' ? endpoint : '';
  const startsWith = (...prefixes) => prefixes.some(prefix => path.startsWith(prefix));
  // agent/status is canonical (LIN-533); foreman/status is the deprecated alias and
  // still appears in historical audit events, so both are matched.
  if (startsWith('/api/proxy/agent/status', '/api/proxy/foreman/status')) return isRead ? 'watching' : 'reporting';
  if (startsWith('/api/proxy/foreman/sessions', '/api/proxy/foreman/tasks')) return 'watching';
  if (startsWith('/api/proxy/dispatch')) return isRead ? 'watching' : 'deciding';
  if (startsWith('/api/proxy/recommend', '/api/proxy/prompt', '/api/proxy/autopilot', '/api/proxy/foreman/playbook')) return 'deciding';
  return isRead ? 'orienting' : 'acting';
}

/**
 * LIN-3689: the optional one-workspace filter for the loaders below. With no
 * `urlKey` it contributes NO key at all (not `urlKey: undefined`): the public
 * /kpis page never passes one, and its `$match` objects are pinned with
 * `deepStrictEqual` (tests/unit/kpi-stats-reads-pin.test.js).
 */
const workspaceFilter = urlKey => (urlKey ? { urlKey } : {});

// ---------------------------------------------------------------------------
// Loaders for the two heavy collections
// ---------------------------------------------------------------------------

// Proxy-event fields the page actually reads. Projecting to these keeps the
// read small even though proxyEvents is the highest-volume collection.
const PROXY_FIELDS = { method: 1, endpoint: 1, status: 1, timestamp: 1, urlKey: 1 };
// Agent-status fields the page reads; drops the bulky summary/metrics/evidence
// payloads carried on each status record.
export const AGENT_STATUS_FIELDS = { dispatchId: 1, status: 1, timestamp: 1, urlKey: 1 };

/**
 * One row per distinct (method, endpoint, status, UTC-hour) with a count and
 * the set of urlKeys seen. proxyEvents is the busiest collection (one row per
 * proxy API call), so loading it raw with find({}).toArray() pulls every event
 * into memory — the read that pushed /kpis past the 30s router timeout.
 * Grouping in the DB collapses millions of repetitive rows into thousands; the
 * page's day/hour buckets, phase categories, status classes, top endpoints and
 * totals are all recoverable from the bins (count-weighted).
 *
 * LIN-3161 (LIN-3157 A1): the leading `$match` on `timestamp` (proxy-events
 * stores `timestamp`, see lib/proxy-events.js) is the shared read horizon, so
 * `/kpis` reads a 30-day payload, never the project lifetime. After it every
 * grouped row has a Date, so `hour` is always a string.
 */
const proxyBinsPipeline = (horizon, urlKey) => [
  { $match: { timestamp: { $gte: horizon }, ...workspaceFilter(urlKey) } },
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
];

/**
 * Load proxy events as pre-binned rows `{method, endpoint, status, hour, day,
 * count, urlKeys}` (see `proxyBinsPipeline`). Falls back to a projected
 * find() when the collection has no aggregate() (the unit-test mock), so the
 * math stays covered by the existing tests.
 *
 * Keep this an async function that calls aggregate() synchronously and awaits
 * `.toArray()` once inside the `try`: when both heavy loaders fail together
 * (the database is down), the rejection that settles first wins the
 * `Promise.all` in `readSources`, so each loader's async depth is behaviour.
 */
export async function loadProxyBins(proxyEvents, { since: horizon, urlKey }) {
  if (typeof proxyEvents.aggregate === 'function') {
    try {
      const grouped = await proxyEvents.aggregate(proxyBinsPipeline(horizon, urlKey)).toArray();
      return grouped.map(({ _id, count, urlKeys }) => ({
        method: _id.method,
        endpoint: _id.endpoint,
        status: _id.status,
        hour: _id.hour,
        day: _id.hour.slice(0, DAY_KEY_LENGTH),
        count,
        urlKeys
      }));
    } catch (err) {
      // LIN-3002: propagate, never fall through to the unbounded find path —
      // that fallback was the ~13.3 MB unbounded read this aggregation exists
      // to avoid, and it hid the failure from /kpis' own warm-stale-serve/
      // cold-500 handling (server.js), which already does the right thing
      // once it actually sees the rejection.
      console.error('kpi-stats: proxy-events aggregation failed:', err?.message || err);
      throw err;
    }
  }
  const docs = await proxyEvents.find({ timestamp: { $gte: horizon }, ...workspaceFilter(urlKey) }, { projection: PROXY_FIELDS }).toArray();
  return docs.map(doc => {
    const hour = utcKey(doc.timestamp, HOUR_KEY_LENGTH);
    return {
      method: doc.method,
      endpoint: doc.endpoint,
      status: doc.status,
      hour,
      day: hour && hour.slice(0, DAY_KEY_LENGTH),
      count: 1,
      urlKeys: doc.urlKey ? [doc.urlKey] : []
    };
  });
}

// LIN-2996 Phase 4 (LIN-3012): true when a row's `feedbackDigest` is fresh —
// present, an object, and its `.version` matches the row's own
// `feedbackVersion` — so loadDispatchHistory can read the four precomputed
// `kpi*` fields instead of re-deriving them from `feedback` on every refresh.
// Both sides go through `$ifNull` so "missing" and "null" normalize to the
// SAME sentinel and can never accidentally compare equal to each other
// (missing digest.version -> -1, missing feedbackVersion -> 0; a legacy row
// with neither field is therefore never mistaken for version-0 fresh).
// Must stay semantically identical to Phase 3's JS `isFreshDigest`
// (LIN-3011, `v(doc) = feedbackVersion ?? 0`) — a Mongo `$cond` can't
// literally share code with a JS predicate, so this is a second, independent
// expression of the same semantics. Reconciliation (ledger L3, carried from
// the LIN-3012 review to LIN-3011 as whichever of Phase 3/Phase 4 landed
// second) is discharged: `tests/unit/mongo-smoke.test.js`'s
// "LIN-3011 ledger L3" parity test runs this exact expression (via
// `__internal.FRESH_DIGEST` below) and `isFreshDigest` side by side, on real
// `mongod`, over 7 row shapes (fresh/legacy/seeded-empty/stale/digest-
// without-version/null-feedbackVersion/non-object digest) and asserts
// agreement on every one.
const FRESH_DIGEST = {
  $and: [
    { $eq: [{ $type: '$feedbackDigest' }, 'object'] },
    { $eq: [{ $ifNull: ['$feedbackDigest.version', -1] }, { $ifNull: ['$feedbackVersion', 0] }] }
  ]
};

// Pipeline pieces for the per-row feedback derivations. Each derived field is
// `$cond: [FRESH_DIGEST, <digest field>, <the same per-row expression>]`
// (LIN-2996 Phase 4 / LIN-3012): a fresh row reads the precomputed
// `feedbackDigest.kpi*` field the Phase 1 writers maintain; every other row
// (legacy, seeded-empty, stale, or a digest missing its own `.version`) falls
// through to the expression, unchanged. A fresh digest never re-derives
// feedback in the DB, and the rows that still need it never reintroduce a
// whole-collection fallback.
const digestOr = (digestField, derived) => ({ $cond: [FRESH_DIGEST, `$feedbackDigest.${digestField}`, derived] });

// Each feedback entry narrowed to `fields` of itself. Callers pick the fields
// their filter reads: `kind` MUST survive the $map before a $filter that tests
// `$$entry.kind` (N1 from the LIN-1957 review) — a map that narrowed to
// {message, timestamp} would make that filter match nothing, a silent empty,
// not a crash. The terminal and ticket-marker filters read only `message`, so
// they stay on the narrow {message, timestamp} shape.
const feedbackEntries = fields => ({
  $map: {
    input: { $ifNull: ['$feedback', []] },
    as: 'f',
    in: Object.fromEntries(fields.map(field => [field, `$$f.${field}`]))
  }
});

const filterEntries = (fields, cond) => ({ $filter: { input: feedbackEntries(fields), as: 'entry', cond } });
const messageMatches = regex => ({
  $regexMatch: { input: { $ifNull: ['$$entry.message', ''] }, regex: regex.source, options: 'i' }
});
const kindIs = kind => ({ $eq: ['$$entry.kind', kind] });

const NARROW_ENTRY = ['message', 'timestamp'];
const KINDED_ENTRY = ['message', 'timestamp', 'kind'];

/**
 * The dispatch-history pipeline: the per-heartbeat `feedback[]` array (it grows
 * on every heartbeat, LIN-594 telemetry, and is the fattest field in the
 * collection) is replaced by its length (`feedbackCount`) and by a few derived
 * entries; reading it whole is what pushed /kpis past the 30s router timeout,
 * so it is never projected raw.
 *
 * - `terminalEntry`: at most ONE entry, the last whose message matches the
 *   shared terminal regex — the same last-marker-wins scan
 *   `findTerminalFeedback` performs in JS (LIN-1596). `$last` yields *missing*
 *   for an empty match set, which is how a row with no marker (including
 *   `[ended·unconfirmed]`, invisible to the terminal regex) arrives. The
 *   pattern is read off the shared seam rather than retyped, so there is still
 *   exactly one definition of what a terminal marker is.
 * - `usageEntry` / `evidenceCount` (LIN-1957): the last `kind: 'usage'` entry
 *   and the count of `kind: 'evidence'` entries, for the terminal-marked-task-
 *   cost numerator (Session 2 of LIN-1625).
 * - `ticketMarkerEntries` (LIN-2253): every `[ticket] LIN-XXXX <state>[ —
 *   <outcome>]` entry (LIN-2242/LIN-2243's worker-lane convention), kept as raw
 *   {message,timestamp} for parseTicketMarkers to walk downstream. Unlike the
 *   others this can be MORE than one entry per lineage (a lane marks several
 *   tickets), so it is a $filter, never narrowed with $last.
 *
 * issueIdentifier/harness are raw passthroughs; never projected as raw
 * $feedback (kpi-stats.js is the privacy boundary and the unbounded-array read
 * is the exact timeout this whole function exists to avoid). The lineage/abort
 * scalars are opaque ids reduced to counts downstream and never emitted — same
 * posture as the already-projected `urlKey`.
 *
 * LIN-3161 (LIN-3157 A1): `horizon`, when supplied, is the shared read horizon
 * as a leading `$match` on `dispatchedAt` (dispatch-history stores
 * `dispatchedAt`, not `resolvedAt` — decision m1). `collectKpiStats` always
 * supplies it; direct callers that omit it keep the unbounded (test-only)
 * behaviour.
 */
const dispatchHistoryPipeline = (horizon, urlKey) => [
  ...(horizon || urlKey ? [{ $match: { ...(horizon ? { dispatchedAt: { $gte: horizon } } : {}), ...workspaceFilter(urlKey) } }] : []),
  {
    $project: {
      urlKey: 1, status: 1, dispatchedAt: 1, resolvedAt: 1, kind: 1,
      rootItemId: 1, followUpTo: 1, abort: 1, abortTo: 1,
      issueIdentifier: 1,
      harness: 1,
      feedbackCount: digestOr('count', { $size: { $ifNull: ['$feedback', []] } }),
      terminalEntry: digestOr('kpiTerminalEntry', {
        $last: filterEntries(NARROW_ENTRY, messageMatches(TERMINAL_INTERNAL.TERMINAL_FEEDBACK_REGEX))
      }),
      usageEntry: digestOr('kpiUsageEntry', { $last: filterEntries(KINDED_ENTRY, kindIs('usage')) }),
      evidenceCount: digestOr('kpiEvidenceCount', { $size: filterEntries(KINDED_ENTRY, kindIs('evidence')) }),
      ticketMarkerEntries: digestOr(
        'kpiTicketMarkerEntries',
        filterEntries(NARROW_ENTRY, messageMatches(SESSION_TELEMETRY_INTERNAL.TICKET_PREFIX))
      )
    }
  }
];

/**
 * Load dispatch history with `feedback[]` reduced as `dispatchHistoryPipeline`
 * describes. Falls back to a raw find() when aggregate() is unavailable (the
 * unit-test mock keeps the real feedback array, which feedbackLen() and the
 * terminal derivation read directly). That fallback is the unbounded read the
 * projection exists to avoid, so a pipeline failure is warned about rather
 * than degrading silently.
 *
 * Same async-depth rule as `loadProxyBins`.
 * @param {Object} dispatchHistory
 * @param {Object} [opts]
 * @param {Date} [opts.since] - shared read-horizon lower bound on `dispatchedAt`
 * @param {string} [opts.urlKey] - LIN-3689: restrict to one workspace; absent, no key is added
 * @returns {Promise<Array<Object>>}
 */
export async function loadDispatchHistory(dispatchHistory, { since: horizon, urlKey } = {}) {
  if (typeof dispatchHistory.aggregate === 'function') {
    try {
      return await dispatchHistory.aggregate(dispatchHistoryPipeline(horizon, urlKey)).toArray();
    } catch (err) {
      // LIN-3002: propagate, never fall through to the unbounded find path —
      // that fallback was the ~67 MB unbounded read the projection above
      // exists to prevent, and it hid the failure from /kpis' own
      // warm-stale-serve/cold-500 handling (server.js), which already does
      // the right thing once it actually sees the rejection.
      console.warn('kpi-stats: dispatch-history aggregation failed:', err?.message || err);
      throw err;
    }
  }
  const filter = { ...(horizon ? { dispatchedAt: { $gte: horizon } } : {}), ...workspaceFilter(urlKey) };
  return dispatchHistory.find(filter).toArray();
}

/**
 * Every store call `collectKpiStats` makes, in one `Promise.all`.
 *
 * The operand ORDER is behaviour: a synchronous throw in operand k stops the
 * operands after k from being issued, and a loader that has already started
 * and then rejects becomes an unhandled rejection. A throw inside a loader's
 * aggregate() is caught by that loader, so later operands still run. Do not
 * reorder.
 *
 * LIN-2952: the milestone funnel is on the SAME 30-day horizon. Its own deps
 * (stores + the dispatch collections) arrive in the OPTIONS argument, never
 * the `collections` handle, so it never issues a second read through
 * `collections.dispatchHistory` (which would clobber the LIN-3014 capture,
 * which keeps one read per collection name). A failing funnel read soft-fails to
 * `no-signal` (LIN-3501); only `taskModeStore` (the mode) and its gated account
 * read still reject here and propagate out of `Promise.all` (LIN-3002, R3).
 */
function readSources(collections, milestoneFunnelDeps, horizon, nowMs) {
  const {
    sessions, userPreferences, workspacePreferences, customPrompts, localIssues,
    dispatchQueue, dispatchHistory, dispatchTokens,
    proxyTokens, proxyEvents, agentStatus,
    freeTier, recapCache, briefCache, reportHistory
  } = collections;
  return Promise.all([
    // Sessions can carry a bulky per-workspace blob; the page only needs expiry.
    sessions.find({}, { projection: { expires: 1 } }).toArray(),
    userPreferences.countDocuments({}),
    workspacePreferences.find({}).toArray(),
    customPrompts.find({}).toArray(),
    localIssues.countDocuments({ kind: 'issue' }),
    localIssues.countDocuments({ kind: 'project' }),
    dispatchQueue.find({}).toArray(),
    loadDispatchHistory(dispatchHistory, { since: horizon }),
    // LIN-3620: `activeTokens` excludes expired dispatch tokens (LIN-3421 TTL).
    // Rows with a null/absent `expiresAt` (legacy rows; new tokens carry 90 days, LIN-3618) still
    // count. Only this KPI count is filtered: `listHolderRows` stays unfiltered so
    // expired rows remain listed as holder evidence. `nowMs` is `windows.nowMs`.
    dispatchTokens.countDocuments({
      $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date(nowMs) } }]
    }),
    proxyTokens.countDocuments({}),
    loadProxyBins(proxyEvents, { since: horizon }),
    agentStatus.find({ timestamp: { $gte: horizon } }, { projection: AGENT_STATUS_FIELDS }).toArray(),
    freeTier.find({}).toArray(),
    recapCache.countDocuments({}),
    briefCache.countDocuments({}),
    reportHistory.find({}).toArray(),
    collectMilestoneFunnel({ since: horizon, ...milestoneFunnelDeps })
  ]);
}

// ---------------------------------------------------------------------------
// Pure builders, one per output block
// ---------------------------------------------------------------------------

/**
 * Length of a dispatch's feedback list, from either shape: the raw `feedback`
 * array (find path) or the pre-computed `feedbackCount` (aggregation path).
 */
function feedbackLen(doc) {
  if (Array.isArray(doc.feedback)) return doc.feedback.length;
  return Number.isFinite(doc.feedbackCount) ? doc.feedbackCount : 0;
}

/**
 * Workspaces seen: the union of workspace keys across configuration and
 * activity collections. Only the count is exposed — never the keys.
 */
function countWorkspaces({ workspacePrefDocs, customPromptDocs, queueDocs, historyDocs, proxyBins, agentStatusDocs, reportDocs, freeTierDocs }) {
  const keys = new Set();
  const add = values => {
    for (const value of values) if (typeof value === 'string' && value) keys.add(value);
  };
  add(workspacePrefDocs.map(doc => doc._id)); // workspace-preferences keyed by urlKey
  for (const docs of [customPromptDocs, queueDocs, historyDocs]) add(docs.map(doc => doc.urlKey));
  add(proxyBins.flatMap(bin => bin.urlKeys));
  for (const docs of [agentStatusDocs, reportDocs, freeTierDocs]) add(docs.map(doc => doc.urlKey)); // global hourly free-tier records have urlKey: null
  return keys.size;
}

/** Sessions whose expiry is still ahead of `now`. */
function countActiveSessions(sessionDocs, nowMs) {
  return sessionDocs.filter(doc => {
    const expires = toEpochMs(doc.expires);
    return expires !== null && expires > nowMs;
  }).length;
}

/**
 * Proxy bins → every proxy-derived block, in one pass.
 *
 * A bin counts toward the 30-day blocks when its UTC day is on the day axis and
 * toward the 24h blocks when its UTC hour is on the hour axis (the hourly
 * siblings back the chart's 24h toggle and are free — the loader already groups
 * on the hour). `reads`/`writes` count EVERY bin in the read horizon, not just
 * the day window: `readsPerWrite` is "across all proxy traffic".
 *
 * Phases come from `categorizeProxyEvent`; status classes group 2xx/3xx as ok
 * and go through `Number()` ('200' is ok, 'abc' and out-of-range codes are
 * skipped); endpoints are trimmed labels, ranked count-weighted across bins.
 */
function summarizeProxyBins(proxyBins, windows) {
  const view = (index, keys) => ({
    index,
    phases: Object.fromEntries(PROXY_PHASES.map(phase => [phase, zeros(keys.length)])),
    status: { ok: 0, clientError: 0, serverError: 0 },
    endpoints: new Map()
  });
  const daily = view(windows.dayIndex, windows.days);
  const hourly = view(windows.hourIndex, windows.hours);
  const hourOfDay = zeros(24);
  let reads = 0;
  let writes = 0;
  let windowedCount = 0;

  // Adds the bin to `view` when its `key` is on that view's axis.
  const record = (target, key, bin, phase, statusClass, endpoint) => {
    const slot = target.index.get(key);
    if (slot === undefined) return false;
    target.phases[phase][slot] += bin.count;
    if (statusClass) target.status[statusClass] += bin.count;
    if (endpoint) addTo(target.endpoints, endpoint, bin.count);
    return true;
  };

  for (const bin of proxyBins) {
    if (httpMethod(bin.method) === 'GET') reads += bin.count;
    else writes += bin.count;

    const phase = categorizeProxyEvent(bin.method, bin.endpoint);
    const status = Number(bin.status);
    const statusClass = status >= 500 ? 'serverError' : status >= 400 ? 'clientError' : status >= 100 ? 'ok' : null;
    const endpoint = labelOf(bin.endpoint);

    if (record(daily, bin.day, bin, phase, statusClass, endpoint)) {
      windowedCount += bin.count;
      hourOfDay[Number(bin.hour.slice(DAY_KEY_LENGTH + 1))] += bin.count;
    }
    record(hourly, bin.hour, bin, phase, statusClass, endpoint);
  }
  return { daily, hourly, hourOfDay, reads, writes, windowedCount };
}

/** Add one count per doc to the UTC hour of its `field` timestamp. */
function addHours(hourOfDay, docs, field) {
  for (const doc of docs) hourOfDay[new Date(toEpochMs(doc[field])).getUTCHours()]++;
}

/**
 * Dispatched work by kind per day: the adoption story over time, in the same
 * 30-day window as the rest of the page (previously 5×7-day = 35 days, which
 * exceeded the 30-day reporting window and under-filled its oldest bucket).
 * The top kinds within the window get their own series, in rank order; the
 * long tail folds into 'other', which is present only if something fell in it.
 * A blank kind counts as 'other' here (it is skipped in `dispatchKinds`).
 */
function buildDispatchByDay(windowedDispatchDocs, kindTally, windows) {
  const series = new Map(rank(kindTally, DISPATCH_DAY_KIND_LIMIT).map(({ label }) => [label, zeros(windows.days.length)]));
  const overflow = zeros(windows.days.length);
  for (const doc of windowedDispatchDocs) {
    const slot = daySlot(doc.dispatchedAt, windows);
    if (slot === undefined) continue;
    (series.get(labelOf(doc.kind) || 'other') ?? overflow)[slot]++;
  }
  const kinds = [...series].map(([label, counts]) => ({ label, counts }));
  if (overflow.some(Boolean)) kinds.push({ label: 'other', counts: overflow });
  return { days: windows.days, kinds };
}

/**
 * The headline outcome rate (LIN-1596): what fraction of dispatched work
 * landed. `done ÷ (done + failed + aborted)` over RESOLVED dispatch lineages in
 * the last OUTCOME_WINDOW_DAYS (a rolling window, unlike the calendar window of
 * `windowsAt`), plus a weekly trend inside it. Runs over history AND queue rows
 * (queue rows never carry feedback, so they contribute unresolved lineages).
 *
 * The rules that make this measure outcomes rather than volume live in
 * `groupDispatchLineages` (lib/dispatch-lineage.js, LIN-1957), shared with the
 * terminal-marked-task cost so the two can never disagree about which issues
 * resolved to `done`:
 *
 * 1. The unit is the lineage, not the dispatch row: a task needing four
 *    follow-ups must not contribute four dispatches (LIN-1468 `rootItemId`
 *    anchor; the last terminal marker in the lineage wins).
 * 2. Abort rows are excluded, but the aborts they represent are not. Harvesting
 *    happens at ROW level BEFORE grouping, and abort rows are dropped only
 *    AFTER their marker is attributed (the LIN-1257/LIN-1261 pair, which also
 *    inherits the F1 guard: an EARLIER abort never overrides a LATER genuine
 *    terminal).
 * 3. `[skipped]` is excluded entirely, numerator and denominator (LIN-946/951):
 *    the runner REFUSED a cascade abort because a human was still in that
 *    session, so nothing ended.
 * 4. The denominator is resolved lineages only: a queued or running dispatch
 *    has no outcome yet. `total` is published alongside so the coverage
 *    sub-label can say how much of the window the rate covers.
 *
 * Buckets are keyed on the lineage's EARLIEST `dispatchedAt`, so one lineage
 * lands in exactly one bucket and the coverage label and trend share one key.
 * The newest bucket is under-*resolved*, but unresolved lineages leave
 * numerator and denominator together, so that is a smaller sample rather than a
 * biased rate — hence `weeklyResolved` rides alongside `weeklyRate`.
 *
 * Emits only integers, `YYYY-MM-DD` bucket keys and ratios: no urlKey, no
 * marker text, no per-workspace or per-user split.
 */
function buildDispatchOutcomes(dispatchDocs, nowMs) {
  const windowStart = nowMs - OUTCOME_WINDOW_DAYS * DAY_MS;
  const weekStarts = Array.from({ length: OUTCOME_WINDOW_WEEKS }, (_, i) => nowMs - (OUTCOME_WINDOW_WEEKS - i) * WEEK_MS);
  const weeklyDone = zeros(weekStarts.length);
  const weeklyResolved = zeros(weekStarts.length);
  const counts = { done: 0, failed: 0, aborted: 0 };
  let total = 0;
  let resolved = 0;

  for (const lineage of groupDispatchLineages(dispatchDocs).values()) {
    const { earliest, status } = lineage;
    if (earliest === null || earliest < windowStart || earliest > nowMs) continue;
    if (status === 'skipped') continue; // benign: nothing ended
    total++;
    if (status === null) continue; // unresolved: in `total`, not `resolved`
    resolved++;
    counts[status]++;
    const week = weekStarts.findIndex(start => earliest >= start && earliest < start + WEEK_MS);
    if (week !== -1) {
      weeklyResolved[week]++;
      if (status === 'done') weeklyDone[week]++;
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
    weeks: weekStarts.map(start => utcKey(start, DAY_KEY_LENGTH)),
    weeklyRate: weeklyResolved.map((of, i) => asRate(weeklyDone[i], of)),
    weeklyResolved
  };
}

/**
 * Work funnel: dispatched → taken (claimed by a worker) → reported (the worker
 * sent feedback, or a step was posted against the dispatch) → completed (a
 * linked step reports 'completed'). The gaps between stages are the honest
 * part of the story: expiry, silence, and failure.
 *
 * Windowed on the DISPATCH's own 30-day window, joined by dispatch id — not by
 * the agent-status report's own timestamp. The funnel answers "of the
 * dispatches made in the last 30 days, how far did they get", so a report that
 * lands a few hours after its dispatch just outside a naive report-timestamp
 * window must still count.
 */
export function buildFunnel({ historyDocs, agentStatusDocs, windowedDispatchDocs }) {
  const windowedIds = new Set(windowedDispatchDocs.map(doc => String(doc._id)));
  const inWindow = doc => windowedIds.has(String(doc._id));
  const reportedIds = new Set();
  const completedIds = new Set();
  for (const doc of agentStatusDocs) {
    if (!doc.dispatchId) continue;
    const id = String(doc.dispatchId);
    if (!windowedIds.has(id)) continue;
    reportedIds.add(id);
    if (typeof doc.status === 'string' && doc.status.toLowerCase() === 'completed') completedIds.add(id);
  }
  for (const doc of historyDocs) {
    if (inWindow(doc) && feedbackLen(doc) > 0) reportedIds.add(String(doc._id));
  }
  return {
    dispatched: windowedDispatchDocs.length,
    taken: historyDocs.filter(doc => doc.status === 'taken' && inWindow(doc)).length,
    reported: reportedIds.size,
    completed: completedIds.size,
    // A non-reporting agent is indistinguishable from an incomplete task, so
    // `reported`/`completed` can only ever undercount the true totals — they
    // are lower bounds, never exact counts (LIN-2325 F4).
    reportedIsLowerBound: true,
    completedIsLowerBound: true
  };
}

/**
 * Median queue→take latency for taken dispatches, in minutes, over the whole
 * read horizon. resolvedAt is stamped when the runner *claims* the item
 * (take/archive time), NOT when the work finishes — so this is dispatch→claim
 * wait, not task duration. Labelling it "resolution"/"dispatch→done" was the
 * LIN-400 leak; the true completion time lives in the terminal feedback
 * timestamp (proxy deriveCompletedAt), not in resolvedAt, and is not
 * aggregated here. Rows taken before they were dispatched are skipped.
 */
export function medianQueueToTakeMinutes(historyDocs) {
  const waits = [];
  for (const doc of historyDocs) {
    if (doc.status !== 'taken') continue;
    const dispatched = toEpochMs(doc.dispatchedAt);
    const taken = toEpochMs(doc.resolvedAt);
    if (dispatched === null || taken === null || taken < dispatched) continue;
    waits.push((taken - dispatched) / 60000);
  }
  return median(waits);
}

/**
 * Step outcomes: agents report per-step results to the agent-status log with
 * conventional statuses; anything unconventional lands in 'other'. Windowed on
 * the report's OWN timestamp — "step outcomes posted in the last 30 days" is
 * the right reading here, unlike the funnel's dispatch-anchored join.
 */
function buildStepOutcomes(windowedAgentStatusDocs) {
  const outcomes = { completed: 0, failed: 0, blocked: 0, other: 0 };
  for (const doc of windowedAgentStatusDocs) {
    const status = typeof doc.status === 'string' ? doc.status.toLowerCase() : '';
    // Object.hasOwn so consumer-supplied statuses like 'constructor' can't
    // reach the prototype chain and pollute the buckets.
    outcomes[status !== 'other' && Object.hasOwn(outcomes, status) ? status : 'other']++;
  }
  return outcomes;
}

/**
 * Free tier prompts, last 7 days. Workspace daily docs have a non-null urlKey
 * and a 'YYYY-MM-DD' date; global hourly docs are excluded. Only a finite
 * numeric `count` is added, the same guard as `feedbackLen`: the page is
 * public and a count that is not a number must never be concatenated into the
 * output.
 */
function buildFreeTier(freeTierDocs, days) {
  const countByDate = new Map(days.map(day => [day, 0]));
  for (const doc of freeTierDocs) {
    if (!doc.urlKey || typeof doc.date !== 'string' || doc.date.length !== DAY_KEY_LENGTH) continue;
    if (countByDate.has(doc.date) && Number.isFinite(doc.count)) addTo(countByDate, doc.date, doc.count);
  }
  return { days, counts: days.map(day => countByDate.get(day)) };
}

/** Busiest day across all activity sources (vanity stat); the first maximum wins. */
function findBusiestDay(days, ...countsByDay) {
  let busiest = null;
  days.forEach((day, i) => {
    const count = countsByDay.reduce((sum, counts) => sum + counts[i], 0);
    if (count > 0 && (!busiest || count > busiest.count)) busiest = { day, count };
  });
  return busiest;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/**
 * LIN-3689: the windowing and the four activity totals, once, for every page
 * that reports them — `collectKpiStats` (instance-wide /kpis) and
 * `collectWorkspaceKpis` (one workspace, lib/workspace-kpi-stats.js) — so a
 * figure has one authority and cannot drift between the two.
 *
 * Pure: takes the already-loaded rows and the `windows` from `windowsAt`.
 * `proxy` is the full `summarizeProxyBins` result (the instance page reads its
 * charts and endpoint tallies; the workspace page reads only the count).
 *
 * - Autopilot runs: kickoff dispatches carry the explicit meta-kind
 *   'autopilot' (never derived from promptName). The worker steps an autopilot
 *   spawns show up as the other kinds in the kind tally.
 * - Agent actions: windowed proxy calls plus windowed agent-status reports.
 */
export function summarizeActivity({ historyDocs, queueDocs, agentStatusDocs, proxyBins }, windows) {
  const windowedHistoryDocs = notBefore(historyDocs, 'dispatchedAt', windows.activityStart);
  const windowedDispatchDocs = [...windowedHistoryDocs, ...notBefore(queueDocs, 'dispatchedAt', windows.activityStart)];
  const windowedAgentStatusDocs = notBefore(agentStatusDocs, 'timestamp', windows.activityStart);

  // Proxy calls by phase of the agent loop, per UTC day. This is the page's
  // hero chart: composition over volume — what agents *do*, not how much.
  const proxy = summarizeProxyBins(proxyBins, windows);

  return {
    windowedHistoryDocs,
    windowedDispatchDocs,
    windowedAgentStatusDocs,
    proxy,
    totals: {
      agentActions: proxy.windowedCount + windowedAgentStatusDocs.length,
      dispatches: windowedDispatchDocs.length,
      autopilotRuns: windowedDispatchDocs.filter(doc => doc.kind === 'autopilot').length,
      feedbackNotes: windowedHistoryDocs.reduce((sum, doc) => sum + feedbackLen(doc), 0)
    }
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
 * @param {Object} [options.milestoneFunnelDeps] - LIN-2952 aggregate deps
 *   ({taskModeStore, accountStore, accountWorkspaceStore, closeOutEventsStore,
 *   dispatchQueue, dispatchHistory}); required when the aggregate is wired in
 *   (server's refreshKpiStats and the LIN-3014 capture both pass it). A failing
 *   funnel read soft-fails to `no-signal` (LIN-3501); only `taskModeStore` (the
 *   mode) and its gated account read still reject (LIN-3002, R3); an absent
 *   inner dep reads as no-signal. Kept OUT of `collections` on purpose (see
 *   `readSources`).
 * @returns {Promise<Object>} Aggregate stats, safe for public display
 */
export async function collectKpiStats(collections, { now = new Date(), dbBackend = null, milestoneFunnelDeps } = {}) {
  if (!milestoneFunnelDeps) throw new TypeError('collectKpiStats: milestoneFunnelDeps is required (LIN-2952)');

  // LIN-3161 (LIN-3157 A1): bound every whole-collection activity read on the
  // shared 30-day read horizon, derived from the SAME injected `now`. This
  // keeps `/kpis` a 30-day payload once evidence retention is lifetime.
  const windows = windowsAt(now);
  const [
    sessionDocs, usersCount, workspacePrefDocs, customPromptDocs, localIssuesCount, localProjectsCount,
    queueDocs, historyDocs, dispatchTokensCount, proxyTokensCount, proxyBins, agentStatusDocs,
    freeTierDocs, recapCount, briefCount, reportDocs, milestoneFunnel
  ] = await readSources(collections, milestoneFunnelDeps, readHorizonStart(now), windows.nowMs);

  const { windowedDispatchDocs, windowedAgentStatusDocs, proxy, totals: activityTotals } =
    summarizeActivity({ historyDocs, queueDocs, agentStatusDocs, proxyBins }, windows);
  const dispatchDocs = [...historyDocs, ...queueDocs];
  const kindTally = tallyLabels(windowedDispatchDocs, 'kind');

  // When the instance works: all agent actions histogrammed by UTC hour, over
  // the same 30-day window as the rest of the page (a fixed hour-of-day
  // profile, not a 24h series — it stays toggle-free). Proxy events come from
  // the pre-binned hour (count-weighted); the others from their raw
  // timestamps, already restricted to the same window.
  const hourOfDay = proxy.hourOfDay;
  addHours(hourOfDay, windowedAgentStatusDocs, 'timestamp');
  addHours(hourOfDay, windowedDispatchDocs, 'dispatchedAt');

  const proxyByDay = windows.days.map((_, i) => PROXY_PHASES.reduce((sum, phase) => sum + proxy.daily.phases[phase][i], 0));
  const medianQueueToTake = medianQueueToTakeMinutes(historyDocs);

  return {
    generatedAt: now.toISOString(),
    totals: {
      workspaces: countWorkspaces({ workspacePrefDocs, customPromptDocs, queueDocs, historyDocs, proxyBins, agentStatusDocs, reportDocs, freeTierDocs }),
      // M is genuinely unknowable here: this is a union over activity
      // collections read on the fixed 30-day read horizon (evidence is
      // lifetime-retained, LIN-3163) plus durable preferences, never a
      // workspace registry read, so an older workspace with no recent
      // activity and no stored preferences silently isn't counted (LIN-2325 F4).
      workspacesBasis: 'workspaces with activity in the 30-day read window or stored preferences (older, quiet workspaces may be undercounted)',
      users: usersCount,
      activeSessions: countActiveSessions(sessionDocs, windows.nowMs),
      agentActions: activityTotals.agentActions,
      dispatches: activityTotals.dispatches,
      autopilotRuns: activityTotals.autopilotRuns,
      feedbackNotes: activityTotals.feedbackNotes,
      aiSummaries: recapCount + briefCount,
      roadmapReports: reportDocs.length,
      // M is knowable but capped here — the store's own per-workspace
      // retention limit, named rather than hand-restated so it can't drift.
      roadmapReportsBasis: `newest ${MAX_REPORTS_PER_WORKSPACE} reports per workspace`,
      customPrompts: customPromptDocs.length,
      localIssues: localIssuesCount,
      localProjects: localProjectsCount,
      activeTokens: proxyTokensCount + dispatchTokensCount
    },
    proxyCategories: { days: windows.days, ...proxy.daily.phases },
    proxyCategoriesHourly: { hours: windows.hours, ...proxy.hourly.phases },
    dispatchByDay: buildDispatchByDay(windowedDispatchDocs, kindTally, windows),
    dispatchKinds: rank(kindTally),
    // Distinct dispatch kinds the top-8 cut silently drops, mirroring
    // dispatchByDay's own 'other' bucket for this flat top-list (LIN-2325 F4).
    dispatchKindsOtherCount: excludedCount(kindTally),
    dispatchOutcomes: buildDispatchOutcomes(dispatchDocs, windows.nowMs),
    // Terminal-marked-task cost (LIN-1957, Session 1 of LIN-1625): the
    // API-equivalent dollar cost of `[done]`-marked work, plus its bias/
    // coverage disclosures. Runs over the SAME dispatchDocs as the outcome
    // rate, sharing `groupDispatchLineages`. Aggregate-only: no
    // issueIdentifier crosses into this block (see privacy assertion in
    // tests/unit/kpi-stats.test.js).
    terminalMarkedTaskCost: computeTerminalMarkedTaskCost(dispatchDocs, now),
    // Weekly-budget burn gauge (LIN-2118): an ESTIMATE of the current
    // subscription-window's consumption, calibrated from the same windowed
    // `[usage]` telemetry, scoped to the Thursday-06:00Z reset window rather
    // than the 30-day outcome window. Aggregate-only, same privacy
    // boundary — see lib/weekly-budget.js.
    weeklyBudgetGauge: computeWeeklyBudgetGauge(dispatchDocs, now),
    funnel: buildFunnel({ historyDocs, agentStatusDocs, windowedDispatchDocs }),
    milestoneFunnel,
    stepOutcomes: buildStepOutcomes(windowedAgentStatusDocs),
    // Proxy response classes (2xx/3xx grouped as ok), windowed to the same
    // 30-day span as the rest of the page.
    proxyStatus: proxy.daily.status,
    proxyStatusHourly: proxy.hourly.status,
    topEndpoints: rank(proxy.daily.endpoints),
    topEndpointsHourly: rank(proxy.hourly.endpoints),
    // Distinct endpoints the top-8 cut silently drops.
    topEndpointsOtherCount: excludedCount(proxy.daily.endpoints),
    // The 24h sibling of topEndpointsOtherCount (review LIN-2325 F1): the 30d
    // truncation count does not describe the 24h view the range toggle can
    // switch to, so the caption needs its own count for that window or it
    // can claim a truncation that didn't happen in the narrower view.
    topEndpointsHourlyOtherCount: excludedCount(proxy.hourly.endpoints),
    hourOfDay,
    freeTier: buildFreeTier(freeTierDocs, windows.freeTierDays),
    vanity: {
      busiestDay: findBusiestDay(
        windows.days,
        proxyByDay,
        countByDay(agentStatusDocs, 'timestamp', windows),
        countByDay(dispatchDocs, 'dispatchedAt', windows)
      ),
      // Reads per write across all proxy traffic (null until the first write)
      readsPerWrite: proxy.writes > 0 ? roundTo1(proxy.reads / proxy.writes) : null,
      // Median minutes from dispatch to claim (queue→take latency) for taken
      // items. NOT task duration — resolvedAt is take time, not completion (LIN-400).
      medianQueueToTakeMinutes: medianQueueToTake === null ? null : roundTo1(medianQueueToTake),
      dbBackend
    }
  };
}

// ---------------------------------------------------------------------------
// Public view and small-count floor (LIN-3703)
// ---------------------------------------------------------------------------

// A published count of people, or of per-person events, below this shows as
// "fewer than N"; exactly 0 shows as 0. Operator default, John to confirm
// (LIN-3625). Every consumer (page text, privacy page) reads it from here.
export const PUBLIC_COUNT_FLOOR = 5;

const HIDDEN_BELOW_FLOOR = 'below-floor';
const HIDDEN_WITHHELD = 'withheld';

const isCount = value => typeof value === 'number' && Number.isFinite(value);
const isLowCount = value => isCount(value) && value >= 1 && value < PUBLIC_COUNT_FLOOR;
const hiddenLeaf = reason => ({ hidden: reason });

// Every numeric leaf `toPublicKpis` can emit, by path (array indexes are
// written `[]`). A test walks a real payload and fails on any leaf missing
// here, so a new field has to be classified before it can be published.
// `floored` leaves go through the floor (alone, or as part of a `group`);
// `open` leaves are many events across every workspace and need no floor.
const OPEN = 'open';
const FLOORED = 'floored';
const PHASE_LEAVES = PROXY_PHASES.map(phase => ({ path: `phases.${phase}[]`, kind: OPEN, why: 'per-day proxy calls, many per run' }));
export const PUBLIC_LEAF_REGISTRY = Object.freeze([
  ...['total', 'resolved', 'done', 'failed', 'aborted', 'windowDays', 'rate', 'weeklyRate[]', 'weeklyResolved[]']
    .map(leaf => ({ path: `outcomes.${leaf}`, kind: OPEN, why: 'dispatch lineages over 30 days across every workspace; not tied to a person' })),
  ...['agentActions', 'dispatches', 'autopilotRuns']
    .map(leaf => ({ path: `totals.${leaf}`, kind: OPEN, why: 'event counts; an event count does not describe a person' })),
  ...PHASE_LEAVES,
  { path: 'dispatchKinds[].count', kind: OPEN, why: 'dispatch rows per app-defined kind' },
  { path: 'totals.workspaces', kind: FLOORED, group: null, why: 'the nearest thing to a count of people; no usable relation to another published figure' },
  ...['login', 'connected', 'firstGo', 'prOpened', 'mergeClicked']
    .map(step => ({ path: `milestoneFunnel.steps.${step}.count`, kind: FLOORED, group: 'steps', why: 'people who signed up in the window and reached the step' })),
  { path: 'milestoneFunnel.mode.total', kind: FLOORED, group: 'mode', why: 'task-mode entries in the window; the sum of the rungs' },
  { path: 'milestoneFunnel.mode.byRung[].entries', kind: FLOORED, group: 'mode', why: 'task-mode entries per rung' },
  { path: 'milestoneFunnel.mode.byRung[].notReady', kind: FLOORED, group: 'mode', why: 'the part of a rung\'s entries recorded not ready' }
]);

// A floored leaf on its own: exact if 0 or at least the floor.
function floorLeaf(value) {
  return isLowCount(value) ? hiddenLeaf(HIDDEN_BELOW_FLOOR) : value;
}

/**
 * The "suppress the dependents" pass over one group of floored leaves tied by
 * a relation (a total and its parts, a part and its container). `refs` are
 * `{ holder, key }` slots holding the raw counts; `derived` are the other
 * values a reader can compute from them. If any member or derived value is 1
 * to floor-1, every nonzero member is hidden, even a large one: the low leaf
 * says "fewer than N", the rest "withheld". Zero stays 0 (it shows no person,
 * and with every nonzero member hidden it derives nothing).
 */
function floorGroup(refs, derived) {
  const members = refs.map(({ holder, key }) => holder[key]).filter(isCount);
  if (![...members, ...derived].some(isLowCount)) return;
  for (const { holder, key } of refs) {
    const value = holder[key];
    if (!isCount(value) || value === 0) continue;
    holder[key] = hiddenLeaf(isLowCount(value) ? HIDDEN_BELOW_FLOOR : HIDDEN_WITHHELD);
  }
}

// A member that is itself 1 to floor-1 trips the group pass too, so a group
// needs no separate leaf pass.
// Steps are separate reads, not guaranteed ordered, so every pair is a
// container and a part: both differences are derivable.
function stepDifferences(values) {
  return values.flatMap((a, i) => values.flatMap((b, j) => (i === j ? [] : [a - b])));
}

// `total` sums the rungs' entries (a container and its parts, in any subset),
// and a rung's `notReady` is a part of its `entries`.
function modeDerived(mode) {
  const rungs = mode.byRung;
  const derived = [];
  for (let mask = 0; mask < 1 << rungs.length; mask++) {
    const sum = rungs.reduce((acc, rung, i) => acc + (mask & (1 << i) ? rung.entries : 0), 0);
    derived.push(sum, mode.total - sum);
  }
  for (const rung of rungs) derived.push(rung.entries - rung.notReady);
  return derived.filter(isCount);
}

function publicMilestoneFunnel(milestoneFunnel) {
  const steps = {};
  for (const [key, step] of Object.entries(milestoneFunnel?.steps || {})) steps[key] = { ...step };
  const mode = milestoneFunnel?.mode
    ? { total: milestoneFunnel.mode.total, byRung: milestoneFunnel.mode.byRung.map(({ rung, entries, notReady }) => ({ rung, entries, notReady })) }
    : null;

  const stepRefs = Object.values(steps).filter(step => step.state === 'reached' && isCount(step.count)).map(holder => ({ holder, key: 'count' }));
  const stepValues = stepRefs.map(({ holder }) => holder.count);
  // Derived values come from the raw counts, before anything is replaced.
  const modeValues = mode ? modeDerived(mode) : [];
  const modeRefs = mode ? [{ holder: mode, key: 'total' }, ...mode.byRung.flatMap(rung => [{ holder: rung, key: 'entries' }, { holder: rung, key: 'notReady' }])] : [];
  floorGroup(stepRefs, stepDifferences(stepValues));
  floorGroup(modeRefs, modeValues);
  return { steps, mode };
}

/**
 * The view of the stats the public /kpis page draws, and nothing else (LIN-3703):
 * the page's cache stores this, so the renderer, the embedded `__KPI_DATA__`
 * and the script never see a field it does not draw. Pure; `stats` is not
 * mutated. Counts of people and per-person events pass through the floor;
 * the registry above lists every numeric leaf and how it is treated.
 *
 * @param {Object} stats - Output of collectKpiStats()
 * @returns {Object} The public view
 */
export function toPublicKpis(stats) {
  const { dispatchOutcomes: o, totals: t, proxyCategories: p } = stats;
  return {
    generatedAt: stats.generatedAt,
    outcomes: {
      windowDays: o.windowDays,
      total: o.total,
      resolved: o.resolved,
      done: o.done,
      failed: o.failed,
      aborted: o.aborted,
      rate: o.rate,
      weeks: [...o.weeks],
      weeklyRate: [...o.weeklyRate],
      weeklyResolved: [...o.weeklyResolved]
    },
    totals: {
      workspaces: floorLeaf(t.workspaces),
      workspacesBasis: t.workspacesBasis,
      agentActions: t.agentActions,
      dispatches: t.dispatches,
      autopilotRuns: t.autopilotRuns
    },
    phases: { days: [...p.days], ...Object.fromEntries(PROXY_PHASES.map(phase => [phase, [...p[phase]]])) },
    dispatchKinds: stats.dispatchKinds.map(({ label, count }) => ({ label, count })),
    milestoneFunnel: publicMilestoneFunnel(stats.milestoneFunnel)
  };
}

// LIN-3011 (LIN-2996 Phase 3) ledger L3: exposes the real `FRESH_DIGEST`
// expression (not a hand-copied approximation) so the real-`mongod` parity
// test in tests/unit/mongo-smoke.test.js can run it side by side with the JS
// `isFreshDigest` (lib/digest-feedback.js) over the exact row shapes this
// file's own `loadDispatchHistory digest read` suite already exercises —
// same `__internal` convention `dispatch-terminal.js`/`session-telemetry.js`
// use to share an implementation detail with tests without exporting it as
// public API.
export const __internal = { FRESH_DIGEST };
