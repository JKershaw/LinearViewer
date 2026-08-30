/**
 * Unit tests for routes/openrouter-auth.js's consent surfaces (LIN-2412).
 *
 * Drives the router's handlers directly (mirrors tests/unit/jira-auth.test.js's
 * getHandler/makeRes/makeSession pattern) against a fake userPreferencesStore
 * implementing the real UserPreferencesStore contract, so this pins routing
 * behavior without a live Mongo/Mango collection or a live OpenRouter call.
 *
 * Coverage:
 *   - GET /auth/openrouter renders the consent interstitial (LIN-2412 F1
 *     correction) — a real choice, not an immediate redirect/pending-consent
 *     stash. No PKCE state or session flag is touched by the GET itself.
 *   - POST /auth/openrouter/begin (the interstitial's submit target) stashes
 *     pending-consent ONLY on the grant choice; a decline proceeds to the
 *     OpenRouter redirect exactly the same, but with no pending-consent flag.
 *   - The full production chain — GET renders the choice, POST /begin
 *     branches on it, the callback records (or withholds) consent — is
 *     driven end to end for BOTH the grant and decline paths, so the
 *     callback's guard is exercised via real branching code, not by a test
 *     hand-setting `session.openRouterPendingConsent` directly.
 *   - POST /auth/openrouter/consent requires Linear auth + an existing durable
 *     key, and sets consent for an already-connected account (400/409 cases).
 *   - POST /auth/openrouter/disconnect clears both the key and consent
 *     (delegated to UserPreferencesStore.clearOpenRouterApiKey, already
 *     covered at the store layer — this pins the ROUTE calls it).
 *
 * Run with: node --test tests/unit/openrouter-auth.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterAuthRoutes } from '../../routes/openrouter-auth.js';

function getHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    jsonBody: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    send(html) { this.body = html; return this; },
    json(obj) { this.jsonBody = obj; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
}

function makeSession(initial = {}) {
  return {
    ...initial,
    save(cb) { if (cb) cb(); },
  };
}

const WORKSPACE = { id: 'ws-uuid-1', urlKey: 'acme', name: 'Acme' };

// Fake UserPreferencesStore implementing exactly the surface routes/openrouter-auth.js
// calls, over an in-memory map — mirrors the real store's read-merge contract
// (tests/unit/openrouter-key-persistence.test.js's mock collection does the
// same thing one layer down; this fakes the store itself for route-level tests).
function fakeUserPreferencesStore() {
  const docs = new Map(); // accountId -> { openRouterApiKey?, openRouterDurableConsentAt? }
  return {
    docs,
    async getOpenRouterApiKey(accountId) {
      return docs.get(accountId)?.openRouterApiKey || null;
    },
    async setOpenRouterApiKey(accountId, apiKey) {
      docs.set(accountId, { ...(docs.get(accountId) || {}), openRouterApiKey: apiKey });
      return true;
    },
    async clearOpenRouterApiKey(accountId) {
      const existing = docs.get(accountId) || {};
      const { openRouterApiKey, openRouterDurableConsentAt, ...rest } = existing;
      docs.set(accountId, rest);
      return true;
    },
    async getOpenRouterConsent(accountId) {
      return docs.get(accountId)?.openRouterDurableConsentAt || null;
    },
    async setOpenRouterConsent(accountId) {
      docs.set(accountId, { ...(docs.get(accountId) || {}), openRouterDurableConsentAt: '2026-08-30T12:00:00.000Z' });
      return true;
    }
  };
}

describe('routes/openrouter-auth.js: consent beat (LIN-2412)', () => {
  let userPreferencesStore;
  let router;

  beforeEach(() => {
    userPreferencesStore = fakeUserPreferencesStore();
    router = createOpenRouterAuthRoutes({ userPreferencesStore });
  });

  test('GET /auth/openrouter renders the consent interstitial WITHOUT touching PKCE state or redirecting to OpenRouter', async () => {
    const handler = getHandler(router, 'get', '/auth/openrouter');
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-1' });
    const req = { session, protocol: 'https', get: () => 'harbour.example', query: {} };
    const res = makeRes();

    await handler(req, res);

    assert.equal(session.openRouterPendingConsent, undefined, 'the GET must not decide consent — only the interstitial submit does');
    assert.equal(session.openRouterCodeVerifier, undefined, 'no PKCE state until the choice is actually submitted');
    assert.equal(res.redirectedTo, null, 'must render the interstitial, not redirect straight to OpenRouter');
    assert.ok(res.body, 'must render an HTML body');
    assert.match(res.body, /openrouter-consent-page/);
    assert.match(res.body, /openrouter-consent-grant-submit/, 'must offer a real grant choice');
    assert.match(res.body, /openrouter-consent-decline-submit/, 'must offer a real decline choice');
  });

  test('GET /auth/openrouter with no active workspace redirects home WITHOUT rendering the interstitial', async () => {
    const handler = getHandler(router, 'get', '/auth/openrouter');
    const session = makeSession({});
    const req = { session, protocol: 'https', get: () => 'harbour.example', query: {} };
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.redirectedTo, '/');
    assert.equal(res.body, null);
  });

  test('POST /auth/openrouter/begin with consent=granted stashes openRouterPendingConsent alongside the PKCE verifier', async () => {
    const handler = getHandler(router, 'post', '/auth/openrouter/begin');
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-1' });
    const req = { session, protocol: 'https', get: () => 'harbour.example', body: { consent: 'granted' } };
    const res = makeRes();

    await handler(req, res);

    assert.equal(session.openRouterPendingConsent, true);
    assert.ok(session.openRouterCodeVerifier, 'the existing PKCE verifier write must be untouched');
    assert.match(res.redirectedTo, /^https:\/\/openrouter\.ai\/auth\?/);
  });

  test('POST /auth/openrouter/begin with consent=declined still proceeds to OpenRouter, but stashes NO pending-consent flag', async () => {
    const handler = getHandler(router, 'post', '/auth/openrouter/begin');
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-1' });
    const req = { session, protocol: 'https', get: () => 'harbour.example', body: { consent: 'declined' } };
    const res = makeRes();

    await handler(req, res);

    assert.equal(session.openRouterPendingConsent, undefined, 'declining must leave no pending-consent intent for the callback to find');
    assert.ok(session.openRouterCodeVerifier, 'declining consent must not block connecting the key itself');
    assert.match(res.redirectedTo, /^https:\/\/openrouter\.ai\/auth\?/, 'declining unattended consent still connects OpenRouter — only consent is skipped');
  });

  test('POST /auth/openrouter/begin with no active workspace redirects home WITHOUT stashing consent intent', async () => {
    const handler = getHandler(router, 'post', '/auth/openrouter/begin');
    const session = makeSession({});
    const req = { session, protocol: 'https', get: () => 'harbour.example', body: { consent: 'granted' } };
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.redirectedTo, '/');
    assert.equal(session.openRouterPendingConsent, undefined);
  });

  test('callback sets durable consent when the pending flag was present, in the same flow as the key write', async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ key: 'sk-or-v1-new' }) });
    try {
      const handler = getHandler(router, 'get', '/auth/openrouter/callback');
      const session = makeSession({
        workspaces: [WORKSPACE],
        activeWorkspaceId: WORKSPACE.id,
        accountId: 'acct-1',
        openRouterCodeVerifier: 'verifier-123',
        openRouterPendingConsent: true,
      });
      const req = { session, query: { code: 'auth-code' } };
      const res = makeRes();

      await handler(req, res);

      assert.equal(await userPreferencesStore.getOpenRouterApiKey('acct-1'), 'sk-or-v1-new');
      assert.ok(await userPreferencesStore.getOpenRouterConsent('acct-1'), 'consent must be recorded when the pending flag was set');
      assert.equal(session.openRouterCodeVerifier, undefined, 'verifier must still be cleaned up');
      assert.equal(session.openRouterPendingConsent, undefined, 'pending-consent flag must be cleaned up');
      assert.equal(session.openRouterApiKey, 'sk-or-v1-new');
    } finally {
      delete global.fetch;
    }
  });

  test('callback WITHOUT the pending-consent flag writes the key but records NO consent (e.g. a re-auth of an existing connection)', async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ key: 'sk-or-v1-reauth' }) });
    try {
      const handler = getHandler(router, 'get', '/auth/openrouter/callback');
      const session = makeSession({
        workspaces: [WORKSPACE],
        activeWorkspaceId: WORKSPACE.id,
        accountId: 'acct-1',
        openRouterCodeVerifier: 'verifier-123',
        // No openRouterPendingConsent this time.
      });
      const req = { session, query: { code: 'auth-code' } };
      const res = makeRes();

      await handler(req, res);

      assert.equal(await userPreferencesStore.getOpenRouterApiKey('acct-1'), 'sk-or-v1-reauth');
      assert.equal(await userPreferencesStore.getOpenRouterConsent('acct-1'), null, 'no pending flag -> no consent write, even though the key write succeeded');
    } finally {
      delete global.fetch;
    }
  });
});

describe('routes/openrouter-auth.js: production chain, GET -> POST /begin -> callback (LIN-2412 F1 correction)', () => {
  // Drives the REAL route handlers in sequence for both choices, rather than
  // hand-setting req.session.openRouterPendingConsent directly — the review
  // finding this closes was precisely that the callback's guard could only be
  // exercised via an artificial test state, because the GET handler set the
  // flag unconditionally in production. This proves the guard is reachable
  // (and unreachable) via the real branching code the interstitial submits into.
  let userPreferencesStore;
  let router;

  beforeEach(() => {
    userPreferencesStore = fakeUserPreferencesStore();
    router = createOpenRouterAuthRoutes({ userPreferencesStore });
  });

  test('grant path end-to-end: interstitial renders -> begin stashes consent -> callback records it', async () => {
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-1' });

    // 1. GET renders the interstitial (offers the real choice).
    const getHandlerFn = getHandler(router, 'get', '/auth/openrouter');
    const getReq = { session, protocol: 'https', get: () => 'harbour.example', query: {} };
    const getRes = makeRes();
    await getHandlerFn(getReq, getRes);
    assert.match(getRes.body, /openrouter-consent-grant-submit/);

    // 2. The user submits the grant form -> POST /begin.
    const beginHandler = getHandler(router, 'post', '/auth/openrouter/begin');
    const beginReq = { session, protocol: 'https', get: () => 'harbour.example', body: { consent: 'granted' } };
    const beginRes = makeRes();
    await beginHandler(beginReq, beginRes);
    assert.equal(session.openRouterPendingConsent, true);
    assert.match(beginRes.redirectedTo, /^https:\/\/openrouter\.ai\/auth\?/);

    // 3. OpenRouter redirects back to the callback with a code.
    global.fetch = async () => ({ ok: true, json: async () => ({ key: 'sk-or-v1-grant-e2e' }) });
    try {
      const callbackHandler = getHandler(router, 'get', '/auth/openrouter/callback');
      const callbackReq = { session, query: { code: 'auth-code' } };
      const callbackRes = makeRes();
      await callbackHandler(callbackReq, callbackRes);

      assert.equal(await userPreferencesStore.getOpenRouterApiKey('acct-1'), 'sk-or-v1-grant-e2e');
      assert.ok(await userPreferencesStore.getOpenRouterConsent('acct-1'), 'consent must be recorded end to end when the user chose grant');
    } finally {
      delete global.fetch;
    }
  });

  test('decline path end-to-end: interstitial renders -> begin withholds consent -> callback connects the key but records NO consent', async () => {
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-1' });

    // 1. GET renders the interstitial (offers the real choice).
    const getHandlerFn = getHandler(router, 'get', '/auth/openrouter');
    const getReq = { session, protocol: 'https', get: () => 'harbour.example', query: {} };
    const getRes = makeRes();
    await getHandlerFn(getReq, getRes);
    assert.match(getRes.body, /openrouter-consent-decline-submit/);

    // 2. The user submits the decline form -> POST /begin.
    const beginHandler = getHandler(router, 'post', '/auth/openrouter/begin');
    const beginReq = { session, protocol: 'https', get: () => 'harbour.example', body: { consent: 'declined' } };
    const beginRes = makeRes();
    await beginHandler(beginReq, beginRes);
    assert.equal(session.openRouterPendingConsent, undefined, 'declining must leave no pending intent for the callback to act on');
    assert.match(beginRes.redirectedTo, /^https:\/\/openrouter\.ai\/auth\?/, 'the OAuth round trip still happens — only consent is skipped');

    // 3. OpenRouter redirects back to the callback with a code.
    global.fetch = async () => ({ ok: true, json: async () => ({ key: 'sk-or-v1-decline-e2e' }) });
    try {
      const callbackHandler = getHandler(router, 'get', '/auth/openrouter/callback');
      const callbackReq = { session, query: { code: 'auth-code' } };
      const callbackRes = makeRes();
      await callbackHandler(callbackReq, callbackRes);

      assert.equal(await userPreferencesStore.getOpenRouterApiKey('acct-1'), 'sk-or-v1-decline-e2e', 'the key must still be connected — decline is about consent, not connection');
      assert.equal(await userPreferencesStore.getOpenRouterConsent('acct-1'), null, 'no consent must be recorded when the user declined, even though the key connected fine');
    } finally {
      delete global.fetch;
    }
  });
});

describe('routes/openrouter-auth.js: POST /auth/openrouter/consent (retroactive consent)', () => {
  let userPreferencesStore;
  let router;

  beforeEach(() => {
    userPreferencesStore = fakeUserPreferencesStore();
    router = createOpenRouterAuthRoutes({ userPreferencesStore });
  });

  test('grants consent for an already-connected account and redirects to settings', async () => {
    await userPreferencesStore.setOpenRouterApiKey('acct-1', 'sk-or-v1-existing');
    const handler = getHandler(router, 'post', '/auth/openrouter/consent');
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-1' });
    const req = { session };
    const res = makeRes();

    await handler(req, res);

    assert.ok(await userPreferencesStore.getOpenRouterConsent('acct-1'));
    assert.equal(res.redirectedTo, `/workspace/${WORKSPACE.urlKey}/settings`);
  });

  test('409s when the account has no existing durable key to consent for', async () => {
    const handler = getHandler(router, 'post', '/auth/openrouter/consent');
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-no-key' });
    const req = { session };
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(await userPreferencesStore.getOpenRouterConsent('acct-no-key'), null);
  });

  test('400s when there is no accountId on the session at all', async () => {
    const handler = getHandler(router, 'post', '/auth/openrouter/consent');
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id });
    const req = { session };
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
  });

  test('redirects home with no active workspace, before touching the store', async () => {
    const handler = getHandler(router, 'post', '/auth/openrouter/consent');
    const session = makeSession({ accountId: 'acct-1' });
    const req = { session };
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.redirectedTo, '/');
    assert.equal(await userPreferencesStore.getOpenRouterConsent('acct-1'), null);
  });
});

describe('routes/openrouter-auth.js: POST /auth/openrouter/disconnect clears both the key and consent', () => {
  test('disconnect clears the durable key and any granted consent together', async () => {
    const userPreferencesStore = fakeUserPreferencesStore();
    await userPreferencesStore.setOpenRouterApiKey('acct-1', 'sk-or-v1-x');
    await userPreferencesStore.setOpenRouterConsent('acct-1');
    const router = createOpenRouterAuthRoutes({ userPreferencesStore });
    const handler = getHandler(router, 'post', '/auth/openrouter/disconnect');
    const session = makeSession({ workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id, accountId: 'acct-1', openRouterApiKey: 'sk-or-v1-x' });
    const req = { session };
    const res = makeRes();

    await handler(req, res);

    assert.equal(await userPreferencesStore.getOpenRouterApiKey('acct-1'), null);
    assert.equal(await userPreferencesStore.getOpenRouterConsent('acct-1'), null);
    assert.equal(session.openRouterApiKey, undefined);
  });
});
