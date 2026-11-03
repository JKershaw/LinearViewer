#!/usr/bin/env node
/**
 * LIN-4178: time the KPI path's founder lookup (lib/founder-lookup.js) on a seeded real MongoDB.
 *
 *   node scripts/lin4178-founder-timing.mjs --uri mongodb://127.0.0.1:27017 [--workspaces 50] [--lineages 400]
 *
 * It seeds a fresh database (production indexes via lib/db-indexes.js ensureIndexes) with dispatch
 * history and queue rows across several workspaces: most lineages are in the 30-day window, and about
 * one in ten has a founder older than the window with an in-window cross-issue follow-up (the horizon
 * straddler, LIN-4148). Then it times the two reads `/kpis` makes:
 *   1. the horizon read of the dispatch history (`loadDispatchHistory`, the aggregation it already runs);
 *   2. the founder lookup over the lineages that read returned (`lookupFounderRows`).
 * It prints both timings, the query count and the row counts. The database is dropped afterwards.
 */
import { MongoClient } from 'mongodb';
import { performance } from 'node:perf_hooks';
import { ensureIndexes } from '../lib/db-indexes.js';
import { loadDispatchHistory } from '../lib/kpi-stats.js';
import { lookupFounderRows, FOUNDER_BATCH_SIZE } from '../lib/founder-lookup.js';
import { readHorizonStart } from '../lib/read-horizon.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const uri = arg('uri', process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017');
const workspaces = Number(arg('workspaces', 50));
const lineagesPerWorkspace = Number(arg('lineages', 400));

// Deterministic: a small LCG, so two runs seed the same rows.
let seed = 4178;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ago = days => new Date(now - days * DAY);
const usage = (costUsd, at) => ({ kind: 'usage', timestamp: at.toISOString(), message: `[usage] ${JSON.stringify({ model: 'anthropic/claude-sonnet-5', costUsd })}` });
const terminal = at => ({ kind: 'terminal', timestamp: at.toISOString(), message: '[done] timing' });

function seedRows() {
  const history = [];
  const queue = [];
  for (let w = 0; w < workspaces; w += 1) {
    const urlKey = `ws-${w}`;
    for (let l = 0; l < lineagesPerWorkspace; l += 1) {
      const root = `${urlKey}-L${l}`;
      const issue = `LIN-${(l % 997) + 1}`;
      const straddler = rand() < 0.1;
      const founderAge = straddler ? 35 + rand() * 20 : 1 + rand() * 25;
      const founderAt = ago(founderAge);
      history.push({
        _id: `${root}-f`, urlKey, rootItemId: root, issueIdentifier: issue, kind: 'implementation', promptName: 'implementation',
        status: 'taken', abort: false, target: 'cli', dispatchedAt: founderAt, resolvedAt: founderAt,
        feedback: [usage(0.5 + rand(), founderAt), terminal(founderAt)],
      });
      const followUps = 1 + Math.floor(rand() * 2);
      for (let f = 0; f < followUps; f += 1) {
        const at = ago(Math.max(0.05, Math.min(founderAge - 0.1, rand() * 25)));
        const crossIssue = straddler || rand() < 0.2;
        history.push({
          _id: `${root}-${f}`, urlKey, rootItemId: root, followUpTo: f === 0 ? `${root}-f` : `${root}-0`,
          issueIdentifier: crossIssue ? `LIN-${(l % 997) + 2}` : issue, kind: rand() < 0.2 ? 'review' : 'implementation',
          promptName: 'implementation', status: 'taken', abort: false, target: 'cli', dispatchedAt: at, resolvedAt: at,
          feedback: [usage(0.2 + rand(), at), terminal(at)],
        });
      }
      if (rand() < 0.02) {
        const at = ago(0.5 + rand());
        queue.push({ _id: `${root}-q`, urlKey, rootItemId: root, issueIdentifier: issue, kind: 'implementation', promptName: 'implementation', status: 'queued', abort: false, target: 'cli', dispatchedAt: at, feedback: [] });
      }
    }
  }
  return { history, queue };
}

const client = new MongoClient(uri);
await client.connect();
const dbName = `lin4178_timing_${Date.now()}`;
const db = client.db(dbName);
try {
  await ensureIndexes(db, { logger: { log() {}, warn() {}, error: console.error } });
  const { history, queue } = seedRows();
  const dispatchHistory = db.collection('dispatch-history');
  const dispatchQueue = db.collection('dispatch-queue');
  for (let i = 0; i < history.length; i += 5000) await dispatchHistory.insertMany(history.slice(i, i + 5000), { ordered: false });
  if (queue.length) await dispatchQueue.insertMany(queue, { ordered: false });

  // The read /kpis makes on the horizon (loadDispatchHistory, aggregation shape) over every workspace.
  const since = readHorizonStart(new Date(now));
  let t0 = performance.now();
  const fetched = await loadDispatchHistory(dispatchHistory, { since });
  const readMs = performance.now() - t0;
  const queued = await dispatchQueue.find({}).toArray();
  const rows = [...fetched, ...queued];

  // The founder lookup over those lineages, counting every find it issues.
  let queries = 0;
  const countingCollection = c => ({ find: (q, o) => { queries += 1; return c.find(q, o); } });
  t0 = performance.now();
  const founders = await lookupFounderRows({ dispatchHistory: countingCollection(dispatchHistory), dispatchQueue: countingCollection(dispatchQueue) }, rows);
  const lookupMs = performance.now() - t0;

  // The narrowed variant (the plan's fallback): only anchors whose EARLIEST fetched member is a follow-up.
  // A lineage whose root is fetched has every true member fetched, so its identity is already whole.
  const earliest = new Map();
  for (const r of fetched) {
    const cur = earliest.get(r.rootItemId);
    if (!cur || new Date(r.dispatchedAt) < new Date(cur.dispatchedAt)) earliest.set(r.rootItemId, r);
  }
  const byAnchor = new Map();
  for (const r of fetched) {
    const list = byAnchor.get(r.rootItemId);
    if (list) list.push(r);
    else byAnchor.set(r.rootItemId, [r]);
  }
  const narrowRows = [...earliest.values()].filter(r => r.followUpTo).flatMap(r => byAnchor.get(r.rootItemId));
  t0 = performance.now();
  const narrowFounders = await lookupFounderRows({ dispatchHistory, dispatchQueue }, narrowRows);
  const narrowMs = performance.now() - t0;

  const anchors = new Set(rows.map(r => r.rootItemId).filter(Boolean));
  console.log(JSON.stringify({
    workspaces, lineagesPerWorkspace, seededHistoryRows: history.length, seededQueueRows: queue.length,
    horizonHistoryRows: fetched.length, queueRows: queued.length, anchors: anchors.size,
    batchSize: FOUNDER_BATCH_SIZE, findQueries: queries, founderRows: founders.length,
    horizonReadMs: Math.round(readMs), founderLookupMs: Math.round(lookupMs),
    narrowedAnchors: new Set(narrowRows.map(r => r.rootItemId)).size, narrowedFounderRows: narrowFounders.length,
    narrowedFounderLookupMs: Math.round(narrowMs),
  }, null, 2));
} finally {
  await db.dropDatabase();
  await client.close();
}
