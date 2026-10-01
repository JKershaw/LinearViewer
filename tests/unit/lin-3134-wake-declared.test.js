/**
 * LIN-3139 (LIN-3134 T2-ii) S6 — the declared wake.
 *
 * The wake is Class F's eleventh member: `addFeedback` reads the parent's
 * persisted record (`edgeDoc.sessionId`) before the provider block, carries it
 * onto the wake row, and hands it to the provider, which mints from the
 * RECORDED owner/workspace through `provisionResumeCredential`.
 *
 * Real `DispatchQueueStore` on mock collections (the
 * dispatch-wake-credential-provisioning.test.js pattern), a real
 * `ProxyTokenStore` with a stubbed owner check, and both real builder sites
 * (routes/dispatch.js feedback, routes/proxy-runner.js runner feedback).
 *
 * Covers F2 (1), (2)/(2b), (5), (6), (8); N5 negative half from both builders
 * plus a record without a proxy token store; N3 wake withdraw (first read and
 * re-read); N2 wake structural degrade; the prose gate with a record.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
// fixture:LIN-3136
import { mintDispatchWriter } from './lib/dispatch-writer.js';
// /fixture:LIN-3136
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { buildWakeCredentialProvisioner } from '../../lib/wake-credential.js';
// Namespace import so this file still loads (and reports per-cell red) before
// the export exists.
import * as dispatchWake from '../../lib/dispatch-wake.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRunnerRoutes } from '../../routes/proxy-runner.js';
import { createProxyRoutes } from '../../routes/proxy.js';

const URL_KEY = 'acme';
const RECORDED_OWNER = 'account-A';
const RECORDED_WORKSPACE = 'ws-recorded';
const POSTER = 'poster-B';
const BASE_URL = 'https://harbour.test';

const RECORD = Object.freeze({
  grants: ['dispatch'],
  ownerAccountId: RECORDED_OWNER,
  workspaceId: RECORDED_WORKSPACE,
  profile: 'worker',
  site: 'proxy-kickoff',
  declaredAt: '2026-09-29T00:00:00.000Z'
});

const NOTICE = (code) => `your dispatch grant was refused (${code}); you cannot enqueue further work; report this to your human and stop`;

const sha256 = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
// World
// ─────────────────────────────────────────────────────────────────────────────

function makeWorld() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  const tokenCollection = createMockCollection();
  const tokenStore = new ProxyTokenStore({ collection: tokenCollection });

  const world = {
    store, collection, historyCollection, tokenStore, tokenCollection,
    owners: { [RECORDED_WORKSPACE]: RECORDED_OWNER },
    ownerCheckFault: false,
    // 'none' | 'first' (the first read throws) | 'reread' (a history re-read throws)
    lookupFault: 'none',
    lookupCalls: 0,
    spy: { grant: [], plain: [], issued: [] }
  };

  tokenStore.setOwnerCheck(async ({ workspaceId, accountId }) => {
    if (world.ownerCheckFault) throw new Error('owner check backend down');
    const owner = world.owners[workspaceId];
    if (!owner) return { status: 'no-owner' };
    return { status: owner === accountId ? 'owner' : 'not-owner' };
  });

  const realGrant = tokenStore.mintGrantBootstrap.bind(tokenStore);
  tokenStore.mintGrantBootstrap = async (args) => {
    world.spy.grant.push(args);
    const minted = await realGrant(args);
    world.spy.issued.push(minted.token);
    return minted;
  };
  const realCreate = tokenStore.createToken.bind(tokenStore);
  tokenStore.createToken = async (urlKey, opts) => {
    world.spy.plain.push({ urlKey, opts });
    const minted = await realCreate(urlKey, opts);
    world.spy.issued.push(minted.token);
    return minted;
  };

  // Lookup fault seam: the REAL store read runs with faulting collections.
  const realLookup = store.getGrantDeclaration.bind(store);
  store.getGrantDeclaration = async (urlKey, itemId) => {
    world.lookupCalls++;
    if (world.lookupFault === 'none') return realLookup(urlKey, itemId);
    const savedActive = collection.findOne;
    const savedHistory = historyCollection.findOne;
    let historyReads = 0;
    if (world.lookupFault === 'first') {
      collection.findOne = async () => { throw new Error('mongo read timeout'); };
    } else {
      historyCollection.findOne = async (...args) => {
        historyReads++;
        if (historyReads >= 2) throw new Error('mongo re-read timeout');
        return savedHistory.apply(historyCollection, args);
      };
    }
    try {
      return await realLookup(urlKey, itemId);
    } finally {
      collection.findOne = savedActive;
      historyCollection.findOne = savedHistory;
    }
  };
  return world;
}

function resetSpy(world) {
  world.spy.grant.length = 0;
  world.spy.plain.length = 0;
  world.spy.issued.length = 0;
}

/** A parent session row (taken, so it lives in history, like a real run). */
async function seedParent(world, { record = null, harness = 'claude-code' } = {}) {
  const parent = await world.store.addItem(URL_KEY, {
    prompt: 'parent work', kind: 'autopilot', harness,
    ...(record !== null ? { grantDeclaration: record } : {})
  });
  await world.store.takeItem(parent._id, URL_KEY, 'orchestrator');
  return parent._id;
}

async function takenChild(world, sessionId, { subscription = 'terminal-only', tokenLabel = 'token-a', tokenId = null } = {}) {
  const child = await world.store.addItem(URL_KEY, {
    prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42', subscription, sessionId
  });
  await world.store.takeItem(child._id, URL_KEY, tokenLabel, tokenId);
  return child._id;
}

function provisioner(world, { createdBy = POSTER, proxyTokenStore = world.tokenStore } = {}) {
  return buildWakeCredentialProvisioner({ proxyTokenStore, urlKey: URL_KEY, baseUrl: BASE_URL, createdBy });
}

function wakeRows(world) {
  return [...world.collection._docs, ...world.historyCollection._docs].filter(d => d.kind === 'wake');
}

function witnessBurned(world, childId) {
  const doc = world.historyCollection._docs.find(d => d._id === childId);
  return (doc.terminalWakeItems || []).includes(childId);
}

/** Runs `fn`, capturing console output lines. */
async function captureLogs(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    Object.assign(console, saved);
  }
}

async function report(world, childId, message, provision, tokenLabel = 'token-a') {
  return world.store.addFeedback(childId, URL_KEY, { message }, tokenLabel, provision);
}

function assertDeclaredWakeMint(world, row) {
  assert.equal(world.spy.plain.length, 0, `a declared wake never mints plain; saw ${JSON.stringify(world.spy.plain)}`);
  assert.equal(world.spy.grant.length, 1, 'exactly one grant mint');
  assert.deepEqual(world.spy.grant[0], {
    urlKey: URL_KEY, workspaceId: RECORDED_WORKSPACE, ownerAccountId: RECORDED_OWNER,
    grants: ['dispatch'], label: 'wake-bootstrap', profile: 'worker'
  });
  assert.equal(row.bootstrapToken, world.spy.issued[0], 'the grant token travels on the wake row');
  assert.deepEqual(row.grantDeclaration, RECORD, 'the record is carried onto the wake row (C4)');
  assert.equal('grantRefusal' in row, false);
}

async function callApp(app, method, path, body, bearer) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (bearer) opts.headers.Authorization = `Bearer ${bearer}`;
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

/** A later follow-up to `followUpTo` through the real POST /api/proxy/dispatch. */
async function laterFollowUp(world, followUpTo) {
  const poster = await world.tokenStore.createToken(URL_KEY, { kind: 'standard', scope: 'readWrite', label: 'poster', createdBy: POSTER });
  // fixture:LIN-3136: the poster holds the dispatch grant (the enqueue mounts require it)
  poster.token = (await mintDispatchWriter(world.tokenStore, { urlKey: URL_KEY, ownerAccountId: POSTER, label: 'poster' })).token;
  // /fixture:LIN-3136
  resetSpy(world);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: world.tokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 3600000 }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: world.store,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return callApp(app, 'post', '/api/proxy/dispatch', { prompt: 'next beat', target: 'cli', followUpTo }, poster.token);
}

// ─────────────────────────────────────────────────────────────────────────────
// F2 (1): transient withdraw, then a declared mint after the seam is restored
// ─────────────────────────────────────────────────────────────────────────────

describe('F2 (1) — owner check unavailable withdraws the wake; restored, it mints declared', () => {
  test('withdrawn with the witness unburned; re-report enqueues a token that exchanges to [dispatch]', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId);
    const provision = provisioner(world);

    world.ownerCheckFault = true;
    const { result, lines } = await captureLogs(() => report(world, childId, '[done] shipped', provision));
    assert.ok(result?.success, 'the feedback itself still lands');
    assert.equal(wakeRows(world).length, 0, 'the wake is withdrawn');
    assert.equal(witnessBurned(world, childId), false, 'the witness is unburned (retryable)');
    assert.ok(lines.some(l => l.includes('[dispatch-wake] grant-mint-transient')), `logs grant-mint-transient; saw ${JSON.stringify(lines)}`);
    assert.ok(lines.some(l => l.includes('reason=grant-mint-transient:OWNER_CHECK_UNAVAILABLE')), 'null-wake reason names the code');

    world.ownerCheckFault = false;
    resetSpy(world);
    await report(world, childId, '[done] shipped (re-report)', provision);
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1, 'the re-report enqueues exactly one wake');
    assertDeclaredWakeMint(world, wakes[0]);
    assert.equal(witnessBurned(world, childId), true);
    const exchanged = await world.tokenStore.exchangeBootstrapToken(wakes[0].bootstrapToken);
    assert.deepEqual(exchanged.grants, ['dispatch'], 'the wake token exchanges to [dispatch]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F2 (2) / (2b): structural refusal degrades, notice, burned witness
// ─────────────────────────────────────────────────────────────────────────────

const STRUCTURAL_CASES = [
  { code: 'WORKSPACE_OWNER_UNSET', attempts: 1, setup: (w) => { delete w.owners[RECORDED_WORKSPACE]; }, record: RECORD },
  { code: 'GRANT_OWNER_ONLY', attempts: 1, setup: (w) => { w.owners[RECORDED_WORKSPACE] = 'account-B'; }, record: RECORD },
  { code: 'INVALID_GRANTS', attempts: 1, setup: () => {}, record: { ...RECORD, grants: ['not-a-grant'] } },
  // Refused locally, before any mint.
  { code: 'GRANT_OWNERLESS', attempts: 0, setup: () => {}, record: { ...RECORD, ownerAccountId: '' } }
];

describe('F2 (2) — each structural code degrades exactly one wake, burns the witness, never withdraws', () => {
  for (const c of STRUCTURAL_CASES) {
    test(`${c.code}: one grant-less wake with the notice and grantRefusal; a re-report enqueues nothing`, async () => {
      const world = makeWorld();
      const parentId = await seedParent(world, { record: c.record });
      const childId = await takenChild(world, parentId);
      const provision = provisioner(world);
      c.setup(world);

      const { lines } = await captureLogs(() => report(world, childId, '[done] shipped', provision));
      const wakes = wakeRows(world);
      assert.equal(wakes.length, 1, `exactly one wake; log ${JSON.stringify(lines)}`);
      const row = wakes[0];
      assert.strictEqual(row.bootstrapToken, null, 'grant-less');
      assert.equal(row.grantRefusal, c.code, 'grantRefusal on the row');
      assert.deepEqual(row.grantDeclaration, c.record, 'the record is still carried');
      assert.ok(row.prompt.startsWith(NOTICE(c.code)), `the server-authored notice is prepended; prompt=${JSON.stringify(row.prompt.slice(0, 160))}`);
      assert.equal(witnessBurned(world, childId), true, 'the witness is burned');
      assert.ok(lines.some(l => l.includes(`degraded=declared-grant-refused:${c.code}`)), 'logs the degrade');
      assert.equal(world.spy.issued.length, 0, 'no token issued');
      assert.equal(world.spy.grant.length, c.attempts);

      await report(world, childId, '[done] shipped (re-report)', provision);
      assert.equal(wakeRows(world).length, 1, 'a second re-report of the same terminal enqueues nothing');
      assert.equal(world.spy.grant.length, c.attempts, 'the mint spy does not move');
    });
  }
});

describe('F2 (2b) — N distinct [pending] events give N degraded wakes and N mint attempts', () => {
  test('3 pending events on an everything edge -> 3 degraded wakes, spy = 3, no server loop', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId, { subscription: 'everything' });
    const provision = provisioner(world);
    world.owners[RECORDED_WORKSPACE] = 'account-B';

    for (let i = 1; i <= 3; i++) await report(world, childId, `[pending] beat ${i} done`, provision);
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 3);
    for (const row of wakes) {
      assert.equal(row.grantRefusal, 'GRANT_OWNER_ONLY');
      assert.strictEqual(row.bootstrapToken, null);
      assert.ok(row.prompt.startsWith(NOTICE('GRANT_OWNER_ONLY')));
    }
    assert.equal(world.spy.grant.length, 3);
    assert.equal(world.spy.issued.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F2 (5) / (6), N5: both builders, ownerless and no-store
// ─────────────────────────────────────────────────────────────────────────────

function dispatchFeedbackApp(world, { harbour = false, dispatchTokenStore = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: world.store,
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: harbour ? { validateAndConsume: async () => ({ urlKey: URL_KEY }) } : null,
    proxyTokenStore: world.tokenStore
  }));
  return app;
}

function runnerFeedbackApp(world, { createdBy }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRunnerRoutes({
    proxyLimiter: (req, res, next) => next(),
    authenticateProxyToken: (req, res, next) => {
      req.proxyUrlKey = URL_KEY;
      req.proxyTokenLabel = 'runner';
      req.proxyTokenId = 'runner-token-1';
      req.proxyCreatedBy = createdBy;
      next();
    },
    requireGrant: () => (req, res, next) => next(),
    logEvent: () => {},
    dispatchQueueStore: world.store,
    dispatchTokenStore: {},
    proxyTokenStore: world.tokenStore,
    workspaceHaltStore: {}
  }));
  return app;
}

describe('F2 (5) — a declared wake with no poster owner still mints from the record', () => {
  test('harbour-feedback branch (routes/dispatch.js builder, no dispatchTokenOwner)', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId, { tokenLabel: 'harbour' });
    const res = await callApp(dispatchFeedbackApp(world, { harbour: true }), 'post', `/api/dispatch/feedback/${childId}`, { message: '[done] shipped' }, 'harbour-feedback-token');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1);
    assertDeclaredWakeMint(world, wakes[0]);
  });

  test('ownerless runner token (routes/proxy-runner.js builder)', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId, { tokenLabel: 'runner', tokenId: 'runner-token-1' });
    const res = await callApp(runnerFeedbackApp(world, { createdBy: null }), 'post', `/api/proxy/runner/feedback/${childId}`, { message: '[done] shipped' }, 'x');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1);
    assertDeclaredWakeMint(world, wakes[0]);
  });
});

describe('F2 (6) — a leaf wake stays grant-less', () => {
  test('no record: plain wake-bootstrap mint as the poster, grants []', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: null });
    const childId = await takenChild(world, parentId);
    await report(world, childId, '[done] shipped', provisioner(world));
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1);
    assert.equal(world.spy.grant.length, 0);
    assert.equal(world.spy.plain.length, 1);
    assert.equal(world.spy.plain[0].opts.label, 'wake-bootstrap');
    assert.equal(world.spy.plain[0].opts.createdBy, POSTER);
    assert.equal(wakes[0].bootstrapToken, world.spy.issued[0]);
    const doc = world.tokenCollection._docs.find(d => d.tokenHash === sha256(wakes[0].bootstrapToken));
    assert.deepEqual(doc.grants, []);
    assert.equal('grantDeclaration' in wakes[0], false);
    assert.equal('grantRefusal' in wakes[0], false);
  });
});

describe('N5 — negative half from both builders, and a record without a proxy token store', () => {
  test('routes/dispatch.js builder: no record + ownerless dispatch token -> no-token-owner, spy 0', async () => {
    const world = makeWorld();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token } = await dispatchTokenStore.createToken(URL_KEY, 'consumer', null);
    const parentId = await seedParent(world, { record: null });
    const childId = await takenChild(world, parentId, { tokenLabel: 'consumer' });
    const { result: res, lines } = await captureLogs(() => callApp(dispatchFeedbackApp(world, { dispatchTokenStore }), 'post', `/api/dispatch/feedback/${childId}`, { message: '[done] shipped' }, token));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1, 'a structural miss still enqueues');
    assert.strictEqual(wakes[0].bootstrapToken, null);
    assert.ok(lines.some(l => l.includes('degraded=no-token-owner')));
    assert.equal(world.spy.grant.length + world.spy.plain.length, 0, 'mint spy 0');
  });

  test('routes/proxy-runner.js builder: no record + ownerless runner token -> no-token-owner, spy 0', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: null });
    const childId = await takenChild(world, parentId, { tokenLabel: 'runner', tokenId: 'runner-token-1' });
    const { result: res, lines } = await captureLogs(() => callApp(runnerFeedbackApp(world, { createdBy: null }), 'post', `/api/proxy/runner/feedback/${childId}`, { message: '[done] shipped' }, 'x'));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1);
    assert.strictEqual(wakes[0].bootstrapToken, null);
    assert.ok(lines.some(l => l.includes('degraded=no-token-owner')));
    assert.equal(world.spy.grant.length + world.spy.plain.length, 0, 'mint spy 0');
  });

  test('a record with no proxy token store: no-proxy-token-store, record carried, later follow-up resumes declared', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId);
    const { lines } = await captureLogs(() => report(world, childId, '[done] shipped', provisioner(world, { proxyTokenStore: null })));
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1);
    const row = wakes[0];
    assert.strictEqual(row.bootstrapToken, null);
    assert.deepEqual(row.grantDeclaration, RECORD, 'the record is carried: no silent downgrade');
    assert.equal('grantRefusal' in row, false, 'not stamped: no code describes it');
    assert.ok(!row.prompt.includes('your dispatch grant was refused'), 'no notice');
    assert.ok(lines.some(l => l.includes('degraded=no-proxy-token-store') && l.includes('declaredParent=true')),
      `the degrade log names the declared parent; saw ${JSON.stringify(lines)}`);

    const res = await laterFollowUp(world, row._id);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(world.spy.grant.length, 1, 'the later follow-up resumes declared');
    assert.equal(world.spy.grant[0].ownerAccountId, RECORDED_OWNER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F2 (8): a degraded row carries the record + refusal; a later follow-up is refused
// ─────────────────────────────────────────────────────────────────────────────

describe('F2 (8) — a degraded wake row and a later follow-up to that tail', () => {
  test('owner still transferred: the wake degrades, and a follow-up to it gets GRANT_OWNER_ONLY', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId);
    // The refusal condition PERSISTS (the helper reads only the record, never
    // the row's grantRefusal): the recorded owner no longer owns the workspace.
    world.owners[RECORDED_WORKSPACE] = 'account-B';
    await report(world, childId, '[done] shipped', provisioner(world));
    const [row] = wakeRows(world);
    assert.ok(row, 'one degraded wake');
    assert.deepEqual(row.grantDeclaration, RECORD);
    assert.equal(row.grantRefusal, 'GRANT_OWNER_ONLY');

    const before = world.collection._docs.length;
    const res = await laterFollowUp(world, row._id);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNER_ONLY');
    assert.equal(world.collection._docs.length, before, 'nothing enqueued');
    assert.equal(world.spy.issued.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N3 (wake): a thrown read withdraws, witness unburned; re-report enqueues
// ─────────────────────────────────────────────────────────────────────────────

describe('N3 — a thrown record read withdraws the wake', () => {
  test('first read throws: withdrawn, unburned, spy 0; re-report after the fault clears mints declared', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId);
    const provision = provisioner(world);
    world.lookupFault = 'first';
    const { lines } = await captureLogs(() => report(world, childId, '[done] shipped', provision));
    assert.ok(world.lookupCalls >= 1, 'the wake reads the parent record');
    assert.equal(wakeRows(world).length, 0);
    assert.equal(witnessBurned(world, childId), false);
    assert.equal(world.spy.grant.length + world.spy.plain.length, 0, 'spy 0');
    assert.ok(lines.some(l => l.includes('[dispatch-wake] grant-mint-transient')));
    assert.ok(lines.some(l => l.includes('reason=grant-mint-transient:declaration-lookup-unavailable')), `saw ${JSON.stringify(lines)}`);

    world.lookupFault = 'none';
    await report(world, childId, '[done] shipped (re-report)', provision);
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1);
    assertDeclaredWakeMint(world, wakes[0]);
  });

  test('a history re-read throws (parent row not yet visible): withdrawn, unburned; re-report enqueues', async () => {
    const world = makeWorld();
    const childId = await takenChild(world, crypto.randomUUID());
    const provision = provisioner(world);
    world.lookupFault = 'reread';
    await captureLogs(() => report(world, childId, '[done] shipped', provision));
    assert.equal(wakeRows(world).length, 0);
    assert.equal(witnessBurned(world, childId), false);
    assert.equal(world.spy.grant.length + world.spy.plain.length, 0);

    world.lookupFault = 'none';
    await captureLogs(() => report(world, childId, '[done] shipped (re-report)', provision));
    assert.equal(wakeRows(world).length, 1, 'the re-report enqueues (row-missing resolves to plain)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N2 (wake): a corrupt record degrades structurally, spy 0
// ─────────────────────────────────────────────────────────────────────────────

describe('N2 — a corrupt record gives a structural degrade at the wake, spy 0', () => {
  const CORRUPT = [
    ['grants []', { ...RECORD, grants: [] }, 'INVALID_GRANTS'],
    ['grants null', { ...RECORD, grants: null }, 'INVALID_GRANTS'],
    ["grants 'dispatch'", { ...RECORD, grants: 'dispatch' }, 'INVALID_GRANTS'],
    ['non-object record', 'dispatch', 'INVALID_GRANTS'],
    ['missing workspaceId', { ...RECORD, workspaceId: undefined }, 'INVALID_GRANTS'],
    ['missing site', { ...RECORD, site: undefined }, 'INVALID_GRANTS'],
    ['missing ownerAccountId', { ...RECORD, ownerAccountId: undefined }, 'GRANT_OWNERLESS']
  ];
  for (const [label, record, code] of CORRUPT) {
    test(`${label} -> ${code}`, async () => {
      const world = makeWorld();
      const parentId = await seedParent(world, { record });
      const childId = await takenChild(world, parentId);
      await captureLogs(() => report(world, childId, '[done] shipped', provisioner(world)));
      const wakes = wakeRows(world);
      assert.equal(wakes.length, 1, 'a structural refusal still enqueues the wake');
      assert.equal(wakes[0].grantRefusal, code);
      assert.strictEqual(wakes[0].bootstrapToken, null);
      assert.ok(wakes[0].prompt.startsWith(NOTICE(code)));
      assert.equal(witnessBurned(world, childId), true);
      assert.equal(world.spy.grant.length + world.spy.plain.length, 0, 'spy 0: refused before any mint');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Order kept: the prose gate runs first, even with a record
// ─────────────────────────────────────────────────────────────────────────────

describe('provider order — prose gate first', () => {
  test('a prose parent with a record: no token wanted, no degrade, record carried, spy 0', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD, harness: 'opencode' });
    const childId = await takenChild(world, parentId);
    await report(world, childId, '[done] shipped', provisioner(world));
    const wakes = wakeRows(world);
    assert.equal(wakes.length, 1);
    assert.strictEqual(wakes[0].bootstrapToken, null);
    assert.deepEqual(wakes[0].grantDeclaration, RECORD);
    assert.equal('grantRefusal' in wakes[0], false);
    assert.equal(world.spy.grant.length + world.spy.plain.length, 0);
  });

  test('formatGrantRefusalNotice wording', () => {
    assert.equal(typeof dispatchWake.formatGrantRefusalNotice, 'function', 'exported from lib/dispatch-wake.js');
    assert.equal(dispatchWake.formatGrantRefusalNotice('GRANT_OWNER_ONLY'), NOTICE('GRANT_OWNER_ONLY'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F2 (3), wake half: launched under A, transferred to B
// ─────────────────────────────────────────────────────────────────────────────

describe('F2 (3) — owner transferred A -> B: the wake degrades, and the mint names A, never B', () => {
  test('the refused mint attempt carries the recorded owner, not the live owner or the poster', async () => {
    const world = makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    const childId = await takenChild(world, parentId);
    world.owners[RECORDED_WORKSPACE] = 'account-B';
    await captureLogs(() => report(world, childId, '[done] shipped', provisioner(world, { createdBy: 'account-B' })));
    const [row] = wakeRows(world);
    assert.equal(row.grantRefusal, 'GRANT_OWNER_ONLY', 'the wake degrades');
    assert.equal(world.spy.grant.length, 1);
    assert.equal(world.spy.grant[0].ownerAccountId, RECORDED_OWNER, 'exactly A');
    assert.notEqual(world.spy.grant[0].ownerAccountId, 'account-B', 'never B');
  });
});
