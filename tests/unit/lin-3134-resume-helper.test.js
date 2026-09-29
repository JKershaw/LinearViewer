/**
 * LIN-3138 S3 (LIN-3134 T2-i) — `provisionResumeCredential`.
 *
 * Witnesses the ticket's S3 acceptance:
 *   - F1: a declared item minted through the preamble exchanges at worker
 *     lifetimes (48h/48h) via the real ProxyTokenStore, and a runner mint stays
 *     1h/24h;
 *   - F2 (7) helper half: a declared row through the real store resolves via the
 *     helper (history fallback) and the record never reaches addItem's return;
 *   - F2 (9): the mint sees the RECORDED owner and workspace, never `createdBy`;
 *   - N2: corrupt-record helper cells (INVALID_GRANTS / GRANT_OWNERLESS), spy 0,
 *     `mint:false` carries the record unchanged;
 *   - N3 helper: a lookup read fault maps to OWNER_CHECK_UNAVAILABLE 503
 *     retryable + proxyAttachFailed, message "declaration lookup unavailable";
 *   - attach mode (MCP + prose), no record and record; no lookup without followUpTo.
 */
process.env.NODE_ENV = 'test';

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import { provisionResumeCredential, provisionBootstrapToken } from '../../lib/proxy-preamble.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { RUNNER_GRANTS } from '../../lib/proxy-scopes.js';
import { DispatchQueueStore, GRANT_LOOKUP_HISTORY_RETRIES, GRANT_LOOKUP_RETRY_MS } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createProxyRoutes } from '../../routes/proxy.js';

const HOUR_MS = 60 * 60 * 1000;
const hoursFromNow = (iso, from = Date.now()) => (new Date(iso).getTime() - from) / HOUR_MS;
const TOKEN = 'declared-tok';
const RECORD = {
  grants: ['dispatch'],
  ownerAccountId: 'account-A',
  workspaceId: 'ws-1',
  profile: 'worker',
  site: 'proxy-kickoff',
  declaredAt: '2026-09-29T00:00:00.000Z'
};

function mintSpy({ result, error } = {}) {
  const calls = [];
  return {
    calls,
    async mintGrantBootstrap(args) {
      calls.push(args);
      if (error) throw error;
      return result || { token: TOKEN, tokenId: 't1', workspaceId: args.workspaceId };
    },
    async createToken(urlKey, opts) {
      calls.push({ createToken: true, urlKey, opts });
      return { token: 'plain-tok' };
    }
  };
}

function recordStore(record = RECORD) {
  const calls = [];
  return {
    calls,
    async getGrantDeclaration(urlKey, itemId) {
      calls.push({ urlKey, itemId });
      return { state: 'record', record };
    }
  };
}

// ── Step 1: lookup resolution ────────────────────────────────────────────────

describe('S3 — record resolution', () => {
  test('no lookup without followUpTo (and no store needed)', async () => {
    const dispatchStore = { getGrantDeclaration: async () => { throw new Error('must not be consulted'); } };
    const store = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', label: 'dispatch-bootstrap', createdBy: 'u1' });
    assert.deepEqual(result, { prompt: 'p', bootstrapToken: 'plain-tok', grantDeclaration: null });
  });

  test('a store without getGrantDeclaration when a lookup is needed throws (never a silent plain)', async () => {
    await assert.rejects(
      () => provisionResumeCredential({ proxyTokenStore: mintSpy(), dispatchStore: {}, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', followUpTo: 'row-1' }),
      /getGrantDeclaration/
    );
  });

  test('the sentinel undefined triggers a lookup; null skips it', async () => {
    const store = recordStore();
    await provisionResumeCredential({ proxyTokenStore: mintSpy(), dispatchStore: store, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', followUpTo: 'row-1' });
    assert.equal(store.calls.length, 1);

    const store2 = recordStore();
    await provisionResumeCredential({ proxyTokenStore: mintSpy(), dispatchStore: store2, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', followUpTo: 'row-1', grantDeclaration: null });
    assert.equal(store2.calls.length, 0);
  });
});

// ── Step 2: no record → today's exact calls ──────────────────────────────────

describe('S3 — no record plain path', () => {
  test('pbt: provisionBootstrapToken gets today\'s exact args; grantDeclaration null', async () => {
    const store = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: { getGrantDeclaration: async () => ({ state: 'none' }) }, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', label: 'dispatch-bootstrap', harness: 'claude-code', createdBy: 'u1', followUpTo: 'row-1' });
    assert.deepEqual(result, { prompt: 'p', bootstrapToken: 'plain-tok', grantDeclaration: null });
    const call = store.calls[0];
    assert.deepEqual(call.opts, { kind: 'bootstrap', scope: 'readWrite', label: 'dispatch-bootstrap', ttl: 48 * 60 * 60, createdBy: 'u1' });
  });

  test('mint:false with no record returns bootstrapToken null, no mint', async () => {
    const store = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', mint: false, followUpTo: null });
    assert.deepEqual(result, { prompt: 'p', bootstrapToken: null, grantDeclaration: null });
    assert.equal(store.calls.length, 0);
  });

  test('a row-missing lookup is a plain resume (store logs the miss; helper does not)', async () => {
    const logs = [];
    const origWarn = console.warn;
    console.warn = (...a) => logs.push(a);
    let result;
    try {
      result = await provisionResumeCredential({ proxyTokenStore: mintSpy(), dispatchStore: { getGrantDeclaration: async () => ({ state: 'row-missing' }) }, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', harness: 'claude-code', createdBy: 'u1', followUpTo: 'row-1' });
    } finally {
      console.warn = origWarn;
    }
    assert.deepEqual(result, { prompt: 'p', bootstrapToken: 'plain-tok', grantDeclaration: null });
    assert.equal(logs.length, 0, 'the helper must not log the miss a second time');
  });
});

// ── Step 3: record → declared branch ─────────────────────────────────────────

describe('S3 — record declared branch', () => {
  test('F2(9): mints from the RECORDED owner/workspace, ignoring createdBy', async () => {
    const store = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: recordStore(), urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', label: 'dispatch-bootstrap', harness: 'claude-code', createdBy: 'poster-B', followUpTo: 'row-1' });
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].ownerAccountId, 'account-A', 'recorded owner, never the poster');
    assert.equal(store.calls[0].workspaceId, 'ws-1', 'recorded workspace');
    assert.deepEqual(store.calls[0].grants, ['dispatch']);
    assert.equal(result.bootstrapToken, TOKEN);
    assert.equal(result.grantDeclaration, RECORD, 'the parent record is returned unchanged');
    assert.equal(result.grantDeclaration.workspaceId, 'ws-1');
  });

  test('attach mode also mints from the recorded owner (not createdBy)', async () => {
    const store = mintSpy();
    const result = await provisionResumeCredential({
      proxyTokenStore: store, dispatchStore: recordStore(), urlKey: 'acme', baseUrl: 'https://h',
      prompt: 'ignored', attach: { issueIdentifier: 'LIN-1', prompt: 'base', providerDisplayName: null, providerUi: null },
      label: 'dispatch-bootstrap', harness: 'claude-code', createdBy: 'poster-B', followUpTo: 'row-1'
    });
    assert.equal(store.calls[0].ownerAccountId, 'account-A');
    assert.equal(store.calls[0].workspaceId, 'ws-1');
    assert.equal(result.bootstrapToken, TOKEN);
    assert.equal(result.grantDeclaration, RECORD);
  });

  test('the S2 declared branch is reached (mintGrantBootstrap called)', async () => {
    const store = mintSpy();
    await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: recordStore(), urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', harness: 'claude-code', followUpTo: 'row-1' });
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].profile, 'worker');
  });
});

// ── N2 corruption (helper cells) ─────────────────────────────────────────────

describe('S3 — N2 record corruption', () => {
  const cases = [
    ['grants []', { ...RECORD, grants: [] }, 'INVALID_GRANTS'],
    ['grants null', { ...RECORD, grants: null }, 'INVALID_GRANTS'],
    ['grants string', { ...RECORD, grants: 'dispatch' }, 'INVALID_GRANTS'],
    ['non-object record', 'dispatch', 'INVALID_GRANTS'],
    ['missing workspaceId', { ...RECORD, workspaceId: null }, 'INVALID_GRANTS'],
    ['missing site', { ...RECORD, site: null }, 'INVALID_GRANTS'],
    ['missing ownerAccountId', { ...RECORD, ownerAccountId: null }, 'GRANT_OWNERLESS']
  ];

  for (const [label, record, code] of cases) {
    test(`${label} -> ${code}, mint spy 0`, async () => {
      const store = mintSpy();
      await assert.rejects(
        () => provisionResumeCredential({ proxyTokenStore: store, dispatchStore: recordStore(record), urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', harness: 'claude-code', followUpTo: 'row-1' }),
        (err) => err.code === code
      );
      assert.equal(store.calls.length, 0);
    });
  }

  test('mint:false does not validate and returns the corrupt record unchanged', async () => {
    const corrupt = { ...RECORD, grants: [] };
    const store = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: recordStore(corrupt), urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', mint: false, followUpTo: 'row-1' });
    assert.deepEqual(result, { prompt: 'p', bootstrapToken: null, grantDeclaration: corrupt });
    assert.equal(store.calls.length, 0);
  });

  test('an unknown grant name reaches the mint and is refused there', async () => {
    const coded = Object.assign(new Error('Grant bootstrap mint refused: INVALID_GRANTS'), { code: 'INVALID_GRANTS', status: 400, retryable: false });
    const store = mintSpy({ error: coded });
    await assert.rejects(
      () => provisionResumeCredential({ proxyTokenStore: store, dispatchStore: recordStore({ ...RECORD, grants: ['bogus'] }), urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', harness: 'claude-code', followUpTo: 'row-1' }),
      (err) => err === coded
    );
    assert.equal(store.calls.length, 1, 'the unknown name was not rejected pre-mint');
  });
});

// ── N3 helper read fault ─────────────────────────────────────────────────────

describe('S3 — N3 lookup read fault mapping', () => {
  test('a thrown lookup maps to OWNER_CHECK_UNAVAILABLE 503 retryable + proxyAttachFailed', async () => {
    const store = mintSpy();
    await assert.rejects(
      () => provisionResumeCredential({
        proxyTokenStore: store,
        dispatchStore: { getGrantDeclaration: async () => { const e = new Error('boom'); e.declarationLookupFailed = true; throw e; } },
        urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', harness: 'claude-code', followUpTo: 'row-1'
      }),
      (err) => err.code === 'OWNER_CHECK_UNAVAILABLE'
        && err.status === 503
        && err.retryable === true
        && err.proxyAttachFailed === true
        && err.message === 'declaration lookup unavailable'
    );
    assert.equal(store.calls.length, 0, 'nothing minted under the fault');
  });

  test('the helper adds no log of its own on the fault (the store owns the log)', async () => {
    const logs = [];
    const ow = console.warn; const oe = console.error;
    console.warn = (...a) => logs.push(['warn', ...a]);
    console.error = (...a) => logs.push(['error', ...a]);
    try {
      await provisionResumeCredential({
        proxyTokenStore: mintSpy(),
        dispatchStore: { getGrantDeclaration: async () => { throw new Error('boom'); } },
        urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', followUpTo: 'row-1'
      }).catch(() => {});
    } finally {
      console.warn = ow; console.error = oe;
    }
    assert.equal(logs.length, 0);
  });
});

// ── attach mode (no record and record; MCP + prose) ──────────────────────────

describe('S3 — attach mode', () => {
  const attach = { issueIdentifier: 'LIN-1', prompt: 'base', providerDisplayName: null, providerUi: null };

  test('no record, MCP: block appended, token as field, grantDeclaration null', async () => {
    const store = { createToken: async () => ({ token: 'plain-tok' }) };
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: { getGrantDeclaration: async () => ({ state: 'none' }) }, urlKey: 'acme', baseUrl: 'https://h', prompt: 'base', attach, harness: 'claude-code', createdBy: 'u1', followUpTo: 'row-1' });
    assert.deepEqual(Object.keys(result).sort(), ['bootstrapToken', 'grantDeclaration', 'prompt']);
    assert.equal(result.bootstrapToken, 'plain-tok');
    assert.ok(result.prompt.startsWith('base'));
    assert.ok(!result.prompt.includes('plain-tok'));
    assert.strictEqual(result.grantDeclaration, null);
  });

  test('no record, prose: token embedded, bootstrapToken null', async () => {
    const store = { createToken: async () => ({ token: 'plain-tok' }) };
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: { getGrantDeclaration: async () => ({ state: 'none' }) }, urlKey: 'acme', baseUrl: 'https://h', prompt: 'base', attach, harness: 'opencode', createdBy: 'u1', followUpTo: 'row-1' });
    assert.strictEqual(result.bootstrapToken, null);
    assert.ok(result.prompt.includes('plain-tok'));
    assert.strictEqual(result.grantDeclaration, null);
  });

  test('record, MCP: declared attach, recorded owner, token field, record returned', async () => {
    const store = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: recordStore(), urlKey: 'acme', baseUrl: 'https://h', prompt: 'base', attach, harness: 'claude-code', createdBy: 'poster-B', followUpTo: 'row-1' });
    assert.equal(store.calls[0].ownerAccountId, 'account-A');
    assert.equal(result.bootstrapToken, TOKEN);
    assert.equal(result.grantDeclaration, RECORD);
  });

  test('record, prose: declared attach, token embedded, record returned', async () => {
    const store = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: store, dispatchStore: recordStore(), urlKey: 'acme', baseUrl: 'https://h', prompt: 'base', attach, harness: 'opencode', createdBy: 'poster-B', followUpTo: 'row-1' });
    assert.strictEqual(result.bootstrapToken, null);
    assert.ok(result.prompt.includes(TOKEN));
    assert.equal(result.grantDeclaration, RECORD);
  });
});

// ── F2 (7) helper half: real store, history fallback ─────────────────────────

describe('S3 — F2(7) helper half (real store, history fallback)', () => {
  test('a declared row resolves through take+archive and the record never reaches addItem\'s return', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const returned = await store.addItem('acme', { prompt: 'run me', grantDeclaration: RECORD });
    assert.equal('grantDeclaration' in returned, false, 'addItem return is stripped (store half)');
    assert.deepEqual(store.collection._docs[0].grantDeclaration, RECORD, 'persisted doc keeps it');

    // Take → the row is now only in history.
    await store.takeItem(returned._id, 'acme');
    assert.equal(store.collection._docs.length, 0);

    const mint = mintSpy();
    const result = await provisionResumeCredential({ proxyTokenStore: mint, dispatchStore: store, urlKey: 'acme', baseUrl: 'https://h', prompt: 'p', harness: 'claude-code', createdBy: 'poster-B', followUpTo: returned._id });
    assert.deepEqual(result.grantDeclaration, RECORD, 'resolved from history (active is empty)');
    assert.equal(mint.calls[0].ownerAccountId, 'account-A');
    assert.equal(mint.calls[0].workspaceId, 'ws-1');
  });
});

// ── F1: real ProxyTokenStore lifetimes ───────────────────────────────────────

function createCollection() {
  let docs = [];
  const matches = (d, query) => Object.keys(query).every(k => {
    if (k === '$or') return query.$or.some(sub => matches(d, sub));
    const val = query[k];
    if (val && typeof val === 'object') {
      if ('$lt' in val && '$ne' in val) return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      if ('$lt' in val) return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      return true;
    }
    return d[k] === val;
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => !matches(d, query));
      return { deletedCount: before - docs.length };
    },
    find(query) { return { toArray: async () => docs.filter(d => matches(d, query)) }; },
    _docs: () => docs
  };
}

function newStore() {
  const collection = createCollection();
  const store = new ProxyTokenStore({ collection });
  store.setOwnerCheck(async () => ({ status: 'owner' }));
  return { store, collection };
}

function buildApp(store) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: store,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem: async () => ({}) },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function postExchange(app, bearer) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/token`, { method: 'POST', headers });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const workingDocFor = (collection, token) => {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return collection._docs().find(d => d.tokenHash === hash);
};
function shiftBack(doc, ms) {
  doc.createdAt = new Date(new Date(doc.createdAt).getTime() - ms);
  if (doc.expiresAt) doc.expiresAt = new Date(new Date(doc.expiresAt).getTime() - ms);
}

describe('S3 — F1 declared worker lifetimes through the preamble', () => {
  test('worker bootstrap: exchange at +23h59m gives 200, grants dispatch, working ~48h; valid at +25h; expiry+1s -> 401', async () => {
    const { store, collection } = newStore();
    const app = buildApp(store);

    const minted = await provisionBootstrapToken({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h',
      label: 'dispatch-bootstrap', harness: 'claude-code',
      declaredGrants: ['dispatch'], grantOwnerAccountId: 'account-A',
      workspaceId: 'ws-1', declaredSite: 'proxy-kickoff'
    });
    const boot = collection._docs().find(d => d.label === 'dispatch-bootstrap');
    assert.equal(boot.lifetimeProfile, 'worker');
    assert.equal(boot.createdBy, 'account-A');
    assert.equal(boot.workspaceId, 'ws-1');
    assert.deepEqual(boot.grants, ['dispatch']);

    shiftBack(boot, (24 * HOUR_MS) - (60 * 1000));
    const before = Date.now();
    const exchange = await postExchange(app, minted.token);
    assert.equal(exchange.status, 200, JSON.stringify(exchange.body));
    assert.deepEqual(exchange.body.grants, ['dispatch']);
    const hours = hoursFromNow(exchange.body.expiresAt, before);
    assert.ok(hours > 47.9 && hours <= 48.02, `expected ~48h, got ${hours}`);

    shiftBack(workingDocFor(collection, exchange.body.token), 25 * HOUR_MS);
    const validated = await store.validateToken(exchange.body.token);
    assert.ok(validated, 'still valid 25h after exchange');
    assert.deepEqual(validated.grants, ['dispatch']);
  });

  test('worker bootstrap at expiry +1s -> 401', async () => {
    const { store, collection } = newStore();
    const app = buildApp(store);
    const minted = await provisionBootstrapToken({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h',
      label: 'dispatch-bootstrap', harness: 'claude-code',
      declaredGrants: ['dispatch'], grantOwnerAccountId: 'account-A',
      workspaceId: 'ws-1', declaredSite: 'proxy-kickoff'
    });
    collection._docs().find(d => d.label === 'dispatch-bootstrap').expiresAt = new Date(Date.now() - 1000);
    const exchange = await postExchange(app, minted.token);
    assert.equal(exchange.status, 401, JSON.stringify(exchange.body));
  });

  test('a runner-profile bootstrap stays 1h/24h', async () => {
    const { store } = newStore();
    const before = Date.now();
    const boot = await store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: RUNNER_GRANTS, label: 'runner-bootstrap', profile: 'runner' });
    assert.ok(hoursFromNow(boot.expiresAt, before) > 0.99 && hoursFromNow(boot.expiresAt, before) <= 1.001, 'runner bootstrap ~1h');
    const beforeWorking = Date.now();
    const working = await store.exchangeBootstrapToken(boot.token);
    assert.ok(hoursFromNow(working.expiresAt, beforeWorking) > 23.9 && hoursFromNow(working.expiresAt, beforeWorking) <= 24.01, 'runner working ~24h');
  });
});

// ── R1 take-hop through the HELPER (a+b), mock timers ────────────────────────

/**
 * Active/history fakes modelling delete-then-insert faithfully: the row is
 * removed from active first (active `findOne` never returns it) and reaches
 * history only when the test releases the insert. History `findOne` calls are
 * counted (read 1 = initial, reads 2-4 = the at-most-3 re-reads).
 */
function takeHopStore({ releaseAtHistoryRead = null } = {}) {
  const row = { _id: 'hop-1', urlKey: 'acme', grantDeclaration: RECORD };
  let activeReads = 0;
  let historyReads = 0;
  let inserted = false;
  const collection = { async findOne() { activeReads += 1; return null; } };
  const historyCollection = {
    async findOne() {
      historyReads += 1;
      if (releaseAtHistoryRead !== null && historyReads >= releaseAtHistoryRead) inserted = true;
      return inserted ? row : null;
    }
  };
  return {
    dispatchStore: new DispatchQueueStore({ collection, historyCollection }),
    counts: () => ({ activeReads, historyReads })
  };
}

async function settleWithMockTimers(promise) {
  let settled = false;
  let value;
  let failure;
  promise.then((v) => { value = v; settled = true; }, (e) => { failure = e; settled = true; });
  for (let i = 0; i < GRANT_LOOKUP_HISTORY_RETRIES + 1 && !settled; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(GRANT_LOOKUP_RETRY_MS);
  }
  await new Promise((resolve) => setImmediate(resolve));
  if (failure) throw failure;
  return value;
}

describe('S3 — R1 take-hop through the helper (mock timers, counted reads)', () => {
  for (const releaseAtHistoryRead of [2, 3, 4]) {
    test(`(a) insert released at history read ${releaseAtHistoryRead}: record resolves AND the resume is declared`, async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const { dispatchStore, counts } = takeHopStore({ releaseAtHistoryRead });
        const mint = mintSpy();
        const result = await settleWithMockTimers(provisionResumeCredential({
          proxyTokenStore: mint, dispatchStore, urlKey: 'acme', baseUrl: 'https://h',
          prompt: 'p', label: 'dispatch-bootstrap', harness: 'claude-code', createdBy: 'poster-B', followUpTo: 'hop-1'
        }));
        assert.equal(result.bootstrapToken, TOKEN, 'the resume is declared, not plain');
        assert.deepEqual(result.grantDeclaration, RECORD);
        assert.equal(mint.calls.length, 1);
        assert.equal(mint.calls[0].ownerAccountId, 'account-A', 'mint spy sees the recorded owner');
        assert.equal(mint.calls[0].workspaceId, 'ws-1', 'mint spy sees the recorded workspaceId');
        const { activeReads, historyReads } = counts();
        assert.equal(activeReads, 1, 'exactly one active read — no third active read');
        assert.equal(historyReads, releaseAtHistoryRead);
        assert.ok(historyReads <= 1 + GRANT_LOOKUP_HISTORY_RETRIES, 'at most 3 re-reads');
      } finally {
        mock.timers.reset();
      }
    });
  }

  test('(b) insert released only after 4 history reads: row-missing, miss log, plain resume', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { dispatchStore, counts } = takeHopStore({ releaseAtHistoryRead: null });
      const mint = mintSpy();
      const logs = [];
      const origWarn = console.warn;
      console.warn = (...args) => logs.push(args);
      let result;
      try {
        result = await settleWithMockTimers(provisionResumeCredential({
          proxyTokenStore: mint, dispatchStore, urlKey: 'acme', baseUrl: 'https://h',
          prompt: 'p', label: 'dispatch-bootstrap', harness: 'claude-code', createdBy: 'u1', followUpTo: 'hop-1'
        }));
      } finally {
        console.warn = origWarn;
      }
      assert.deepEqual(result, { prompt: 'p', bootstrapToken: 'plain-tok', grantDeclaration: null }, 'plain resume');
      assert.equal(mint.calls.filter(c => c.opts).length, 1, 'the plain path still createTokens');
      const { activeReads, historyReads } = counts();
      assert.equal(activeReads, 1, 'exactly one active read');
      assert.equal(historyReads, 1 + GRANT_LOOKUP_HISTORY_RETRIES, 'initial history read + all 3 re-reads');
      assert.equal(logs.length, 1);
      assert.equal(logs[0][0], '[dispatch] resume-declaration-lookup-miss');
    } finally {
      mock.timers.reset();
    }
  });
});

