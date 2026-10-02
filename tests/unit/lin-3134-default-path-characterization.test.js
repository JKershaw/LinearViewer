/**
 * LIN-3134 T2-i (LIN-3138) — S0 default-path characterization snapshot.
 *
 * S0 is the BYTE-IDENTITY witness for the declared-mint mechanism. It is landed
 * BEFORE any production change and stays unedited through the rest of T2-i and
 * T2-ii. Every golden literal here is captured from the unchanged code at
 * `e9c8b3f1` — never computed from the declared-mint code (there is none yet).
 *
 * The declared mechanism is inert: nothing passes non-empty `declaredGrants`,
 * and nothing writes `grantDeclaration` / `grantRefusal`. So the assertion this
 * file carries is an ABSENCE: for the undeclared default path, the two new row
 * fields must not appear in any document, projection, or mint result. When S1
 * writes them sparsely (only when present) and S4 pins them after every spread,
 * these key sets stay exactly as pinned here.
 *
 * Covered surfaces (the ones T2-i's S1-S4 touch):
 *   - preamble default `[]` path: `createToken` arguments, return shape,
 *     fail-closed, `attachProxyContext` key set (S2/S3);
 *   - factory default path: the exact key set handed to `addItem` and the
 *     returned item (S4);
 *   - store default path: `addItem` document keys, `_archiveItem` history keys
 *     through all three archive hops (take / cancel / expiry), an undeclared
 *     wake row, `_formatItem` / `_formatHistoryItem`, and `getItemStatus` (S1);
 *   - route projections `formatDispatchWatch` and the list map (allow-lists);
 *   - the wake provider's `{token, reason, degraded}` output per branch.
 *
 * Mutation witness (recorded, not asserted here): an unconditional `|| null`
 * write of either field in `addItem` / `_archiveItem` fails the key-set pins
 * below.
 *
 * Additive only: no existing assertion is touched.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import express from 'express';
// LIN-1880: keep this file hermetic (the proxy routes can reach Linear on some
// paths). Same fixture the sibling proxy-dispatch tests install.
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { provisionBootstrapToken, attachProxyContext } from '../../lib/proxy-preamble.js';
import { buildWakeCredentialProvisioner } from '../../lib/wake-credential.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../../lib/proxy-tokens.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  return { store: new DispatchQueueStore({ collection, historyCollection }), collection, historyCollection };
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden key sets, captured at e9c8b3f1 (unchanged code).
// LIN-3163 (LIN-3157 B): the ARCHIVE key set no longer carries
// `historyExpiresAt` — dispatch-history is lifetime-retained (the queue doc's
// `expiresAt` TTL is unchanged).
// ─────────────────────────────────────────────────────────────────────────────

const ADD_ITEM_DOC_KEYS = [
  '_id', 'abort', 'abortTo', 'bootstrapToken', 'cascade', 'consumerLastSeenAt',
  'dispatchedAt', 'dispatchedBy', 'effort', 'expiresAt', 'followUpTo', 'force',
  'harness', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl', 'kind',
  'maxSessionsPerTask', 'maxTasks', 'model', 'periodicalId', 'presetConfig',
  'presetName', 'producingItemAttempt', 'producingItemId', 'prompt', 'promptName',
  'queueIfBusy', 'repo', 'rootItemId', 'sessionGroupId', 'sessionId',
  'stopAt', 'subscription', 'target', 'terminal', 'urlKey', 'waitForFollowUps'
];

const ARCHIVE_HISTORY_DOC_KEYS = [
  '_id', 'abort', 'abortTo', 'cascade', 'consumerLastSeenAt', 'dispatchedAt',
  'dispatchedBy', 'effort', 'feedbackDigest', 'feedbackVersion', 'followUpTo',
  'force', 'harness', 'issueId', 'issueIdentifier',
  'issueTitle', 'issueUrl', 'kind', 'maxSessionsPerTask', 'maxTasks', 'model',
  'periodicalId', 'presetConfig', 'presetName', 'producingItemAttempt',
  'producingItemId', 'prompt', 'promptName', 'queueIfBusy', 'repo', 'resolvedAt',
  'rootItemId', 'sessionGroupId', 'sessionId', 'status', 'stopAt',
  'subscription',
  'takenByTokenId', 'takenByTokenLabel', 'target', 'terminal', 'trimHistory',
  'urlKey', 'waitForFollowUps'
];

const FORMAT_ITEM_KEYS = [
  'abort', 'abortTo', 'bootstrapToken', 'cascade', 'consumerLastSeenAt',
  'dispatchedAt', 'dispatchedBy', 'effort', 'expiresAt', 'followUpTo', 'force',
  'harness', 'id', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl',
  'kind', 'maxSessionsPerTask', 'maxTasks', 'model', 'periodicalId',
  'presetConfig', 'presetName', 'prompt', 'promptName', 'queueIfBusy', 'repo',
  'rootItemId', 'sessionGroupId', 'sessionId', 'stopAt', 'subscription',
  'target', 'terminal', 'trimHistory', 'waitForFollowUps', 'workspace'
];

const FORMAT_HISTORY_ITEM_KEYS = [
  'abort', 'abortTo', 'bookkeeping', 'cascade', 'consumerLastSeenAt',
  'dispatchedAt', 'dispatchedBy', 'effort', 'feedbackDigest', 'feedbackVersion',
  'followUpTo', 'force', 'harness', 'id', 'issueId', 'issueIdentifier',
  'issueTitle', 'issueUrl', 'kind', 'maxSessionsPerTask', 'maxTasks', 'model',
  'periodicalId', 'presetConfig', 'presetName', 'prompt', 'promptName',
  'queueIfBusy', 'repo', 'resolvedAt', 'rootItemId', 'sessionGroupId',
  'sessionId', 'status', 'stopAt', 'subscription', 'takenByTokenLabel', 'target',
  'terminal', 'trimHistory', 'waitForFollowUps'
];

const DECLARED_ROW_FIELDS = ['grantDeclaration', 'grantRefusal'];

function assertNoDeclaredFields(obj, label) {
  for (const field of DECLARED_ROW_FIELDS) {
    assert.equal(field in obj, false, `${label} must not carry ${field}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Preamble default path (S2/S3 base)
// ─────────────────────────────────────────────────────────────────────────────

describe('S0 — provisionBootstrapToken default-path createToken arguments', () => {
  test('golden createToken call: kind/scope/label/ttl/createdBy', async () => {
    const calls = [];
    const proxyTokenStore = {
      createToken: async (urlKey, opts) => {
        calls.push({ urlKey, opts });
        return { token: 'tok-abc' };
      }
    };
    const token = await provisionBootstrapToken({
      proxyTokenStore, urlKey: 'acme', baseUrl: 'https://host', createdBy: 'u1'
    });
    assert.equal(token, 'tok-abc');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].urlKey, 'acme');
    assert.deepEqual(calls[0].opts, {
      kind: 'bootstrap',
      scope: 'readWrite',
      label: 'dispatch-bootstrap',
      ttl: BOOTSTRAP_TOKEN_TTL_SECONDS,
      createdBy: 'u1'
    });
    assert.equal(BOOTSTRAP_TOKEN_TTL_SECONDS, 48 * 60 * 60);
  });

  test('per-site label + createdBy pass through unchanged', async () => {
    const calls = [];
    const proxyTokenStore = {
      createToken: async (urlKey, opts) => { calls.push(opts); return { token: 't' }; }
    };
    await provisionBootstrapToken({
      proxyTokenStore, urlKey: 'acme', baseUrl: 'https://host', label: 'wake-bootstrap', createdBy: 'owner-9'
    });
    assert.equal(calls[0].label, 'wake-bootstrap');
    assert.equal(calls[0].createdBy, 'owner-9');
  });

  test('prose (opencode) with no store degrades to null', async () => {
    const token = await provisionBootstrapToken({
      proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', harness: 'opencode', createdBy: 'u1'
    });
    assert.strictEqual(token, null);
  });

  test('MCP (claude-code) with no store fails closed with proxyAttachFailed', async () => {
    await assert.rejects(
      provisionBootstrapToken({
        proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', harness: 'claude-code', createdBy: 'u1'
      }),
      (err) => err.proxyAttachFailed === true
    );
  });
});

describe('S0 — attachProxyContext default-path return shape', () => {
  function store(minted = 'tok-abc') {
    return { createToken: async () => ({ token: minted }) };
  }

  test('prose harness: exactly {prompt, bootstrapToken:null}, token in the block', async () => {
    const base = 'do the thing';
    const result = await attachProxyContext({
      proxyTokenStore: store(), urlKey: 'acme', baseUrl: 'https://host', prompt: base, harness: 'opencode', createdBy: 'u1'
    });
    assert.deepEqual(Object.keys(result).sort(), ['bootstrapToken', 'prompt']);
    assert.strictEqual(result.bootstrapToken, null);
    assert.ok(result.prompt.startsWith(base), 'original prompt is the prefix');
    assert.ok(result.prompt.includes('tok-abc'), 'prose carries the token');
    assert.equal('grantDeclaration' in result, false);
  });

  test('MCP harness: exactly {prompt, bootstrapToken:token}, token stripped from prose', async () => {
    const base = 'do the thing';
    const result = await attachProxyContext({
      proxyTokenStore: store(), urlKey: 'acme', baseUrl: 'https://host', prompt: base, harness: 'claude-code', createdBy: 'u1'
    });
    assert.deepEqual(Object.keys(result).sort(), ['bootstrapToken', 'prompt']);
    assert.equal(result.bootstrapToken, 'tok-abc');
    assert.ok(result.prompt.startsWith(base));
    assert.ok(!result.prompt.includes('tok-abc'), 'MCP strips the token from prose');
    assert.equal('grantDeclaration' in result, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Store default path (S1 base)
// ─────────────────────────────────────────────────────────────────────────────

describe('S0 — addItem / archive document key sets (undeclared item)', () => {
  const ITEM = { prompt: 'run me', promptName: 'Prompt', issueIdentifier: 'LIN-1', dispatchedBy: 'u1' };

  test('addItem persists exactly the pinned key set', async () => {
    const { store } = makeStore();
    const doc = await store.addItem('acme', ITEM);
    assert.deepEqual(sortedKeys(doc), ADD_ITEM_DOC_KEYS);
    assertNoDeclaredFields(doc, 'queue document');
  });

  test('takeItem archives exactly the pinned history key set', async () => {
    const { store, historyCollection } = makeStore();
    const created = await store.addItem('acme', ITEM);
    await store.takeItem(created._id, 'acme');
    assert.equal(historyCollection._docs.length, 1);
    const hist = historyCollection._docs[0];
    assert.deepEqual(sortedKeys(hist), ARCHIVE_HISTORY_DOC_KEYS);
    assertNoDeclaredFields(hist, 'taken history document');
    assert.equal('bootstrapToken' in hist, false, 'a live credential is never archived');
  });

  test('removeItem (cancel) archives exactly the pinned history key set', async () => {
    const { store, historyCollection } = makeStore();
    const created = await store.addItem('acme', ITEM);
    assert.equal(await store.removeItem('acme', created._id), true);
    assert.equal(historyCollection._docs.length, 1);
    assert.deepEqual(sortedKeys(historyCollection._docs[0]), ARCHIVE_HISTORY_DOC_KEYS);
    assertNoDeclaredFields(historyCollection._docs[0], 'cancelled history document');
  });

  test('cleanup (expiry) archives exactly the pinned history key set', async () => {
    const { store, collection, historyCollection } = makeStore();
    await store.addItem('acme', ITEM);
    // Force expiry, then let cleanup archive-then-delete.
    collection._docs[0].expiresAt = new Date(0);
    await store.cleanup();
    assert.equal(historyCollection._docs.length, 1);
    assert.deepEqual(sortedKeys(historyCollection._docs[0]), ARCHIVE_HISTORY_DOC_KEYS);
    assertNoDeclaredFields(historyCollection._docs[0], 'expired history document');
  });

  test('an undeclared wake row keeps the same key set (producingItem* present)', async () => {
    const { store } = makeStore();
    const doc = await store.addItem('acme', {
      prompt: 'wake', kind: 'wake', sessionId: 'sess-1', producingItemId: 'prod-1', producingItemAttempt: 0
    });
    assert.deepEqual(sortedKeys(doc), ADD_ITEM_DOC_KEYS);
    assertNoDeclaredFields(doc, 'wake row');
    assert.equal(doc.producingItemId, 'prod-1');
  });
});

describe('S0 — store projections (undeclared item)', () => {
  test('_formatItem key set excludes both declared fields and is exactly pinned', async () => {
    const { store } = makeStore();
    const doc = await store.addItem('acme', { prompt: 'run me', issueIdentifier: 'LIN-1' });
    const item = store._formatItem(doc);
    assert.deepEqual(sortedKeys(item), FORMAT_ITEM_KEYS);
    assertNoDeclaredFields(item, '_formatItem');
  });

  test('_formatHistoryItem key set excludes both declared fields and bootstrapToken', async () => {
    const { store, historyCollection } = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me' });
    await store.takeItem(created._id, 'acme');
    const item = store._formatHistoryItem(historyCollection._docs[0]);
    assert.deepEqual(sortedKeys(item), FORMAT_HISTORY_ITEM_KEYS);
    assertNoDeclaredFields(item, '_formatHistoryItem');
    assert.equal('bootstrapToken' in item, false);
  });

  test('getItemStatus queued / taken key sets', async () => {
    const { store } = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me' });
    const queued = await store.getItemStatus('acme', created._id);
    assert.deepEqual(sortedKeys(queued), [...FORMAT_ITEM_KEYS, 'status', 'feedback'].sort());
    assert.equal(queued.status, 'queued');
    assertNoDeclaredFields(queued, 'queued status');

    await store.takeItem(created._id, 'acme');
    const taken = await store.getItemStatus('acme', created._id);
    assert.deepEqual(sortedKeys(taken), [...FORMAT_HISTORY_ITEM_KEYS, 'feedback'].sort());
    assertNoDeclaredFields(taken, 'taken status');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Factory default path (S4 base)
// ─────────────────────────────────────────────────────────────────────────────

describe('S0 — createDispatchItem default path: addItem call shape', () => {
  // fields spread + the explicit step-8 keys, for a fresh launch with no anchor.
  const FIELDS = { promptName: 'Prompt', issueIdentifier: 'LIN-1', dispatchedBy: 'u1', followUpTo: null };
  const FACTORY_ADD_ITEM_KEYS = [
    ...Object.keys(FIELDS),
    'prompt', 'kind', 'model', 'harness', 'terminal', 'effort',
    'presetConfig', 'presetName', 'bootstrapToken', 'consumerLastSeenAt'
  ].sort();

  test('passes exactly the pinned key set and returns the store item', async () => {
    const captured = [];
    const store = {
      addItem: async (urlKey, item) => {
        captured.push({ urlKey, item });
        return { ...item, _id: 'disp-1', marker: 'returned' };
      }
    };
    const result = await createDispatchItem({
      store,
      urlKey: 'acme',
      prompt: 'do the thing',
      finalizePrompt: async () => ({ prompt: 'do the thing (final)', bootstrapToken: null }),
      fields: FIELDS
    });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].urlKey, 'acme');
    assert.deepEqual(sortedKeys(captured[0].item), FACTORY_ADD_ITEM_KEYS);
    assertNoDeclaredFields(captured[0].item, 'factory addItem argument');
    assert.equal(captured[0].item.prompt, 'do the thing (final)');
    assert.strictEqual(captured[0].item.bootstrapToken, null);
    assert.equal(result.marker, 'returned', 'factory returns the store item');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route projections: formatDispatchWatch and the list map (allow-lists)
// ─────────────────────────────────────────────────────────────────────────────

const MINTED = 'bootstrap-xyz';

function buildRouteApp({ itemForWatch = null, itemsForList = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      // fixture:LIN-3136: the writer holds the dispatch grant (overrides the stub above)
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
      // /fixture:LIN-3136
      createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => ({ _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }),
      getItemStatus: async () => itemForWatch,
      listItems: async () => (itemsForList || []),
      listHistory: async () => ({ items: [], total: 0 })
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function callRoute(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('S0 — route projections never expose the declared row fields', () => {
  const leaky = {
    id: 'disp-1', status: 'queued', promptName: 'Prompt', kind: 'custom',
    issueIdentifier: 'LIN-1', issueUrl: null, target: 'cli',
    grantDeclaration: { grants: ['dispatch'], ownerAccountId: 'a', workspaceId: 'w', profile: 'worker', site: 's', declaredAt: 't' },
    grantRefusal: 'INVALID_GRANTS',
    prompt: 'x', feedback: []
  };

  test('watch (formatDispatchWatch) strips both declared fields', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const res = await callRoute(buildRouteApp({ itemForWatch: { ...leaky, id } }), 'get', `/api/proxy/dispatch/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertNoDeclaredFields(res.body, 'watch body');
  });

  test('list map strips both declared fields', async () => {
    const res = await callRoute(buildRouteApp({ itemsForList: [leaky] }), 'get', '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    for (const item of res.body.items || []) assertNoDeclaredFields(item, 'list item');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route-level createToken arguments (launch + follow-up on POST /dispatch)
// ─────────────────────────────────────────────────────────────────────────────

describe('S0 — POST /api/proxy/dispatch createToken arguments', () => {
  function appCalls(calls, bodyHook) {
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
        // fixture:LIN-3136: the writer holds the dispatch grant (overrides the stub above)
        validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
        // /fixture:LIN-3136
        createToken: async (urlKey, opts) => { calls.push({ urlKey, opts }); return { token: MINTED, kind: 'bootstrap', scope: 'readWrite' }; }
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
      getWorkspaceAccessToken: async () => 'test-token',
      getWorkspaceOpenRouterKey: async () => null,
      agentStatusStore: {},
      recapCacheStore: { get: async () => null, set: async () => {} },
      briefCacheStore: { get: async () => null, set: async () => {} },
      dispatchQueueStore: {
        getGrantDeclaration: async () => ({ state: 'none' }),
        addItem: async (urlKey, item) => ({ _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }),
        getItemStatus: async () => null,
        listItems: async () => [],
        listHistory: async () => ({ items: [], total: 0 })
      },
      workspaceFromUrl: (req, res, next) => { bodyHook?.(req); next(); },
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      freeTierStore: { tryUse: async () => ({ allowed: true }) }
    }));
    return app;
  }

  test('launch, MCP harness -> golden createToken args', async () => {
    const calls = [];
    const res = await callRoute(appCalls(calls), 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'TEST-1', harness: 'claude-code'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].opts, {
      kind: 'bootstrap', scope: 'readWrite', label: 'dispatch-bootstrap', ttl: BOOTSTRAP_TOKEN_TTL_SECONDS, createdBy: 'u1'
    });
  });

  test('follow-up default, MCP harness -> still mints once (label dispatch-bootstrap)', async () => {
    const calls = [];
    const res = await callRoute(appCalls(calls), 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'TEST-1', harness: 'claude-code',
      followUpTo: '11111111-2222-4333-8444-555555555555'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.length, 1, 'a follow-up still provisions a live credential');
    assert.equal(calls[0].opts.label, 'dispatch-bootstrap');
    assert.equal(calls[0].opts.kind, 'bootstrap');
  });

  test('prose harness -> no out-of-band mint (token stays in prompt)', async () => {
    const calls = [];
    const res = await callRoute(appCalls(calls), 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'TEST-1', harness: 'opencode'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.length, 1, 'the prose attach still mints (embedded in the block)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wake provider output per branch
// ─────────────────────────────────────────────────────────────────────────────

describe('S0 — buildWakeCredentialProvisioner output per branch', () => {
  test('prose harness (opencode): no token, no degrade', async () => {
    const provision = buildWakeCredentialProvisioner({ proxyTokenStore: {}, urlKey: 'acme', baseUrl: 'http://x', createdBy: 'acct' });
    assert.deepEqual(await provision('opencode'), { token: null, reason: null, degraded: null });
  });

  test('null harness + no proxy store: no-proxy-token-store', async () => {
    const provision = buildWakeCredentialProvisioner({ proxyTokenStore: null, urlKey: 'acme', baseUrl: 'http://x', createdBy: 'acct' });
    assert.deepEqual(await provision(null), { token: null, reason: null, degraded: 'no-proxy-token-store' });
  });

  test('ownerless caller: no-token-owner', async () => {
    const provision = buildWakeCredentialProvisioner({ proxyTokenStore: {}, urlKey: 'acme', baseUrl: 'http://x', createdBy: null });
    assert.deepEqual(await provision('claude-code'), { token: null, reason: null, degraded: 'no-token-owner' });
  });

  test('MCP + owner + successful mint: token', async () => {
    const provision = buildWakeCredentialProvisioner({
      proxyTokenStore: { createToken: async () => ({ token: 'wake-tok' }) },
      urlKey: 'acme', baseUrl: 'http://x', createdBy: 'acct'
    });
    assert.deepEqual(await provision('claude-code'), { token: 'wake-tok', reason: null, degraded: null });
  });

  test('mint throws: wake-provision-failed:<message>, withdrawn (reason set)', async () => {
    const provision = buildWakeCredentialProvisioner({
      proxyTokenStore: { createToken: async () => { throw new Error('boom'); } },
      urlKey: 'acme', baseUrl: 'http://x', createdBy: 'acct'
    });
    const out = await provision('claude-code');
    assert.strictEqual(out.token, null);
    assert.strictEqual(out.degraded, null);
    assert.ok(out.reason.startsWith('wake-provision-failed:'), 'transient failure carries a reason');
    assert.ok(out.reason.includes('boom'), 'the underlying message is preserved');
  });

  test('mint returns no token: wake-provision-failed:mint-returned-null', async () => {
    const provision = buildWakeCredentialProvisioner({
      proxyTokenStore: { createToken: async () => ({}) },
      urlKey: 'acme', baseUrl: 'http://x', createdBy: 'acct'
    });
    const out = await provision('claude-code');
    assert.strictEqual(out.token, null);
    assert.strictEqual(out.degraded, null);
    assert.ok(out.reason.startsWith('wake-provision-failed:'), 'transient failure carries a reason');
    assert.ok(out.reason.includes('mint returned no token'), 'the no-token case is named');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-identity: the route projection bodies are explicit allow-lists
// ─────────────────────────────────────────────────────────────────────────────

describe('S0 — projection source bodies are spread-free and token-free', () => {
  test('formatDispatchWatch and the list map contain no declared field or row spread', () => {
    const src = readFileSync(join(ROOT, 'routes', 'proxy-dispatch.js'), 'utf8');

    const watchStart = src.indexOf('function formatDispatchWatch(');
    assert.ok(watchStart > -1, 'formatDispatchWatch found');
    const watchEnd = src.indexOf('\n}\n', watchStart);
    const watchBody = src.slice(watchStart, watchEnd);

    const listMapStart = src.indexOf('const items = filtered.slice(0, limit).map(');
    assert.ok(listMapStart > -1, 'list map found');
    const listMapEnd = src.indexOf('}));', listMapStart);
    const listMapBody = src.slice(listMapStart, listMapEnd);

    for (const body of [watchBody, listMapBody]) {
      assert.ok(!body.includes('grantDeclaration'), 'no grantDeclaration in projection');
      assert.ok(!body.includes('grantRefusal'), 'no grantRefusal in projection');
      assert.ok(!/\.\.\.\s*(item|i)\b/.test(body), 'no row spread in projection');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The 10 follow-up branches + the wake (plan S0 item 1 and item 2).
//
// Class F (LIN-3134 rev 3 / LIN-2884 rev 4 B2): 6 calls carry `followUpTo`;
// 4 of those also carry an attach branch. The ten branches are:
//   pbt (6)   proxy-dispatch:543 (POST /dispatch), :961 (override), :1232 (LLM),
//             dispatch.js:546 (session), flight-companion.js:956, chat-tools.js:2090
//   attach (4) proxy-dispatch:497 (POST /dispatch), :936 (override), :1207 (LLM),
//             dispatch.js:490 (session)
// plus the wake (wake-credential.js:91 via addFeedback). Every route branch
// mints through `provisionBootstrapToken` (attach branches via attachProxyContext).
// createToken args are therefore uniform: {kind, scope, label, ttl, createdBy}.
// ═════════════════════════════════════════════════════════════════════════════

const PROXY_MARKER = '## Workspace API access (auto-appended)';
const BRANCH_FOLLOW_UP = '11111111-2222-4333-8444-555555555555';

function assertGoldenMint(calls, { createdBy, label = 'dispatch-bootstrap' } = {}) {
  assert.equal(calls.length, 1, 'exactly one createToken call on this branch');
  assert.deepEqual(calls[0].opts, {
    kind: 'bootstrap', scope: 'readWrite', label, ttl: BOOTSTRAP_TOKEN_TTL_SECONDS, createdBy
  });
}

// ── proxy-dispatch: POST /dispatch + both recommend-and-dispatch arms ─────────

function proxyApp() {
  const captured = { mintCalls: [], items: [] };
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      // fixture:LIN-3136: the writer holds the dispatch grant (overrides the stub above)
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
      // /fixture:LIN-3136
      createToken: async (urlKey, opts) => { captured.mintCalls.push({ urlKey, opts }); return { token: MINTED, kind: 'bootstrap', scope: 'readWrite' }; }
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 3600000 }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      addItem: async (urlKey, item) => { captured.items.push(item); return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }; },
      getItemStatus: async () => null,
      listItems: async () => [],
      listHistory: async () => ({ items: [], total: 0 })
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, captured };
}

describe('S0 — proxy-dispatch branches: createToken args + finalizePrompt result', () => {
  const DISPATCH = '/api/proxy/dispatch';
  const RECOMMEND = '/api/proxy/recommend-and-dispatch';

  // B1 — routes/proxy-dispatch.js:543 (pbt)
  test('B1 POST /dispatch pbt (MCP follow-up): golden mint; prompt verbatim; token as field', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', target: 'cli', followUpTo: BRANCH_FOLLOW_UP });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.equal(captured.items[0].prompt, 'next beat');
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });

  // A1 — routes/proxy-dispatch.js:497 (attach), MCP + prose
  test('A1 POST /dispatch attach (MCP): block appended, token stripped to field', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', followUpTo: BRANCH_FOLLOW_UP, appendProxyContext: true, harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER), 'attach appends the block');
    assert.ok(!captured.items[0].prompt.includes(MINTED), 'MCP strips the token from prose');
    assert.equal(captured.items[0].bootstrapToken, MINTED, 'token lands in the field');
  });

  test('A1 POST /dispatch attach (prose): block appended, token embedded in prose', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', followUpTo: BRANCH_FOLLOW_UP, appendProxyContext: true, harness: 'opencode' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER), 'attach appends the block');
    assert.ok(captured.items[0].prompt.includes(MINTED), 'prose embeds the token');
    assert.strictEqual(captured.items[0].bootstrapToken, null, 'no field when the token is in prose');
  });

  // B2 — routes/proxy-dispatch.js:961 (pbt), override arm
  test('B2 recommend-and-dispatch override arm pbt (MCP): golden mint; token as field', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: BRANCH_FOLLOW_UP });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.equal(captured.items[0].bootstrapToken, MINTED);
    assert.ok(!captured.items[0].prompt.includes(PROXY_MARKER), 'pbt does not append the block');
  });

  // A2 — routes/proxy-dispatch.js:936 (attach), override arm
  test('A2 recommend-and-dispatch override arm attach (MCP): block appended, token to field', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: BRANCH_FOLLOW_UP, appendProxyContext: true, harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });

  test('A2 recommend-and-dispatch override arm attach (prose): token embedded in prose', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: BRANCH_FOLLOW_UP, appendProxyContext: true, harness: 'opencode' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.ok(captured.items[0].prompt.includes(MINTED));
    assert.strictEqual(captured.items[0].bootstrapToken, null);
  });

  // B3 — routes/proxy-dispatch.js:1232 (pbt), LLM arm
  test('B3 recommend-and-dispatch LLM arm pbt (MCP): golden mint; token as field', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo: BRANCH_FOLLOW_UP });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.equal(captured.items[0].bootstrapToken, MINTED);
    assert.ok(!captured.items[0].prompt.includes(PROXY_MARKER));
  });

  // A3 — routes/proxy-dispatch.js:1207 (attach), LLM arm
  test('A3 recommend-and-dispatch LLM arm attach (MCP): block appended, token to field', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo: BRANCH_FOLLOW_UP, appendProxyContext: true, harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });

  test('A3 recommend-and-dispatch LLM arm attach (prose): token embedded in prose', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo: BRANCH_FOLLOW_UP, appendProxyContext: true, harness: 'opencode' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.ok(captured.items[0].prompt.includes(MINTED));
    assert.strictEqual(captured.items[0].bootstrapToken, null);
  });

  // Launch counterparts for the dead pbt branch (removed at S5/T2-ii).
  test('launch appendProxyContext:false mints nothing and leaves the prompt verbatim', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', DISPATCH, { prompt: 'self-contained', issueIdentifier: 'TEST-1', appendProxyContext: false, harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.mintCalls.length, 0, 'opt-out mints nothing');
    assert.equal(captured.items[0].prompt, 'self-contained');
    assert.strictEqual(captured.items[0].bootstrapToken, null);
  });

  test('default launch attaches (block appended, MCP token as field)', async () => {
    const { app, captured } = proxyApp();
    const res = await callRoute(app, 'post', DISPATCH, { prompt: 'fresh', issueIdentifier: 'TEST-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });
});

// ── routes/dispatch.js session route: attach + pbt + proxyAttachFailed guard ──

const SESSION_PATH = '/workspace/acme/api/dispatch';

function sessionApp({ anchor = null, proxyTokenStore } = {}) {
  const captured = { mintCalls: [], items: [] };
  const pstore = proxyTokenStore === undefined
    ? { createToken: async (urlKey, opts) => { captured.mintCalls.push({ urlKey, opts }); return { token: MINTED }; } }
    : proxyTokenStore;
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      addItem: async (urlKey, item) => { captured.items.push(item); return { _id: 'disp-1', dispatchedAt: '2026-07-09T00:00:00.000Z', ...item }; },
      getItemStatus: async () => anchor
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; req.session = { accountId: 'u1', linearUserId: 'u1' }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: pstore
  }));
  return { app, captured };
}

describe('S0 — dispatch.js session route branches', () => {
  // B4 — routes/dispatch.js:546 (pbt)
  test('B4 session reply-box pbt (MCP anchor): golden mint; prompt verbatim; token as field', async () => {
    const { app, captured } = sessionApp({ anchor: { harness: 'claude-code' } });
    const res = await callRoute(app, 'post', SESSION_PATH, { prompt: 'do the thing', followUpTo: BRANCH_FOLLOW_UP, target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.equal(captured.items[0].prompt, 'do the thing');
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });

  // A4 — routes/dispatch.js:490 (attach)
  test('A4 session attach (MCP): block appended, token stripped to field', async () => {
    const { app, captured } = sessionApp();
    const res = await callRoute(app, 'post', SESSION_PATH, { prompt: 'do the thing', followUpTo: BRANCH_FOLLOW_UP, attachProxy: true, harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.ok(!captured.items[0].prompt.includes(MINTED));
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });

  test('A4 session attach (prose): block appended, token embedded in prose', async () => {
    const { app, captured } = sessionApp();
    const res = await callRoute(app, 'post', SESSION_PATH, { prompt: 'do the thing', followUpTo: BRANCH_FOLLOW_UP, attachProxy: true, harness: 'opencode' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.ok(captured.items[0].prompt.includes(MINTED));
    assert.strictEqual(captured.items[0].bootstrapToken, null);
  });

  // The route's own proxyAttachFailed guard: an attach that did not change the
  // prompt (prose + no store) or any MCP fail-closed is a 503, nothing enqueued.
  test('proxyAttachFailed guard: prose attach with no store is a 503, nothing enqueued', async () => {
    const { app, captured } = sessionApp({ proxyTokenStore: null });
    const res = await callRoute(app, 'post', SESSION_PATH, { prompt: 'do the thing', followUpTo: BRANCH_FOLLOW_UP, attachProxy: true, harness: 'opencode' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(captured.items.length, 0);
  });

  test('proxyAttachFailed guard: MCP attach whose mint throws is a 503, nothing enqueued', async () => {
    const { app, captured } = sessionApp({ proxyTokenStore: { createToken: async () => { throw new Error('rate limited'); } } });
    const res = await callRoute(app, 'post', SESSION_PATH, { prompt: 'do the thing', followUpTo: BRANCH_FOLLOW_UP, attachProxy: true, harness: 'claude-code' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(captured.items.length, 0);
  });

  // Launch counterparts on the session route.
  test('launch attachProxy omitted -> prompt verbatim, no mint', async () => {
    const { app, captured } = sessionApp();
    const res = await callRoute(app, 'post', SESSION_PATH, { prompt: 'do the thing', harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.mintCalls.length, 0);
    assert.equal(captured.items[0].prompt, 'do the thing');
    assert.strictEqual(captured.items[0].bootstrapToken, null);
  });

  test('default launch attachProxy:true attaches (block + MCP token field)', async () => {
    const { app, captured } = sessionApp();
    const res = await callRoute(app, 'post', SESSION_PATH, { prompt: 'do the thing', harness: 'claude-code', attachProxy: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.items[0].prompt.includes(PROXY_MARKER));
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });
});

// ── flight-companion approve-follow-up (B5, pbt-only) ─────────────────────────

const FC_PATH = '/workspace/acme/api/flight-companion/approve-follow-up';

function fcApp({ anchorStatus = null } = {}) {
  const captured = { mintCalls: [], items: [] };
  const tIso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const history = [{
    id: 'sess-done', promptName: 'implementation', prompt: 'prompt body', issueId: 'uuid-500',
    issueIdentifier: 'LIN-500', issueTitle: 'A task', issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: 'acme' }, dispatchedAt: tIso(60), dispatchedBy: 'user-1', target: 'cli',
    repo: null, status: 'taken', resolvedAt: tIso(30), kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: tIso(30) }]
  }];
  const app = express();
  app.use(express.json());
  app.use(createFlightCompanionRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: 'acme' }; req.session = { accountId: 'u1', features: { flightCompanion: true } }; next(); },
    getOpenRouterSource: () => null, getDeployInfo: () => ({}), observerStateStore: null, freeTierStore: null,
    workspacePreferencesStore: null, recapCacheStore: null, briefCacheStore: null,
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      listItems: async () => [],
      listHistory: async () => ({ items: history, total: history.length }),
      getItemStatus: async () => anchorStatus,
      addItem: async (urlKey, item) => { captured.items.push(item); return { _id: 'disp-new-1', dispatchedAt: new Date().toISOString(), ...item }; }
    },
    agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
    proxyTokenStore: { createToken: async (urlKey, opts) => { captured.mintCalls.push({ urlKey, opts }); return { token: MINTED }; } }
  }));
  return { app, captured };
}

describe('S0 — flight-companion approve-follow-up branch (pbt)', () => {
  // B5 — routes/flight-companion.js:956 (pbt)
  test('B5 MCP anchor: golden mint; prompt verbatim; token as field', async () => {
    const { app, captured } = fcApp({ anchorStatus: { harness: 'claude-code' } });
    const res = await callRoute(app, 'post', FC_PATH, { sessionId: 'sess-done', prompt: 'next beat' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertGoldenMint(captured.mintCalls, { createdBy: 'u1' });
    assert.equal(captured.items[0].prompt, 'next beat');
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });

  test('blank anchor: no mint; token stays null', async () => {
    const { app, captured } = fcApp({ anchorStatus: null });
    const res = await callRoute(app, 'post', FC_PATH, { sessionId: 'sess-done', prompt: 'next beat' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(captured.mintCalls.length, 0);
    assert.strictEqual(captured.items[0].bootstrapToken, null);
  });
});

// ── chat-tools send_follow_up (B6, pbt-only) ─────────────────────────────────

function chatSessionRows() {
  const tIso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  return [{
    id: 'sess-done', promptName: 'implementation', prompt: 'prompt body', issueId: 'uuid-500',
    issueIdentifier: 'LIN-500', issueTitle: 'A task', issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: 'ws-key' }, dispatchedAt: tIso(60), dispatchedBy: 'user-1', target: 'cli',
    repo: null, status: 'taken', resolvedAt: tIso(30), kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: tIso(30) }]
  }];
}

function chatCatalog({ anchorHarness, proxyTokenStore } = {}) {
  const captured = { mintCalls: [], items: [] };
  const history = chatSessionRows();
  const { executeTool } = createChatToolCatalog({
    provider: {
      fetchRecommendationContext: async () => ({}),
      search: async () => [],
      relations: async () => ({ trashed: false, relations: { nodes: [] }, inverseRelations: { nodes: [] } }),
      fetchProjects: async () => ({ projects: [], issues: [] })
    },
    scope: 'workspace-token-abc', urlKey: 'ws-key',
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      listItems: async () => [],
      listHistory: async () => { const items = withFreshDigests(history); return { items, total: items.length }; },
      getItemStatus: async () => (anchorHarness !== undefined ? { harness: anchorHarness } : null),
      addItem: async (urlKey, item) => { captured.items.push(item); return { _id: 'queued-item-1', urlKey, ...item }; }
    },
    agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
    sessionIsTerminal: (session) => (session.loops || []).some((l) => l.terminalStatus === 'done'),
    followUpEnabled: true,
    dispatchedBy: 'user-42',
    proxyTokenStore,
    baseUrl: 'https://harbour.test'
  });
  return { executeTool, captured };
}

describe('S0 — chat-tools send_follow_up branch (pbt)', () => {
  // B6 — lib/chat-tools.js:2090 (pbt)
  test('B6 MCP anchor: golden mint (createdBy=dispatchedBy); prompt verbatim; token as field', async () => {
    const mintCalls = [];
    const proxyTokenStore = { createToken: async (urlKey, opts) => { mintCalls.push({ urlKey, opts }); return { token: MINTED }; } };
    const { executeTool, captured } = chatCatalog({ anchorHarness: 'claude-code', proxyTokenStore });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
    assert.equal(result.queued, true);
    assertGoldenMint(mintCalls, { createdBy: 'user-42' });
    assert.equal(captured.items[0].prompt, 'ship it');
    assert.equal(captured.items[0].bootstrapToken, MINTED);
  });

  test('blank anchor: no mint; token stays null', async () => {
    const mintCalls = [];
    const { executeTool, captured } = chatCatalog({ anchorHarness: null, proxyTokenStore: { createToken: async (urlKey, opts) => { mintCalls.push({ urlKey, opts }); return { token: MINTED }; } } });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });
    assert.equal(result.queued, true);
    assert.equal(mintCalls.length, 0);
    assert.strictEqual(captured.items[0].bootstrapToken, null);
  });
});

// ── the wake (wake-credential.js:91 via addFeedback) ─────────────────────────

describe('S0 — wake branch createToken args + output', () => {
  test('wake provider mints with label wake-bootstrap and the recorded createdBy', async () => {
    const mintCalls = [];
    const provision = buildWakeCredentialProvisioner({
      proxyTokenStore: { createToken: async (urlKey, opts) => { mintCalls.push({ urlKey, opts }); return { token: 'wake-tok' }; } },
      urlKey: 'acme', baseUrl: 'https://host', createdBy: 'acct'
    });
    const out = await provision('claude-code');
    assert.deepEqual(out, { token: 'wake-tok', reason: null, degraded: null });
    assert.equal(mintCalls.length, 1);
    assert.equal(mintCalls[0].urlKey, 'acme');
    assert.deepEqual(mintCalls[0].opts, {
      kind: 'bootstrap', scope: 'readWrite', label: 'wake-bootstrap', ttl: BOOTSTRAP_TOKEN_TTL_SECONDS, createdBy: 'acct'
    });
  });
});
