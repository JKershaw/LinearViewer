/**
 * LIN-4177: runs every cost surface the replay covers over the fixture corpus (corpus.js) and
 * returns one JSON-stable object. `scripts/cost-replay.mjs` records it as the goldens and checks
 * the current code against them; `tests/unit/cost-replay.test.js` pins the same run.
 *
 * The surfaces are called through their real entry points, so the same harness runs against the
 * code before and after the change:
 *  - S1  `/api/proxy/cost/:identifier`, through `createProxyRoutes` (routes/proxy.js) over Express.
 *  - S5  `readModelsHistory` (the 30-day read, capped), then `agentSpendByJob`.
 *  - S6  `typicalByModel` per job (the decision panel's per-model typicals).
 *  - S8  `spendByEffectiveModel` over the agent and Harbour-call spend.
 *  - S9  the dispatch decision panel's per-kind read (`agentSpendByJob` + `typicalByModel`, one kind).
 *  - S10 `computeEffortReadout`'s cost columns (200 newest resolved history rows, as the route reads).
 *
 * The fake store serves the corpus in the two shapes the real store serves: formatted list rows
 * (`listHistory`, `listItems`) and raw scalar docs (`lineageIdentityRows`, the founder lookup).
 */
import express from 'express';
import { createProxyRoutes } from '../../../routes/proxy.js';
import { LlmCallLogStore } from '../../../lib/llm-call-log.js';
import { readModelsHistory } from '../../../lib/model-routing-history.js';
import { agentSpendByJob, typicalByModel, harbourSpendByJob, spendByEffectiveModel } from '../../../lib/model-routing-spend.js';
import { computeEffortReadout } from '../../../lib/effort-readout.js';
import { parseUsage } from '../../../lib/session-telemetry.js';
import { isRunningTotal } from '../../../lib/row-usage.js';
import { readHorizonStart } from '../../../lib/read-horizon.js';
import { buildCorpus, NOW_MS, REPLAY_ISSUES, REPLAY_JOBS } from './corpus.js';

const URL_KEY = 'acme';
const AGENT_JOBS = REPLAY_JOBS.filter(j => j !== 'proxy-x');
const HARBOUR_JOBS = ['proxy-x'];

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
function makeCallCollection(corpus) {
  return {
    find(query = {}) {
      let docs = corpus.calls.filter(c => c.urlKey === query.urlKey);
      if (query.issueIdentifier !== undefined) docs = docs.filter(c => c.issueIdentifier === query.issueIdentifier);
      if (query.timestamp && query.timestamp.$gte) docs = docs.filter(c => toMs(c.timestamp) >= toMs(query.timestamp.$gte));
      return { toArray: async () => docs };
    },
  };
}

/** The Express app `/api/proxy/cost/:identifier` is served from (the route test's harness shape). */
export function buildCostApp(store, callCollection) {
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
    llmCallLogStore: new LlmCallLogStore({ collection: callCollection }),
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function getJson(app, path) {
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

/** Run every replayed surface over a fresh corpus. Pure except for the in-memory fakes. */
export async function runReplay() {
  const realNow = Date.now;
  Date.now = () => NOW_MS;
  try {
    const corpus = buildCorpus();
    const store = makeDispatchStore(corpus);
    const callCollection = makeCallCollection(corpus);
    const app = buildCostApp(store, callCollection);
    const out = {};

    // S1: the issue cost route, one request per issue.
    out.S1 = {};
    for (const issue of REPLAY_ISSUES) {
      const { status, body } = await getJson(app, `/api/proxy/cost/${issue}`);
      out.S1[issue] = { status, body };
    }

    // S5 / S6 / S8 / S9 share the 30-day models read, capped at its own row limit.
    const history = await readModelsHistory(store, URL_KEY);
    const identityRows = await store.lineageIdentityRows(URL_KEY, { anchors: anchorsOf(history.items) });
    const callDocs = corpus.calls.filter(c => c.urlKey === URL_KEY && toMs(c.timestamp) >= toMs(readHorizonStart(NOW_MS)));

    const agentSpend = agentSpendByJob(history.items, { jobs: AGENT_JOBS, identityRows });
    out.S5 = {
      total: history.total,
      rows: history.items.length,
      truncated: history.total > history.items.length,
      jobs: agentSpend,
    };

    out.S6 = Object.fromEntries(AGENT_JOBS.map(job => [job, typicalByModel(history.items, { job, identityRows })]));

    const harbourSpend = harbourSpendByJob(callDocs, { jobs: HARBOUR_JOBS });
    out.S8 = spendByEffectiveModel([...agentSpend, ...harbourSpend], corpus.effective);

    out.S9 = Object.fromEntries(AGENT_JOBS.map(kind => [kind, {
      spend: agentSpendByJob(history.items, { jobs: [kind], identityRows })[0],
      typicals: typicalByModel(history.items, { job: kind, identityRows }),
    }]));

    // S10: the effort read-out's cost columns over the 200 newest resolved history rows.
    const liveRows = await store.listItems(URL_KEY, {});
    const historyRows = (await store.listHistory(URL_KEY, { limit: 200 })).items;
    const effortIdentity = await store.lineageIdentityRows(URL_KEY, { anchors: anchorsOf([...liveRows, ...historyRows]) });
    out.S10 = computeEffortReadout({
      liveRows,
      historyRows,
      historyTotal: historyRows.length,
      issueContext: new Map(),
      asOf: new Date(NOW_MS),
      survivalAvailable: false,
      gateFieldsAvailable: false,
      identityRows: effortIdentity,
    });

    // The mixed-harness tally over the whole 30-day window (uncapped), as the plan asks.
    const windowRows = (await store.listHistory(URL_KEY, { since: readHorizonStart(NOW_MS) })).items;
    out.mixedHarness = { lineages: mixedHarnessTally(windowRows) };

    return JSON.parse(JSON.stringify(out));
  } finally {
    Date.now = realNow;
  }
}
