/**
 * Unit tests for LIN-1366: Linear-token owner isolation — the Linear-token
 * twin of tests/unit/quota-isolation.test.js (LIN-1353).
 *
 * Before this fix, `resolveWorkspaceAccess(urlKey)` picked the latest-expiring
 * token from ANY session referencing the workspace — owner-blind. An agent
 * calling the proxy under one connected user's token could silently write to
 * Linear under a DIFFERENT connected user's identity. The fix threads the
 * proxy token's owning account (`req.proxyCreatedBy`) into token resolution
 * and fails closed (never falls back owner-blind) when no token for that
 * owner exists.
 *
 * Block A drives the pure selector directly (lib/workspace-token-resolver.js).
 * Block B drives the real wiring end-to-end over HTTP: a real `ProxyTokenStore`
 * mints tokens with a real `createdBy`, and a recording spy resolver captures
 * the `(urlKey, ownerAccountId)` args every in-scope call site forwards, so the
 * threading itself — not just the pure selector — is proven.
 *
 * Run with: node --test tests/unit/linear-token-isolation.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { selectOwnerWorkspaceToken, detectOwnerAccountMismatch, UNSCOPED } from '../../lib/workspace-token-resolver.js';

// ---------------------------------------------------------------------------
// Block A — pure selector `selectOwnerWorkspaceToken` (7 cases)
// ---------------------------------------------------------------------------

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000; // ~2.8h — comfortably past the 5-minute refresh buffer
const FURTHER_FUTURE_MS = 50_000_000; // ~13.9h — a later expiry than FAR_FUTURE_MS
const PAST_MS = -10_000; // already expired

function sessionRow(accountId, urlKey, accessToken, expiresAt, provider = 'linear') {
  return { session: { accountId, workspaces: [{ urlKey, provider, accessToken, tokenExpiresAt: expiresAt }] } };
}

describe('selectOwnerWorkspaceToken (LIN-1366, Block A — pure selector)', () => {
  test('A1: owner isolation — account A never receives account B\'s token, even though B\'s expires later (the bug removed)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FURTHER_FUTURE_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tokA');
    assert.notEqual(result.token, 'tokB');
    assert.equal(result.reason, 'ok');
  });

  test('A2: no session for the owning account references this workspace -> not_connected (fail closed, no fallback)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, null);
    assert.equal(result.reason, 'not_connected');
  });

  test('A3: owner has a session for this workspace but its token is expired -> session_expired', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, null);
    assert.equal(result.reason, 'session_expired');
  });

  test('A4: legacy null/empty owner fails closed and never borrows another account\'s token', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
      // Even a session with a matching null accountId must not be borrowed.
      { session: { accountId: null, workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'tok-null-owner', tokenExpiresAt: NOW + FAR_FUTURE_MS }] } },
    ];
    const nullResult = selectOwnerWorkspaceToken(sessions, 'acme', null);
    assert.equal(nullResult.token, null);
    assert.equal(nullResult.reason, 'not_connected');

    const emptyResult = selectOwnerWorkspaceToken(sessions, 'acme', '');
    assert.equal(emptyResult.token, null);
    assert.equal(emptyResult.reason, 'not_connected');
  });

  test('A5: the UNSCOPED sentinel preserves legacy owner-blind selection (latest-expiring across ALL accounts)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FURTHER_FUTURE_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', UNSCOPED);
    assert.equal(result.token, 'tokB');
    assert.equal(result.reason, 'ok');

    // Omitting the third argument entirely defaults to UNSCOPED.
    const defaulted = selectOwnerWorkspaceToken(sessions, 'acme');
    assert.equal(defaulted.token, 'tokB');
  });

  test('A6: the latest-expiring token is selected only among the owner\'s OWN sessions', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-old', NOW + FAR_FUTURE_MS),
      sessionRow('account-A', 'acme', 'tokA-new', NOW + FURTHER_FUTURE_MS),
      // B's session expires later than BOTH of A's, but must never win for A.
      { session: { accountId: 'account-B', workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'tokB', tokenExpiresAt: NOW + FURTHER_FUTURE_MS + 1_000_000 }] } },
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tokA-new');
  });

  test('A7: fail-closed results still surface `provider` (owner-blind) for the write capability gate', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS, 'linear'),
    ];
    const noMatch = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(noMatch.token, null);
    assert.equal(noMatch.provider, 'linear');

    const expiredOnly = selectOwnerWorkspaceToken(
      [sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS, 'linear')],
      'acme',
      'account-A'
    );
    assert.equal(expiredOnly.token, null);
    assert.equal(expiredOnly.provider, 'linear');
  });
});

// ---------------------------------------------------------------------------
// Block C — detectOwnerAccountMismatch (LIN-1413, pure sibling detector)
// ---------------------------------------------------------------------------

describe('detectOwnerAccountMismatch (LIN-1413, Block C — pure detector)', () => {
  test('C1: owner has an expired row for urlKey, a different account has a live one -> true', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), true);
  });

  test('C2: owner has no row at all, a different account has a live one -> true (the "stale row already gone" variant)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), true);
  });

  test('C3: owner\'s own token is merely expired and nobody else is live -> false (stays LIN-1373\'s case)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), false);
  });

  test('C4: null/empty owner, even with another account live -> false (protects R4/not_connected)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', null), false);
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', ''), false);
  });

  test('C5: UNSCOPED -> false (owner-blind callers have no owner to mismatch against)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', UNSCOPED), false);
  });

  test('C6: owner is live -> false (never reached in practice via server.js, asserted anyway)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FURTHER_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), false);
  });
});

// ---------------------------------------------------------------------------
// Block B — route wiring (4 cases): real ProxyTokenStore + recording spy resolver
// ---------------------------------------------------------------------------

function inMemoryCollection() {
  const docs = [];
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) {
      return docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v)) || null;
    },
    find(query = {}) {
      const results = docs.filter(d => Object.entries(query).every(([k, v]) => d[k] === v));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { ...(update.$setOnInsert || {}) };
        Object.entries(query).forEach(([k, v]) => { doc[k] = v; });
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (Object.entries(query).every(([k, v]) => docs[i][k] === v)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
  };
}

// A hand-rolled fake, not the real selector (that's Block A's job): success iff
// an owner was actually threaded through, so this proves WIRING, not selection.
function makeRecordingResolver() {
  const calls = [];
  const resolveWorkspaceAccess = async (urlKey, ownerAccountId) => {
    calls.push({ urlKey, ownerAccountId });
    if (!ownerAccountId) {
      return { token: null, reason: 'not_connected', provider: null };
    }
    // 'test-token' also drives /api/proxy/stack's own NODE_ENV=test mock-data
    // shortcut, so R3 never needs a real Linear connection either.
    return { token: 'test-token', reason: 'ok', provider: 'linear' };
  };
  return { calls, resolveWorkspaceAccess };
}

// A fake provider (LIN-581's injectedProvider TEST-ONLY seam) so the read/write
// call sites (R1/R2) never reach a real Linear provider or network call.
function fakeLinearProvider() {
  const calls = [];
  return {
    name: 'linear',
    calls,
    supports(method) { calls.push({ fn: 'supports', method }); return true; },
    async issues() { calls.push({ fn: 'issues' }); return { nodes: [], pageInfo: {} }; },
    async createIssue(token, input) {
      calls.push({ fn: 'createIssue', token, input });
      return { id: 'fake-issue-id', identifier: 'ACME-1', title: input.title };
    },
  };
}

function buildApp({ resolveWorkspaceAccess, provider }) {
  const app = express();
  app.use(express.json());
  const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    resolveWorkspaceAccess,
    getWorkspaceAccessToken: async (urlKey) => (await resolveWorkspaceAccess(urlKey)).token,
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return { app, proxyTokenStore };
}

async function requestJson(app, path, { method = 'GET', token, body } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('req.proxyCreatedBy route wiring (LIN-1366, Block B)', () => {
  test('R1: read site (GET /api/proxy/issues) threads req.proxyCreatedBy to the resolver', async () => {
    const spy = makeRecordingResolver();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider: fakeLinearProvider() });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read', createdBy: 'account-A' });

    const { status } = await requestJson(app, '/api/proxy/issues', { token });

    assert.equal(status, 200);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].urlKey, 'acme');
    assert.equal(spy.calls[0].ownerAccountId, 'account-A');
  });

  test('R2: write site (POST /api/proxy/issues) threads owner + the capability gate sees the resolved provider', async () => {
    const spy = makeRecordingResolver();
    const provider = fakeLinearProvider();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });

    const { status, body } = await requestJson(app, '/api/proxy/issues', {
      method: 'POST',
      token,
      body: { teamId: '00000000-0000-0000-0000-000000000000', title: 'Test issue' },
    });

    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(spy.calls[0].ownerAccountId, 'account-A');
    assert.ok(provider.calls.some(c => c.fn === 'supports' && c.method === 'createIssue'), 'capability gate consulted the resolved provider');
    assert.ok(provider.calls.some(c => c.fn === 'createIssue'), 'write reached the provider using the owner-scoped token');
  });

  test('R3: direct task-automation site (GET /api/proxy/stack) threads req.proxyCreatedBy to the resolver', async () => {
    const spy = makeRecordingResolver();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider: fakeLinearProvider() });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read', createdBy: 'account-A' });

    const { status } = await requestJson(app, '/api/proxy/stack', { token });

    assert.equal(status, 200);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].urlKey, 'acme');
    assert.equal(spy.calls[0].ownerAccountId, 'account-A');
  });

  test('R4: anonymous/null-owner proxy token -> 503 WORKSPACE_NOT_CONNECTED end-to-end (exact envelope, verbatim)', async () => {
    const spy = makeRecordingResolver();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider: fakeLinearProvider() });
    // No createdBy -> legacy/anonymous mint, createdBy: null (LIN-1366's core checkpoint).
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read' });

    const { status, body } = await requestJson(app, '/api/proxy/issues', { token });

    assert.equal(status, 503);
    assert.equal(body.error, 'Workspace not available');
    assert.equal(body.code, 'WORKSPACE_NOT_CONNECTED');
    assert.equal(body.category, 'config');
    assert.equal(body.retryable, false);
    assert.equal(body.context.workspaceUrlKey, 'acme');
    assert.equal(spy.calls[0].ownerAccountId, null);
  });

  test('R5 (LIN-1413): resolveWorkspaceAccess returning owner_mismatch -> 503 WORKSPACE_OWNER_MISMATCH end-to-end (exact envelope, verbatim)', async () => {
    // Forced-reason resolver: proves the wire threading, mirroring R4's style.
    // The detector itself (Block C) is exercised separately.
    const resolveWorkspaceAccess = async () => ({ token: null, reason: 'owner_mismatch', provider: 'linear' });
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess, provider: fakeLinearProvider() });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read', createdBy: 'account-A' });

    const { status, body } = await requestJson(app, '/api/proxy/issues', { token });

    assert.equal(status, 503);
    assert.equal(body.error, 'Workspace not available');
    assert.equal(body.code, 'WORKSPACE_OWNER_MISMATCH');
    assert.equal(body.category, 'config');
    assert.equal(body.retryable, false);
    assert.equal(body.context.workspaceUrlKey, 'acme');
    // Privacy boundary: the other (live) account's id must never reach the wire.
    assert.ok(!/account-B|accountId/i.test(JSON.stringify(body)));
  });
});
