// Recording fakes for every dependency the three routers receive.
//
// Session lane (routes/dispatch.js): the deps server.js:2336 passes —
// workspaceFromUrl (transcribed from server.js), the stores, the
// workspace-owner seam, getWorkspaceAccessToken and fetchIssueContext.
// Proxy lane (routes/proxy-kickoff.js + routes/proxy-dispatch.js): the
// closures routes/proxy.js:1576/1580 passes — authenticateProxyToken,
// requireWriteScope, logEvent, resolveProviderAccess, denyIfUnsupported,
// workspaceUnavailable, graphqlErrorStatus, relayDispatchRefusal,
// recommendErrorResponse, chargeFreeTierOrReject, logOpenRouterCredentialSource,
// transcribed from origin/main (pinned/proxy.js.ref); requireGrant is the REAL
// lib/require-grant.js; computeRecommendation, resolvePromptIssueContext and
// getWorkspaceOpenRouterKey are scenario-driven recorders (no model call ever).
//
// Every lib module used here is the SIDE's own instance (`?side=<label>`), the
// same instance that side's routers import. Every fake dispatches onto
// `holder.ctx`, the per-request context the harness installs.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { snap, errSummary, buildError, materialize, makeRecordingStore, runBehaviour, pickBehaviour, STORE_TAG } from './common.mjs';

export async function loadSideLibs(libRoot, label) {
  const u = (p) => `${pathToFileURL(path.join(libRoot, p)).href}?side=${label}`;
  const errors = await import(u('lib/errors.js'));
  const events = await import(u('lib/proxy-events.js'));
  const workspace = await import(u('lib/workspace.js'));
  const scopes = await import(u('lib/proxy-scopes.js'));
  const refusal = await import(u('lib/dispatch-refusal.js'));
  const gqlErr = await import(u('lib/proxy-graphql-errors.js'));
  const requireGrantMod = await import(u('lib/require-grant.js'));
  await import(u('lib/providers/index.js'));
  const registry = await import(u('lib/providers/registry.js'));
  let BYTE_IDENTICAL_ESCALATION_THRESHOLD = 3;
  try { ({ BYTE_IDENTICAL_ESCALATION_THRESHOLD } = await import(u('lib/rejected-credentials.js'))); } catch { /* default */ }
  return { label, errors, events, workspace, scopes, refusal, gqlErr, requireGrant: requireGrantMod.requireGrant, registry, BYTE_IDENTICAL_ESCALATION_THRESHOLD };
}

const OPENROUTER_FALLBACK_PAID_NOTE = 'openrouter_key_fallback_paid_env';
const OPENROUTER_FALLBACK_FREE_NOTE = 'openrouter_key_fallback_free_tier';
export const PROXY_ATTACH_FAILED_MESSAGE = 'Proxy context was requested but a proxy token could not be created (LIN-1175) — refusing to launch a credential-less session; you may have hit the token rate limit, wait a minute and retry.';
export const LINEAGE_QUERY_LIMIT = 2000;
export const RECOMMEND_DESCENT_BUDGET_MS = 180_000;

// ---------------------------------------------------------------------------
// Store defaults: plausible answers computed from the arguments (and, for the
// queue, from a per-app memory of what was enqueued, so the duplicate guard
// emerges across requests the way it does in production).
// ---------------------------------------------------------------------------
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

function queueDefaults(mem) {
  return {
    addItem: ([urlKey, doc], c) => {
      const id = c.sc.ids?.item || `00000000-0000-4000-a000-${String(c.sc.index ?? 0).padStart(12, '0')}`;
      const item = { ...doc, _id: id, id, status: 'queued', dispatchedAt: new Date() };
      if (c.sc.addItemShape === 'stringDate') item.dispatchedAt = item.dispatchedAt.toISOString();
      if (c.sc.addItemShape === 'noDate') delete item.dispatchedAt;
      mem.items.push({ urlKey, issueIdentifier: doc?.issueIdentifier ?? null, kind: doc?.kind, id, dispatchedAt: Date.now() });
      if (mem.items.length > 50) mem.items.shift();
      return item;
    },
    findRecentFreshDispatch: ([urlKey, q]) => {
      const since = q?.since instanceof Date ? q.since.getTime() : 0;
      const hit = [...mem.items].reverse().find(i => i.urlKey === urlKey && i.issueIdentifier === q?.issueIdentifier && i.kind === q?.kind && i.dispatchedAt >= since);
      return hit ? { id: hit.id, dispatchedAt: new Date(hit.dispatchedAt) } : null;
    },
    expandCascadeAborts: ([, abortTo]) => ({ aborted: 2, ids: [`${String(abortTo).slice(0, 8)}-c1`, `${String(abortTo).slice(0, 8)}-c2`] }),
    countDistinctTasksForSession: () => ({ count: 0, alreadyCounted: false, taskDispatches: 0 }),
    getItemStatus: () => null,
    getGrantDeclaration: () => ({ state: 'none' }),
    takeItem: () => null,
    listItems: () => [],
    countItems: () => 0,
    listHistory: () => ({ items: [], total: 0 }),
    removeItem: () => true,
    trimSessionBudget: ([, sessionId, { maxTasks } = {}]) => ({ ok: true, item: { id: sessionId, maxTasks, prompt: 'run', dispatchedBy: 'acct-owner', bootstrapToken: 'hb_secret' } }),
    pollAvailable: () => [],
    addFeedback: () => ({ success: true }),
    countPilotEligible: () => 0,
    getWakeShadow: () => null,
    getWakeShadowTally: ([, o]) => ({ days: [], totals: { minted: 0, wouldSkip: 0, share: 0, byReason: {} }, window: o?.days ?? 7 }),
  };
}

function storeSet(holder, libs, variant, mem) {
  const ctx = () => holder.ctx;
  const S = (name, defaults = {}, opts = {}) => makeRecordingStore(name, ctx, libs, { defaults, ...opts });
  return {
    dispatchQueueStore: S('dispatchQueueStore', queueDefaults(mem), { hiddenProps: ['historyCollection'] }),
    dispatchTokenStore: S('dispatchTokenStore', {
      validateToken: () => null,
      createToken: ([urlKey, label]) => ({ tokenId: 'dtok-1', token: `hbd_${urlKey}_${label}`, label }),
      listTokens: () => [],
      revokeToken: () => true,
    }),
    proxyTokenStore: S('proxyTokenStore', {
      validateToken: () => null,
      describeRejectionCause: () => null,
      createToken: ([urlKey, o]) => ({ token: `hb_boot_${urlKey}_${o?.label}`, expiresAt: isoAgo(-172_800_000) }),
      mintGrantBootstrap: ([o]) => ({ token: `hb_grant_${o?.urlKey}_${o?.label}`, workspaceId: o?.workspaceId }),
      listTokens: () => [],
    }),
    userPreferencesStore: S('userPreferencesStore', {
      getUserPreferences: () => ({ recentCustomPrompts: {} }),
      saveUserPreferences: () => undefined,
      getFavoritePrompts: () => [],
      addFavoritePrompt: ([, , p]) => [p],
      removeFavoritePrompt: () => [],
    }),
    harbourFeedbackTokenStore: S('harbourFeedbackTokenStore', {
      validateAndConsume: () => null,
      mintToken: ([id]) => ({ token: `hft_${id}` }),
    }),
    workspacePreferencesStore: S('workspacePreferencesStore', { getWorkspacePreferences: () => ({}) }),
    dispatchPresetsStore: S('dispatchPresetsStore', {
      get: () => null,
      list: () => [],
      createCustom: ([, o]) => ({ id: 'preset-new', name: o?.name, config: o?.config }),
      update: ([, id, o]) => ({ id, name: o?.name, config: o?.config }),
      delete: () => true,
    }),
    workspaceHaltStore: S('workspaceHaltStore', {
      getWorkspaceHalt: () => null,
      setWorkspaceHalt: () => undefined,
      clearWorkspaceHalt: () => undefined,
      getLastKnownHalt: () => null,
    }, { syncOps: ['getLastKnownHalt'] }),
    sessionsFeedCache: S('sessionsFeedCache', { clear: () => undefined }, { syncOps: ['clear', 'keyFor', 'peek', 'set'] }),
    taskModeStore: S('taskModeStore', { record: () => ({ ok: true }) }),
    freeTierStore: S('freeTierStore', {
      checkRun: () => ({ allowed: true }),
      getRunUsage: () => ({ runsUsed: 1, limit: 10, remaining: 9, resetsAt: '2026-10-02T00:00:00.000Z' }),
      tryUse: () => ({ allowed: true, remaining: 5, limit: 10, resetsAt: '2026-10-02T00:00:00.000Z' }),
    }),
    accountStore: S('accountStore', {
      resolveCanonicalAccountId: ([id]) => id,
      listMergedAccounts: () => [],
    }),
    proxyEventStore: S('proxyEventStore', { recordEvent: () => undefined }),
  };
}

/** A recorded dependency function driven by `sc[key]` (behaviour) or `dflt`. */
function recFn(holder, libs, fnName, key, dflt, describe = (args) => args.map(a => snap(a))) {
  return function recorded(...args) {
    const c = holder.ctx;
    c.rec.deps.push({ fn: fnName, args: describe(args) });
    const n = (c.callCounts.get(fnName) || 0);
    c.callCounts.set(fnName, n + 1);
    const b = pickBehaviour(c.sc[key], n) || dflt;
    return runBehaviour(b, libs);
  };
}

// ---------------------------------------------------------------------------
// Registry providers (session lane resolves the REAL registry): each side's
// registered provider objects are re-registered behind a Proxy whose network
// methods are scenario-driven recorders. Anything else that could reach the
// network throws (and is recorded) instead.
// ---------------------------------------------------------------------------
const PURE_PROVIDER_METHODS = new Set(['supports', 'constructor', 'toString', 'toJSON', 'valueOf', 'hasOwnProperty']);
export function patchRegistry(holder, libs) {
  const { registry } = libs;
  for (const p of registry.getAllProviders()) {
    if (p.__replayPatched) continue;
    const wrapped = new Proxy(p, {
      get(t, prop, recv) {
        if (prop === '__replayPatched') return true;
        const v = Reflect.get(t, prop, t);
        if (typeof v !== 'function' || typeof prop !== 'string' || PURE_PROVIDER_METHODS.has(prop)) return typeof v === 'function' ? v.bind(t) : v;
        return (...args) => {
          const c = holder.ctx;
          if (!c) throw new Error(`replay: provider ${t.name}.${prop} called outside a request`);
          c.rec.deps.push({ fn: `registry.${t.name}.${prop}`, args: args.map(a => snap(a)) });
          const spec = c.sc.regProvider?.[prop];
          if (!spec) return Promise.reject(new Error(`replay: provider method ${prop} is not modelled`));
          return runBehaviour(pickBehaviour(spec, 0), libs);
        };
      },
    });
    registry.registerProvider(wrapped);
  }
}

// ---------------------------------------------------------------------------
// Session lane
// ---------------------------------------------------------------------------
export const SESSION_VARIANTS = ['full', 'sparse', 'noStores'];

export function buildSessionDeps(holder, libs, variant, mem) {
  const ctx = () => holder.ctx;
  const stores = storeSet(holder, libs, variant, mem);
  const { errors, workspace } = libs;
  const full = variant === 'full';
  const seam = variant !== 'sparse'; // noStores keeps the owner seam, drops every optional store

  // Transcription of server.js workspaceFromUrl (origin/main); the two HTML
  // pages it can render are stubbed with fixed text (identical on both sides).
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

  const workspaceOwnerCheck = recFn(holder, libs, 'workspaceOwnerCheck', 'ownerCheck', { ret: { status: 'owner' } });
  const getWorkspaceAccessToken = recFn(holder, libs, 'getWorkspaceAccessToken', 'wsToken', { ret: 'ws-access-token' },
    (args) => [snap(args[0]), args.length > 1 ? (args[1] ? { __session: true } : snap(args[1])) : '<omitted>']);
  const fetchIssueContext = recFn(holder, libs, 'fetchIssueContext', 'issueCtx', { ret: { issue: { description: 'plan body', state: { type: 'started' } } } });

  return {
    dispatchQueueStore: stores.dispatchQueueStore,
    dispatchTokenStore: stores.dispatchTokenStore,
    workspaceFromUrl,
    userPreferencesStore: full ? stores.userPreferencesStore : null,
    harbourFeedbackTokenStore: full ? stores.harbourFeedbackTokenStore : null,
    workspacePreferencesStore: stores.workspacePreferencesStore,
    dispatchPresetsStore: full ? stores.dispatchPresetsStore : null,
    proxyTokenStore: full ? stores.proxyTokenStore : null,
    workspaceOwnerCheck: seam ? workspaceOwnerCheck : null,
    getWorkspaceAccessToken,
    fetchIssueContext,
    workspaceHaltStore: full ? stores.workspaceHaltStore : null,
    sessionsFeedCache: full ? stores.sessionsFeedCache : null,
    taskModeStore: full ? stores.taskModeStore : null,
    freeTierStore: stores.freeTierStore,
    accountStore: full ? stores.accountStore : null,
  };
}

// ---------------------------------------------------------------------------
// Proxy lane
// ---------------------------------------------------------------------------
export const PROXY_VARIANTS = ['full', 'sparse', 'noQueue'];

function buildFakeProvider(spec, holder, libs) {
  const realUi = libs.registry.getProvider(spec.name)?.ui ?? null;
  const unsupported = new Set(spec.unsupported || []);
  const provider = {
    name: spec.name,
    ui: spec.ui === 'none' ? undefined : realUi,
    supports(method) {
      holder.ctx.rec.deps.push({ fn: 'provider.supports', args: [snap(method)] });
      return !unsupported.has(method);
    },
  };
  for (const m of ['fetchIssueContext', 'issueWriteGuard', 'fetchRecommendationContext']) {
    if ((spec.missing || []).includes(m)) continue;
    provider[m] = (...args) => {
      const c = holder.ctx;
      c.rec.deps.push({ fn: `provider.${m}`, args: args.map(a => snap(a)) });
      const b = pickBehaviour(spec.methods?.[m], 0) || (m === 'issueWriteGuard' ? { ret: { id: 'issue-1' } } : { ret: { issue: { description: 'plan body' } } });
      return runBehaviour(b, libs);
    };
  }
  provider[STORE_TAG] = `provider:${spec.name}`;
  return provider;
}

export function buildProxyDeps(holder, libs, variant, mem) {
  const ctx = () => holder.ctx;
  const stores = storeSet(holder, libs, variant, mem);
  const { errors, events, refusal, gqlErr, requireGrant, BYTE_IDENTICAL_ESCALATION_THRESHOLD } = libs;
  const { jsonError, keepaliveError, workspaceUnavailableEnvelope } = errors;
  const PROXY_TOKEN_REJECTED_EXTRA = { code: 'PROXY_TOKEN_INVALID', category: 'auth', retryable: false, stage: events.STAGE_PROXY_TOKEN };
  const proxyEventStore = stores.proxyEventStore;
  const proxyTokenStore = stores.proxyTokenStore;
  const registry = (op, data) => ctx().rec.registry.push({ op, ...data });

  function isTransientProviderAuthFailure(req) {
    const reg = ctx().sc.registry || {};
    const expiresAt = req?.resolvedCredentialExpiresAt;
    const looksLive = typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > Date.now();
    if (!looksLive) return false;
    if (reg.suspect) return false;
    if (reg.pastThreshold && BYTE_IDENTICAL_ESCALATION_THRESHOLD) return false;
    if (reg.superseded) return false;
    return true;
  }
  function graphqlErrorStatus(err, req) {
    let status;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') status = 504;
    else {
      const s = err.response?.status || err.response?.errors?.[0]?.extensions?.statusCode;
      if (s === 401 || s === 403) status = isTransientProviderAuthFailure(req) ? 503 : 401;
      else if (s === 404) status = 404;
      else if (s === 429) status = 429;
      else if (err.response?.errors?.[0]?.extensions?.userError === true) status = 400;
      else status = 500;
    }
    ctx().rec.deps.push({ fn: 'graphqlErrorStatus', err: errSummary(err), status });
    return status;
  }

  // eslint-disable-next-line no-unused-vars
  function logEvent(req, endpoint, status, note = null, { skipWitness = false } = {}) {
    const c = ctx();
    c.rec.log.push({ endpoint: snap(endpoint), status: snap(status), note: snap(note), opts: arguments.length > 4 ? snap(arguments[4]) : '<omitted>' });
    if (status === 401 || status === 503) {
      registry('logCredentialRejection', { endpoint });
      const reason = status === 401 ? 'provider-401' : (req.resolvedCredentialFingerprint ? 'provider-503-transient' : 'workspace-503');
      registry('markSuspect', { fingerprint: snap(req.resolvedCredentialFingerprint), reason });
    } else if (status >= 200 && status < 300 && req.resolvedCredentialFingerprint && !skipWitness) {
      registry('witnessAccepted', { fingerprint: req.resolvedCredentialFingerprint });
    }
    const stage = req.resolvedCredentialFingerprint !== undefined ? events.STAGE_PROVIDER_LANE : events.STAGE_PROXY_TOKEN;
    proxyEventStore.recordEvent({
      urlKey: req.proxyUrlKey, tokenId: req.proxyTokenId, tokenLabel: req.proxyTokenLabel, method: req.method,
      endpoint, status, note, stage,
      credentialFingerprint: req.resolvedCredentialFingerprint ?? null,
      credentialSource: req.resolvedCredentialSource ?? null,
    }).catch(err => console.error('Failed to log proxy event:', err?.message ?? err));
  }

  async function authenticateProxyToken(req, res, next) {
    ctx().rec.deps.push({ fn: 'authenticateProxyToken' });
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return jsonError(res, 401, 'Missing or invalid Authorization header', PROXY_TOKEN_REJECTED_EXTRA);
    const token = authHeader.slice(7);
    if (!token) return jsonError(res, 401, 'Empty token', PROXY_TOKEN_REJECTED_EXTRA);
    try {
      const result = await proxyTokenStore.validateToken(token);
      if (!result) {
        registry('logCredentialRejection', { endpoint: 'auth' });
        const descriptor = await proxyTokenStore.describeRejectionCause(token);
        const extra = descriptor
          ? { ...PROXY_TOKEN_REJECTED_EXTRA, proxyTokenState: descriptor.state, ...(descriptor.state === 'expired' ? { proxyTokenExpiredAt: descriptor.expiresAt } : {}) }
          : PROXY_TOKEN_REJECTED_EXTRA;
        if (descriptor) {
          proxyEventStore.recordEvent({ urlKey: descriptor.urlKey, tokenId: null, tokenLabel: null, method: req.method, endpoint: req.originalUrl, status: 401, stage: events.STAGE_PROXY_TOKEN, note: descriptor.state })
            .catch(err => console.error('Failed to log proxy-token rejection event:', err));
        }
        return jsonError(res, 401, 'Invalid, expired, or consumed token', extra);
      }
      req.proxyTokenId = result.tokenId;
      req.proxyUrlKey = result.urlKey;
      req.proxyTokenLabel = result.label;
      req.proxyTokenScope = result.scope;
      req.proxyCreatedBy = result.createdBy;
      req.proxyTokenGrants = result.grants || [];
      req.proxyWorkspaceId = result.workspaceId || null;
      next();
    } catch (err) {
      console.error('Proxy token validation error:', err.message);
      return jsonError(res, 500, 'Authentication error');
    }
  }

  function requireWriteScope(req, res, next) {
    ctx().rec.deps.push({ fn: 'requireWriteScope', scope: snap(req.proxyTokenScope) });
    if (req.proxyTokenScope !== libs.scopes.READ_WRITE) return jsonError(res, 403, 'This endpoint requires a read-write token');
    next();
  }

  function proxyLimiter(req, res, next) {
    const c = ctx();
    c.rec.deps.push({ fn: 'proxyLimiter' });
    if (c.sc.limiter === 'block') return res.status(429).json({ error: 'Too many proxy requests, please try again later' });
    next();
  }

  // eslint-disable-next-line no-unused-vars
  async function resolveProviderAccess(urlKey, ownerAccountId, req, { source } = {}) {
    const c = ctx();
    c.rec.deps.push({ fn: 'resolveProviderAccess', urlKey: snap(urlKey), ownerAccountId: snap(ownerAccountId), hasReq: !!req, opts: snap(arguments[3]), argc: arguments.length });
    const a = c.sc.access || {};
    if (a.hang) return new Promise(() => {});
    if (a.throw) throw buildError(a.throw, libs);
    const token = a.token ?? null;
    if (req && token) {
      req.resolvedCredentialFingerprint = a.credentialFingerprint ?? null;
      req.resolvedCredentialExpiresAt = Number.isFinite(a.expiresAt) ? a.expiresAt : null;
      req.resolvedCredentialSource = a.credentialSource ?? null;
    }
    const provider = c.provider;
    if (req) {
      req.resolvedProvider = {
        name: provider.name,
        displayName: provider.ui?.displayName ?? provider.name,
        declared: a.providerName ?? null,
        ui: provider.ui ?? null,
      };
    }
    registry('recordCredentialResolution', { urlKey: snap(urlKey), ownerAccountId: snap(ownerAccountId), provider: snap(a.providerName), credential: token ? snap(a.scope ?? token) : null });
    return { provider, token: token ? (a.scope ?? token) : token, reason: a.reason ?? 'ok' };
  }

  function workspaceUnavailable(req, res, endpoint, reason) {
    ctx().rec.deps.push({ fn: 'workspaceUnavailable', endpoint: snap(endpoint), reason: snap(reason) });
    logEvent(req, endpoint, 503, reason);
    const { error, ...rest } = workspaceUnavailableEnvelope(reason, req.proxyUrlKey);
    return jsonError(res, 503, error, rest);
  }

  function denyIfUnsupported(activeProvider, method, req, res, endpoint) {
    ctx().rec.deps.push({ fn: 'denyIfUnsupported', method: snap(method), endpoint: snap(endpoint) });
    if (activeProvider.supports(method)) return false;
    logEvent(req, endpoint, 422);
    jsonError(res, 422, `This workspace's provider does not support this`, { code: 'CAPABILITY_NOT_SUPPORTED', capability: method, provider: activeProvider.name });
    return true;
  }

  function relayDispatchRefusal(err, req, res, endpoint, keepalive = null) {
    ctx().rec.deps.push({ fn: 'relayDispatchRefusal', endpoint: snap(endpoint), keepalive: !!keepalive, err: errSummary(err) });
    const reply = refusal.mapDispatchRefusal(err);
    if (!reply) return false;
    logEvent(req, endpoint, reply.status, reply.note);
    if (reply.retryAfter != null && !res.headersSent) res.set('Retry-After', String(reply.retryAfter));
    if (keepalive) keepaliveError(keepalive, reply.status, reply.message, { ...reply.body });
    else jsonError(res, reply.status, reply.message, reply.body);
    return true;
  }

  function recommendErrorResponse(err, req) {
    ctx().rec.deps.push({ fn: 'recommendErrorResponse', err: errSummary(err) });
    if (err.message?.includes('not found')) return { status: 404, body: { error: 'Issue not found' } };
    if (err.message?.includes('OpenRouter')) return { status: 503, body: { error: 'AI service temporarily unavailable', detail: err.message } };
    console.error('Proxy /recommend error:', err.message);
    const status = graphqlErrorStatus(err, req);
    return { status, body: { error: 'Failed to get recommendation', detail: gqlErr.graphqlErrorDetail(err, req), ...gqlErr.graphqlErrorExtra(err, status) } };
  }

  async function chargeFreeTierOrReject(req, endpoint) {
    ctx().rec.deps.push({ fn: 'chargeFreeTierOrReject', endpoint: snap(endpoint) });
    console.warn(`[LIN-961] Proxy ${endpoint} running on FREE TIER — no paid/OAuth key resolved (workspace ${req.proxyUrlKey}). Set OPENROUTER_API_KEY (non-empty) or connect OpenRouter to use a paid key.`);
    logEvent(req, endpoint, 200, 'free-tier fallback: no paid/OAuth key resolved');
    const check = await stores.freeTierStore.tryUse(req.proxyUrlKey);
    if (check.allowed) return null;
    return { status: 429, body: { error: check.reason, reason: 'no_paid_key_resolved', freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } } };
  }

  function logOpenRouterCredentialSource(req, endpoint, { sessionApiKey, isFreeTier }) {
    ctx().rec.deps.push({ fn: 'logOpenRouterCredentialSource', endpoint: snap(endpoint), sessionApiKey: snap(sessionApiKey), isFreeTier: snap(isFreeTier) });
    if (sessionApiKey) return;
    logEvent(req, endpoint, 200, isFreeTier ? OPENROUTER_FALLBACK_FREE_NOTE : OPENROUTER_FALLBACK_PAID_NOTE);
  }

  const getWorkspaceOpenRouterKey = recFn(holder, libs, 'getWorkspaceOpenRouterKey', 'orKey', { ret: 'sk-or-session-key' });

  // Server-side hang-up: destroying the socket is what a client going away
  // looks like to clientGoneSignal ('close' with writableFinished false).
  // Resolves once the server has seen the 'close' (what clientGoneSignal reacts to).
  function hangUp() {
    const res = ctx().res;
    ctx().rec.deps.push({ fn: 'client.hangUp' });
    return new Promise((resolve) => {
      if (!res || res.destroyed || res.writableFinished) return resolve();
      res.once('close', () => resolve());
      res.socket?.destroy();
    });
  }

  async function resolvePromptIssueContext(provider, accessToken, identifier, isTestMode) {
    const c = ctx();
    c.rec.deps.push({ fn: 'resolvePromptIssueContext', provider: provider?.name ?? snap(provider), accessToken: snap(accessToken), identifier: snap(identifier), isTestMode: snap(isTestMode) });
    const b = c.sc.promptCtx || { ret: null };
    if (b.hangUp) await hangUp();
    return runBehaviour(b, libs);
  }

  async function computeRecommendation(args) {
    const c = ctx();
    const { clientSignal, deadline, ...rest } = args || {};
    c.rec.deps.push({ fn: 'computeRecommendation', args: snap({ ...rest, provider: rest.provider?.name, deadlineIn: typeof deadline === 'number' ? deadline - Date.now() : snap(deadline), hasClientSignal: !!clientSignal }) });
    const table = c.sc.recs || {};
    const b = pickBehaviour(table[rest.identifier] ?? table['*'], 0) || { throw: { kind: 'plain', message: 'Issue not found' } };
    if (b.hangUp || b.hangUpThenReturn) {
      await hangUp();
      await new Promise((resolve) => { if (!clientSignal || clientSignal.aborted) resolve(); else clientSignal.addEventListener('abort', resolve, { once: true }); });
      if (b.hangUpThenReturn) return materialize(b.ret, libs); // a hop that completes despite the abort
      throw buildError({ kind: 'timeout' }, libs);
    }
    return runBehaviour(b, libs);
  }

  const has = (k) => variant === 'full' || (variant === 'sparse' && !['dispatchTokenStore', 'dispatchPresetsStore', 'accountStore', 'kickoffOrKey'].includes(k)) || (variant === 'noQueue' && k !== 'dispatchQueueStore');
  const common = {
    proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant, logEvent,
    dispatchQueueStore: has('dispatchQueueStore') ? stores.dispatchQueueStore : null,
    dispatchTokenStore: has('dispatchTokenStore') ? stores.dispatchTokenStore : null,
    workspacePreferencesStore: stores.workspacePreferencesStore,
    proxyTokenStore,
    resolveProviderAccess, workspaceUnavailable, denyIfUnsupported, resolvePromptIssueContext,
    relayDispatchRefusal, freeTierStore: stores.freeTierStore, accountStore: has('accountStore') ? stores.accountStore : null,
    graphqlErrorStatus, PROXY_ATTACH_FAILED_MESSAGE,
  };
  return {
    kickoff: { ...common, dispatchPresetsStore: has('dispatchPresetsStore') ? stores.dispatchPresetsStore : null, getWorkspaceOpenRouterKey: has('kickoffOrKey') ? getWorkspaceOpenRouterKey : null },
    dispatch: {
      ...common, chargeFreeTierOrReject, computeRecommendation, getWorkspaceOpenRouterKey, LINEAGE_QUERY_LIMIT,
      logOpenRouterCredentialSource, recommendErrorResponse, RECOMMEND_DESCENT_BUDGET_MS,
    },
    buildProvider: (spec) => buildFakeProvider(spec, holder, libs),
  };
}

export { materialize };
