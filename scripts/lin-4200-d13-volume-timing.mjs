#!/usr/bin/env node
/**
 * LIN-4200 beat 3 (D13): volume and timing for the records-sum read that piece 4 would add.
 * One-off measurement. Not part of the app.
 *
 * WHAT IT MEASURES
 *  1. Record volume: per-lineage distribution (min, median, p95, max), and records per UTC day and hour.
 *  2. explain('executionStats') on the two queries RequestUsageStore.listForAnchors issues (LIN-4212): the member
 *     rows from dispatch-history (rootItemId in anchors), then the records by {urlKey, itemId} (LIST_PROJECTION), for
 *     three anchor sets: one task, the 30-day /kpis-sized dispatch anchors, and the lineages that have records.
 *     Confirms each index is used (IXSCAN, no COLLSCAN) and records keysExamined, docsExamined, nReturned. The stamped
 *     read (the pre-LIN-4212 shape, {urlKey, rootItemId}) is explained beside them for the delta.
 *  3. Wall times on live production data, with repetitions:
 *     (a) today's /kpis (collectKpiStats) and workspace KPIs (collectWorkspaceKpis), the real collectors, fed the
 *         production collection handles and the same stores server.js constructs;
 *     (b) the records-sum path piece 4 would add for the same windows: listForAnchors + priceRequest per record,
 *         summed per lineage (the D6 contract, minimal form).
 *  4. A steady-state projection. Production has too little volume for it, so the records-sum path is timed on a
 *     SCRATCH copy at steady-state volume (see --scale-local below), and the projection's basis is printed. Each
 *     scratch point also times the stamped read on the same data, and reports the loader's percentage delta
 *     (the LIN-4212 target: within +10% at steady-state volume).
 *
 * READ-ONLY against production. The only writes are to a scratch database on a LOCAL mongod (127.0.0.1), created
 * by --scale-local and dropped at the end. The script refuses a scratch write to any non-loopback host.
 *
 * RUN (the URI is read from the environment at run time and never written to a file):
 *   MONGODB_URI='<read-only production URI, via the tunnel>' MONGODB_SCRATCH_URI='mongodb://127.0.0.1:27017' \
 *     node scripts/lin-4200-d13-volume-timing.mjs [--out FILE] [--scale-local]
 * Env:
 *   LIN4200_DB     production database (default: linear-viewer)
 *   LIN4200_TASK   the one-task anchor (default: 3ccfa072-12bd-46e5-ba82-dc7112f914e2, this ticket's chain)
 *   LIN4200_REPS   repetitions per timed read (default: 5)
 *
 * TESTS (pure helpers only): node --test tests/unit/lin-4200-d13.test.js
 */

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { RequestUsageStore, LIST_PROJECTION, REQUEST_USAGE_COLLECTION } from '../lib/request-usage-store.js';
import { anchorOf } from '../lib/lineage-membership.js';
import { priceRequest } from '../lib/model-pricing.js';
import { readHorizonStart } from '../lib/read-horizon.js';
import { ACTIVITY_WINDOW_DAYS } from '../lib/kpi-stats.js';

// ---------- pure helpers (unit-tested) ----------

/** Nearest-rank percentile of a numeric list (p in 0..100). Empty list -> null. */
export function percentileOf(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** min, median, p95, max, count of a numeric list. */
export function distributionOf(values) {
  if (values.length === 0) return { count: 0, min: null, median: null, p95: null, max: null };
  return {
    count: values.length,
    min: Math.min(...values),
    median: percentileOf(values, 50),
    p95: percentileOf(values, 95),
    max: Math.max(...values)
  };
}

/** Counts of instants (ms) per UTC day ('YYYY-MM-DD') or hour ('YYYY-MM-DDTHH'). */
export function bucketCountsOf(instantsMs, unit) {
  const width = unit === 'hour' ? 13 : 10;
  const counts = new Map();
  for (const ms of instantsMs) {
    if (!Number.isFinite(ms)) continue;
    const key = new Date(ms).toISOString().slice(0, width);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Walk an explain('executionStats') document: the stage names, the index used, and the execution counters. */
export function summarizeExplain(explain) {
  const stages = [];
  let indexName = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.stage === 'string') stages.push(node.stage);
    if (typeof node.indexName === 'string' && indexName === null) indexName = node.indexName;
    walk(node.inputStage);
    if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
  };
  walk(explain?.queryPlanner?.winningPlan);
  const exec = explain?.executionStats || {};
  return {
    stages,
    indexName,
    usesCollScan: stages.includes('COLLSCAN'),
    usesIxScan: stages.includes('IXSCAN'),
    nReturned: exec.nReturned ?? null,
    keysExamined: exec.totalKeysExamined ?? null,
    docsExamined: exec.totalDocsExamined ?? null,
    executionTimeMillis: exec.executionTimeMillis ?? null
  };
}

/** Least-squares line through (n, ms) points: ms = a + b * n. */
export function fitLinear(points) {
  const k = points.length;
  if (k < 2) return null;
  const mx = points.reduce((s, p) => s + p.n, 0) / k;
  const my = points.reduce((s, p) => s + p.ms, 0) / k;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.n - mx) ** 2;
    sxy += (p.n - mx) * (p.ms - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b, points: k };
}

/** Projected milliseconds at a record count, from a fitLinear result. */
export function projectMs(fit, records) {
  return fit.a + fit.b * records;
}

/** Percentage change from `base` to `next` (positive = slower). Null when `base` is not a positive number. */
export function deltaPctOf(base, next) {
  if (!(base > 0) || !Number.isFinite(next)) return null;
  return round(((next - base) / base) * 100);
}

/**
 * Steady-state records in a window: the observed records per hour since a start, scaled to the window.
 * It assumes the rate holds; the caller states that as the projection's basis.
 */
export function steadyStateRecordsOf({ recordsSinceStart, hoursSinceStart, windowDays }) {
  if (!(hoursSinceStart > 0)) return null;
  return Math.round((recordsSinceStart / hoursSinceStart) * 24 * windowDays);
}

/**
 * The records-sum path piece 4 would add, over a list of anchors: listForAnchors, then priceRequest per record
 * summed per lineage. Pure over the records it is given, so the fold's cost is measured without a database.
 */
export function sumRecordsByLineage(records) {
  const byAnchor = new Map();
  let unpriced = 0;
  for (const record of records) {
    const cost = priceRequest(record);
    if (cost === null) unpriced += 1;
    else byAnchor.set(record.rootItemId, (byAnchor.get(record.rootItemId) || 0) + cost);
  }
  return { lineages: byAnchor.size, records: records.length, unpriced };
}

/** Host (loopback names normalised) and port of a mongodb URI. The port defaults to 27017. */
export function hostPortOf(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)/.exec(uri || '');
  if (!m) throw new Error('not a mongodb URI');
  const [rawHost, rawPort] = m[1].split(':');
  const host = rawHost.toLowerCase();
  return { host: host === 'localhost' ? '127.0.0.1' : host, port: Number(rawPort || 27017) };
}

/**
 * The scratch guard (review finding 6). Scratch writes are refused unless the target is loopback, on exactly
 * `scratchPort`, and is not the production target (MONGODB_URI's host:port, loopback names normalised).
 */
export function assertScratchTarget({ scratchUri, prodUri, scratchPort = 27017 }) {
  const scratch = hostPortOf(scratchUri);
  if (scratch.host !== '127.0.0.1') throw new Error(`scratch writes refused: host ${scratch.host} is not loopback`);
  if (scratch.port !== scratchPort) throw new Error(`scratch writes refused: port ${scratch.port} is not --scratch-port ${scratchPort}`);
  if (prodUri) {
    const prod = hostPortOf(prodUri);
    if (prod.host === scratch.host && prod.port === scratch.port) {
      throw new Error('scratch writes refused: the scratch target equals MONGODB_URI');
    }
  }
  return scratch;
}

// ---------- measurement (the only I/O) ----------

const round = (ms) => Math.round(ms * 10) / 10;

/** Run fn `reps` times; returns the wall times (ms) and their median, and the last result's summary. */
export async function timeReps(label, reps, fn) {
  const times = [];
  let last = null;
  for (let i = 0; i < reps; i += 1) {
    const t0 = performance.now();
    last = await fn();
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { label, reps, timesMs: times.map(round), medianMs: round(median), maxMs: round(sorted[sorted.length - 1]), last };
}

/**
 * The explain pair for the two-step read the loader issues (LIN-4212): the member rows from dispatch-history
 * (`rootItemId in anchors`, projection {_id, rootItemId}), then the records by itemId (LIST_PROJECTION). Both are
 * explained on the handles the loader uses; `stampedRecords` is the pre-LIN-4212 read shape, kept for the delta.
 */
async function explainListForAnchors(db, urlKey, anchors) {
  const ids = [...new Set(anchors)];
  const history = db.collection('dispatch-history');
  const records = db.collection(REQUEST_USAGE_COLLECTION);
  const memberExplain = await history
    .find({ urlKey, rootItemId: { $in: ids } }, { projection: { _id: 1, rootItemId: 1 } })
    .explain('executionStats');
  const memberIds = (await history.find({ urlKey, rootItemId: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map(r => String(r._id));
  const recordExplain = await records
    .find({ urlKey, itemId: { $in: memberIds } }, { projection: LIST_PROJECTION })
    .explain('executionStats');
  const stampedExplain = await records
    .find({ urlKey, rootItemId: { $in: ids } }, { projection: LIST_PROJECTION })
    .explain('executionStats');
  return {
    anchorCount: ids.length,
    memberRows: memberIds.length,
    members: summarizeExplain(memberExplain),
    records: summarizeExplain(recordExplain),
    stampedComparison: summarizeExplain(stampedExplain)
  };
}

/**
 * The record lineages of a workspace, from the POSTING rows: the current anchor of each dispatch-history row that
 * a stored record names by itemId. Never the stored stamp (that is the bug LIN-4212 fixes).
 */
async function recordLineageAnchors(db, urlKey) {
  const itemIds = (await db.collection(REQUEST_USAGE_COLLECTION).distinct('itemId', { urlKey })).map(String);
  if (itemIds.length === 0) return [];
  const postingRows = await db.collection('dispatch-history')
    .find({ urlKey, _id: { $in: itemIds } }, { projection: { _id: 1, rootItemId: 1 } }).toArray();
  return [...new Set(postingRows.map(r => anchorOf(r)))];
}

/**
 * Volume of the workspace's records. The raw documents give the total, the per-day and per-hour buckets and the
 * deploy split. The lineage sizes come from the records the loader returns (`records`, folded and relabelled),
 * not from a raw count on the stored stamp.
 */
async function readWorkspaceVolume(db, urlKey, now, records) {
  const ru = db.collection(REQUEST_USAGE_COLLECTION);
  const rows = await ru.find({ urlKey }, { projection: { _id: 0, at: 1 } }).toArray();
  const perLineage = new Map();
  for (const r of records) perLineage.set(r.rootItemId, (perLineage.get(r.rootItemId) || 0) + 1);
  const instants = [];
  for (const r of rows) {
    const ms = new Date(r.at).getTime();
    if (Number.isFinite(ms)) instants.push(ms);
  }
  return {
    records: rows.length,
    foldedRecords: records.length,
    perLineage: distributionOf([...perLineage.values()]),
    perDay: bucketCountsOf(instants, 'day'),
    perHour: bucketCountsOf(instants, 'hour'),
    recordsAtOrAfterDeploy: instants.filter(ms => ms >= Date.parse('2026-11-04T04:59:21Z')).length,
    now: now.toISOString()
  };
}

async function productionCollectors(db) {
  // The same stores server.js builds for /kpis, over the production collections. Read methods only.
  const { AccountStore } = await import('../lib/account-store.js');
  const { AccountWorkspaceStore } = await import('../lib/account-workspace-store.js');
  const { TaskModeStore } = await import('../lib/task-mode-store.js');
  const { CloseOutEventsStore } = await import('../lib/close-out-events-store.js');
  const { collectKpiStats } = await import('../lib/kpi-stats.js');
  const { collectWorkspaceKpis } = await import('../lib/workspace-kpi-stats.js');
  const { lineageIdentityOfRows } = await import('../lib/dispatch-store.js');
  const c = name => db.collection(name);
  const dispatchQueue = c('dispatch-queue');
  const dispatchHistory = c('dispatch-history');
  const kpiDailyRollup = c('kpi-daily-rollup');
  const closeOuts = c('close-out-events');
  const collections = {
    sessions: c('sessions'), userPreferences: c('user-preferences'), workspacePreferences: c('workspace-preferences'),
    customPrompts: c('custom-prompts'), localIssues: c('local-issues'), dispatchQueue, dispatchHistory,
    dispatchTokens: c('dispatch-tokens'), proxyTokens: c('proxy-tokens'), proxyEvents: c('proxy-events'),
    agentStatus: c('foreman-status'), freeTier: c('free-tier-usage'), recapCache: c('recap-cache'),
    briefCache: c('brief-cache'), reportHistory: c('report-history'), kpiDailyRollup
  };
  const milestoneFunnelDeps = {
    taskModeStore: new TaskModeStore({ collection: c('task-mode-events') }),
    accountStore: new AccountStore({ collection: c('accounts') }),
    accountWorkspaceStore: new AccountWorkspaceStore({ collection: c('account-workspaces') }),
    closeOutEventsStore: new CloseOutEventsStore({ collection: closeOuts }),
    dispatchQueue,
    dispatchHistory
  };
  const lineageIdentity = rows => lineageIdentityOfRows([dispatchHistory, dispatchQueue], rows);
  // LIN-4201: the collectors require the request records (the one loader). Since then these timings are the
  // records-first collectors, records load included: the "today" figures of the LIN-4200 run predate that.
  const { requestUsageLoader } = await import('../lib/request-usage-loader.js');
  const loader = requestUsageLoader(new RequestUsageStore({ collection: c(REQUEST_USAGE_COLLECTION), historyCollection: dispatchHistory }));
  return {
    kpi: (now) => collectKpiStats(collections, { now, dbBackend: 'mongodb', milestoneFunnelDeps, lineageIdentity, requestSource: loader }),
    workspace: (urlKey, now) => collectWorkspaceKpis({
      collections: { dispatchQueue, dispatchHistory, proxyEvents: collections.proxyEvents, agentStatus: collections.agentStatus,
        reportHistory: collections.reportHistory, customPrompts: collections.customPrompts, closeOutEvents: closeOuts,
        kpiDailyRollup },
      urlKey, now, requestUsageLoader: loader
    })
  };
}

async function historyAnchors(db, since, urlKey) {
  // Both collections: a row lives in exactly one of them, so the union is the window's full set of lineages.
  const anchors = new Set();
  for (const name of ['dispatch-history', 'dispatch-queue']) {
    const rows = await db.collection(name).aggregate([
      { $match: { urlKey, dispatchedAt: { $gte: since } } },
      { $group: { _id: { $ifNull: ['$rootItemId', '$_id'] } } }
    ]).toArray();
    for (const r of rows) anchors.add(String(r._id));
  }
  return [...anchors];
}

async function measureProduction(db, urlKey, now, reps, taskAnchor) {
  const since = readHorizonStart(now);
  // LIN-4212: the store reads the lineage members from dispatch-history, so it is built with that handle.
  const store = new RequestUsageStore({ collection: db.collection(REQUEST_USAGE_COLLECTION), historyCollection: db.collection('dispatch-history') });
  const recordAnchors = await recordLineageAnchors(db, urlKey);
  const recordsOfAnchors = await store.listForAnchors(urlKey, recordAnchors);
  const volume = await readWorkspaceVolume(db, urlKey, now, recordsOfAnchors);
  const windowAnchors = await historyAnchors(db, since, urlKey);
  const explains = {
    oneTask: await explainListForAnchors(db, urlKey, [taskAnchor]),
    kpiWindow: await explainListForAnchors(db, urlKey, windowAnchors),
    recordLineages: await explainListForAnchors(db, urlKey, recordAnchors)
  };
  const collectors = await productionCollectors(db);
  const timings = {
    kpi: await timeReps('today /kpis (collectKpiStats, instance-wide)', reps, () => collectors.kpi(now)),
    workspaceKpis: await timeReps('today workspace KPIs (collectWorkspaceKpis)', reps, () => collectors.workspace(urlKey, now)),
    recordsSumKpiWindow: await timeReps('records-sum path, 30-day window anchors', reps, async () => {
      const recs = await store.listForAnchors(urlKey, windowAnchors);
      return sumRecordsByLineage(recs);
    }),
    stampedKpiWindow: await timeReps('stamped read, 30-day window anchors (pre-LIN-4212 shape, comparison only)', reps, async () => {
      const recs = await db.collection(REQUEST_USAGE_COLLECTION).find({ urlKey, rootItemId: { $in: windowAnchors } }, { projection: LIST_PROJECTION }).toArray();
      return sumRecordsByLineage(recs);
    }),
    recordsSumOneTask: await timeReps('records-sum path, one task', reps, async () => {
      const recs = await store.listForAnchors(urlKey, [taskAnchor]);
      return sumRecordsByLineage(recs);
    })
  };
  // Strip the large collector payloads from the summaries; keep the counters the verdict needs.
  for (const key of Object.keys(timings)) timings[key].last = summarizeLast(timings[key].last);
  return { since: since.toISOString(), windowDays: ACTIVITY_WINDOW_DAYS, volume, anchors: { window: windowAnchors.length, recordLineages: recordAnchors.length }, explains, timings };
}

function summarizeLast(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  return { keys: Object.keys(value).slice(0, 20) };
}

/**
 * Scratch copy at steady-state volume on a LOCAL mongod: the records-sum path timed and explained.
 * LIN-4212: each lineage gets one posting row in dispatch-history (its `_id` is the item id the records name, its
 * `rootItemId` the lineage anchor), so the loader's member read has rows to find, exactly as in production.
 */
async function measureScratch(scratchClient, prodRecords, steadyRecords, reps, scratchDbName) {
  const db = scratchClient.db(scratchDbName);
  await db.dropDatabase();
  const col = db.collection(REQUEST_USAGE_COLLECTION);
  const history = db.collection('dispatch-history');
  // The indexes production declares for these two reads (lib/db-indexes.js).
  await col.createIndex({ urlKey: 1, rootItemId: 1, requestId: 1 }, { unique: true });
  await col.createIndex({ urlKey: 1, rootItemId: 1 });
  await col.createIndex({ urlKey: 1, itemId: 1 });
  await history.createIndex({ urlKey: 1, rootItemId: 1 });
  const lineages = Math.max(1, Math.round(steadyRecords / 125));
  const anchors = Array.from({ length: lineages }, (_, i) => `scratch-${String(i).padStart(6, '0')}`);
  const itemOf = (i) => `scratch-row-${String(i % lineages).padStart(6, '0')}`;
  await history.insertMany(anchors.map((anchor, i) => ({
    _id: itemOf(i), urlKey: 'scratch', rootItemId: anchor, kind: 'implementation', status: 'taken', abort: false,
    dispatchedAt: new Date('2026-11-04T05:00:00Z')
  })));
  const BATCH = 5000;
  let batch = [];
  let inserted = 0;
  for (let i = 0; i < steadyRecords; i += 1) {
    const src = prodRecords[i % prodRecords.length];
    const at = src.at;
    batch.push({ urlKey: 'scratch', itemId: itemOf(i), rootItemId: anchors[i % lineages], requestId: `scratch-${i}`, harness: 'claude-code', model: src.model,
      effort: src.effort ?? null, lane: src.lane ?? null, agent: 'main', at, updatedAt: at,
      inputTokens: src.inputTokens, outputTokens: src.outputTokens, cacheCreationInputTokens: src.cacheCreationInputTokens,
      cacheCreation1hInputTokens: src.cacheCreation1hInputTokens, cacheReadInputTokens: src.cacheReadInputTokens });
    if (batch.length === BATCH) { await col.insertMany(batch, { ordered: false }); inserted += batch.length; batch = []; }
  }
  if (batch.length) { await col.insertMany(batch, { ordered: false }); inserted += batch.length; }
  const store = new RequestUsageStore({ collection: col, historyCollection: history });
  const explain = await explainListForAnchors(db, 'scratch', anchors);
  const loaderTiming = await timeReps(`scratch records-sum path (loader), ${inserted} records, ${lineages} lineages`, reps, async () => {
    const recs = await store.listForAnchors('scratch', anchors);
    return sumRecordsByLineage(recs);
  });
  const stampedTiming = await timeReps(`scratch stamped read (pre-LIN-4212 shape), ${inserted} records, ${lineages} lineages`, reps, async () => {
    const recs = await col.find({ urlKey: 'scratch', rootItemId: { $in: anchors } }, { projection: LIST_PROJECTION }).toArray();
    return sumRecordsByLineage(recs);
  });
  loaderTiming.last = summarizeLast(loaderTiming.last);
  stampedTiming.last = summarizeLast(stampedTiming.last);
  await db.dropDatabase();
  return { records: inserted, lineages, explain, timing: loaderTiming, stampedTiming, deltaPct: deltaPctOf(stampedTiming.medianMs, loaderTiming.medianMs) };
}

async function main(argv) {
  const args = Object.fromEntries(argv.reduce((acc, arg, i, all) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (read-only production URI, never written to a file)');
  // Validate the scratch target BEFORE any read or write (review finding 6).
  const scratchPort = args['scratch-port'] !== undefined ? Number(args['scratch-port']) : 27017;
  if (args['scale-local']) {
    const scratchUri = process.env.MONGODB_SCRATCH_URI;
    if (!scratchUri) throw new Error('MONGODB_SCRATCH_URI is required for --scale-local');
    if (!Number.isInteger(scratchPort)) throw new Error('--scratch-port must be an integer');
    assertScratchTarget({ scratchUri, prodUri: uri, scratchPort });
  }
  const { MongoClient } = await import('mongodb');
  const now = new Date();
  const reps = Number(process.env.LIN4200_REPS || 5);
  const taskAnchor = process.env.LIN4200_TASK || '3ccfa072-12bd-46e5-ba82-dc7112f914e2';
  const client = new MongoClient(uri, { readPreference: 'primary' });
  await client.connect();
  let report;
  try {
    const db = client.db(process.env.LIN4200_DB || 'linear-viewer');
    // --url-key (review minor): explicit when more than one workspace holds records; never an arbitrary first.
    const keys = await db.collection(REQUEST_USAGE_COLLECTION).distinct('urlKey');
    const explicit = typeof args['url-key'] === 'string' ? args['url-key'] : null;
    if (explicit && !keys.includes(explicit)) throw new Error(`--url-key ${explicit} has no records`);
    if (!explicit && keys.length !== 1) throw new Error(`${keys.length} workspaces hold records; pass --url-key`);
    const urlKey = explicit ?? keys[0];
    report = { generatedAt: now.toISOString(), urlKey, production: await measureProduction(db, urlKey, now, reps, taskAnchor) };
  } finally {
    await client.close();
  }
  if (args['scale-local']) {
    const scratchUri = process.env.MONGODB_SCRATCH_URI;
    const prodClient = new MongoClient(uri, { readPreference: 'primary' });
    await prodClient.connect();
    let prodRecords;
    try {
      prodRecords = await prodClient.db(process.env.LIN4200_DB || 'linear-viewer').collection(REQUEST_USAGE_COLLECTION)
        .find({}, { projection: { _id: 0, model: 1, effort: 1, lane: 1, at: 1, inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 1, cacheCreation1hInputTokens: 1, cacheReadInputTokens: 1 } })
        .toArray();
    } finally {
      await prodClient.close();
    }
    const { recordsAtOrAfterDeploy } = report.production.volume;
    const deployMs = Date.parse('2026-11-04T04:59:21Z');
    const hoursSinceDeploy = (now.getTime() - deployMs) / 3.6e6;
    const steady = steadyStateRecordsOf({ recordsSinceStart: recordsAtOrAfterDeploy, hoursSinceStart: hoursSinceDeploy, windowDays: 30 });
    const scratchClient = new MongoClient(scratchUri);
    await scratchClient.connect();
    try {
      const points = [];
      for (const n of [5000, 50000, 200000]) {
        const r = await measureScratch(scratchClient, prodRecords, n, reps, `lin4200_d13_scratch_${n}`);
        points.push({ n: r.records, ms: r.timing.medianMs, explain: r.explain });
        report[`scratch_${n}`] = r;
      }
      const big = await measureScratch(scratchClient, prodRecords, steady, reps, 'lin4200_d13_scratch_steady');
      report.scratchSteady = big;
      const fit = fitLinear(points.map(p => ({ n: p.n, ms: p.ms })));
      report.projection = {
        basis: `records since deploy (${recordsAtOrAfterDeploy}) over ${hoursSinceDeploy.toFixed(2)} h, scaled to 30 days (${steady} records); scratch timing at ${big.records} records on a local mongod, not Railway`,
        steadyRecords: steady,
        fit,
        projectedMsAtSteady: fit ? round(projectMs(fit, steady)) : null,
        measuredMsAtSteady: big.timing.medianMs
      };
    } finally {
      await scratchClient.close();
    }
  }
  const json = JSON.stringify(report, null, 2);
  if (args.out && args.out !== true) writeFileSync(args.out, json);
  process.stdout.write(json + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => {
    process.stderr.write(`lin-4200 d13 measurement failed: ${err.message}\n`);
    process.exit(1);
  });
}
