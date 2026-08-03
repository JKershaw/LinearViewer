/**
 * LIN-1458 — "fail observably": witness which OpenRouter credential source
 * served a proxy request when the token creator's OWN account-keyed read
 * (getWorkspaceOpenRouterKey) came back empty.
 *
 * routes/proxy.js's logOpenRouterCredentialSource helper is called once per
 * request at the six top-level OpenRouter call sites (GET/POST recommend,
 * recap, brief, plus recommend-and-dispatch), after the existing 503
 * "not configured" gate. It writes an additive audit-note row
 * (openrouter_key_fallback_paid_env / openrouter_key_fallback_free_tier) via
 * the existing logEvent channel — no resolver contract change, no new store.
 *
 * The note is deliberately suppressed under isTestMode (process.env.NODE_ENV
 * === 'test' && accessToken === 'test-token'), so witnessing it live requires
 * a NON-test-token access token. lib/providers/linear/index.js hardcodes
 * https://api.linear.app with no injection seam (LIN-1458's approved plan
 * scoped no such seam), so a bogus token here really does hit the real Linear
 * API and fail authentication downstream of our witness call — exactly as
 * the plan-review's session-fit note (round 2, Advisory A4) anticipated: "the
 * new route-level cases must run with a non-test-token access token and
 * assert the row written before generation; the downstream Linear/OpenRouter
 * call may then fail, and the fire-and-forget row survives that." Every
 * assertion below is on the recorded proxy-event rows, never on the
 * (deliberately unreachable) success response body.
 *
 * Scaffolding mirrors tests/unit/proxy-token-route-ownerless.test.js: the real
 * route factory, handlers pulled directly off router.stack (bypassing
 * proxyLimiter/authenticateProxyToken/requireWriteScope, which this unit
 * harness deliberately does not drive).
 *
 * Run with: node --test tests/unit/proxy-openrouter-fallback-note.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyRoutes } from '../../routes/proxy.js';

const PAID_NOTE = 'openrouter_key_fallback_paid_env';
const FREE_NOTE = 'openrouter_key_fallback_free_tier';
const LIN_961_NOTE = 'free-tier fallback: no paid/OAuth key resolved';

function getHandler(router, method, path) {
  const layer = router.stack.find(l => {
    if (!l.route || !l.route.methods[method]) return false;
    const p = l.route.path;
    return Array.isArray(p) ? p.includes(path) : p === path;
  });
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  // The LAST handler in the stack is the route's own; earlier entries are
  // middleware (rate limiter, token auth, write-scope guard) this unit
  // harness deliberately bypasses.
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
    // armKeepalive's flush path is never reached at these response times
    // (well under its 25s delayMs), but stub the surface defensively.
    setHeader() {}, removeHeader() {}, flushHeaders() {}, write() {}, end() {}, on() {}, once() {},
  };
}

/**
 * `accessToken` defaults to a syntactically-valid but bogus, non-test-token
 * value so isTestMode is false and the witness call is live — see file
 * header. Pass `accessToken: 'test-token'` for the isTestMode negative cases.
 */
function buildRouter({ getWorkspaceOpenRouterKey, events, accessToken = 'not-a-real-linear-token', dispatchQueueStore = {} }) {
  return createProxyRoutes({
    proxyTokenStore: {},
    proxyEventStore: { recordEvent: async (e) => { events.push(e); return e; } },
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, put: async () => {} },
    briefCacheStore: { get: async () => null, put: async () => {} },
    taskSnapshotStore: null,
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: async () => ({ token: accessToken, reason: null }),
    getWorkspaceOpenRouterKey,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true, remaining: 19, limit: 20, resetsAt: null }) },
  });
}

function baseReq(overrides = {}) {
  return {
    method: 'GET',
    proxyUrlKey: 'acme',
    proxyCreatedBy: 'account-A',
    proxyTokenId: 'tok-1',
    proxyTokenLabel: 'worker',
    params: {},
    query: {},
    ...overrides,
  };
}

/** Save/restore an env var around one test, mirroring the ownerless-token spec's `restore()`. */
function withEnv(t, key, value) {
  const before = process.env[key];
  t.after(() => {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  });
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('LIN-1458 — OpenRouter fallback-credential-source audit note', () => {
  test('GET /recommend: creator key present → no fallback note is written', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', undefined);
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => 'sk-or-real-creator-key', events });
    const handler = getHandler(router, 'get', '/api/proxy/issues/:identifier/recommend');

    await handler(baseReq({ params: { identifier: 'TEST-2' } }), makeRes());

    assert.ok(events.length >= 1, 'the terminal response is still logged');
    assert.ok(!events.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `no fallback note when the creator's own key resolved: ${JSON.stringify(events)}`);
  });

  test('GET /recommend: creator key absent + OPENROUTER_API_KEY set → exactly one paid-env fallback note', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events });
    const handler = getHandler(router, 'get', '/api/proxy/issues/:identifier/recommend');

    await handler(baseReq({ params: { identifier: 'TEST-2' } }), makeRes());

    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one paid-env note: ${JSON.stringify(events)}`);
    assert.equal(paidNotes[0].status, 200, 'the witness row itself is a 200, independent of the eventual response');
    assert.ok(!events.some(e => e.note === FREE_NOTE), 'must not also claim free tier');
  });

  test('GET /recommend: creator key absent + only OPENROUTER_FREE_TIER_KEY set → free-tier fallback note alongside the existing LIN-961 row', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', undefined);
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', 'sk-or-fake-free-tier-key');
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events });
    const handler = getHandler(router, 'get', '/api/proxy/issues/:identifier/recommend');

    await handler(baseReq({ params: { identifier: 'TEST-2' } }), makeRes());

    const freeNotes = events.filter(e => e.note === FREE_NOTE);
    const lin961Notes = events.filter(e => e.note === LIN_961_NOTE);
    assert.equal(freeNotes.length, 1, `expected exactly one free-tier fallback note: ${JSON.stringify(events)}`);
    assert.equal(lin961Notes.length, 1, 'the pre-existing LIN-961 breadcrumb must still fire — additive, not a replacement');
    assert.ok(!events.some(e => e.note === PAID_NOTE), 'must not also claim paid-env');
  });

  test('GET /recommend: ?kind= override → no fallback note (no real credential attempt is made)', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', undefined);
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events });
    const handler = getHandler(router, 'get', '/api/proxy/issues/:identifier/recommend');

    await handler(baseReq({ params: { identifier: 'TEST-2' }, query: { kind: 'implementation' } }), makeRes());

    assert.ok(!events.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `kind-override must bypass the 503 gate AND the witness together: ${JSON.stringify(events)}`);
  });

  test('GET /recommend: isTestMode (test-token) → no fallback note, fully deterministic (no live Linear/OpenRouter call)', async (t) => {
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events, accessToken: 'test-token' });
    const handler = getHandler(router, 'get', '/api/proxy/issues/:identifier/recommend');

    await handler(baseReq({ params: { identifier: 'TEST-2' } }), makeRes());

    assert.ok(!events.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `isTestMode must suppress the witness: ${JSON.stringify(events)}`);
  });

  test('POST /recommend-and-dispatch: fallback note witnessed exactly once per request', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events, dispatchQueueStore: {} });
    const handler = getHandler(router, 'post', '/api/proxy/recommend-and-dispatch');

    await handler(baseReq({
      method: 'POST',
      body: { issueIdentifier: 'TEST-2' },
      protocol: 'https',
      get: () => 'example.com',
    }), makeRes());

    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one witness row for the whole request: ${JSON.stringify(events)}`);
  });

  test('POST /recap (force-regenerate): fallback note witnessed before the (failing) regeneration', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events });
    const handler = getHandler(router, 'post', '/api/proxy/recap/:identifier');

    await handler(baseReq({ method: 'POST', params: { identifier: 'TEST-2' } }), makeRes());

    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one paid-env note: ${JSON.stringify(events)}`);
  });

  test('POST /brief (force-regenerate): fallback note witnessed before the (failing) regeneration', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];
    const router = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events });
    const handler = getHandler(router, 'post', '/api/proxy/brief/:identifier');

    await handler(baseReq({ method: 'POST', params: { identifier: 'TEST-2' } }), makeRes());

    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one paid-env note: ${JSON.stringify(events)}`);
  });

  test('POST /recap and POST /brief: isTestMode → no fallback note, fully deterministic', async (t) => {
    const recapEvents = [];
    const recapRouter = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events: recapEvents, accessToken: 'test-token' });
    await getHandler(recapRouter, 'post', '/api/proxy/recap/:identifier')(
      baseReq({ method: 'POST', params: { identifier: 'TEST-2' } }), makeRes()
    );
    assert.ok(!recapEvents.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `isTestMode must suppress the witness on POST /recap: ${JSON.stringify(recapEvents)}`);

    const briefEvents = [];
    const briefRouter = buildRouter({ getWorkspaceOpenRouterKey: async () => null, events: briefEvents, accessToken: 'test-token' });
    await getHandler(briefRouter, 'post', '/api/proxy/brief/:identifier')(
      baseReq({ method: 'POST', params: { identifier: 'TEST-2' } }), makeRes()
    );
    assert.ok(!briefEvents.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `isTestMode must suppress the witness on POST /brief: ${JSON.stringify(briefEvents)}`);
  });
});
