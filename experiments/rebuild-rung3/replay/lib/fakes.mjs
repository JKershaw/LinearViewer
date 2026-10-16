// Deterministic fake deps for createReadRoutes, modelled on the real closures in
// routes/proxy.js (authenticateProxyToken, resolveProviderAccess,
// denyIfUnsupported, logEvent, workspaceUnavailable, graphqlErrorStatus /
// isTransientProviderAuthFailure) and on the fake-provider shapes in
// tests/unit/lib/proxy-fake-deps.js.
//
// Every dep is a thin dispatcher onto `holder.ctx` — the per-request context
// (materialized scenario + recorder) the harness installs before each request.
// The scenario is pure data; `materialize` builds fresh objects/errors from it
// for each app, so a handler mutating a provider result in place (flattenIssue
// does) can never leak into the other app or the next request.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function loadRepoLibs(repoRoot) {
  const u = (p) => pathToFileURL(path.join(repoRoot, p)).href;
  const errors = await import(u('lib/errors.js'));
  const events = await import(u('lib/proxy-events.js'));
  const workspace = await import(u('lib/workspace.js'));
  const wire = await import(u('lib/proxy-wire.js'));
  const fetchMod = await import(u('lib/proxy-fetch.js'));
  let BYTE_IDENTICAL_ESCALATION_THRESHOLD = 3;
  try {
    ({ BYTE_IDENTICAL_ESCALATION_THRESHOLD } = await import(u('lib/rejected-credentials.js')));
  } catch { /* keep default */ }
  return {
    jsonError: errors.jsonError,
    workspaceUnavailableEnvelope: errors.workspaceUnavailableEnvelope,
    STAGE_PROVIDER_LANE: events.STAGE_PROVIDER_LANE,
    STAGE_PROXY_TOKEN: events.STAGE_PROXY_TOKEN,
    TeamNotFoundError: workspace.TeamNotFoundError,
    MAX_ATTACHMENT_BYTES: wire.MAX_ATTACHMENT_BYTES,
    setProxyFetchImpl: fetchMod.setProxyFetchImpl,
    BYTE_IDENTICAL_ESCALATION_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Snapshotting (for recorded call args) — canonical, cycle-safe, JSON-able.
// ---------------------------------------------------------------------------
export function snap(v, depth = 0, seen = new WeakSet()) {
  if (v === undefined) return { __undefined: true };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { __number: String(v) };
  if (typeof v === 'bigint') return { __bigint: String(v) };
  if (typeof v === 'function') return { __fn: v.name || 'anonymous' };
  if (typeof v === 'symbol') return { __symbol: String(v) };
  if (depth > 12) return { __deep: true };
  if (seen.has(v)) return { __cycle: true };
  seen.add(v);
  if (v instanceof Error) return { __error: v.name, message: v.message };
  if (typeof AbortSignal !== 'undefined' && v instanceof AbortSignal) return { __abortSignal: true };
  if (v && typeof v === 'object' && typeof v.pipe === 'function' && 'headers' in v && 'method' in v) return { __request: `${v.method} ${v.originalUrl || v.url}` };
  if (Buffer.isBuffer(v)) return { __buffer: v.length };
  if (Array.isArray(v)) {
    const out = v.map(x => snap(x, depth + 1, seen));
    const extra = Object.keys(v).filter(k => !/^\d+$/.test(k));
    if (extra.length) return { __array: out, __props: Object.fromEntries(extra.map(k => [k, snap(v[k], depth + 1, seen)])) };
    return out;
  }
  const out = {};
  for (const k of Object.keys(v)) out[k] = snap(v[k], depth + 1, seen);
  return out;
}

function errSummary(err) {
  if (err === null || err === undefined || typeof err !== 'object') return { thrown: snap(err) };
  return { name: err.name, message: err.message, responseStatus: err.response?.status, status: err.status };
}

// ---------------------------------------------------------------------------
// Scenario materialization
// ---------------------------------------------------------------------------
export function buildError(e, libs) {
  let err;
  switch (e.kind) {
    case 'gql':
      err = new Error(e.message || `GraphQL Error (Code: ${e.status})`);
      err.name = 'ClientError';
      err.response = { status: e.status, errors: e.errors, headers: {} };
      return err;
    case 'statusOnly':
      err = new Error(e.message || 'upstream error');
      err.status = e.status;
      return err;
    case 'timeout':
      err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      return err;
    case 'abort':
      err = new Error('This operation was aborted');
      err.name = 'AbortError';
      return err;
    case 'network':
      err = new TypeError(e.message || 'fetch failed');
      err.cause = { code: e.code };
      return err;
    case 'team':
      return new libs.TeamNotFoundError(e.teamId, e.truncated);
    case 'notImpl':
      err = new Error(`${e.method} is not implemented by this provider`);
      err.name = 'NotImplementedError';
      return err;
    case 'redirectCause':
      err = new TypeError('fetch failed');
      err.cause = { code: 'ERR_FR_TOO_MANY_REDIRECTS' };
      return err;
    case 'redirectMsg':
      return new TypeError('redirect mode is set to error');
    case 'string':
      return e.value;
    case 'null':
      return null;
    case 'plain':
    default:
      return new Error(e.message || 'boom');
  }
}

export function materialize(v, libs) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => materialize(x, libs));
  if (v.__arrayWithProps) {
    const arr = v.items.map(x => materialize(x, libs));
    Object.assign(arr, materialize(v.props, libs));
    return arr;
  }
  if (v.__err) return buildError(v.__err, libs);
  const out = {};
  for (const k of Object.keys(v)) out[k] = materialize(v[k], libs);
  return out;
}

export function newRecorder() {
  return { provider: [], log: [], store: [], deps: [], fetch: [], registry: [], console: [], unhandled: [], expressErrors: [] };
}

const PROXY_TOKEN_REJECTED_EXTRA_BASE = { code: 'PROXY_TOKEN_INVALID', category: 'auth', retryable: false };

/**
 * Build the provider object for one request/app from the scenario.
 */
function buildProvider(spec, rec, libs) {
  if (spec == null) return spec; // null/undefined provider (probes `resolved.provider?.name`)
  const unsupported = new Set(spec.unsupported || []);
  const provider = {
    name: spec.name,
    ui: spec.ui ?? null,
    supports(method) {
      rec.provider.push({ method: 'supports', args: [snap(method)] });
      return !unsupported.has(method);
    },
  };
  const methods = spec.methods || {};
  for (const name of Object.keys(methods)) {
    const behaviour = methods[name];
    let calls = 0;
    provider[name] = async (...args) => {
      rec.provider.push({ method: name, args: args.map(a => snap(a)) });
      const b = Array.isArray(behaviour.seq) ? behaviour.seq[Math.min(calls, behaviour.seq.length - 1)] : behaviour;
      calls++;
      if (b.throw) throw buildError(b.throw, libs);
      return materialize(b.ret, libs);
    };
  }
  return provider;
}

/**
 * The deps object handed to createReadRoutes. `holder.ctx` is swapped per request.
 */
export function createFakeDeps(holder, libs) {
  const { jsonError, workspaceUnavailableEnvelope, STAGE_PROVIDER_LANE, STAGE_PROXY_TOKEN, BYTE_IDENTICAL_ESCALATION_THRESHOLD } = libs;
  const ctx = () => holder.ctx;
  const PROXY_TOKEN_REJECTED_EXTRA = { ...PROXY_TOKEN_REJECTED_EXTRA_BASE, stage: STAGE_PROXY_TOKEN };

  function storeCall(op, args) {
    const c = ctx();
    c.rec.store.push({ op, args: args.map(a => snap(a)) });
    const b = c.sc.store?.[op];
    return b;
  }

  const proxyEventStore = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      return async (...args) => {
        const b = storeCall(prop, args);
        if (prop === 'recordEvent') {
          if (b?.throw) throw buildError(b.throw, libs);
          return undefined;
        }
        if (!b) return undefined;
        if (b.throw) throw buildError(b.throw, libs);
        return materialize(b.ret, libs);
      };
    },
  });

  function registry(op, data) {
    ctx().rec.registry.push({ op, ...data });
  }

  // Mirror of routes/proxy.js isTransientProviderAuthFailure, registry state from scenario.
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

  // Mirror of routes/proxy.js graphqlErrorStatus.
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

  // Mirror of routes/proxy.js logEvent.
  function logEvent(req, endpoint, status, note = null, opts = {}) {
    const { skipWitness = false } = opts || {};
    const c = ctx();
    c.rec.log.push({ endpoint: snap(endpoint), status: snap(status), note: snap(note), skipWitness });
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
    }).catch(() => { c.rec.registry.push({ op: 'recordEventRejected' }); });
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

  function workspaceUnavailable(req, res, endpoint, reason) {
    ctx().rec.deps.push({ fn: 'workspaceUnavailable', endpoint: snap(endpoint), reason: snap(reason) });
    logEvent(req, endpoint, 503, reason);
    const { error, ...rest } = workspaceUnavailableEnvelope(reason, req.proxyUrlKey);
    return jsonError(res, 503, error, rest);
  }

  async function resolveProviderAccess(urlKey, ownerAccountId, req, opts = {}) {
    const c = ctx();
    const { source } = opts || {};
    c.rec.deps.push({ fn: 'resolveProviderAccess', urlKey: snap(urlKey), ownerAccountId: snap(ownerAccountId), source: snap(source), hasReq: !!req, extraArgs: snap(opts) });
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

  // Mirror of routes/proxy.js authenticateProxyToken.
  async function authenticateProxyToken(req, res, next) {
    const c = ctx();
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

  // Rate limiter: pass-through, but counted (a rewrite that drops it shows up).
  function proxyLimiter(req, res, next) {
    ctx().rec.deps.push({ fn: 'proxyLimiter' });
    next();
  }

  return { proxyLimiter, authenticateProxyToken, resolveProviderAccess, denyIfUnsupported, logEvent, workspaceUnavailable, graphqlErrorStatus, proxyEventStore };
}

/**
 * Per-request context for one app: materialized scenario + fresh provider + recorder.
 */
export function newContext(scenario, libs) {
  const rec = newRecorder();
  const sc = scenario; // scenario is read-only data; materialize() copies on use
  const provider = buildProvider(materialize(sc.provider, libs), rec, libs);
  return { sc, rec, provider, res: null };
}

/**
 * Fake egress transport (attachment relay). Same object installed as
 * setProxyFetchImpl override AND globalThis.fetch.
 */
export function makeFakeFetch(holder, libs) {
  return async function fakeFetch(url, opts = {}) {
    const c = holder.ctx;
    if (!c) throw new Error('egress outside a request');
    c.rec.fetch.push({ url: String(url), opts: snap(opts) });
    const f = c.sc.fetch;
    if (!f) throw new TypeError('fetch failed');
    if (f.throw) throw buildError(f.throw, libs);
    const headers = new Headers();
    if (f.contentType != null) headers.set('content-type', f.contentType);
    if (f.contentLength != null) headers.set('content-length', f.contentLength);
    const body = f.big ? Buffer.alloc(libs.MAX_ATTACHMENT_BYTES + 1, 0x61) : Buffer.from(f.body ?? '', 'utf8');
    return {
      ok: f.status >= 200 && f.status < 300,
      status: f.status,
      headers,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => body.toString('utf8'),
      json: async () => JSON.parse(body.toString('utf8')),
    };
  };
}
