/**
 * LIN-4177: runs every cost surface the replay covers (S1 to S13) over the fixture corpus (corpus.js)
 * and returns one JSON-stable object. `scripts/cost-replay.mjs` records it as the goldens and checks
 * the current code against them; `tests/unit/cost-read.test.js` pins the run and the change list.
 *
 * The surfaces are called through their real entry points, so the same harness runs against the code
 * before and after the change. Every entry point used here exists at the baseline commit (9e397e6b), so
 * the goldens are recorded there by copying this directory into a worktree (see the plan's baseline rule).
 *
 *  - S1  `/api/proxy/cost/:id`, through `createProxyRoutes` (routes/proxy.js) over Express.
 *  - S2  Settings › Health's workspace calls: `listInHorizon` then `callsSurfaceOf` (routes/settings.js, LIN-4179).
 *  - S3  Ship's Biscuit's Weather line: the same calls read (routes/ship-biscuit.js).
 *  - S4  Observation's scan estimate: `listInHorizon(urlKey, {feature: 'scan'})` then `scanEstimateOf`, in the
 *        shape the page reads (routes/dashboard-feed.js); it is S7's scan `typicalUsd`.
 *  - S5  `readModelsHistory` (the 30-day read, capped; LIN-4226: its `workerSessions`), then `agentSpendByJob`.
 *  - S6  `typicalByModel` per job (the decision panel's per-model typicals).
 *  - S7  Settings › Models' Harbour spend per job: `listInHorizon`, then `harbourSpendByJob`.
 *  - S8  `spendByEffectiveModel` over the agent and Harbour-call spend.
 *  - S9  the dispatch decision panel's per-kind read (`agentSpendByJob` + `typicalByModel`, one kind).
 *  - S10 `computeEffortReadout`'s cost columns (200 newest resolved history rows, as the route reads).
 *  - S11 the public `/kpis` cost per finished ticket: `computeTerminalMarkedTaskCost` (lib/kpi-stats.js).
 *  - S12 the workspace KPIs' cost per day: `collectWorkspaceKpis` over fake collections (lib/workspace-kpi-stats.js).
 *  - S13 the run page's per-lineage cost: `buildRunView` over one session's loops (lib/run-view.js).
 *
 * The fake store serves the corpus in the two shapes the real store serves: formatted list rows
 * (`listHistory`, `listItems`) and raw scalar docs (`lineageIdentityRows`, the founder lookup). The fake
 * collections answer the filters the production readers send; an operator this fake does not know throws.
 */
import express from 'express';
import { createProxyRoutes } from '../../../routes/proxy.js';
import { LlmCallLogStore } from '../../../lib/llm-call-log.js';
import { callsSurfaceOf, lineageRecords } from '../../../lib/cost-read.js';
import { groupDispatchLineages } from '../../../lib/dispatch-lineage.js';
import { readModelsHistory } from '../../../lib/model-routing-history.js';
import { agentSpendByJob, typicalByModel, harbourSpendByJob, spendByEffectiveModel, scanEstimateOf } from '../../../lib/model-routing-spend.js';
import { computeEffortReadout } from '../../../lib/effort-readout.js';
import { parseUsage } from '../../../lib/session-telemetry.js';
import { isRunningTotal } from '../../../lib/row-usage.js';
import { readHorizonStart } from '../../../lib/read-horizon.js';
import { computeTerminalMarkedTaskCost } from '../../../lib/terminal-marked-task-cost.js';
import { collectWorkspaceKpis } from '../../../lib/workspace-kpi-stats.js';
import { lineageIdentityOfRows } from '../../../lib/dispatch-store.js';
import { buildRunView } from '../../../lib/run-view.js';
import { NO_REQUEST_RECORDS, loaderOver } from '../request-usage-loader.js';
import { buildCorpus, NOW_MS, REPLAY_ISSUES, REPLAY_JOBS } from './corpus.js';

// The S1 route is served in-process through proxyLimiter (routes/proxy.js), which skips only when NODE_ENV is
// 'test'. The replay freezes Date.now for each run, so the limiter's 60-per-minute window never rolls over, and a
// second runReplay() in the same process would be answered 429. Every replay caller is a test or the recorder,
// so this is the environment they run in (cost-read.test.js sets the same thing). It does not change any value:
// a fresh process gives identical output with or without it (LIN-4197 beat 4).
process.env.NODE_ENV = 'test';

export const URL_KEY = 'acme';
const AGENT_JOBS = REPLAY_JOBS.filter(j => j !== 'proxy-x');
const HARBOUR_JOBS = ['proxy-x'];
const HARBOUR_JOBS_SPEND = ['proxy-x', 'review', 'scan'];

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const toMs = (d) => (d instanceof Date ? d.getTime() : Date.parse(d));

/** The formatted list shape: dates as ISO strings, `id` alongside `_id`. */
function formatted(doc) {
  return { ...doc, id: doc._id, dispatchedAt: iso(doc.dispatchedAt), resolvedAt: iso(doc.resolvedAt) };
}

/** The raw scalar projection the founder lookup reads. */
function scalar(doc) {
  return {
    _id: doc._id,
    rootItemId: doc.rootItemId,
    status: doc.status,
    abort: doc.abort,
    kind: doc.kind,
    issueIdentifier: doc.issueIdentifier,
    dispatchedAt: doc.dispatchedAt,
  };
}

/** A value for comparison: a Date or an ISO instant as its epoch ms, anything else as it is. */
function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return value;
}

/**
 * Whether a doc matches a Mongo-style filter. Supports equality and the operators the production readers
 * send ($gte, $gt, $lt, $lte, $in, $ne); any other operator throws, so an unmodelled reader is seen, not
 * silently answered.
 */
export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = comparable(doc[key]);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        const want = comparable(arg);
        if (op === '$gte') return value !== undefined && value >= want;
        if (op === '$gt') return value !== undefined && value > want;
        if (op === '$lt') return value !== undefined && value < want;
        if (op === '$lte') return value !== undefined && value <= want;
        if (op === '$in') return arg.includes(doc[key]);
        if (op === '$ne') return doc[key] !== arg;
        throw new Error(`cost-replay fake: unsupported operator ${op} on ${key}`);
      });
    }
    return value === comparable(cond);
  });
}

/** A fake dispatch store over the corpus: the list reads, plus the founder lookup. */
export function makeDispatchStore(corpus) {
  const byRoot = (docs, root) => (root && typeof root === 'object' && root.$in
    ? docs.filter(d => root.$in.includes(d.rootItemId))
    : docs.filter(d => d.rootItemId === root));

  const select = (docs, opts = {}) => {
    let out = docs.filter(d => d.urlKey === URL_KEY);
    if (opts.rootItemId !== undefined) out = byRoot(out, opts.rootItemId);
    if (opts.issueIdentifier !== undefined) out = out.filter(d => d.issueIdentifier === opts.issueIdentifier);
    if (opts.since) out = out.filter(d => toMs(d.dispatchedAt) >= toMs(opts.since));
    return out.sort((a, b) => toMs(b.resolvedAt) - toMs(a.resolvedAt));
  };

  const page = (docs, opts = {}) => {
    const matched = select(docs, opts);
    const items = (opts.limit ? matched.slice(0, opts.limit) : matched).map(formatted);
    return { items, total: matched.length };
  };

  return {
    async listItems(urlKey, opts = {}) {
      return select(corpus.queue, opts).map(formatted);
    },
    async listHistory(urlKey, opts = {}) {
      return page(corpus.history, opts);
    },
    async listHistoryWithBodies(urlKey, opts = {}) {
      return page(corpus.history, opts);
    },
    /** The founder lookup's shape (LIN-4177): raw scalar docs over history and queue, uncapped. */
    async lineageIdentityRows(urlKey, { anchors, issueIdentifier } = {}) {
      const docs = [...corpus.history, ...corpus.queue].filter(d => d.urlKey === urlKey);
      const hit = anchors !== undefined
        ? docs.filter(d => anchors.includes(d.rootItemId))
        : docs.filter(d => d.issueIdentifier === issueIdentifier);
      return hit.map(scalar);
    },
  };
}

/** A fake call-log collection: `find(query).toArray()` over the corpus's call docs. */
export function makeCallCollection(corpus) {
  return {
    find(query = {}) {
      const docs = corpus.calls.filter(c => matches(c, query));
      return { toArray: async () => docs };
    },
  };
}

/** The Express app `/api/proxy/cost/:identifier` is served from (the route test's harness shape). */
export function buildCostApp(store, callCollection, requestUsageLoader) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'replay', scope: 'read', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'replay-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'replay-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: store,
    requestUsageLoader,
    llmCallLogStore: new LlmCallLogStore({ collection: callCollection }),
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

/** One GET against an app built by `buildCostApp`, on a loopback port. */
export async function getJson(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer replay' } });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** The anchors (rootItemId) of a set of rows, deduplicated. */
const anchorsOf = (rows) => [...new Set(rows.map(r => r.rootItemId ?? r._id ?? r.id).filter(Boolean))];

/**
 * The mixed-harness tally (plan W3): lineages in the fetched rows whose counted usage mixes an
 * opencode delta with a running total. Read from the same usage the fold reads.
 */
function mixedHarnessTally(rows) {
  const byRoot = new Map();
  for (const row of rows) {
    const root = row.rootItemId ?? row.id;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(row);
  }
  const mixed = [];
  for (const [root, members] of byRoot) {
    const usages = members.map(m => parseUsage(m.feedback)).filter(Boolean);
    const hasDelta = usages.some(u => !isRunningTotal(u));
    const hasTotal = usages.some(u => isRunningTotal(u));
    if (hasDelta && hasTotal) mixed.push(root);
  }
  return mixed.sort();
}

/**
 * A fake collection over raw docs: `find`, `countDocuments`, `findOne`. `project` (optional) is applied to
 * each found doc, as a real projection is: the filter always runs on the whole doc.
 */
function fakeCollection(docs, project = doc => doc) {
  return {
    find(filter = {}) {
      return { toArray: async () => docs.filter(d => matches(d, filter)).map(project) };
    },
    async countDocuments(filter = {}) {
      return docs.filter(d => matches(d, filter)).length;
    },
    async findOne(filter = {}) {
      return docs.find(d => matches(d, filter)) ?? null;
    },
  };
}

/**
 * The collections `collectWorkspaceKpis` reads, over the corpus: dispatch history and queue are the
 * corpus's rows; the proxy, agent-status, report, prompt, close-out and rollup collections are empty.
 */
function workspaceKpiCollections(corpus) {
  return {
    dispatchQueue: fakeCollection(corpus.queue),
    dispatchHistory: fakeCollection(corpus.history),
    proxyEvents: fakeCollection([]),
    agentStatus: fakeCollection([]),
    reportHistory: fakeCollection([]),
    customPrompts: fakeCollection([]),
    closeOutEvents: fakeCollection([]),
    kpiDailyRollup: fakeCollection([]),
  };
}

/**
 * The run page's loops for one session: the hand-built corpus rows (the filler exists for S1's cap and
 * S5's row cap, and is left out here), mapped to the loop fields `buildRunView` reads.
 */
function sessionLoops(corpus) {
  return [...corpus.history, ...corpus.queue]
    .filter(row => !/^f(42|99)-/.test(row._id))
    .map(row => ({
      loopId: row._id,
      lineageId: row.rootItemId,
      kind: row.kind,
      status: row.status,
      terminalStatus: row.status === 'taken' && !row.abort ? 'done' : null,
      dispatchedAt: iso(row.dispatchedAt),
      feedback: row.feedback,
    }));
}

/**
 * The corpus's request records as the store's loader returns them (LIN-4201): `corpus.requestRecords` maps a lineage
 * anchor (the row that posted them) to its records. Each is stamped with that anchor as `rootItemId` (the posting
 * row's CURRENT anchor, as listForAnchors relabels), the posting row as `itemId`, the workspace, and the producer's
 * harness: every corpus record is a claude-code transcript's.
 */
export function requestRecordsOf(corpus) {
  return Object.entries(corpus.requestRecords || {}).flatMap(([anchor, records]) =>
    records.map(record => ({ harness: 'claude-code', ...record, rootItemId: anchor, itemId: anchor, urlKey: URL_KEY })));
}

/**
 * Run every replayed surface over a fresh corpus. Pure except for the in-memory fakes. `corpusOverride`
 * runs the same surfaces over another corpus of the same shape (the S1 = S5 witness uses a sub-selection).
 * `readRecords` (LIN-4201): serve the corpus's request records through the loader. Off, the loader holds none, and
 * every surface reads exactly what it read before the cutover (the recorded baselines).
 */
export async function runReplay(corpusOverride, { readRecords = false } = {}) {
  const realNow = Date.now;
  Date.now = () => NOW_MS;
  try {
    const corpus = corpusOverride ?? buildCorpus();
    const store = makeDispatchStore(corpus);
    const callCollection = makeCallCollection(corpus);
    // LIN-4201: every surface reads its request records through the one loader, as production does.
    const requestUsageLoader = readRecords ? loaderOver(requestRecordsOf(corpus)) : NO_REQUEST_RECORDS;
    const app = buildCostApp(store, callCollection, requestUsageLoader);
    const llmStore = new LlmCallLogStore({ collection: callCollection });
    const now = new Date(NOW_MS);
    const out = {};

    // S1: the issue cost route, one request per issue.
    out.S1 = {};
    for (const issue of REPLAY_ISSUES) {
      const { status, body } = await getJson(app, `/api/proxy/cost/${issue}`);
      out.S1[issue] = { status, body };
    }

    // S2 / S3: the workspace calls total, read by Health (settings) and by the Biscuit's Weather line: the store's
    // docs, summed by the one calls read (LIN-4179).
    out.S2 = callsSurfaceOf(await llmStore.listInHorizon(URL_KEY));
    out.S3 = callsSurfaceOf(await llmStore.listInHorizon(URL_KEY));

    // S4: the scan estimate Observation renders, from the scan feature's docs.
    out.S4 = scanEstimateOf(await llmStore.listInHorizon(URL_KEY, { feature: 'scan' }));

    // S5 / S6 / S8 / S9 share the 30-day models read, capped at its own row limit. The read carries the
    // founder lookup for its own lineages, and the cost read over them (LIN-4226: the page carries the read's
    // `workerSessions`; the spend readers take those, as the Settings and decision routes do).
    const history = await readModelsHistory(store, URL_KEY, requestUsageLoader);
    const { workerSessions } = history;
    const callDocs = corpus.calls.filter(c => c.urlKey === URL_KEY && toMs(c.timestamp) >= toMs(readHorizonStart(now)));

    const agentSpend = agentSpendByJob(workerSessions, { jobs: AGENT_JOBS });
    out.S5 = {
      total: history.total,
      rows: history.items.length,
      truncated: history.total > history.items.length,
      jobs: agentSpend,
    };

    out.S6 = Object.fromEntries(AGENT_JOBS.map(job => [job, typicalByModel(workerSessions, { job })]));

    // S7: Harbour-call spend per job, over the calls in the horizon (the store's own read).
    const horizonCalls = await llmStore.listInHorizon(URL_KEY);
    out.S7 = harbourSpendByJob(horizonCalls, { jobs: HARBOUR_JOBS_SPEND });

    const harbourSpend = harbourSpendByJob(callDocs, { jobs: HARBOUR_JOBS });
    out.S8 = spendByEffectiveModel([...agentSpend, ...harbourSpend], corpus.effective);

    out.S9 = Object.fromEntries(AGENT_JOBS.map(kind => [kind, {
      spend: agentSpendByJob(workerSessions, { jobs: [kind] })[0],
      typicals: typicalByModel(workerSessions, { job: kind }),
    }]));

    // S10: the effort read-out's cost columns over the 200 newest resolved history rows. Its identity is
    // the founder lookup over every row the page reads (computeWorkspaceEffortReadout's own anchors).
    const liveRows = await store.listItems(URL_KEY, {});
    const historyRows = (await store.listHistory(URL_KEY, { limit: 200 })).items;
    const effortIdentity = await store.lineageIdentityRows(URL_KEY, { anchors: anchorsOf([...liveRows, ...historyRows]) });
    // LIN-4226: the read loads the records itself, through the source (no preload here).
    out.S10 = await computeEffortReadout({
      liveRows,
      historyRows,
      historyTotal: historyRows.length,
      issueContext: new Map(),
      asOf: now,
      survivalAvailable: false,
      gateFieldsAvailable: false,
      identityRows: effortIdentity,
      requestSource: requestUsageLoader,
      urlKey: URL_KEY,
    });

    // S11: the public KPI's cost per finished ticket. Production feeds it the rows `loadDispatchHistory`
    // reads on the 30-day horizon (kpi-stats.js readSources), and the founder lookup over those lineages
    // (lib/dispatch-store.js lineageIdentityOfRows, over the raw collections). The baseline (9e397e6b) was recorded on the same
    // horizon-filtered rows; an unfiltered corpus is not what `/kpis` sees.
    const horizonRows = [...corpus.history, ...corpus.queue].filter(r => toMs(r.dispatchedAt) >= toMs(readHorizonStart(now)));
    const founders = await lineageIdentityOfRows([
      fakeCollection(corpus.history, scalar),
      fakeCollection(corpus.queue, scalar),
    ], horizonRows);
    // LIN-4226: the lineage records come from the one cost read, through the source (scoped to this workspace, as the
    // harness always read them); the terminal figures take them.
    const s11CostLineages = await lineageRecords({
      fetchedRows: horizonRows,
      identityRows: founders,
      requestSource: requestUsageLoader,
      urlKey: URL_KEY,
      outcomes: groupDispatchLineages(horizonRows),
    });
    out.S11 = computeTerminalMarkedTaskCost(horizonRows, now, { costLineages: s11CostLineages });

    // S12: the workspace KPIs' cost per day (and the rest of the dashboard's figures).
    out.S12 = await collectWorkspaceKpis({ collections: workspaceKpiCollections(corpus), urlKey: URL_KEY, now, requestUsageLoader });

    // S13: the run page's loops for one session, grouped by lineage, with each lineage's cost.
    const runSession = { sessionId: 'replay-main', seedIssue: 'LIN-1', loops: sessionLoops(corpus) };
    out.S13 = await buildRunView(runSession, { now, requestSource: requestUsageLoader, urlKey: URL_KEY });

    // The mixed-harness tally over the whole 30-day window (uncapped), as the plan asks.
    const windowRows = (await store.listHistory(URL_KEY, { since: readHorizonStart(now) })).items;
    out.mixedHarness = { lineages: mixedHarnessTally(windowRows) };

    return JSON.parse(JSON.stringify(out));
  } finally {
    Date.now = realNow;
  }
}
