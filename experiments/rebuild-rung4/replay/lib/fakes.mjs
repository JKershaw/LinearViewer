// Deterministic recording fakes for the deps routes/proxy.js hands to
// createProxyWriteRoutes, createRulingsRoutes and createTokensAdminRoutes
// (origin/main 06ec62b7). The closures are transcriptions of the real ones in
// routes/proxy.js (authenticateProxyToken, requireWriteScope,
// resolveProviderAccess, denyIfUnsupported, denyIfMissingRead, logEvent,
// workspaceUnavailable, graphqlErrorStatus/isTransientProviderAuthFailure,
// writeRejected, resolve{Team,State,Project,Label}Input, refResolutionFailed,
// partialWriteFailed) and server.js (workspaceFromUrl). Stores, caches,
// limiters and the onTicketWrite seam are recording fakes driven by scenario
// data. Every dep dispatches onto `holder.ctx`, the per-request context the
// harness installs before each request.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { snap, errSummary, buildError, materialize, makeRecordingStore, buildProvider, newRecorder, STORE_TAG } from './common.mjs';

/**
 * Wrap a REAL object (e.g. a per-app createDedupeCache() instance) so every
 * method call is recorded as a store op with its arguments and return value.
 */
function wrapRecording(name, target, ctx) {
  return new Proxy(target, {
    get(t, prop) {
      if (prop === STORE_TAG) return name;
      const v = t[prop];
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      return (...args) => {
        const ret = v.apply(t, args);
        ctx()?.rec.store.push({ store: name, op: prop, args: args.map(a => snap(a)), ret: snap(ret) });
        return ret;
      };
    },
  });
}

export async function loadRepoLibs(repoRoot) {
  const u = (p) => pathToFileURL(path.join(repoRoot, p)).href;
  const errors = await import(u('lib/errors.js'));
  const events = await import(u('lib/proxy-events.js'));
  const workspace = await import(u('lib/workspace.js'));
  const scopes = await import(u('lib/proxy-scopes.js'));
  const refs = await import(u('lib/proxy-ref-resolver.js'));
  const pwe = await import(u('lib/partial-write-error.js'));
  const desc = await import(u('lib/description-edit.js'));
  const wire = await import(u('lib/proxy-wire.js'));
  const dedupe = await import(u('lib/proxy-dedupe.js'));
  const digest = await import(u('lib/digest-feedback.js'));
  // Register every provider (getProvider() in the tokens-admin mint response
  // reads the registry; the real server registers them at boot).
  await import(u('lib/providers/index.js'));
  let BYTE_IDENTICAL_ESCALATION_THRESHOLD = 3;
  try {
    ({ BYTE_IDENTICAL_ESCALATION_THRESHOLD } = await import(u('lib/rejected-credentials.js')));
  } catch { /* keep default */ }
  return {
    errors,
    jsonError: errors.jsonError,
    workspaceUnavailableEnvelope: errors.workspaceUnavailableEnvelope,
    STAGE_PROVIDER_LANE: events.STAGE_PROVIDER_LANE,
    STAGE_PROXY_TOKEN: events.STAGE_PROXY_TOKEN,
    TeamNotFoundError: workspace.TeamNotFoundError,
    UUID_REGEX: workspace.UUID_REGEX,
    validateWorkspaceUrlKey: workspace.validateWorkspaceUrlKey,
    getWorkspaceByUrlKey: workspace.getWorkspaceByUrlKey,
    READ_WRITE: scopes.READ_WRITE,
    parseSourceNamespace: refs.parseSourceNamespace,
    resolveStateRef: refs.resolveStateRef,
    resolveLabelRef: refs.resolveLabelRef,
    resolveProjectRef: refs.resolveProjectRef,
    resolveTeamRef: refs.resolveTeamRef,
    RefResolutionError: refs.RefResolutionError,
    PartialWriteError: pwe.PartialWriteError,
    DescriptionEditError: desc.DescriptionEditError,
    MAX_ATTACHMENT_BYTES: wire.MAX_ATTACHMENT_BYTES,
    createDedupeCache: dedupe.createDedupeCache,
    createGenerationTracker: dedupe.createGenerationTracker,
    digestFeedback: digest.digestFeedback,
    BYTE_IDENTICAL_ESCALATION_THRESHOLD,
  };
}

const PROXY_TOKEN_REJECTED_EXTRA_BASE = { code: 'PROXY_TOKEN_INVALID', category: 'auth', retryable: false };

/** Per-request context: scenario + fresh provider + recorder. */
export function newContext(scenario, libs) {
  const rec = newRecorder();
  const provider = buildProvider(materialize(scenario.provider, libs), rec, libs);
  return { sc: scenario, rec, provider, res: null, callCounts: new Map() };
}

// ===========================================================================
// Proxy-token lane (writes + rulings): the closures of createProxyRoutes.
// ===========================================================================
function proxyLaneDeps(holder, libs) {
  const { jsonError, workspaceUnavailableEnvelope, STAGE_PROVIDER_LANE, STAGE_PROXY_TOKEN, BYTE_IDENTICAL_ESCALATION_THRESHOLD } = libs;
  const ctx = () => holder.ctx;
  const PROXY_TOKEN_REJECTED_EXTRA = { ...PROXY_TOKEN_REJECTED_EXTRA_BASE, stage: STAGE_PROXY_TOKEN };
  const proxyEventStore = makeRecordingStore('proxyEventStore', ctx, libs);

  function registry(op, data) { ctx().rec.registry.push({ op, ...data }); }

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

  function graphqlErrorStatusImpl(err, req) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 504;
    const status = err.response?.status
      || err.response?.errors?.[0]?.extensions?.statusCode;
    if (status === 401 || status === 403) return isTransientProviderAuthFailure(req) ? 503 : 401;
    if (status === 404) return 404;
    if (status === 429) return 429;
    if (err.response?.errors?.[0]?.extensions?.userError === true) return 400;
    return 500;
  }

  function graphqlErrorStatus(err, req) {
    const c = ctx();
    let status;
    try {
      status = graphqlErrorStatusImpl(err, req);
    } catch (e) {
      c.rec.deps.push({ fn: 'graphqlErrorStatus', err: errSummary(err), threw: e.message });
      throw e;
    }
    c.rec.deps.push({ fn: 'graphqlErrorStatus', err: errSummary(err), status });
    return status;
  }

  // eslint-disable-next-line no-unused-vars
  function logEvent(req, endpoint, status, note = null, { skipWitness = false } = {}) {
    const c = ctx();
    // Every argument as passed (the options object raw, so `{ skipWitness: true }` is compared).
    c.rec.log.push({ endpoint: snap(endpoint), status: snap(status), note: snap(note), opts: arguments.length > 4 ? snap(arguments[4]) : '<omitted>' });
    if (status === 401 || status === 503) {
      registry('logCredentialRejection', { endpoint });
      const reason = status === 401
        ? 'provider-401'
        : (req.resolvedCredentialFingerprint ? 'provider-503-transient' : 'workspace-503');
      registry('markSuspect', { fingerprint: snap(req.resolvedCredentialFingerprint), reason });
    } else if (status >= 200 && status < 300 && req.resolvedCredentialFingerprint && !skipWitness) {
      registry('witnessAccepted', { fingerprint: req.resolvedCredentialFingerprint });
    }
    const stage = req.resolvedCredentialFingerprint !== undefined ? STAGE_PROVIDER_LANE : STAGE_PROXY_TOKEN;
    proxyEventStore.recordEvent({
      urlKey: req.proxyUrlKey,
      tokenId: req.proxyTokenId,
      tokenLabel: req.proxyTokenLabel,
      method: req.method,
      endpoint,
      status,
      note,
      stage,
      credentialFingerprint: req.resolvedCredentialFingerprint ?? null,
      credentialSource: req.resolvedCredentialSource ?? null,
    }).catch(err => console.error('Failed to log proxy event:', err?.message ?? err));
  }

  function denyIfUnsupported(activeProvider, method, req, res, endpoint) {
    ctx().rec.deps.push({ fn: 'denyIfUnsupported', method: snap(method), endpoint: snap(endpoint) });
    if (activeProvider.supports(method)) return false;
    logEvent(req, endpoint, 422);
    jsonError(res, 422, `This workspace's provider does not support this`, {
      code: 'CAPABILITY_NOT_SUPPORTED',
      capability: method,
      provider: activeProvider.name,
    });
    return true;
  }

  function denyIfMissingRead(activeProvider, method, req, res, endpoint) {
    ctx().rec.deps.push({ fn: 'denyIfMissingRead', method: snap(method), endpoint: snap(endpoint) });
    if (typeof activeProvider?.[method] === 'function') return false;
    logEvent(req, endpoint, 422);
    jsonError(res, 422, `This workspace's provider does not support this`, {
      code: 'CAPABILITY_NOT_SUPPORTED',
      capability: method,
      provider: activeProvider?.name,
    });
    return true;
  }

  function workspaceUnavailable(req, res, endpoint, reason) {
    ctx().rec.deps.push({ fn: 'workspaceUnavailable', endpoint: snap(endpoint), reason: snap(reason) });
    logEvent(req, endpoint, 503, reason);
    const { error, ...rest } = workspaceUnavailableEnvelope(reason, req.proxyUrlKey);
    return jsonError(res, 503, error, rest);
  }

  // eslint-disable-next-line no-unused-vars
  async function resolveProviderAccess(urlKey, ownerAccountId, req, { source } = {}) {
    const c = ctx();
    c.rec.deps.push({ fn: 'resolveProviderAccess', urlKey: snap(urlKey), ownerAccountId: snap(ownerAccountId), hasReq: !!req, opts: snap(arguments[3]), argc: arguments.length });
    const a = c.sc.access;
    if (a.throw) throw buildError(a.throw, libs);
    if (req && a.token) {
      req.resolvedCredentialFingerprint = a.credentialFingerprint ?? null;
      req.resolvedCredentialExpiresAt = Number.isFinite(a.expiresAt) ? a.expiresAt : null;
      req.resolvedCredentialSource = a.credentialSource ?? null;
    }
    const provider = c.provider;
    if (req && provider) {
      req.resolvedProvider = {
        name: provider.name,
        displayName: provider.ui?.displayName ?? provider.name,
        declared: a.declared ?? null,
        ui: provider.ui ?? null,
      };
    }
    registry('recordCredentialResolution', { urlKey: snap(urlKey), ownerAccountId: snap(ownerAccountId) });
    return { provider, token: a.token ? (a.scope ?? a.token) : a.token, reason: a.reason };
  }

  async function authenticateProxyToken(req, res, next) {
    const c = ctx();
    c.rec.deps.push({ fn: 'authenticateProxyToken' });
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError(res, 401, 'Missing or invalid Authorization header', PROXY_TOKEN_REJECTED_EXTRA);
    }
    const token = authHeader.slice(7);
    if (!token) {
      return jsonError(res, 401, 'Empty token', PROXY_TOKEN_REJECTED_EXTRA);
    }
    const s = c.sc.auth;
    if (s.mode === 'throws') {
      console.error('Proxy token validation error:', 'token store unreachable');
      return jsonError(res, 500, 'Authentication error');
    }
    if (s.mode === 'rejected') {
      registry('logCredentialRejection', { endpoint: 'auth' });
      const descriptor = s.descriptor || null;
      const extra = descriptor
        ? { ...PROXY_TOKEN_REJECTED_EXTRA, proxyTokenState: descriptor.state, ...(descriptor.state === 'expired' ? { proxyTokenExpiredAt: descriptor.expiresAt } : {}) }
        : PROXY_TOKEN_REJECTED_EXTRA;
      if (descriptor) {
        proxyEventStore.recordEvent({ urlKey: descriptor.urlKey, tokenId: null, tokenLabel: null, method: req.method, endpoint: req.originalUrl, status: 401, stage: STAGE_PROXY_TOKEN, note: descriptor.state }).catch(() => {});
      }
      return jsonError(res, 401, 'Invalid, expired, or consumed token', extra);
    }
    const r = s.result;
    req.proxyTokenId = r.tokenId;
    req.proxyUrlKey = r.urlKey;
    req.proxyTokenLabel = r.label;
    req.proxyTokenScope = r.scope;
    req.proxyCreatedBy = r.createdBy;
    req.proxyTokenGrants = r.grants || [];
    req.proxyWorkspaceId = r.workspaceId || null;
    next();
  }

  function requireWriteScope(req, res, next) {
    ctx().rec.deps.push({ fn: 'requireWriteScope', scope: snap(req.proxyTokenScope) });
    if (req.proxyTokenScope !== libs.READ_WRITE) {
      return jsonError(res, 403, 'This endpoint requires a read-write token');
    }
    next();
  }

  // Rate limiter: recorded; a scenario can make it answer 429 (express-rate-limit's message).
  function proxyLimiter(req, res, next) {
    const c = ctx();
    c.rec.deps.push({ fn: 'proxyLimiter' });
    if (c.sc.limiter?.proxyLimiter === 'block') {
      return res.status(429).json({ error: 'Too many proxy requests, please try again later' });
    }
    next();
  }

  return {
    proxyEventStore, registry, graphqlErrorStatus, logEvent, denyIfUnsupported, denyIfMissingRead,
    workspaceUnavailable, resolveProviderAccess, authenticateProxyToken, requireWriteScope, proxyLimiter,
  };
}

// ===========================================================================
// createProxyWriteRoutes
// ===========================================================================
export const WRITES_VARIANTS = ['full', 'noLedger', 'noTicket', 'bare'];

export function createWritesDeps(holder, libs, variant) {
  const lane = proxyLaneDeps(holder, libs);
  const ctx = () => holder.ctx;
  const { jsonError, UUID_REGEX, parseSourceNamespace, resolveStateRef, resolveLabelRef, resolveProjectRef, resolveTeamRef, RefResolutionError, PartialWriteError } = libs;
  const { logEvent } = lane;

  function writeRejected(req, res, endpoint, payload, errorMessage) {
    ctx().rec.deps.push({ fn: 'writeRejected', endpoint: snap(endpoint), message: snap(errorMessage) });
    if (payload && payload.success === true) return false;
    logEvent(req, endpoint, 502);
    jsonError(res, 502, errorMessage, { detail: payload || null });
    return true;
  }
  async function resolveTeamInput(activeProvider, token, rawRef) {
    ctx().rec.deps.push({ fn: 'resolveTeamInput', rawRef: snap(rawRef) });
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const teams = await activeProvider.fetchTeams(token);
    return resolveTeamRef(teams, localRef);
  }
  async function resolveStateInput(activeProvider, token, teamId, rawRef) {
    ctx().rec.deps.push({ fn: 'resolveStateInput', teamId: snap(teamId), rawRef: snap(rawRef) });
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    if (!teamId) {
      throw new RefResolutionError(
        `Cannot resolve state '${localRef}' — the issue's team could not be determined`,
        { status: 422 },
      );
    }
    const states = await activeProvider.states(token, teamId);
    return resolveStateRef(states, localRef);
  }
  async function resolveProjectInput(activeProvider, token, rawRef) {
    ctx().rec.deps.push({ fn: 'resolveProjectInput', rawRef: snap(rawRef) });
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const projects = await activeProvider.fetchProjectsList(token);
    return resolveProjectRef(projects, localRef);
  }
  async function resolveLabelInput(activeProvider, token, rawRef) {
    ctx().rec.deps.push({ fn: 'resolveLabelInput', rawRef: snap(rawRef) });
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const labels = await activeProvider.labels(token, null);
    return resolveLabelRef(labels, localRef);
  }
  function refResolutionFailed(req, res, endpoint, err) {
    ctx().rec.deps.push({ fn: 'refResolutionFailed', endpoint: snap(endpoint), err: errSummary(err) });
    if (!(err instanceof RefResolutionError)) return false;
    logEvent(req, endpoint, err.status);
    jsonError(res, err.status, err.message, err.candidates ? { candidates: err.candidates } : undefined);
    return true;
  }
  function partialWriteFailed(req, res, endpoint, err) {
    ctx().rec.deps.push({ fn: 'partialWriteFailed', endpoint: snap(endpoint), err: errSummary(err) });
    if (!(err instanceof PartialWriteError)) return false;
    const status = err.status || 500;
    logEvent(req, endpoint, status, `PARTIAL_WRITE applied=${err.applied.join(',') || 'none'} failed=${err.failed}`);
    jsonError(res, status, err.message, {
      code: 'PARTIAL_WRITE',
      category: 'upstream',
      retryable: true,
      detail: err.cause?.message || null,
      context: { applied: err.applied, failed: err.failed },
    });
    return true;
  }

  // Module-scope singletons in routes/proxy.js: REAL instances, one per app
  // (sharing one would let the second app see the first app's dedupe hits),
  // wrapped so get/set/current/bump are recorded with arguments and results.
  // They persist across requests, exactly as in production; the clock is frozen,
  // so the TTL never lapses.
  const commentDedupe = wrapRecording('commentDedupe', libs.createDedupeCache(), ctx);
  const commentDedupeGenerations = wrapRecording('commentDedupeGenerations', libs.createGenerationTracker(), ctx);
  const harbourCommentsStore = (variant === 'full' || variant === 'noTicket') ? makeRecordingStore('harbourCommentsStore', ctx, libs) : null;

  // LIN-3366 ticket-closer seam: fire-and-forget; may read back, may throw.
  async function onTicketWrite(args) {
    const c = ctx();
    c.rec.deps.push({ fn: 'onTicketWrite', args: snap({ ...args }) });
    const t = c.sc.ticketWrite || {};
    if (t.readBack && typeof args?.readBack === 'function') {
      const back = await args.readBack();
      c.rec.deps.push({ fn: 'onTicketWrite.readBack', result: snap(back) });
    }
    if (t.throw) throw buildError(t.throw, libs);
  }

  return {
    onTicketWrite: (variant === 'full' || variant === 'noLedger') ? onTicketWrite : null,
    proxyLimiter: lane.proxyLimiter,
    commentDedupe,
    commentDedupeGenerations,
    authenticateProxyToken: lane.authenticateProxyToken,
    requireWriteScope: lane.requireWriteScope,
    resolveProviderAccess: lane.resolveProviderAccess,
    denyIfUnsupported: lane.denyIfUnsupported,
    denyIfMissingRead: lane.denyIfMissingRead,
    workspaceUnavailable: lane.workspaceUnavailable,
    graphqlErrorStatus: lane.graphqlErrorStatus,
    writeRejected,
    resolveTeamInput,
    resolveStateInput,
    resolveProjectInput,
    resolveLabelInput,
    refResolutionFailed,
    partialWriteFailed,
    logEvent,
    harbourCommentsStore,
  };
}

// ===========================================================================
// createRulingsRoutes
// ===========================================================================
export const RULINGS_VARIANTS = ['full', 'noCache', 'noSuggest', 'noTaskShelf', 'bare'];

export function createRulingsDeps(holder, libs, variant) {
  const lane = proxyLaneDeps(holder, libs);
  const ctx = () => holder.ctx;
  const has = (k) => variant === 'full' || (variant === 'noCache' && k !== 'cache') || (variant === 'noSuggest' && k !== 'suggest') || (variant === 'noTaskShelf' && k !== 'task' && k !== 'shelf');

  // Shared SWR cache (lib/sessions-feed-cache.js): keyFor mirrors the real one;
  // get() is a scenario-driven hit / miss (runs the producer) / throw.
  const sessionsFeedCache = {
    keyFor(workspaces, view) {
      const base = (workspaces || []).map(w => w.urlKey).sort().join(',');
      const key = view ? `${view}::${base}` : base;
      ctx().rec.store.push({ store: 'sessionsFeedCache', op: 'keyFor', args: [snap(workspaces), snap(view)], ret: key });
      return key;
    },
    async get(key, producer) {
      const c = ctx();
      c.rec.store.push({ store: 'sessionsFeedCache', op: 'get', args: [snap(key), snap(producer)] });
      const fc = c.sc.feedCache || { mode: 'miss' };
      if (fc.mode === 'throw') throw buildError(fc.throw || { kind: 'plain', message: 'cache down' }, libs);
      if (fc.mode === 'hit') return materialize(fc.cached, libs);
      return await producer();
    },
    peek(key) { ctx().rec.store.push({ store: 'sessionsFeedCache', op: 'peek', args: [snap(key)] }); return undefined; },
    set(key, value) { ctx().rec.store.push({ store: 'sessionsFeedCache', op: 'set', args: [snap(key), snap(value)] }); },
    clear(urlKey) { ctx().rec.store.push({ store: 'sessionsFeedCache', op: 'clear', args: [snap(urlKey)] }); },
  };
  sessionsFeedCache[Symbol.for('replay.storeName')] = 'sessionsFeedCache';

  return {
    proxyLimiter: lane.proxyLimiter,
    authenticateProxyToken: lane.authenticateProxyToken,
    requireWriteScope: lane.requireWriteScope,
    logEvent: lane.logEvent,
    // getLoopsForWorkspace (lib/pipeline-loops.js, real) reads these two. No
    // `historyCollection`, so its lean self-heal never runs: every history row
    // is seeded with a fresh digest (withFreshDigests, as the unit test does).
    dispatchQueueStore: makeRecordingStore('dispatchQueueStore', ctx, libs, { hiddenProps: ['historyCollection'] }),
    agentStatusStore: makeRecordingStore('agentStatusStore', ctx, libs),
    taskDecisionsStore: has('task') ? makeRecordingStore('taskDecisionsStore', ctx, libs) : null,
    shelvedRulingsStore: has('shelf') ? makeRecordingStore('shelvedRulingsStore', ctx, libs) : null,
    dismissalSuggestionsStore: has('suggest') ? makeRecordingStore('dismissalSuggestionsStore', ctx, libs) : null,
    sessionsFeedCache: has('cache') ? sessionsFeedCache : null,
  };
}

// ===========================================================================
// createTokensAdminRoutes
// ===========================================================================
export const TOKENS_VARIANTS = ['full'];

export function createTokensDeps(holder, libs, variant, sideModule) {
  const ctx = () => holder.ctx;
  const { errors, validateWorkspaceUrlKey, getWorkspaceByUrlKey } = libs;

  // Transcription of server.js workspaceFromUrl. The two HTML pages it can
  // render are stubbed with fixed text (identical on both sides).
  function workspaceFromUrl(req, res, next) {
    ctx().rec.deps.push({ fn: 'workspaceFromUrl', urlKey: snap(req.params?.urlKey) });
    try {
      const { urlKey } = req.params;
      if (!validateWorkspaceUrlKey(urlKey)) {
        if (req.path.includes('/api/')) {
          return errors.badRequest.json(res, 'Invalid workspace URL');
        }
        return res.status(404).send('<!doctype html><title>stub:workspace-not-found</title>invalid');
      }
      if (!req.session.workspaces || req.session.workspaces.length === 0) {
        if (req.path.includes('/api/')) {
          return errors.unauthorized.json(res, 'Not authenticated');
        }
        return res.redirect('/');
      }
      const workspace = getWorkspaceByUrlKey(req.session, urlKey);
      if (!workspace) {
        return res.status(404).send(`<!doctype html><title>stub:workspace-not-found</title>${String(urlKey)}`);
      }
      req.workspace = workspace;
      next();
    } catch (error) {
      console.error('Error in workspaceFromUrl middleware:', error?.message ?? error);
      if (req.path.includes('/api/')) {
        return errors.serverError.json(res, 'Internal server error');
      }
      return res.status(500).send('<!doctype html><title>stub:error</title>');
    }
  }

  // The two limiters are express-rate-limit instances in routes/proxy.js whose
  // `skip` reads the router module's own isDefaultCopyMint export. Modelled as
  // recorders that evaluate THIS side's isDefaultCopyMint (so a change to that
  // export shows up) and can answer 429 on scenario demand.
  function limiter(name) {
    return function rateLimiter(req, res, next) {
      const c = ctx();
      let isDefault;
      try { isDefault = sideModule?.isDefaultCopyMint ? sideModule.isDefaultCopyMint(req) : { __missing: true }; } catch (e) { isDefault = { __threw: e.message }; }
      c.rec.deps.push({ fn: name, method: req.method, isDefaultCopyMint: snap(isDefault), hasAccount: !!req.session?.accountId });
      if (c.sc.limiter?.[name] === 'block') {
        return res.status(429).json({ error: 'Too many token creation requests, please try again later' });
      }
      next();
    };
  }

  return {
    proxyTokenStore: makeRecordingStore('proxyTokenStore', ctx, libs),
    proxyEventStore: makeRecordingStore('proxyEventStore', ctx, libs),
    workspaceFromUrl,
    proxyTokenCreationLimiter: limiter('proxyTokenCreationLimiter'),
    defaultCopyTokenCreationLimiter: limiter('defaultCopyTokenCreationLimiter'),
  };
}
