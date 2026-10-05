/**
 * LIN-3282 commit 1 — credential-trail instrumentation.
 *
 * Proof for the observability half of LIN-3282:
 *   1. `credentialSource` is stamped per request (routes/proxy.js,
 *      `resolveProviderAccess`) and persisted onto the proxy-event row at the
 *      single `recordEvent` write seam — the same value the resolver already
 *      returns.
 *   2. `GET /api/proxy/credential-trail` (routes/proxy-reads.js,
 *      `ProxyEventStore.listSelfCredentialTrail`) is token-scoped and
 *      read-only: token B never sees token A's rows, another workspace sees
 *      nothing, only `provider-lane` rows appear, and the response is exactly
 *      the projected field set — never token bytes.
 *
 * Runs over a REAL MangoDB instance (tests/fixtures/mango-tmpdir.js) so
 * sort/skip/limit/projection matching is exercised, not faked.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import {
  ProxyEventStore,
  CREDENTIAL_TRAIL_DEFAULT_LIMIT,
  CREDENTIAL_TRAIL_MAX_LIMIT,
} from '../../lib/proxy-events.js';
import { fingerprintCredential, CREDENTIAL_SOURCES } from '../../lib/credential-diagnostics.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const harness = createMangoTmpdir('lin-3282-trail-');
let store;
let raw;

before(() => harness.connect());
after(() => harness.close());
beforeEach(() => {
  raw = harness.freshDb().collection('proxy-events');
  store = new ProxyEventStore({ collection: raw });
});

const TOKEN_A = 'tok-a';
const TOKEN_B = 'tok-b';
const URL_KEY = 'acme';

/** The complete projected field set the trail returns, in a stable order. */
const TRAIL_FIELDS = ['timestamp', 'method', 'endpoint', 'status', 'stage', 'credentialSource', 'credentialFingerprint'];

/**
 * Seed a raw proxy-event doc directly (bypassing `recordEvent`), so a test can
 * shape an "old row" that predates `credentialSource` or back-date a timestamp.
 */
async function insertRow(overrides = {}) {
  const doc = {
    _id: crypto.randomUUID(),
    urlKey: URL_KEY,
    tokenId: TOKEN_A,
    tokenLabel: 'agent-a',
    method: 'GET',
    endpoint: '/api/proxy/me',
    status: 200,
    note: null,
    stage: 'provider-lane',
    credentialFingerprint: fingerprintCredential('linear-tok'),
    credentialSource: CREDENTIAL_SOURCES.CONNECTION,
    timestamp: new Date(),
    ...overrides,
  };
  await raw.insertOne(doc);
  return doc;
}

function buildApp({ tokensById, workspaceSource = CREDENTIAL_SOURCES.CONNECTION }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async (bearer) => tokensById[bearer],
    },
    proxyEventStore: store,
    resolveWorkspaceAccess: async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: workspaceSource,
      expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('linear-tok'),
    }),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: {
      name: 'linear',
      supports: () => true,
      viewer: async () => ({ id: 'u1', name: 'Alice' }),
    },
  }));
  return app;
}

async function request(app, path, bearer) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const headers = bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` };
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const TOKENS = {
  'token-a': { tokenId: TOKEN_A, urlKey: URL_KEY, label: 'agent-a', scope: 'readWrite', createdBy: 'acct-owner' },
  'token-b': { tokenId: TOKEN_B, urlKey: URL_KEY, label: 'agent-b', scope: 'readWrite', createdBy: 'acct-owner' },
};

/** `recordEvent` is fire-and-forget; poll until the expected rows have landed. */
async function waitForTrail(urlKey, tokenId, count, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await store.listSelfCredentialTrail(urlKey, tokenId);
    if (result.items.length >= count || Date.now() > deadline) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('LIN-3282: credentialSource persisted on the proxy-event row', () => {
  test('a provider-lane call persists the resolver source onto its audit row', async () => {
    const app = buildApp({ tokensById: TOKENS, workspaceSource: CREDENTIAL_SOURCES.CONNECTION });

    const { status } = await request(app, '/api/proxy/me', 'token-a');
    assert.equal(status, 200);

    const { items } = await waitForTrail(URL_KEY, TOKEN_A, 1);
    assert.equal(items.length, 1);
    assert.equal(items[0].credentialSource, CREDENTIAL_SOURCES.CONNECTION);
    assert.equal(items[0].method, 'GET');
    assert.equal(items[0].endpoint, '/api/proxy/me');
    assert.equal(items[0].status, 200);
    assert.equal(items[0].credentialFingerprint, fingerprintCredential('linear-tok'));
  });

  test('a different resolver source (cache) is persisted verbatim', async () => {
    const app = buildApp({ tokensById: TOKENS, workspaceSource: CREDENTIAL_SOURCES.CACHE });
    await request(app, '/api/proxy/me', 'token-a');
    const { items } = await waitForTrail(URL_KEY, TOKEN_A, 1);
    assert.equal(items[0].credentialSource, CREDENTIAL_SOURCES.CACHE);
  });

  test('a row written before credentialSource existed reads null', async () => {
    // A pre-LIN-3282 row: the field is entirely absent, never null.
    const old = {
      _id: crypto.randomUUID(), urlKey: URL_KEY, tokenId: TOKEN_A, tokenLabel: 'agent-a',
      method: 'GET', endpoint: '/api/proxy/me', status: 200, note: null,
      stage: 'provider-lane', credentialFingerprint: 'deadbeef0000', timestamp: new Date(),
    };
    await raw.insertOne(old);

    const { items } = await store.listSelfCredentialTrail(URL_KEY, TOKEN_A);
    assert.equal(items.length, 1);
    assert.equal(items[0].credentialSource, null);
  });
});

describe('LIN-3282: credential-trail scoping and projection', () => {
  test('token B cannot read token A rows; another workspace returns nothing', async () => {
    await insertRow({ tokenId: TOKEN_A });
    await insertRow({ tokenId: TOKEN_A });

    const app = buildApp({ tokensById: TOKENS });
    const { status, body } = await request(app, '/api/proxy/credential-trail', 'token-b');
    assert.equal(status, 200);
    assert.equal(body.items.filter(i => i.credentialFingerprint === fingerprintCredential('linear-tok')).length, 0,
      'token B must not see token A rows');

    const other = await store.listSelfCredentialTrail('other-ws', TOKEN_A);
    assert.deepEqual(other.items, []);
  });

  test('the response carries exactly the projected fields — never token bytes', async () => {
    await insertRow({});
    const { status, body } = await request(buildApp({ tokensById: TOKENS }), '/api/proxy/credential-trail', 'token-a');
    assert.equal(status, 200);
    assert.equal(body.items.length, 1);
    assert.deepEqual(Object.keys(body.items[0]).sort(), [...TRAIL_FIELDS].sort());
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('linear-tok'), 'raw credential must never appear in the trail response');
    assert.ok(!serialized.includes('tokenLabel'), 'no token label field');
    assert.ok(!('tokenId' in body.items[0]), 'no token id field on a row');
  });

  test('only provider-lane rows appear; proxy-token rows are excluded', async () => {
    await insertRow({ stage: 'provider-lane', endpoint: '/api/proxy/me' });
    await insertRow({ stage: 'proxy-token', endpoint: '/api/proxy/credential-health', credentialFingerprint: null, credentialSource: null });

    const { items } = await store.listSelfCredentialTrail(URL_KEY, TOKEN_A);
    assert.equal(items.length, 1);
    assert.equal(items[0].stage, 'provider-lane');
  });

  test('null/ownerless tokenId reads as an empty trail', async () => {
    const { items } = await store.listSelfCredentialTrail(URL_KEY, null);
    assert.deepEqual(items, []);
  });

  test('unauthenticated credential-trail is rejected', async () => {
    const { status } = await request(buildApp({ tokensById: TOKENS }), '/api/proxy/credential-trail');
    assert.equal(status, 401);
  });

  test('listEvents (the session-authed /events projection) does not expose credentialSource', async () => {
    await insertRow({});
    const { items } = await store.listEvents(URL_KEY, { limit: 10 });
    assert.equal(items.length, 1);
    assert.ok(!('credentialSource' in items[0]), 'the workspace-wide /events list must not leak the new field');
  });
});

describe('LIN-3282: credential-trail bounds', () => {
  test('limit defaults to 50 and clamps to 100', async () => {
    for (let i = 0; i < 120; i++) {
      await insertRow({ timestamp: new Date(Date.now() - i * 1000) });
    }

    const dflt = await store.listSelfCredentialTrail(URL_KEY, TOKEN_A);
    assert.equal(dflt.items.length, CREDENTIAL_TRAIL_DEFAULT_LIMIT);

    const capped = await store.listSelfCredentialTrail(URL_KEY, TOKEN_A, { limit: 1000 });
    assert.equal(capped.items.length, CREDENTIAL_TRAIL_MAX_LIMIT);

    const small = await store.listSelfCredentialTrail(URL_KEY, TOKEN_A, { limit: 5 });
    assert.equal(small.items.length, 5);
  });

  test('rows older than the window are excluded', async () => {
    await insertRow({ timestamp: new Date(Date.now() - 60 * 60 * 1000) });
    const { items } = await store.listSelfCredentialTrail(URL_KEY, TOKEN_A, { windowMs: 5 * 60 * 1000 });
    assert.deepEqual(items, []);
  });

  test('newest first', async () => {
    await insertRow({ endpoint: '/api/proxy/me', timestamp: new Date(Date.now() - 10_000) });
    await insertRow({ endpoint: '/api/proxy/issues/:id', timestamp: new Date(Date.now() - 1_000) });
    const { items } = await store.listSelfCredentialTrail(URL_KEY, TOKEN_A);
    assert.equal(items[0].endpoint, '/api/proxy/issues/:id');
    assert.equal(items[1].endpoint, '/api/proxy/me');
  });
});
