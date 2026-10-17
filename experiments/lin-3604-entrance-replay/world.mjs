/**
 * LIN-3604 replay: the fake world one input runs in.
 *
 * Every dependency the four entrances take is a recording fake, built fresh per input
 * so nothing leaks between inputs. The real routers (createDispatchRoutes in
 * routes/dispatch.js; createDispatchRoutes in routes/proxy-dispatch.js; createKickoffRoutes)
 * and the real factory (createDispatchItem), preamble (attachProxyContext,
 * provisionResumeCredential) and validators run against them, so what is compared is the
 * entrances' own decisions: what they read, in what order, what they write and what they
 * answer. The closures the Agent API owns (logEvent, relayDispatchRefusal,
 * resolveProviderAccess, ...) are faked with the same signatures and recorded.
 *
 * No network and no model call is possible: the providers are fakes, every credential is a
 * literal, and the recommendation compute is a scripted closure.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { format } from 'node:util';

export const SAMPLE_UUID = '11111111-2222-4333-8444-555555555555';
export const SAMPLE_UUID_B = '99999999-8888-4777-8666-555555555555';
export const OWNER = 'acct-owner';
export const MEMBER = 'acct-member';

/** JSON that keeps key order, shows `undefined`, and renders errors and functions. */
export function ser(value, { sortKeys = false } = {}) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === undefined) return '__undefined__';
    if (typeof v === 'function') return '__function__';
    if (typeof v === 'bigint') return `__bigint__${v}`;
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return `__date__${v.toISOString()}`;
    if (v instanceof Error) {
      const tags = {};
      for (const k of Object.keys(v)) tags[k] = walk(v[k]);
      return { __error__: v.message, name: v.name, ...tags };
    }
    if (typeof v.get === 'function' && typeof v.method === 'string' && v.headers) return '__req__';
    if (seen.has(v)) return '__circular__';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const keys = sortKeys ? Object.keys(v).sort() : Object.keys(v);
    const out = {};
    for (const k of keys) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

class Recorder {
  constructor() { this.calls = []; this.counter = 0; }
  log(channel, name, args) { this.calls.push([channel, name, ...args]); }
  next(prefix) { this.counter += 1; return `${prefix}-${this.counter}`; }
}

const spy = (rec, channel, name, fn) => (...args) => {
  rec.log(channel, name, args);
  return fn(...args);
};

/** A thrown error carrying the tags the entrances map. */
export function taggedError(kind) {
  const e = new Error(`replay ${kind}`);
  switch (kind) {
    case 'duplicate': e.duplicateDispatch = { id: 'dup-1', retryAfter: 7, code: 'DUPLICATE_DISPATCH' }; e.message = 'duplicate dispatch'; break;
    case 'runLimit429': e.runLimit = { code: 'FREE_TIER_RUN_LIMIT', error: 'run limit', freeTier: { used: true }, retryAfter: 60 }; break;
    case 'runLimit503': e.runLimit = { code: 'RUN_LIMIT_UNVERIFIED', error: 'unverified', freeTier: { used: true }, retryAfter: 5 }; break;
    case 'closeOut': e.closeOutRefusal = { sessionId: 'sess-1', code: 'CLOSE_OUT_IS_THE_PERSONS' }; break;
    case 'runaway': e.taskSessionRunaway = { sessionId: 'sess-1', code: 'TASK_SESSION_RUNAWAY' }; break;
    case 'budget': e.budgetExhausted = { bound: 'tasks', sessionId: 'sess-1', code: 'BUDGET_EXHAUSTED' }; break;
    case 'attachFailed': e.proxyAttachFailed = true; break;
    case 'structural': e.code = 'GRANT_OWNERLESS'; e.status = 503; e.retryable = false; break;
    case 'structural-invalid': e.code = 'INVALID_GRANTS'; e.status = 400; e.retryable = false; break;
    case 'ownerUnavailable': e.code = 'OWNER_CHECK_UNAVAILABLE'; e.status = 503; e.retryable = true; e.proxyAttachFailed = true; break;
    case 'anchorTerminal': e.anchorTerminalRefusal = { code: 'ANCHOR_TERMINAL' }; break;
    case 'composedInvalid': e.composedRunMarkerInvalid = true; break;
    case 'auth401': e.response = { status: 401 }; break;
    case 'auth503': e.response = { status: 503 }; break;
    default: break;
  }
  return e;
}

function makeIssueContext(identifier, w) {
  const description = identifier === 'GATE-1'
    ? 'Review <!-- harbour-periodical-gate id="documentation-review" -->'
    : `Issue ${identifier} description`;
  return {
    issue: { id: `id-${identifier}`, identifier, title: `Title ${identifier}`, description, state: { name: 'Todo', type: 'unstarted' }, labels: [], url: `https://example.test/${identifier}` },
    parent: null, siblings: [], project: null, children: [], comments: [], attachments: []
  };
}

/** The fake provider: records its reads; `fetchIssueContext` serves a few known identifiers. */
function makeProvider(rec, w) {
  const supported = new Set(['fetchIssueContext', 'fetchRecommendationContext']);
  for (const m of w.unsupported || []) supported.delete(m);
  const provider = {
    name: w.providerName || 'linear',
    ui: null,
    supports: (m) => supported.has(m),
    issueWriteGuard: spy(rec, 'provider', 'issueWriteGuard', async (_token, id) => (w.dangling && id === w.danglingId ? null : { id: 'i1' })),
    fetchIssueContext: spy(rec, 'provider', 'fetchIssueContext', async (_token, id) => {
      if (w.planThrows) throw new Error('plan read failed');
      return makeIssueContext(id, w);
    })
  };
  if (w.providerNoWrite) delete provider.issueWriteGuard;
  if (w.providerNoContext) delete provider.fetchIssueContext;
  return provider;
}

function makeQueueStore(rec, w, nowIso) {
  const store = {
    addItem: spy(rec, 'store', 'addItem', async (urlKey, fields) => {
      if (w.addThrows) throw taggedError(w.addThrows);
      return { _id: rec.next('item'), dispatchedAt: new Date(nowIso), ...fields, ...(w.seen !== undefined ? { consumerLastSeenAt: w.seen } : {}) };
    }),
    expandCascadeAborts: spy(rec, 'store', 'expandCascadeAborts', async () => ({ aborted: 2, targets: ['a', 'b'] })),
    getItemStatus: spy(rec, 'store', 'getItemStatus', async (_k, id) => {
      if (w.statusThrows) throw new Error('status read failed');
      return w.parent ? { ...w.parent, id } : null;
    }),
    getGrantDeclaration: spy(rec, 'store', 'getGrantDeclaration', async () => {
      if (w.grantLookup === 'throws') throw new Error('lookup failed');
      if (w.grantLookup === 'record') {
        return { state: 'record', record: { grants: ['dispatch'], ownerAccountId: OWNER, workspaceId: 'ws-acme', profile: 'worker', site: 'M1' } };
      }
      if (w.grantLookup === 'corrupt') return { state: 'record', record: { grants: 'x' } };
      return { state: 'none' };
    })
  };
  if (w.budgeted) store.countDistinctTasksForSession = spy(rec, 'store', 'countDistinctTasksForSession', async () => 1);
  return store;
}

function makeProxyTokenStore(rec, w) {
  return {
    createToken: spy(rec, 'token', 'createToken', async (_k, opts) => {
      if (w.mint === 'throws') throw new Error('mint failed');
      if (w.mint === 'none') return null;
      return { token: rec.next('tok'), tokenId: rec.next('tid'), ...opts };
    }),
    mintGrantBootstrap: spy(rec, 'token', 'mintGrantBootstrap', async (args) => {
      if (w.grantMint === 'refuse') { const e = taggedError('structural'); throw e; }
      if (w.grantMint === 'transient') { const e = taggedError('ownerUnavailable'); throw e; }
      if (w.grantMint === 'throws') throw new Error('grant mint failed');
      if (w.grantMint === 'none') return {};
      return { token: rec.next('gtok'), workspaceId: args.workspaceId };
    }),
    validateToken: spy(rec, 'token', 'validateToken', async () => null),
    listTokens: async () => []
  };
}

/** The Agent-API closures the proxy factories take, faked with their real signatures. */
function makeProxyClosures(rec, w, tree) {
  const { jsonError, keepaliveError } = tree.errors;
  const { mapDispatchRefusal } = tree.refusal;
  const logEvent = (req, endpoint, status, note = null) => {
    rec.log('log', 'logEvent', [endpoint, status, note]);
  };
  const tokenFor = () => (w.noToken ? null : (w.token === undefined ? 'live-token' : w.token));
  const provider = makeProvider(rec, w);
  const resolveProviderAccess = async (urlKey, owner, req, opts) => {
    rec.log('access', 'resolveProviderAccess', [urlKey, owner, '__req__', opts]);
    if (w.accessThrows) throw taggedError(w.accessThrows);
    req.resolvedProvider = { name: provider.name, displayName: 'Fake', declared: w.declared === false ? null : provider.name, ui: w.providerUi ?? null };
    return { provider, token: tokenFor(), reason: w.reason || 'not_connected' };
  };
  const workspaceUnavailable = (req, res, endpoint, reason) => {
    rec.log('access', 'workspaceUnavailable', [endpoint, reason]);
    logEvent(req, endpoint, 503, reason);
    return jsonError(res, 503, 'workspace unavailable', { reason });
  };
  const denyIfUnsupported = (activeProvider, method, req, res, endpoint) => {
    rec.log('access', 'denyIfUnsupported', [activeProvider.name, method, endpoint]);
    if (activeProvider.supports(method)) return false;
    logEvent(req, endpoint, 422);
    jsonError(res, 422, 'unsupported', { code: 'CAPABILITY_NOT_SUPPORTED', capability: method });
    return true;
  };
  const relayDispatchRefusal = (err, req, res, endpoint, keepalive = null) => {
    const reply = mapDispatchRefusal(err);
    if (!reply) return false;
    logEvent(req, endpoint, reply.status, reply.note);
    if (reply.retryAfter != null && !res.headersSent) res.set('Retry-After', String(reply.retryAfter));
    if (keepalive) keepaliveError(keepalive, reply.status, reply.message, { ...reply.body });
    else jsonError(res, reply.status, reply.message, reply.body);
    return true;
  };
  const graphqlErrorStatus = (err) => err?.response?.status === 401 ? 401 : err?.response?.status === 503 ? 503 : 500;
  const resolvePromptIssueContext = spy(rec, 'provider', 'resolvePromptIssueContext', async (_p, _t, id, isTestMode) => {
    if (w.slowMs) await new Promise(r => setTimeout(r, w.slowMs));
    if (id === 'NOPE-1') return null;
    if (id === 'GONE-1') throw new Error('Issue not found');
    if (id === 'BOOM-1') throw taggedError('auth401');
    if (id === 'BOOM-2') throw new Error('unexpected provider failure');
    return makeIssueContext(id, w);
  });
  const getWorkspaceOpenRouterKey = spy(rec, 'key', 'getWorkspaceOpenRouterKey', async () => {
    if (w.keyThrows) throw new Error('key read failed');
    return w.sessionApiKey ?? null;
  });
  const computeRecommendation = spy(rec, 'compute', 'computeRecommendation', async (args) => {
    if (w.slowMs) await new Promise(r => setTimeout(r, w.slowMs));
    if (w.computeThrows) throw taggedError(w.computeThrows);
    const rcp = w.recommendation || {};
    return {
      identifier: rcp.identifier ?? args.identifier,
      reasoning: 'because',
      prompt: rcp.prompt === undefined ? 'recommended prompt body' : rcp.prompt,
      truncated: false,
      repo: null,
      recommendedAction: rcp.recommendedAction === undefined ? 'implement' : rcp.recommendedAction,
      periodicalId: rcp.periodicalId ?? null
    };
  });
  const chargeFreeTierOrReject = spy(rec, 'free', 'chargeFreeTierOrReject', async () => (w.charge === 'deny'
    ? { status: 429, body: { error: 'free tier limit', reason: 'no_paid_key_resolved' } }
    : null));
  const logOpenRouterCredentialSource = (req, endpoint, info) => rec.log('log', 'logOpenRouterCredentialSource', [endpoint, info]);
  const recommendErrorResponse = (err) => ({ status: err?.response?.status || 502, body: { error: 'recommendation failed' } });
  return {
    logEvent, resolveProviderAccess, workspaceUnavailable, denyIfUnsupported, relayDispatchRefusal, graphqlErrorStatus,
    resolvePromptIssueContext, getWorkspaceOpenRouterKey, computeRecommendation, chargeFreeTierOrReject,
    logOpenRouterCredentialSource, recommendErrorResponse
  };
}

const passthrough = (_req, _res, next) => next();

/** Loads the pieces of a tree the world needs. */
export async function loadTree(root) {
  const at = (rel) => import(pathToFileURL(join(root, rel)).href);
  const [errors, refusal, express, sessionRoutes, proxyDispatch, proxyKickoff, factory] = await Promise.all([
    at('lib/errors.js'), at('lib/dispatch-refusal.js'), at('node_modules/express/index.js').catch(() => import('express')),
    at('routes/dispatch.js'), at('routes/proxy-dispatch.js'), at('routes/proxy-kickoff.js'), at('lib/dispatch-factory.js')
  ]);
  return { root, errors, refusal, express: express.default || express, sessionRoutes, proxyDispatch, proxyKickoff, factory };
}

function proxyAuth(w, rec) {
  return (req, _res, next) => {
    req.proxyUrlKey = 'acme';
    req.proxyCreatedBy = w.createdBy === undefined ? 'u1' : w.createdBy;
    req.proxyTokenId = 't1';
    req.proxyTokenLabel = 'test';
    req.proxyWorkspaceId = w.noWorkspace ? undefined : (w.workspaceId === undefined ? 'ws-acme' : w.workspaceId);
    next();
  };
}

/** Builds { app, rec } for one input. */
export function buildWorld(tree, input) {
  const w = input.world || {};
  const rec = new Recorder();
  const nowIso = '2026-10-17T12:00:00.000Z';
  const queue = makeQueueStore(rec, w, nowIso);
  const proxyTokenStore = makeProxyTokenStore(rec, w);
  const app = tree.express();
  if (w.parser !== false) app.use(tree.express.json({ limit: '50mb' }));

  const dispatchTokenStore = { listTokens: async () => [] };
  const workspacePreferencesStore = { getWorkspacePreferences: async () => (w.defaults ? { dispatchDefaults: w.defaults } : {}) };
  const dispatchPresetsStore = {
    get: spy(rec, 'store', 'presets.get', async (_k, id) => (w.noPreset ? null : { id, name: 'Preset', config: { model: 'preset-model' } }))
  };
  const freeTierStore = {
    tryUse: spy(rec, 'free', 'tryUse', async () => ({ allowed: w.tryUse !== 'deny' })),
    checkRun: spy(rec, 'free', 'checkRun', async (ids) => (w.runGate === 'deny'
      ? { allowed: false, code: 'FREE_TIER_RUN_LIMIT', error: 'run limit', freeTier: { used: true }, retryAfter: 60 }
      : w.runGate === 'unverified'
        ? { allowed: false, code: 'RUN_LIMIT_UNVERIFIED', error: 'unverified', freeTier: { used: true }, retryAfter: 5 }
        : { allowed: true }))
  };
  const accountStore = null;

  if (input.lane === 'S') {
    const accountId = w.account === 'none' ? undefined : (w.account === 'member' ? MEMBER : OWNER);
    const ownerCheck = w.ownerCheck === 'unwired' ? null : async ({ accountId: a }) => {
      rec.log('owner', 'ownerCheck', [{ accountId: a }]);
      if (w.ownerCheck === 'throws') throw new Error('owner check failed');
      return { status: w.ownerCheck === 'not-owner' || (a !== OWNER && w.ownerCheck !== 'owner') ? 'not-owner' : 'owner' };
    };
    const harbourFeedbackTokenStore = { validateAndConsume: async () => null, mintToken: spy(rec, 'token', 'feedback.mintToken', async () => ({ token: 'feedback-fixture' })) };
    const taskModeStore = w.noTaskMode ? null : { record: spy(rec, 'taskMode', 'record', async () => { if (w.taskModeThrows) throw new Error('record failed'); }) };
    const router = tree.sessionRoutes.createDispatchRoutes({
      dispatchQueueStore: queue,
      dispatchTokenStore,
      workspaceFromUrl: (req, _res, next) => {
        req.workspace = { urlKey: 'alpha', id: 'ws-alpha', provider: 'linear' };
        req.session = { accountId, openRouterApiKey: w.sessionApiKey ?? undefined };
        next();
      },
      userPreferencesStore: { getUserPreferences: async () => ({}) },
      harbourFeedbackTokenStore,
      workspacePreferencesStore,
      dispatchPresetsStore: w.noPresetStore ? undefined : dispatchPresetsStore,
      proxyTokenStore,
      provider: w.noInjectedProvider ? null : makeProvider(rec, w),
      getWorkspaceAccessToken: w.noAccessToken ? null : spy(rec, 'access', 'getWorkspaceAccessToken', async () => (w.accessTokenNull ? null : 'live-token')),
      fetchIssueContext: w.noFetchContext ? null : spy(rec, 'provider', 'fetchIssueContext', async (_t, id) => makeIssueContext(id, w)),
      workspaceOwnerCheck: ownerCheck,
      taskModeStore,
      freeTierStore,
      accountStore
    });
    app.use(router);
    return { app, rec, path: '/workspace/alpha/api/dispatch' };
  }

  const closures = makeProxyClosures(rec, w, tree);
  const common = {
    proxyLimiter: passthrough,
    authenticateProxyToken: proxyAuth(w, rec),
    requireWriteScope: passthrough,
    requireGrant: () => (w.noGrant ? (_req, res) => { rec.log('grant', 'refused', []); res.status(403).json({ code: 'DISPATCH_GRANT_REQUIRED' }); } : passthrough),
    logEvent: closures.logEvent,
    dispatchQueueStore: w.noStore ? null : queue,
    dispatchTokenStore,
    workspacePreferencesStore,
    proxyTokenStore,
    resolveProviderAccess: closures.resolveProviderAccess,
    workspaceUnavailable: closures.workspaceUnavailable,
    denyIfUnsupported: closures.denyIfUnsupported,
    resolvePromptIssueContext: closures.resolvePromptIssueContext,
    relayDispatchRefusal: closures.relayDispatchRefusal,
    freeTierStore,
    accountStore,
    getWorkspaceOpenRouterKey: closures.getWorkspaceOpenRouterKey,
    graphqlErrorStatus: closures.graphqlErrorStatus,
    PROXY_ATTACH_FAILED_MESSAGE: 'attach failed (replay message)'
  };
  if (input.lane === 'K') {
    app.use(tree.proxyKickoff.createKickoffRoutes({ ...common, dispatchPresetsStore: w.noPresetStore ? undefined : dispatchPresetsStore, getWorkspaceOpenRouterKey: w.noKeyReader ? null : closures.getWorkspaceOpenRouterKey }));
    return { app, rec, path: '/api/proxy/autopilot/kickoff' };
  }
  app.use(tree.proxyDispatch.createDispatchRoutes({
    ...common,
    authenticateProxyToken: proxyAuth(w, rec),
    chargeFreeTierOrReject: closures.chargeFreeTierOrReject,
    computeRecommendation: closures.computeRecommendation,
    LINEAGE_QUERY_LIMIT: 50,
    logOpenRouterCredentialSource: closures.logOpenRouterCredentialSource,
    recommendErrorResponse: closures.recommendErrorResponse,
    RECOMMEND_DESCENT_BUDGET_MS: 60000
  }));
  return { app, rec, path: input.lane === 'P' ? '/api/proxy/dispatch' : '/api/proxy/recommend-and-dispatch' };
}

export { format };
