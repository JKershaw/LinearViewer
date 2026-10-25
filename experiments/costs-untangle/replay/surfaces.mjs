// Surface table: one adapter per cost surface the judge compares. Each adapter
// calls the production functions of ONE side's tree (loaded by absolute path
// from that side's snapshot, so a side's modules import each other and never
// the checkout) and returns a plain value; `side.mjs` canonicalises it.
//
// Adapters take the scenario as recorded data. They are the judge's only
// window into the code: a site the expected-surface table names but no adapter
// calls is a blind spot, reported as such, never silently passed.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { memCollection } from '../../replay-kit/lib/gen-kit.mjs';

export async function loadTree(tree) {
  const at = rel => import(pathToFileURL(path.join(tree, rel)).href);
  const [modelPricing, sessionTelemetry, dispatchLineage, taskCost, termCost, weekly, llmLog, readHorizon] = await Promise.all([
    at('lib/model-pricing.js'),
    at('lib/session-telemetry.js'),
    at('lib/dispatch-lineage.js'),
    at('lib/task-cost.js'),
    at('lib/terminal-marked-task-cost.js'),
    at('lib/weekly-budget.js'),
    at('lib/llm-call-log.js'),
    at('lib/read-horizon.js'),
  ]);
  const proxy = await at('routes/proxy.js');
  return { modelPricing, sessionTelemetry, dispatchLineage, taskCost, termCost, weekly, llmLog, readHorizon, proxy };
}

export const URL_KEY = 'wk';

/** Recorded ISO strings → Dates for the call-log store (the production row shape). */
function callDocs(calls) {
  return calls.map(c => ({ ...c, timestamp: new Date(c.timestamp), urlKey: URL_KEY }));
}

function storeOver(m, sc) {
  const fail = sc.callLogFail ? { find: sc.callLogFail, toArray: sc.callLogFail } : {};
  return new m.llmLog.LlmCallLogStore({ collection: memCollection(callDocs(sc.calls), { flavour: 'mango', fail }) });
}

/**
 * The formatted row `buildTaskCost` takes (the `/dispatch` list route's shape,
 * which carries `id`; the raw store row carries `_id` only). Without it,
 * `anchorFor` yields undefined for a root row and the lineage silently drops out
 * of the join, so the judge would not be measuring what the route measures.
 */
export function formatted(r) {
  return { ...r, id: r.id ?? String(r._id) };
}

/** One ticket's /cost-style inputs: its own rows, and lineage siblings batched by anchor, unscoped. */
export function ticketRows(m, sc, ticket) {
  const anchorOf = r => m.taskCost.anchorFor(r);
  const own = sc.rows.filter(r => r.issueIdentifier === ticket).map(formatted);
  const anchors = new Set(own.filter(r => r.status === 'taken').map(anchorOf).filter(Boolean));
  const siblings = new Map();
  for (const r of sc.rows.map(formatted)) {
    const a = anchorOf(r);
    if (!anchors.has(a)) continue;
    if (!siblings.has(a)) siblings.set(a, []);
    siblings.get(a).push(r);
  }
  return { own, siblings };
}

/** Synchronous surfaces: id → (mods, scenario) → value. */
export const SYNC_SURFACES = {
  rate: (m, sc) => sc.models.map(raw => {
    const id = m.modelPricing.resolveWorkerModelId(raw);
    const rate = m.modelPricing.getModelRate(id);
    return {
      raw, id, rate,
      display: m.modelPricing.getDisplayPricing(id),
      forPrompt: sc.promptSizes.map(n => m.modelPricing.selectRateForPrompt(rate, n)),
    };
  }),
  usage: (m, sc) => ({
    priced: sc.usages.map(u => m.modelPricing.computeUsageCostUsd(u)),
    parsed: sc.rows.map(r => m.sessionTelemetry.parseUsage(r.feedback)),
  }),
  lineage: (m, sc) => [...m.dispatchLineage.groupDispatchLineages(sc.rows)].map(([key, v]) => ({ key, ...v })),
  termMarked: (m, sc) => m.termCost.computeTerminalMarkedTaskCost(sc.rows, new Date(sc.now)),
  gauge: (m, sc) => m.weekly.computeWeeklyBudgetGauge(sc.rows, new Date(sc.now), sc.env),
};

/** Asynchronous surfaces: the call-log store reads through the collection's cursor. */
export const ASYNC_SURFACES = {
  taskCost: async (m, sc) => {
    const store = storeOver(m, sc);
    const out = [];
    for (const ticket of sc.tickets) {
      const since = m.readHorizon.readHorizonStart(new Date(sc.now));
      const appSummary = await store.summarizeByIssue(URL_KEY, ticket, { since });
      const { own, siblings } = ticketRows(m, sc, ticket);
      out.push({ ticket, cost: m.taskCost.buildTaskCost({ ownRows: own, siblingRowsByAnchor: siblings, appSummary }) });
    }
    return out;
  },
  callLog: async (m, sc) => {
    const store = storeOver(m, sc);
    const out = { summarize: await store.summarize(URL_KEY), byIssue: [], byFeature: [] };
    for (const t of sc.tickets) out.byIssue.push(await store.summarizeByIssue(URL_KEY, t));
    for (const f of sc.features) out.byFeature.push(await store.summarizeByFeature(URL_KEY, f));
    return out;
  },
};

/**
 * A dispatch store with the production query semantics the /cost route relies on:
 * every filter in one query is ANDed (issueIdentifier, rootItemId $in, dispatchedAt
 * since), `total` counts before `limit`, and `projection` is ignored (the route only
 * strips prompts). Rows are the formatted shape, as the route's listHistory returns.
 */
function dispatchStoreOver(sc, now, since) {
  const fmt = sc.rows.map(formatted);
  const matches = (r, o) =>
    (o.issueIdentifier === undefined || r.issueIdentifier === o.issueIdentifier) &&
    (o.rootItemId === undefined || (Array.isArray(o.rootItemId.$in) && o.rootItemId.$in.includes(r.rootItemId))) &&
    (o.since === undefined || new Date(r.dispatchedAt).getTime() >= new Date(o.since).getTime());
  return {
    async listItems(_urlKey, o = {}) {
      return fmt.filter(r => r.status === 'queued' && matches(r, o));
    },
    async listHistory(_urlKey, o = {}) {
      const hit = fmt.filter(r => r.status !== 'queued' && matches(r, o));
      const items = o.limit ? hit.slice(0, o.limit) : hit;
      return { items, total: hit.length };
    },
  };
}

/** The /cost endpoint over HTTP through the same proxy app the proxy cost-route test builds. */
async function costOverHttp(m, sc, ticket) {
  const express = (await import('express')).default;
  const dispatchQueueStore = dispatchStoreOver(sc, sc.now, null);
  const llmCallLogStore = storeOver(m, sc);
  const app = express();
  app.use(express.json());
  app.use(m.proxy.createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'judge', scope: 'read', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'judge-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'judge-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    llmCallLogStore,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/issues/${ticket}/cost`, { headers: { Authorization: 'Bearer judge' } });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { $raw: text }; }
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// Judge the route's JSON only; the body is what a caller reads.
ASYNC_SURFACES.cost = async (m, sc) => {
  const out = [];
  for (const ticket of sc.tickets) out.push({ ticket, ...(await costOverHttp(m, sc, ticket)) });
  return out;
};

export const SURFACE_IDS = [...Object.keys(SYNC_SURFACES), ...Object.keys(ASYNC_SURFACES)];
