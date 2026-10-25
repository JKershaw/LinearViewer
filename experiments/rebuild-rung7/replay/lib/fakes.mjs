// Recording fakes for every dependency routes/workspace-api.js receives, as
// server.js (origin/main 16e7ae77, :2978) passes them, plus the lib seams the
// router reaches through module imports.
//
// Closures transcribed from server.js: workspaceFromUrl (:2293; the two HTML
// pages it renders are stubbed), getOpenRouterSource (:1015). Recorders:
// workspaceOwnerCheck, adoptConnectionCredential, onTicketWrite and the two
// test seams (runEvidence / closeOut, variant `seams` only). Stores are
// recording proxies (replay-kit/lib/router/common.mjs makeRecordingStore)
// answering from the scenario or a plausible default computed from the args.
//
// Providers: the REAL registry of each side (lib/providers/index.js, as
// server.js loads it) with every non-pure method of every registered provider
// replaced by a scenario-driven recorder (`registry.<name>.<method>`); pure
// methods (supports, createFields, apiWriteFields, getCapabilities, mapState,
// getCreateTaskUrl, `_…`) and `ui` stay real, so capability gates and the
// absence of a method (github-projects has no issueWriteGuard) are faithful.
//
// Seams (module shims, replay-kit/lib/router/hooks.mjs): lib/openrouter.js
// getRecommendation / getRecommendationStream / streamChat / streamChatWithTools,
// lib/audit.js runAudit, and lib/prompts/autopilot-manual.js
// extractPrincipleZeroSection (null on demand, LIN-3880). Every importer in the side — the router AND
// lib/recap.js, brief.js, scan.js, feedback-title.js, the roadmap router — gets
// the recorder, so no model call and no Linear GraphQL call can happen. The
// recorders emit scenario-driven events through the caller's onEvent and
// honour the caller's AbortSignal. Everything else in lib runs for real.
// Global `fetch` (image proxy, OpenRouter model catalog, GitHub PR reads) is
// answered by fetchHandler below from the scenario.
import crypto from 'node:crypto';
import { snap, materialize, makeRecordingStore, recFn, runBehaviour, pickBehaviour, signalIn, buildError, STORE_TAG } from '../../../replay-kit/lib/router/common.mjs';

export async function loadSideLibs({ libUrl }) {
  const errors = await import(libUrl('lib/errors.js'));
  const workspace = await import(libUrl('lib/workspace.js'));
  await import(libUrl('lib/providers/index.js'));
  const registry = await import(libUrl('lib/providers/registry.js'));
  const modelRouting = await import(libUrl('lib/model-routing.js'));
  const refs = await import(libUrl('lib/proxy-ref-resolver.js'));
  const pwe = await import(libUrl('lib/partial-write-error.js'));
  const connection = await import(libUrl('lib/connection-binding.js'));
  const { hashContext } = await import(libUrl('lib/recap-cache.js'));
  // Two SYNTHETIC providers (replay-only, workspaces `bare` / `noguard`): no
  // registered provider today lacks a declared capability the router gates on
  // (all five support fetchRecommendationContext / createComment where they
  // have issueWriteGuard), so these reach the router's defensive 422 branches
  // the way the unit tests' stub providers do. Their methods are recorded like
  // every other provider's.
  const noop = async () => { throw new Error('replaced by the recorder'); };
  registry.registerProvider({ name: 'stub-bare', ui: undefined, supports: () => false, createFields: () => ['title'], apiWriteFields: () => [], fetchIssueContext: noop, fetchIssueComments: noop, fetchIssueFields: noop, fetchProjects: noop });
  registry.registerProvider({ name: 'stub-noguard', ui: { displayName: 'NoGuard', write: true }, supports: () => true, createFields: () => ['title', 'teamId', 'description'], apiWriteFields: () => ['title', 'description'],
    fetchIssueContext: noop, fetchRecommendationContext: noop, fetchIssueComments: noop, fetchIssueFields: noop, fetchProjects: noop, createComment: noop, createIssue: noop, updateIssue: noop, fetchTeams: noop, states: noop, uploadFile: noop, fetchProjectsList: noop });
  return { hashContext, errors, workspace, registry, tableFromPreferences: modelRouting.tableFromPreferences, RefResolutionError: refs.RefResolutionError, PartialWriteError: pwe.PartialWriteError, TeamNotFoundError: workspace.TeamNotFoundError, connection };
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
/** Snapshot with long strings digested (prompts / messages stay comparable, reports stay small). */
export function snapLong(v) {
  const walk = (x) => {
    if (typeof x === 'string') return x.length > 600 ? { __str: x.length, sha: sha(x), head: x.slice(0, 120) } : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) o[k] = walk(x[k]); return o; }
    return x;
  };
  return walk(snap(v));
}

// ---------------------------------------------------------------------------
// Provider defaults (plausible canonical shapes computed from the args)
// ---------------------------------------------------------------------------
const UUID = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
function issueFor(id, extra = {}) {
  const ident = /^[A-Za-z]+-\d+$/.test(String(id)) ? String(id).toUpperCase() : 'LIN-7';
  const uuid = /^[0-9a-f-]{36}$/i.test(String(id)) ? String(id) : UUID(7);
  return { id: uuid, identifier: ident, title: `Task ${ident}`, description: 'Implement the thing.\nSecond line.', state: { name: 'In Progress', type: 'started' }, labels: ['feature'], url: `https://linear.app/acme/issue/${ident}`, team: { id: 'team-1' }, priority: 2, ...extra };
}
function ctxFor(id) {
  const issue = issueFor(id);
  return { issue, parent: null, siblings: [], project: { id: 'proj-1', name: 'Project' }, children: [], comments: [{ id: 'c1', body: 'Looks fine', createdAt: '2026-09-30T10:00:00.000Z', user: { name: 'Ann' } }], attachments: [], focusedChild: null };
}
const PROVIDER_DEFAULTS = {
  fetchIssueContext: ([, id]) => ctxFor(id),
  fetchRecommendationContext: ([, id]) => ctxFor(id),
  fetchIssueComments: () => [{ id: 'c1', body: 'Looks fine', createdAt: '2026-09-30T10:00:00.000Z', user: { name: 'Ann' } }],
  fetchIssueFields: ([, id]) => issueFor(id),
  fetchProjects: () => ({ projects: [], issues: [issueFor('LIN-7')] }),
  createComment: ([, , body]) => ({ success: true, comment: { id: 'cm-new', body, createdAt: '2026-10-01T12:00:00.000Z', user: { name: 'Harbour' } } }),
  issueWriteGuard: ([, id]) => ({ id: /^[0-9a-f-]{36}$/i.test(String(id)) ? id : UUID(7), team: { id: 'team-1' }, trashed: false }),
  createIssue: ([, input]) => ({ success: true, issue: { id: UUID(99), identifier: 'LIN-99', title: input?.title, url: 'https://linear.app/acme/issue/LIN-99', state: { name: 'Todo', type: 'unstarted' } } }),
  updateIssue: ([, id, input]) => ({ success: true, issue: { id, identifier: 'LIN-7', ...(input || {}) } }),
  fetchTeams: () => [{ id: 'team-1', key: 'LIN', name: 'Linear Team' }],
  fetchProjectsList: () => [{ id: UUID(500), name: 'Project' }],
  states: () => [{ id: 'st-todo', name: 'Todo', type: 'unstarted' }, { id: 'st-prog', name: 'In Progress', type: 'started' }, { id: 'st-done', name: 'Done', type: 'completed' }],
  uploadFile: () => 'https://uploads.linear.app/asset-1.png',
};

const PURE_PROVIDER_METHODS = new Set(['supports', 'createFields', 'apiWriteFields', 'getCapabilities', 'mapState', 'getCreateTaskUrl', 'constructor', 'toString', 'toJSON', 'valueOf', 'hasOwnProperty']);
export function patchRegistry(holder, libs) {
  const { registry } = libs;
  for (const p of registry.getAllProviders()) {
    if (p.__replayPatched) continue;
    const wrapped = new Proxy(p, {
      get(t, prop) {
        if (prop === '__replayPatched') return true;
        if (prop === STORE_TAG) return `provider:${t.name}`;
        const v = Reflect.get(t, prop, t);
        if (typeof v !== 'function' || typeof prop !== 'string' || PURE_PROVIDER_METHODS.has(prop) || prop.startsWith('_')) return typeof v === 'function' ? v.bind(wrapped) : v;
        return (...args) => {
          const c = holder.ctx;
          if (!c) throw new Error(`replay: provider ${t.name}.${prop} called outside a request`);
          c.rec.deps.push({ fn: `registry.${t.name}.${prop}`, args: args.map(a => snapLong(a)) });
          const key = `prov:${prop}`;
          const n = c.callCounts.get(key) || 0;
          c.callCounts.set(key, n + 1);
          const spec = c.sc.prov?.[`${t.name}.${prop}`] ?? c.sc.prov?.[prop];
          let b = pickBehaviour(spec, n);
          if (!b) {
            const d = PROVIDER_DEFAULTS[prop];
            if (!d) return Promise.reject(new Error(`replay: provider method ${prop} is not modelled`));
            b = { ret: d(args) };
          }
          if (b.retByArg) { // per-identifier answers (descent / fan-out), else the default
            const id = String(args[1]);
            b = b.retByArg[id] ?? b.retByArg['*'] ?? { ret: PROVIDER_DEFAULTS[prop]?.(args) };
          }
          const out = runBehaviour(b, libs, { signal: signalIn(args) });
          if (prop === 'fetchRecommendationContext' && libs.hashContext) {
            // the cache/scan rows a scenario marks {__fromState:'ctxHash'} match THIS context
            return out.then(r => { try { c.state.ctxHash = libs.hashContext(r); } catch { /* odd shape */ } return r; });
          }
          return out;
        };
      },
    });
    registry.registerProvider(wrapped);
  }
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
const iso = (ms) => new Date(ms).toISOString();
function queueDefaults(mem) {
  return {
    addItem: ([urlKey, doc], c) => {
      const id = `11111111-0000-4000-a000-${String(c.sc.index ?? 0).padStart(12, '0')}`;
      const item = { ...doc, _id: id, id, status: 'queued', dispatchedAt: new Date() };
      mem.items.push({ urlKey, issueIdentifier: doc?.issueIdentifier ?? null, kind: doc?.kind, id, dispatchedAt: Date.now() });
      if (mem.items.length > 50) mem.items.shift();
      return item;
    },
    findRecentFreshDispatch: ([urlKey, q]) => {
      const since = q?.since instanceof Date ? q.since.getTime() : 0;
      const hit = [...mem.items].reverse().find(i => i.urlKey === urlKey && i.issueIdentifier === q?.issueIdentifier && i.kind === q?.kind && i.dispatchedAt >= since);
      return hit ? { id: hit.id, dispatchedAt: new Date(hit.dispatchedAt) } : null;
    },
    markDecisionAnswered: () => ({ ok: true }),
    countDistinctTasksForSession: () => ({ count: 0, alreadyCounted: false, taskDispatches: 0 }),
    getItemStatus: () => null,
    getGrantDeclaration: () => ({ state: 'none' }),
    listItems: () => [],
    listHistory: () => ({ items: [], total: 0 }),
    // LIN-3812: the non-lean loop builders (sessions) read listItemsWithPrompt /
    // listHistoryWithBodies, the same rows as listItems / listHistory plus the
    // prompt and feedback. The recording store answers every op, so without these
    // a scenario's listItems/listHistory never reached the sessions route and
    // every session list was empty (m05 undetected, LIN-3934).
    listItemsWithPrompt: (args, c, n) => sameRowsAs(c, 'listItems', n) ?? [],
    listHistoryWithBodies: (args, c, n) => sameRowsAs(c, 'listHistory', n) ?? { items: [], total: 0 },
    countItems: () => 0,
  };
}

/** The scenario's answer for the lean twin of a dispatch-store read, as a behaviour. */
function sameRowsAs(c, op, n) {
  const b = pickBehaviour(c.sc.stores?.dispatchQueueStore?.[op], n);
  return b ? { __behaviour: b } : undefined;
}

/**
 * The routing table a scenario's workspace preferences give (LIN-3853): the same
 * pure migration the production store runs when it has no routing store. The
 * scenario's getWorkspacePreferences answer is the preferences; a throw gives the
 * empty table, as the store's own fault path does. Scenario `delayMs`/`hang` on
 * that store are not modelled here (none is set on the routing path).
 */
export function routingTableFromScenario(c, libs) {
  const spec = c.sc.stores?.workspacePreferencesStore?.getWorkspacePreferences;
  const b = pickBehaviour(spec, c.callCounts.get('workspacePreferencesStore.getWorkspacePreferences') || 0);
  const prefs = b && b.ret !== undefined && !b.throw ? materialize(b.ret, libs) : {};
  return libs.tableFromPreferences(prefs);
}

/**
 * Principle 0 seam (LIN-3880): the manual's section, or `null` when the scenario asks
 * for the fail-closed arm. buildScanMessages fails closed on null; the route then
 * answers 503 PRINCIPLE_ZERO_UNAVAILABLE.
 */
export function principleZeroSection(sc, realFn) {
  return sc.ai?.principleZero === null ? null : realFn();
}

// STALE_FAKES is the kit as it stood before LIN-3853: the store has no routing
// table, so every AI resolution throws (`reading 'jobs'`). Kept so the vacuity
// witness in selfcheck.mjs can show the guard catches today's failure. Read once
// per app build.
export function storeSet(holder, libs, mem, { staleFakes = process.env.REPLAY_STALE_FAKES === '1' } = {}) {
  const ctx = () => holder.ctx;
  const S = (name, defaults = {}, opts = {}) => makeRecordingStore(name, ctx, libs, { defaults, ...opts });
  return {
    freeTierStore: S('freeTierStore', {
      tryUse: () => ({ allowed: true, remaining: 5, limit: 10, resetsAt: '2026-10-02T00:00:00.000Z' }),
      checkRun: () => ({ allowed: true }),
      getRunUsage: () => ({ runsUsed: 1, limit: 10, remaining: 9, resetsAt: '2026-10-02T00:00:00.000Z' }),
      getUsage: () => ({ used: 1, limit: 10, remaining: 9 }),
    }),
    userPreferencesStore: S('userPreferencesStore', { getUserPreferences: () => ({}), saveUserPreferences: () => undefined }),
    workspacePreferencesStore: S('workspacePreferencesStore', {
      getWorkspacePreferences: () => ({}),
      ...(staleFakes ? {} : { getRoutingTable: (args, c) => routingTableFromScenario(c, libs) }),
    }),
    customPromptsStore: S('customPromptsStore', {
      get: ([, id]) => (id === 'cp-1' ? { id: 'cp-1', name: 'My prompt', template: 'Do {{title}} ({{identifier}})\n{{description}}' } : null),
      list: () => [{ id: 'cp-1', name: 'My prompt' }],
      create: ([, o]) => ({ id: 'cp-new', ...(o || {}) }),
      update: ([, id, o]) => ({ id, ...(o || {}) }),
      delete: () => true,
    }),
    recapCacheStore: S('recapCacheStore', { get: () => null, put: () => undefined }),
    briefCacheStore: S('briefCacheStore', { get: () => null, put: () => undefined }),
    reportHistoryStore: S('reportHistoryStore', { save: ([, r]) => ({ id: 'rep-1', ...(r || {}) }), list: () => [], get: () => null }),
    dispatchQueueStore: S('dispatchQueueStore', queueDefaults(mem), { hiddenProps: ['historyCollection'] }),
    agentStatusStore: S('agentStatusStore', { listStatus: () => [] }),
    promptTraceStore: S('promptTraceStore', { listTraces: () => [] }),
    proxyTokenStore: S('proxyTokenStore', {
      createToken: ([urlKey, o]) => ({ token: `hb_boot_${urlKey}_${o?.label}`, expiresAt: iso(Date.now() + 172_800_000) }),
      mintGrantBootstrap: ([o]) => ({ token: `hb_grant_${o?.urlKey}_${o?.label}`, workspaceId: o?.workspaceId }),
      listTokens: () => [],
    }),
    taskDecisionsStore: S('taskDecisionsStore', {
      answer: () => ({ record: { outcome: 'answered' }, firstStampWins: true }),
      getStatus: () => null,
      recordScan: ([o]) => ({ id: `${o?.issueId}:${String(o?.inputHash).slice(0, 8)}`, issueId: o?.issueId, decision: o?.decision ?? null, scannedAt: '2026-10-01T12:00:00.000Z', outcome: null, outcomeAt: null }),
      markOutcome: ([o]) => ({ id: o?.id, issueId: o?.issueId, decision: null, outcome: o?.outcome, outcomeAt: '2026-10-01T12:00:00.000Z', outcomeReason: o?.outcomeReason ?? null, outcomeBasisHash: o?.outcomeBasisHash ?? null, scannedAt: '2026-09-30T12:00:00.000Z' }),
      reverseOutcome: ([o]) => ({ id: o?.id, issueId: o?.issueId, decision: null, outcome: null, outcomeAt: null, outcomeReason: null, outcomeBasisHash: null, scannedAt: '2026-09-30T12:00:00.000Z' }),
      listCandidatesForWorkspace: () => ({ items: [], nextCursor: null, totalCandidateCount: 0 }),
    }),
    harbourCommentsStore: S('harbourCommentsStore', { record: () => ({ ok: true }), wereRecordedByHarbour: () => new Set() }),
    sessionsFeedCache: S('sessionsFeedCache', { clear: () => undefined }, { syncOps: ['clear', 'keyFor', 'peek', 'set'] }),
    ownerCredentialStore: S('ownerCredentialStore', { get: () => null }),
    accountStore: S('accountStore', { resolveCanonicalAccountId: ([id]) => id, listMergedAccounts: () => [] }),
    closeOutEventsStore: S('closeOutEventsStore', {
      findMergedByPr: () => null,
      findAnyByPr: () => null,
      hasMergedEvent: () => false,
      record: ([o]) => ({ _id: `ev-${o?.by}-${sha(o?.prUrl).slice(0, 6)}`, ...(o || {}) }),
      stampDone: ([o]) => ({ _id: 'ev-stamped', ...(o || {}) }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Session stand-in (express-session shape: plain data + save(cb))
// ---------------------------------------------------------------------------
export function buildSession(holder, spec) {
  const data = spec ? JSON.parse(JSON.stringify(spec)) : {};
  Object.defineProperty(data, 'save', {
    enumerable: false,
    value(cb) {
      const c = holder.ctx;
      c.rec.deps.push({ fn: 'session.save' });
      const b = c.sc.sessionSave;
      setImmediate(() => cb(b === 'fail' ? new Error('session store write failed') : undefined));
    },
  });
  return data;
}

// ---------------------------------------------------------------------------
// The deps (server.js:2978) per app variant
// ---------------------------------------------------------------------------
export const VARIANTS = ['full', 'sparse', 'seams'];

export function buildDeps(holder, libs, variant, mem) {
  const ctx = () => holder.ctx;
  const stores = storeSet(holder, libs, mem);
  const { errors, workspace } = libs;

  // Transcription of server.js workspaceFromUrl (origin/main :2293).
  function workspaceFromUrl(req, res, next) {
    ctx().rec.deps.push({ fn: 'workspaceFromUrl', urlKey: snap(req.params?.urlKey) });
    try {
      const { urlKey } = req.params;
      if (!workspace.validateWorkspaceUrlKey(urlKey)) {
        if (req.path.includes('/api/')) return errors.badRequest.json(res, 'Invalid workspace URL');
        return res.status(404).send('<!doctype html><title>stub:workspace-not-found</title>invalid');
      }
      if (!req.session.workspaces || req.session.workspaces.length === 0) {
        if (req.path.includes('/api/')) return errors.unauthorized.json(res, 'Not authenticated');
        return res.redirect('/');
      }
      const ws = workspace.getWorkspaceByUrlKey(req.session, urlKey);
      if (!ws) return res.status(404).send(`<!doctype html><title>stub:workspace-not-found</title>${String(urlKey)}`);
      req.workspace = ws;
      next();
    } catch (error) {
      console.error('Error in workspaceFromUrl middleware:', error?.message ?? error);
      if (req.path.includes('/api/')) return errors.serverError.json(res, 'Internal server error');
      return res.status(500).send('<!doctype html><title>stub:error</title>');
    }
  }

  // Transcription of server.js getOpenRouterSource (origin/main :1015).
  function getOpenRouterSource(req) {
    ctx().rec.deps.push({ fn: 'getOpenRouterSource' });
    if (req.session.openRouterApiKey) return 'oauth';
    const k = process.env.OPENROUTER_API_KEY;
    if (typeof k === 'string' && k.trim()) return 'env';
    if (process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) return 'free';
    return null;
  }

  const workspaceOwnerCheck = recFn(ctx, libs, 'workspaceOwnerCheck', 'ownerCheck', { ret: { status: 'owner' } });

  // connectionAccess.adoptConnectionCredential(args): the scenario says whether
  // a different durable credential exists; the binding returned is the
  // session's own connection-backed binding (what the real seam hands back).
  function adoptConnectionCredential(args) {
    const c = ctx();
    c.rec.deps.push({ fn: 'adoptConnectionCredential', args: [{ urlKey: args?.workspace?.urlKey, ownerAccountId: snap(args?.ownerAccountId), fingerprint: snap(args?.fingerprint) }] });
    const b = c.sc.adoptConnection;
    if (!b || b === 'none') return Promise.resolve(null);
    if (b === 'throw') return Promise.reject(new Error('connection store down'));
    const binding = args?.workspace?.bindings?.find(x => typeof x?.connectionId === 'string') || null;
    return Promise.resolve({ binding, credentialBag: { token: 'lin_conn_fresh', tokenExpiresAt: 1_900_000_000_000 }, token: 'lin_conn_fresh', expiresAt: 1_900_000_000_000 });
  }

  function onTicketWrite(arg) {
    const c = ctx();
    c.rec.deps.push({ fn: 'onTicketWrite', urlKey: snap(arg?.urlKey), written: snapLong(arg?.written), hasReadBack: typeof arg?.readBack === 'function' });
    const b = c.sc.onTicketWrite || 'ok';
    if (b === 'readBack' && typeof arg?.readBack === 'function') return Promise.resolve(arg.readBack()).then(r => { c.rec.deps.push({ fn: 'onTicketWrite.readBack', result: snapLong(r) }); });
    if (b === 'throw') return Promise.reject(new Error('closer down'));
    return Promise.resolve();
  }

  const deps = {
    workspaceFromUrl,
    freeTierStore: stores.freeTierStore,
    getOpenRouterSource,
    userPreferencesStore: stores.userPreferencesStore,
    workspacePreferencesStore: stores.workspacePreferencesStore,
    customPromptsStore: stores.customPromptsStore,
    recapCacheStore: stores.recapCacheStore,
    briefCacheStore: stores.briefCacheStore,
    reportHistoryStore: stores.reportHistoryStore,
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    promptTraceStore: stores.promptTraceStore,
    proxyTokenStore: stores.proxyTokenStore,
    taskDecisionsStore: stores.taskDecisionsStore,
    harbourCommentsStore: stores.harbourCommentsStore,
    sessionsFeedCache: stores.sessionsFeedCache,
    ownerCredentialStore: stores.ownerCredentialStore,
    accountStore: stores.accountStore,
    adoptConnectionCredential,
    closeOutEventsStore: stores.closeOutEventsStore,
    workspaceOwnerCheck,
    onTicketWrite,
  };
  if (variant === 'sparse') {
    // every optional dep absent, and the stores whose absence a route answers
    // with its own 503 (recap/brief/scan/sessions)
    for (const k of ['harbourCommentsStore', 'sessionsFeedCache', 'ownerCredentialStore', 'adoptConnectionCredential', 'accountStore', 'closeOutEventsStore', 'workspaceOwnerCheck', 'onTicketWrite', 'recapCacheStore', 'briefCacheStore', 'taskDecisionsStore', 'agentStatusStore', 'dispatchQueueStore']) delete deps[k];
  }
  if (variant === 'seams') {
    // the LIN-3247 / LIN-3248 test seams (tests/unit/run-evidence-seams, close-out-check-route)
    const seamFn = (name, key, dflt) => recFn(ctx, libs, name, key, dflt, (a) => a.map(x => snapLong(x?.headers && x?.session ? { __request: true } : x)));
    deps.runEvidence = {
      resolveProvider: (ws, source) => { ctx().rec.deps.push({ fn: 'seam.runEvidence.resolveProvider', args: [snap(ws?.urlKey), snap(source)] }); return libs.workspace.resolveIssueBinding(ws, source); },
      viewerIsOwner: (req) => { ctx().rec.deps.push({ fn: 'seam.runEvidence.viewerIsOwner' }); return ctx().sc.viewerIsOwner !== false; },
      readPrStatus: seamFn('seam.runEvidence.readPrStatus', 'seamPrStatus', { ret: { readable: true, state: 'open', merged: false, head: { sha: 'abc123' } } }),
      githubFetch: (...a) => { ctx().rec.deps.push({ fn: 'seam.runEvidence.githubFetch', args: a.map(x => snap(x)) }); return Promise.reject(new Error('no github in replay')); },
    };
    deps.closeOut = {
      resolveProvider: (ws, source) => { ctx().rec.deps.push({ fn: 'seam.closeOut.resolveProvider', args: [snap(ws?.urlKey), snap(source)] }); return libs.workspace.resolveIssueBinding(ws, source); },
      readPrStatus: seamFn('seam.closeOut.readPrStatus', 'seamPrStatus', { ret: { readable: true, state: 'merged', merged: true, head: { sha: 'abc123' } } }),
      githubFetch: (...a) => { ctx().rec.deps.push({ fn: 'seam.closeOut.githubFetch', args: a.map(x => snap(x)) }); return Promise.reject(new Error('no github in replay')); },
      isStopAtRun: seamFn('seam.closeOut.isStopAtRun', 'seamStopAt', { ret: 'pr' }),
      runnerReady: (req) => { ctx().rec.deps.push({ fn: 'seam.closeOut.runnerReady' }); return ctx().sc.seamRunnerReady !== false; },
      markDone: seamFn('seam.closeOut.markDone', 'seamMarkDone', { ret: { success: true, issue: { id: 'i-1', state: { type: 'completed' } } } }),
    };
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Seams: model + Linear GraphQL boundaries
// ---------------------------------------------------------------------------
const DEFAULT_TEXT = {
  recap: JSON.stringify({ done: [{ item: 'Wrote the parser', evidence: 'PR #12' }], pending: [{ item: 'Ship', predicted: 'next' }], deviations: [] }),
  brief: '## Current\nA brief.\n\n## Constraints\n- _None._',
  scan: JSON.stringify({ has_decision: false }),
  'scan-retire': JSON.stringify({ has_decision: false }),
  'feedback-title': 'Generated feedback title',
};

export function seamHandler(holder, libs) {
  return function handle(ctx, rel, name, args, realFn) {
    const key = `${rel.replace(/^lib\//, '').replace(/\.js$/, '')}.${name}`;
    const n = ctx.callCounts.get(`seam:${key}`) || 0;
    ctx.callCounts.set(`seam:${key}`, n + 1);
    const signal = signalIn(args);
    if (key === 'prompts/autopilot-manual.extractPrincipleZeroSection') return principleZeroSection(ctx.sc, realFn);
    if (key === 'audit.runAudit') {
      ctx.rec.seams.push({ seam: key, args: args.map(a => snap(a)) });
      const b = pickBehaviour(ctx.sc.ai?.runAudit, n) || { ret: { summary: { teams: 1, projects: 0, issues: 0 }, findings: [] } };
      return runBehaviour(b, libs);
    }
    if (key === 'openrouter.getRecommendation') {
      ctx.rec.seams.push({ seam: key, args: [snapLong(args[0]), snapLong(args[1]), snapLong(args[2])] });
      const id = args[0]?.identifier;
      const b = pickBehaviour(ctx.sc.ai?.rec?.[id] ?? ctx.sc.ai?.rec?.['*'], n) || { ret: { reasoning: `Work on ${id}`, prompt: `Do ${id}`, truncated: false, completionTokens: 42, recommendedAction: 'implement', deferTo: null } };
      return runBehaviour(b, libs, { signal });
    }
    if (key === 'openrouter.getRecommendationStream') {
      ctx.rec.seams.push({ seam: key, args: [snapLong(args[0]), snapLong(args[1]), snapLong(args[2])] });
      const onEvent = args[3];
      const id = args[0]?.identifier;
      const b = pickBehaviour(ctx.sc.ai?.rec?.[id] ?? ctx.sc.ai?.rec?.['*'], n) || { ret: { reasoning: `Work on ${id}`, prompt: `Do ${id}`, truncated: false, completionTokens: 42, recommendedAction: 'implement', deferTo: null } };
      return emitThen(b, onEvent, libs, signal, (r) => {
        const out = [['phase', { phase: 'reasoning' }]];
        if (r?.reasoning) { out.push(['delta', { section: 'reasoning', content: r.reasoning.slice(0, 5) }]); out.push(['delta', { section: 'reasoning', content: r.reasoning.slice(5) }]); }
        if (r?.prompt) { out.push(['phase', { phase: 'prompt' }]); out.push(['delta', { section: 'prompt', content: r.prompt }]); }
        out.push(['done', { truncated: !!r?.truncated, completionTokens: r?.completionTokens ?? null }]);
        return out;
      });
    }
    if (key === 'openrouter.streamChat' || key === 'openrouter.streamChatWithTools') {
      const feature = args[1]?.callMeta?.feature ?? null;
      ctx.rec.seams.push({ seam: key, feature, args: [snapLong(args[0]), snapLong(args[1])] });
      const onEvent = args[2];
      const b = pickBehaviour(ctx.sc.ai?.chat?.[feature] ?? ctx.sc.ai?.chat?.['*'], n) || { text: DEFAULT_TEXT[feature] ?? 'ok' };
      if (b.text !== undefined) {
        const t = String(b.text);
        const ev = [];
        const cut = Math.max(1, Math.floor(t.length / 3));
        for (let i = 0; i < t.length; i += cut) ev.push(['token', { token: t.slice(i, i + cut) }]);
        ev.push(['done', { finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } }]);
        return emitThen({ events: ev, ret: b.ret ?? { content: t }, delayMs: b.delayMs }, onEvent, libs, signal);
      }
      return emitThen(b, onEvent, libs, signal);
    }
    ctx.rec.seams.push({ seam: key, args: args.map(a => snapLong(a)), note: 'unmodelled seam: real function' });
    return realFn(...args);
  };
}

/** Emit `b.events` (or eventsFor(ret)) through onEvent, then settle like runBehaviour. */
function emitThen(b, onEvent, libs, signal, eventsFor = null) {
  return (async () => {
    if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    if (b.delayMs) await new Promise((resolve, reject) => { const t = setTimeout(resolve, b.delayMs); signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true }); });
    const events = b.events ? materialize(b.events, libs) : (eventsFor && b.ret !== undefined && !b.throw && !b.hang ? eventsFor(materialize(b.ret, libs)) : []);
    for (const [type, data] of events) { if (typeof onEvent === 'function') onEvent(type, data); await null; }
    return runBehaviour({ ...b, delayMs: 0 }, libs, { signal });
  })();
}

// ---------------------------------------------------------------------------
// fetch: image proxy (uploads/cdn.linear.app), OpenRouter catalog, GitHub API
// ---------------------------------------------------------------------------
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb', 'hex');
const GIF = Buffer.from('474946383961010001000000002c', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>x</script>');
export const BODIES = { png: PNG, jpg: JPG, gif: GIF, webp: WEBP, svg: SVG, html: HTML, empty: Buffer.alloc(0) };

export function describeFetchHeaders(h) {
  if (!h) return null;
  const o = {};
  const entries = typeof h.entries === 'function' ? [...h.entries()] : Object.entries(h);
  for (const [k, v] of entries) o[k.toLowerCase()] = /^authorization$/i.test(k) ? `${String(v).split(' ')[0]} <${String(v).length} chars sha ${sha(v)}>` : String(v);
  return o;
}

export function fetchHandler(ctx, entry) {
  const host = (() => { try { return new URL(entry.url).hostname; } catch { return ''; } })();
  const spec = (host.endsWith('linear.app') ? ctx.sc.fetch?.image : host === 'openrouter.ai' ? ctx.sc.fetch?.catalog : host === 'api.github.com' ? ctx.sc.fetch?.github : null) ?? null;
  if (!spec) return Promise.reject(new TypeError('fetch failed (replay: no fake for this host)'));
  if (spec.throw) return Promise.reject(buildError(spec.throw, {}));
  const body = spec.bytes ? BODIES[spec.bytes] ?? Buffer.from(String(spec.bytes)) : spec.json !== undefined ? Buffer.from(JSON.stringify(spec.json)) : Buffer.alloc(0);
  const big = spec.bigBytes ? Buffer.concat([PNG, Buffer.alloc(spec.bigBytes)]) : null;
  const headers = { ...(spec.headers || {}) };
  if (spec.json !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(new Response(big ?? body, { status: spec.status ?? 200, headers }));
}

// ---------------------------------------------------------------------------
// AI-path counters and floors (LIN-3880)
// What each request reached, read from its outcome, and the minimums a run must
// reach for the AI path to count as exercised (see replay-kit ai-coverage.mjs).
// ---------------------------------------------------------------------------
const AI_FAMILY = {
  'POST /workspace/:urlKey/api/scan/:issueId': 'scan',
  'POST /workspace/:urlKey/api/scan/:issueId/retire': 'retire',
  'POST /workspace/:urlKey/api/recap/:issueId': 'recap',
  'POST /workspace/:urlKey/api/brief/:issueId': 'brief',
  'GET /workspace/:urlKey/api/recommend/:issueId': 'recommend',
  'GET /workspace/:urlKey/api/recommend/:issueId/stream': 'recommend',
};
export const AI_VERBS = ['OPTIONS', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'GET', 'POST'];
const ARM_FAMILIES = ['scan', 'retire', 'recap', 'brief'];
const VERB_FAMILIES = ['scan', 'retire', 'recap', 'brief', 'recommend'];

/** The counter keys one request contributes (`model:<feature>`, `store:recordScan`, `arm:<arm>:<family>`, `verb:<METHOD>:<family>`). */
export function aiCountersFor(sc, o) {
  const out = [];
  for (const s of o.calls?.seams || []) {
    if (s.seam === 'openrouter.getRecommendation' || s.seam === 'openrouter.getRecommendationStream') out.push('model:recommend');
    else if (s.feature) out.push(`model:${s.feature}`);
  }
  if (o.calls?.store?.some(x => x.store === 'taskDecisionsStore' && x.op === 'recordScan')) out.push('store:recordScan');
  const family = AI_FAMILY[sc.routeKey];
  if (family) {
    if (o.body?.code === 'PRINCIPLE_ZERO_UNAVAILABLE') out.push(`arm:p0Null:${family}`);
    if (o.body?.code === 'AI_NOT_CONFIGURED') out.push(`arm:notConfigured:${family}`);
    if (o.body?.error === 'AI service temporarily unavailable') out.push(`arm:upstream503:${family}`);
  }
  if (sc.verbFamily) out.push(`verb:${sc.method}:${sc.verbFamily}`);
  return out;
}

export const AI_FLOORS = [
  ...['scan', 'scan-retire', 'recap', 'brief', 'recommend'].map(f => ({ key: `model:${f}`, min: 1, needs: 'gen' })),
  { key: 'store:recordScan', min: 1, needs: 'gen' },
  { key: 'arm:p0Null:scan', min: 1, needs: 'edge' },
  { key: 'arm:p0Null:retire', min: 1, needs: 'edge' },
  ...ARM_FAMILIES.flatMap(f => [
    { key: `arm:notConfigured:${f}`, min: 1, needs: 'edge' },
    { key: `arm:upstream503:${f}`, min: 1, needs: 'edge' },
  ]),
  ...VERB_FAMILIES.flatMap(f => AI_VERBS.map(v => ({ key: `verb:${v}:${f}`, min: 1, needs: 'edge' }))),
];
