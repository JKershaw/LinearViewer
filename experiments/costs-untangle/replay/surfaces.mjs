// Surface table: one adapter per cost surface the judge compares. Each adapter
// calls the production functions of ONE side's tree (loaded by absolute path
// from that side's snapshot, so a side's modules import each other and never
// the checkout) and returns a plain value; `side.mjs` canonicalises it.
//
// Adapters take the scenario as recorded data. They are the judge's only
// window into the code: a site the expected-surface table names but no adapter
// calls is a blind spot, reported as such, never silently passed.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { memCollection } from '../../replay-kit/lib/gen-kit.mjs';
import { URL_KEY } from './gen.mjs';

export { URL_KEY };

export async function loadTree(tree) {
  const at = rel => import(pathToFileURL(path.join(tree, rel)).href);
  const [
    modelPricing, sessionTelemetry, dispatchLineage, taskCost, termCost, weekly, llmLog, readHorizon,
    openrouter, catalog, effort, pipeline, runView, obs, spend, modelRouting, llmJobs,
    renderSettings, renderSettingsModels, renderEffort, renderSession, workspaceKpi, renderWorkspaceKpis,
    kpi, renderKpis, renderObservation,
  ] = await Promise.all([
    at('lib/model-pricing.js'),
    at('lib/session-telemetry.js'),
    at('lib/dispatch-lineage.js'),
    at('lib/task-cost.js'),
    at('lib/terminal-marked-task-cost.js'),
    at('lib/weekly-budget.js'),
    at('lib/llm-call-log.js'),
    at('lib/read-horizon.js'),
    at('lib/openrouter.js'),
    at('lib/openrouter-catalog.js'),
    at('lib/effort-readout.js'),
    at('lib/pipeline-loops.js'),
    at('lib/run-view.js'),
    at('lib/observation-sessions-store.js'),
    at('lib/model-routing-spend.js'),
    at('lib/model-routing.js'),
    at('lib/llm-jobs.js'),
    at('lib/render-settings.js'),
    at('lib/render-settings-models.js'),
    at('lib/render-effort-readout.js'),
    at('lib/render-session.js'),
    at('lib/workspace-kpi-stats.js'),
    at('lib/render-workspace-kpis.js'),
    at('lib/kpi-stats.js'),
    at('lib/render-kpis.js'),
    at('lib/render-observation.js'),
  ]);
  const proxy = await at('routes/proxy.js');
  return {
    modelPricing, sessionTelemetry, dispatchLineage, taskCost, termCost, weekly, llmLog, readHorizon,
    openrouter, catalog, effort, pipeline, runView, obs, spend, modelRouting, llmJobs, proxy,
    renderSettings, renderSettingsModels, renderEffort, renderSession, workspaceKpi, renderWorkspaceKpis,
    kpi, renderKpis, renderObservation,
  };
}

/**
 * A rendered page, compared by its exact bytes (SHA-256 of the HTML), with the USD figures it
 * shows beside the hash so a difference reads as a figure. A hash is exact: one changed character
 * is a difference, the same as a changed number.
 */
function htmlOut(html) {
  return {
    bytes: html.length,
    sha256: createHash('sha256').update(html).digest('hex'),
    usd: [...html.matchAll(/\$[\d.,]+/g)].map(x => x[0]),
    // A page can carry its figures as data for its script (the observation page's __OBSERVATION_DATA__):
    // a numeric cost field embedded in the markup counts as a shown figure too.
    embedded: [...html.matchAll(/"\w*(?:Usd|Cost|cost)\w*":-?\d[\d.e-]*/g)].map(x => x[0]),
  };
}

/**
 * A record as the production store hands it back: its instants are Dates. A scenario records them as
 * ISO strings (JSON carries no Date), and a collection compares a `$gte` bound against a Date, so a
 * string never matches and the page would read an empty workspace. Only the collection-backed readers
 * take this shape; the pure builders keep the strings the /dispatch JSON carries.
 */
const INSTANT_KEY = /(At|timestamp)$/;
function storeShape(value) {
  if (Array.isArray(value)) return value.map(storeShape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [
      k, INSTANT_KEY.test(k) && typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : storeShape(v),
    ]));
  }
  return value;
}

/** The workspace's collections for the KPI loaders: the dispatch rows in store shape, every other collection empty. */
function kpiCollections(sc) {
  const docs = sc.rows.map(r => storeShape({ ...r, urlKey: URL_KEY }));
  const empty = () => memCollection([], { flavour: 'mango' });
  // The rollup's marker read (`findOne`) finds no marker: a fresh instance has no completed day yet.
  const rollup = Object.assign(empty(), { findOne: async () => null });
  return {
    dispatchQueue: memCollection(docs.filter(r => r.status === 'queued'), { flavour: 'mango' }),
    dispatchHistory: memCollection(docs.filter(r => r.status !== 'queued'), { flavour: 'mango' }),
    sessions: empty(), userPreferences: empty(), workspacePreferences: empty(), customPrompts: empty(),
    localIssues: empty(), dispatchTokens: empty(), proxyTokens: empty(), proxyEvents: empty(),
    agentStatus: empty(), freeTier: empty(), recapCache: empty(), briefCache: empty(),
    reportHistory: empty(), closeOutEvents: empty(), kpiDailyRollup: rollup,
  };
}

/** The workspace's sessions as the run view builds them (the production loop builder over the judge's dispatch store). */
async function sessionsOf(m, sc) {
  const dispatchStore = dispatchStoreOver(sc, sc.now, null);
  const agentStatusStore = { listStatus: async () => ({ items: [] }) };
  return m.pipeline.getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore });
}

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

/**
 * Seed the live catalog cache the way a fetch would, through the module's own
 * test seam: no network, and the same cache the picker's hint reads.
 */
function seedCatalog(m, sc) {
  m.catalog._setCatalogCacheForTests({ at: new Date(sc.now), models: sc.catalog || [] });
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
  // The picker's price hint: the curated row, then the rate card, then the cached catalog.
  pricingHint: (m, sc) => {
    seedCatalog(m, sc);
    return sc.models.map(id => m.openrouter.getModelPricingHint(id));
  },
  // The effort read-out's per-kind and per-group cost sums, over the same rows the /dispatch list holds.
  effort: (m, sc) => m.effort.computeEffortReadout({ historyRows: sc.rows.map(formatted), asOf: sc.now }),
  // The effort read-out page (S8): the cost per kind and per group, as the page sums and shows them.
  effortHtml: (m, sc) => htmlOut(m.renderEffort.renderEffortReadoutPage('Workspace', {
    urlKey: URL_KEY, readout: SYNC_SURFACES.effort(m, sc), generatedAt: sc.now,
  })),
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
  // Calls as the server writes them: each goes through `record()` (no collection, so the
  // stored doc is the returned doc), and the doc's `cost` is what a later read sums.
  callRecord: async (m, sc) => {
    const store = new m.llmLog.LlmCallLogStore({});
    const out = [];
    for (const c of sc.calls) {
      const { _id, ...doc } = await store.record({ ...c, urlKey: URL_KEY });
      out.push(doc);
    }
    return out;
  },
  // The Settings › Models spend per job, over the read window: agent runs from the
  // /dispatch history, Harbour calls from the call log's `listInHorizon`. Unsorted: the
  // page's order is the renderer's (see modelsHtml).
  spendByJob: async (m, sc) => {
    const store = storeOver(m, sc);
    const dispatch = dispatchStoreOver(sc, sc.now, null);
    // The route's `safeRead`: a failed read shows an empty spend, never a page error (routes/settings.js).
    const items = await dispatch.listHistoryWithBodies(URL_KEY, { since: m.readHorizon.readHorizonStart(new Date(sc.now)), limit: 500 })
      .then(r => r.items, () => []);
    const calls = await store.listInHorizon(URL_KEY).catch(() => []);
    return {
      agent: m.spend.agentSpendByJob(items, { jobs: m.modelRouting.AGENT_JOB_IDS }),
      harbour: m.spend.harbourSpendByJob(calls, { jobs: m.modelRouting.HARBOUR_JOB_IDS }),
    };
  },
  // The observation feed's stored sessions, as the store serves them (a doc from another builder version is a miss).
  observationStored: async (m, sc) => {
    const store = new m.obs.ObservationSessionsStore({ collection: memCollection(sc.stored, { flavour: 'mango' }) });
    return store.findByWorkspace(URL_KEY);
  },
  // Each run's cost, through the production loop builder over the same dispatch store the /dispatch list reads.
  run: async (m, sc) => (await sessionsOf(m, sc)).map(s => m.runView.buildRunView(s, { now: new Date(sc.now) })),
  // Rendered pages. Each is built from the same inputs its figures come from, through the page's own renderer.
  // Settings › Health: "Harbour's AI calls" (S2), from the call log's summary.
  healthHtml: async (m, sc) => {
    const llmStats = await storeOver(m, sc).summarize(URL_KEY);
    return htmlOut(m.renderSettings.renderSettingsPage('Workspace', { area: 'health', urlKey: URL_KEY, llmStats, providerContextSummary: {}, now: Date.parse(sc.now) }));
  },
  // Settings › Models (S6): the per-job spend as the page orders and totals it.
  modelsHtml: async (m, sc) => {
    const spend = await ASYNC_SURFACES.spendByJob(m, sc);
    const table = m.modelRouting.emptyTable();
    const effective = m.modelRouting.effectiveTable(table, { defaultModel: m.openrouter.DEFAULT_MODEL });
    return htmlOut(m.renderSettingsModels.modelsBody({
      urlKey: URL_KEY, table, effective, agentSpend: spend.agent, harbourSpend: spend.harbour,
      presets: [], log: [], catalog: [], availableModels: [], filter: 'all',
      coverage: { windowRuns: sc.rows.length, capped: false },
    }));
  },
  // The run page (S9): each session's page, with its step costs and header total.
  sessionHtml: async (m, sc) => {
    const sessions = await sessionsOf(m, sc);
    return sessions.map(session => htmlOut(m.renderSession.renderSessionPage(
      { session, sessionId: session.sessionId || '', urlKey: URL_KEY },
      { now: new Date(sc.now) },
    )));
  },
  // The workspace KPIs (S7): the 30-day API-equivalent cost per day, through the production aggregation.
  workspaceKpisHtml: async (m, sc) => {
    const stats = await m.workspaceKpi.collectWorkspaceKpis({ collections: kpiCollections(sc), urlKey: URL_KEY, now: new Date(sc.now) });
    return htmlOut(m.renderWorkspaceKpis.renderWorkspaceKpisPage('Workspace', { urlKey: URL_KEY, workspaces: [], featureFlags: {}, stats }));
  },
  // The public /kpis page (S3): the cost per finished task, through collectKpiStats and the public projection.
  publicKpisHtml: async (m, sc) => {
    const c = kpiCollections(sc);
    const stats = await m.kpi.collectKpiStats(c, {
      now: new Date(sc.now),
      milestoneFunnelDeps: { dispatchQueue: c.dispatchQueue, dispatchHistory: c.dispatchHistory, closeOutEventsStore: null, accountStore: null, accountWorkspaceStore: null, taskModeStore: null },
    });
    return htmlOut(m.renderKpis.renderKpisPage(m.kpi.toPublicKpis(stats), {}));
  },
  // The observation feed's due-scan estimate (S10): the 30-day mean the page states.
  observationHtml: async (m, sc) => {
    const scanCostEstimate = await storeOver(m, sc).summarizeByFeature(URL_KEY, 'scan');
    return htmlOut(m.renderObservation.renderObservationPage({ workspaces: [] }, { urlKey: URL_KEY, scanCostEstimate }));
  },
  // OpenRouter's streamed usage: the final chunk's `usage` becomes the call's `cost` in the
  // recorded call and the `done` event. One streamed call per recorded usage.
  openrouterUsage: async (m, sc) => {
    const out = [];
    for (const usage of sc.orUsages) out.push(await openRouterCall(m, usage));
    return out;
  },
};

/** One streamed OpenRouter call through the production `streamChat`, its transport and recorder injected. */
async function openRouterCall(m, usage) {
  const chunks = [
    `data: ${JSON.stringify({ model: 'anthropic/claude-sonnet-4.6', provider: 'Anthropic', choices: [{ delta: { content: 'ok' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], ...(usage === null ? {} : { usage }) })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const body = (async function* () { yield* chunks; })();
  const recorded = [];
  const done = [];
  m.openrouter.setFetchImpl(async () => ({ ok: true, body }));
  m.openrouter.setLlmCallRecorder(call => { recorded.push(call); });
  try {
    await m.openrouter.streamChat(
      [{ role: 'user', content: 'judge' }],
      { apiKey: 'judge-key', model: 'anthropic/claude-sonnet-4.6', callMeta: { urlKey: URL_KEY, feature: 'scan', issueIdentifier: 'LIN-101' } },
      (type, data) => { if (type === 'done') done.push(data); },
    );
  } finally {
    m.openrouter.setFetchImpl(null);
    m.openrouter.setLlmCallRecorder(null);
  }
  return { done, recorded };
}

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
  const history = async (_urlKey, o = {}) => {
    const hit = fmt.filter(r => r.status !== 'queued' && matches(r, o));
    const items = o.limit ? hit.slice(0, o.limit) : hit;
    return { items, total: hit.length };
  };
  return {
    async listItems(_urlKey, o = {}) {
      return fmt.filter(r => r.status === 'queued' && matches(r, o));
    },
    listHistory: history,
    listHistoryWithBodies: history,
  };
}

/**
 * One proxy app and one listening server per side process, shared by every
 * scenario. The app's stores delegate to the scenario currently being judged, so
 * the route's own code is what runs. One server per request exhausted macOS
 * ephemeral ports (EADDRNOTAVAIL) over a full run, so a server is not per request.
 * A transport failure is a TransportError, never a compared figure.
 */
export class TransportError extends Error {}

async function costHarness(m) {
  if (m.__cost) return m.__cost;
  const express = (await import('express')).default;
  const cur = { sc: null, dispatch: null, llm: null };
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
    dispatchQueueStore: {
      listItems: (...a) => cur.dispatch.listItems(...a),
      listHistory: (...a) => cur.dispatch.listHistory(...a),
    },
    llmCallLogStore: new Proxy({}, { get: (_t, key) => (...a) => cur.llm[key](...a) }),
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const harness = {
    cur,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
  m.__cost = harness;
  return harness;
}

/** Close the side's /cost server, if one was started (called once, after the run). */
export async function closeCostHarness(m) {
  if (m.__cost) { await m.__cost.close(); m.__cost = null; }
}

async function costOverHttp(m, sc, ticket) {
  const h = await costHarness(m);
  h.cur.sc = sc;
  h.cur.dispatch = dispatchStoreOver(sc, sc.now, null);
  h.cur.llm = storeOver(m, sc);
  let res;
  try {
    res = await fetch(`${h.base}/api/proxy/issues/${ticket}/cost`, { headers: { Authorization: 'Bearer judge' } });
  } catch (err) {
    throw new TransportError(`GET /cost ${ticket}: ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message})` : ''}`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { $raw: text }; }
  return { status: res.status, body };
}

// Judge the route's JSON only; the body is what a caller reads.
ASYNC_SURFACES.cost = async (m, sc) => {
  const out = [];
  for (const ticket of sc.tickets) out.push({ ticket, ...(await costOverHttp(m, sc, ticket)) });
  return out;
};

export const SURFACE_IDS = [...Object.keys(SYNC_SURFACES), ...Object.keys(ASYNC_SURFACES)];
