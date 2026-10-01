/**
 * LIN-3139 (LIN-3134 T2-ii) — F2 (7) route-level half (NB6): secrecy across
 * the whole Class Q sink list.
 *
 * A declared row's record (`grantDeclaration`) and refusal (`grantRefusal`)
 * are server-internal. `addItem` strips them from its return (T2-i, store
 * half); this file proves no OUTWARD sink carries either key or any of the
 * record's values. Every record value here is a marker string, so a leak by
 * value (not only by key) is caught.
 *
 * Rows: follow-ups to a declared parent created through each real follow-up
 * route (S5 copies the record forward), a row created through the real factory
 * with a test-only `finalizePrompt` returning a marker-valued record (tests are
 * outside F3's scan), and a refusal row written by the store's own `addItem`
 * (the wake's writer). Sinks: the 201/200 bodies of every follow-up caller,
 * the chat-tool result, both poll routes, both take routes, `listItems`,
 * `getItemStatus` (active and history), watch, list, `GET /:id/prompt`,
 * `listHistory`, the session history route, the session queue list,
 * `stampBookkeeping`.
 *
 * Not reachable here with a declared row (T2 is inert): the kickoff (M1) and
 * collective 201s — no production path creates a declared launch row; their
 * bodies are explicit allow-lists pinned by C4's source census.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
// fixture:LIN-3136
import { mintDispatchWriter } from './lib/dispatch-writer.js';
// /fixture:LIN-3136
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRunnerRoutes } from '../../routes/proxy-runner.js';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';

const URL_KEY = 'acme';
const POSTER = 'poster-B';

// A resumable record: its grants must be real for the follow-up mint to
// succeed; every other value is a marker.
const RESUMABLE_RECORD = {
  grants: ['dispatch'],
  ownerAccountId: 'mkr-owner-5c1e',
  workspaceId: 'mkr-ws-5c1e',
  profile: 'worker',
  site: 'mkr-site-5c1e',
  declaredAt: 'mkr-at-5c1e'
};
// A factory-written record: nothing mints from it, so every value is a marker.
const FACTORY_RECORD = {
  grants: ['mkr-grant-5c1e'],
  ownerAccountId: 'mkr-owner-5c1e',
  workspaceId: 'mkr-ws-5c1e',
  profile: 'mkr-profile-5c1e',
  site: 'mkr-site-5c1e',
  declaredAt: 'mkr-at-5c1e'
};
const REFUSAL = 'mkr-refusal-5c1e';

const NEEDLES = ['grantDeclaration', 'grantRefusal', 'mkr-'];

function assertClean(label, value) {
  const s = JSON.stringify(value);
  assert.ok(s !== undefined, `${label}: sink produced a value`);
  for (const needle of NEEDLES) {
    assert.ok(!s.includes(needle), `${label} leaks ${needle}: ${s.slice(Math.max(0, s.indexOf(needle) - 120), s.indexOf(needle) + 80)}`);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// One world, shared by every sink cell.
// ─────────────────────────────────────────────────────────────────────────────

const world = {};

function rawDoc(id) {
  return world.store.collection._docs.find(d => d._id === id)
    || world.store.historyCollection._docs.find(d => d._id === id);
}

function proxyApp() {
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
  return app;
}

function sessionApp() {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: world.store,
    dispatchTokenStore: world.dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; req.session = { accountId: POSTER }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: world.tokenStore
  }));
  return app;
}

function runnerApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRunnerRoutes({
    proxyLimiter: (req, res, next) => next(),
    authenticateProxyToken: (req, res, next) => {
      req.proxyUrlKey = URL_KEY; req.proxyTokenLabel = 'runner'; req.proxyTokenId = 'runner-1'; req.proxyCreatedBy = POSTER; next();
    },
    requireGrant: () => (req, res, next) => next(),
    logEvent: () => {},
    dispatchQueueStore: world.store,
    dispatchTokenStore: {},
    proxyTokenStore: world.tokenStore,
    workspaceHaltStore: { getWorkspaceHalt: async () => null, getLastKnownHalt: () => null }
  }));
  return app;
}

function fcApp() {
  const app = express();
  app.use(express.json());
  app.use(createFlightCompanionRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY }; req.session = { accountId: POSTER, features: { flightCompanion: true } }; next(); },
    getOpenRouterSource: () => null, getDeployInfo: () => ({}), observerStateStore: null, freeTierStore: null,
    workspacePreferencesStore: null, recapCacheStore: null, briefCacheStore: null,
    dispatchQueueStore: world.sessionStore,
    agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
    proxyTokenStore: world.tokenStore
  }));
  return app;
}

before(async () => {
  world.store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
  world.tokenStore = new ProxyTokenStore({ collection: createMockCollection() });
  world.tokenStore.setOwnerCheck(async ({ workspaceId, accountId }) => (
    { status: workspaceId === RESUMABLE_RECORD.workspaceId && accountId === RESUMABLE_RECORD.ownerAccountId ? 'owner' : 'not-owner' }
  ));
  world.dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
  world.consumerToken = (await world.dispatchTokenStore.createToken(URL_KEY, 'consumer', POSTER)).token;
  world.posterToken = (await world.tokenStore.createToken(URL_KEY, { kind: 'standard', scope: 'readWrite', label: 'poster', createdBy: POSTER })).token;
  // fixture:LIN-3136: the poster holds the dispatch grant (the enqueue mounts require it)
  world.posterToken = (await mintDispatchWriter(world.tokenStore, { urlKey: URL_KEY, ownerAccountId: POSTER, label: 'poster' })).token;
  // /fixture:LIN-3136

  // The declared parent (finished, in history).
  const parent = await world.store.addItem(URL_KEY, {
    prompt: 'parent beat', promptName: 'Parent', kind: 'implementation', issueIdentifier: 'TEST-1',
    harness: 'claude-code', target: 'cli', grantDeclaration: RESUMABLE_RECORD
  });
  await world.store.takeItem(parent._id, URL_KEY, 'runner');
  world.parentId = parent._id;

  // Session discovery for approve-follow-up / send_follow_up: the same real
  // store, with only its session listing pointed at the parent.
  const tIso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const sessionRows = [{
    id: parent._id, promptName: 'implementation', prompt: 'parent beat', issueId: 'uuid-500',
    issueIdentifier: 'LIN-500', issueTitle: 'A task', issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: URL_KEY }, dispatchedAt: tIso(60), dispatchedBy: POSTER, target: 'cli',
    repo: null, status: 'taken', resolvedAt: tIso(30), kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: tIso(30) }]
  }];
  world.sessionStore = Object.create(world.store);
  world.sessionStore.listItems = async () => [];
  world.sessionStore.listHistory = async () => { const items = withFreshDigests(sessionRows); return { items, total: items.length }; };

  // A factory-created declared row (test-only finalizePrompt).
  const factoryRow = await createDispatchItem({
    store: world.store, urlKey: URL_KEY, kind: 'implementation', applyDefaultHarness: false,
    finalizePrompt: async () => ({ prompt: 'factory beat', bootstrapToken: null, grantDeclaration: FACTORY_RECORD }),
    fields: { promptName: 'Factory', issueIdentifier: 'TEST-9', target: 'cli', sessionId: parent._id }
  });
  world.factoryId = factoryRow._id;
  world.factoryReturn = factoryRow;

  // A refusal row, written by the store's own addItem (the wake's writer).
  const refusalRow = await world.store.addItem(URL_KEY, {
    prompt: 'wake beat', kind: 'wake', followUpTo: parent._id, sessionId: parent._id,
    grantDeclaration: FACTORY_RECORD, grantRefusal: REFUSAL
  });
  world.refusalId = refusalRow._id;
  world.refusalReturn = refusalRow;
  world.created = {};
});

// ─────────────────────────────────────────────────────────────────────────────
// Create-path sinks
// ─────────────────────────────────────────────────────────────────────────────

describe('F2 (7) create-path sinks — follow-ups to a declared parent', () => {
  const PROXY_CASES = [
    ['POST /api/proxy/dispatch 201', '/api/proxy/dispatch', () => ({ prompt: 'next beat', issueIdentifier: 'TEST-1', target: 'cli', followUpTo: world.parentId })],
    ['recommend-and-dispatch override arm 201', '/api/proxy/recommend-and-dispatch', () => ({ issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: world.parentId })],
    ['recommend-and-dispatch LLM arm 201 (keepalive)', '/api/proxy/recommend-and-dispatch', () => ({ issueIdentifier: 'TEST-1', followUpTo: world.parentId, appendProxyContext: true })]
  ];
  for (const [label, path, body] of PROXY_CASES) {
    test(label, async () => {
      const res = await callApp(proxyApp(), 'post', path, body(), world.posterToken);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(rawDoc(res.body.id).grantDeclaration, RESUMABLE_RECORD, 'the created row really is declared');
      assertClean(label, res.body);
      world.created[label] = res.body.id;
    });
  }

  test('dispatch.js session route 201', async () => {
    const res = await callApp(sessionApp(), 'post', '/workspace/acme/api/dispatch', { prompt: 'next beat', followUpTo: world.parentId, target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(rawDoc(res.body.item.id).grantDeclaration, RESUMABLE_RECORD);
    assertClean('dispatch.js 201', res.body);
  });

  test('flight-companion approve-follow-up 200', async () => {
    const res = await callApp(fcApp(), 'post', '/workspace/acme/api/flight-companion/approve-follow-up', { sessionId: world.parentId, prompt: 'next beat' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(rawDoc(res.body.itemId).grantDeclaration, RESUMABLE_RECORD);
    assertClean('approve-follow-up 200', res.body);
  });

  test('chat-tools send_follow_up tool result', async () => {
    const { executeTool } = createChatToolCatalog({
      provider: { fetchRecommendationContext: async () => ({}), search: async () => [], relations: async () => ({ trashed: false, relations: { nodes: [] }, inverseRelations: { nodes: [] } }), fetchProjects: async () => ({ projects: [], issues: [] }) },
      scope: 'workspace-token-abc', urlKey: URL_KEY,
      dispatchQueueStore: world.sessionStore,
      agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
      sessionIsTerminal: (session) => (session.loops || []).some((l) => l.terminalStatus === 'done'),
      followUpEnabled: true, dispatchedBy: POSTER, proxyTokenStore: world.tokenStore, baseUrl: 'https://harbour.test'
    });
    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: world.parentId, prompt: 'next beat' } });
    assert.equal(result.queued, true);
    assert.deepEqual(rawDoc(result.itemId).grantDeclaration, RESUMABLE_RECORD);
    assertClean('send_follow_up result', result);
  });

  test('the factory return and addItem return (the raw-return sources) are stripped', () => {
    assert.deepEqual(rawDoc(world.factoryId).grantDeclaration, FACTORY_RECORD, 'the factory row really is declared');
    assert.equal(rawDoc(world.refusalId).grantRefusal, REFUSAL, 'the refusal row really carries a refusal');
    assertClean('createDispatchItem return', world.factoryReturn);
    assertClean('addItem return', world.refusalReturn);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Read-path sinks (active rows, then after take)
// ─────────────────────────────────────────────────────────────────────────────

describe('F2 (7) read-path sinks', () => {
  test('store: listItems and getItemStatus (active)', async () => {
    const items = await world.store.listItems(URL_KEY);
    assert.ok(items.some(i => i.id === world.factoryId), 'the declared row is listed');
    assertClean('listItems', items);
    assertClean('getItemStatus active', await world.store.getItemStatus(URL_KEY, world.factoryId));
    assertClean('getItemStatus active (refusal row)', await world.store.getItemStatus(URL_KEY, world.refusalId));
  });

  test('proxy: list, watch and GET /:id/prompt (active)', async () => {
    const list = await callApp(proxyApp(), 'get', '/api/proxy/dispatch', undefined, world.posterToken);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assertClean('GET /api/proxy/dispatch (list)', list.body);
    for (const id of [world.factoryId, world.refusalId]) {
      const watch = await callApp(proxyApp(), 'get', `/api/proxy/dispatch/${id}`, undefined, world.posterToken);
      assert.equal(watch.status, 200, JSON.stringify(watch.body));
      assertClean('GET /api/proxy/dispatch/:id (watch)', watch.body);
      const prompt = await callApp(proxyApp(), 'get', `/api/proxy/dispatch/${id}/prompt`, undefined, world.posterToken);
      assert.equal(prompt.status, 200, JSON.stringify(prompt.body));
      assertClean('GET /api/proxy/dispatch/:id/prompt', prompt.body);
    }
  });

  test('session queue list (GET /workspace/:urlKey/api/dispatch)', async () => {
    const res = await callApp(sessionApp(), 'get', '/workspace/acme/api/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.items.length > 0);
    assertClean('session queue list', res.body);
  });

  test('both poll routes', async () => {
    const poll = await callApp(sessionApp(), 'get', '/api/dispatch/poll', undefined, world.consumerToken);
    assert.equal(poll.status, 200, JSON.stringify(poll.body));
    assert.ok(poll.body.items.some(i => i.id === world.factoryId), 'the declared row is polled');
    assertClean('GET /api/dispatch/poll', poll.body);
    const runnerPoll = await callApp(runnerApp(), 'get', '/api/proxy/runner/poll', undefined, 'x');
    assert.equal(runnerPoll.status, 200, JSON.stringify(runnerPoll.body));
    assertClean('GET /api/proxy/runner/poll', runnerPoll.body);
  });

  test('both take routes', async () => {
    const take = await callApp(sessionApp(), 'post', `/api/dispatch/take/${world.factoryId}`, {}, world.consumerToken);
    assert.equal(take.status, 200, JSON.stringify(take.body));
    assertClean('POST /api/dispatch/take/:id', take.body);
    const runnerTake = await callApp(runnerApp(), 'post', `/api/proxy/runner/take/${world.refusalId}`, {}, 'x');
    assert.equal(runnerTake.status, 200, JSON.stringify(runnerTake.body));
    assertClean('POST /api/proxy/runner/take/:id', runnerTake.body);
    assert.ok(rawDoc(world.factoryId).grantDeclaration, 'the archived row still carries its record');
  });

  test('history: getItemStatus, listHistory, the history route, watch/prompt, stampBookkeeping', async () => {
    assertClean('getItemStatus history', await world.store.getItemStatus(URL_KEY, world.factoryId));
    assertClean('getItemStatus history (refusal row)', await world.store.getItemStatus(URL_KEY, world.refusalId));
    const history = await world.store.listHistory(URL_KEY, {});
    assert.ok(history.items.some(i => i.id === world.factoryId), 'the declared row is in history');
    assertClean('listHistory', history);
    const route = await callApp(sessionApp(), 'get', '/workspace/acme/api/dispatch/history');
    assert.equal(route.status, 200, JSON.stringify(route.body));
    assertClean('GET /workspace/:urlKey/api/dispatch/history', route.body);
    const watch = await callApp(proxyApp(), 'get', `/api/proxy/dispatch/${world.factoryId}`, undefined, world.posterToken);
    assertClean('watch (history)', watch.body);
    const prompt = await callApp(proxyApp(), 'get', `/api/proxy/dispatch/${world.factoryId}/prompt`, undefined, world.posterToken);
    assertClean('GET /:id/prompt (history)', prompt.body);
    assertClean('stampBookkeeping', await world.store.stampBookkeeping(URL_KEY, world.factoryId, { by: 'op', reason: 'r' }));
  });
});
