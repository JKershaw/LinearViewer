/**
 * LIN-3139 (LIN-3134 T2-ii) — F2 (4) / B2 ten-branch follow-up matrix.
 *
 * Every follow-up-reachable credential mint (Class F, minus the wake) is driven
 * through its REAL route or executor, a real `DispatchQueueStore` on mock
 * collections, and a real `ProxyTokenStore` whose owner check is a stub. The
 * ten branches (six calls):
 *
 *   pbt (6)    B1 proxy-dispatch POST /dispatch   B2 override arm   B3 LLM arm
 *              B4 dispatch.js session route       B5 flight-companion approve-follow-up
 *              B6 chat-tools send_follow_up
 *   attach (4) A1 proxy-dispatch POST /dispatch   A2 override arm   A3 LLM arm
 *              A4 dispatch.js session route
 *
 * Per branch: declared (the parent row carries a record: a grant-bearing
 * resume from the RECORDED owner/workspace, never the poster), leaf (no record,
 * the poster holds `dispatch`: grant-less with today's exact plain arguments),
 * transient (a thrown record read, and an unavailable owner check: the tabled
 * status, nothing enqueued, nothing minted) and structural (the recorded owner
 * no longer owns the workspace: the tabled status and code, nothing enqueued,
 * nothing minted). Approve-follow-up's structural status is 422, never 403.
 *
 * Attach arms add: MCP and prose, with and without a record; each arm's
 * issue-specific brief URL and provider line (G3 note b — the LLM arm's brief
 * names the descended `terminalIdentifier`, TEST-2, not the posted TEST-1);
 * the reviewer's chain (declared parent → attach follow-up → default follow-up
 * must still mint declared); and dispatch.js's `proxyAttachFailed` guard.
 *
 * B1 behavioural pin: the four "declared attach (MCP)" cells were written
 * first and run red against the unmodified sites (failure output recorded on
 * the PR and LIN-3139).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import express from 'express';
// LIN-1880: the proxy routes can reach Linear on some paths; keep this hermetic.
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { ProxyTokenStore, BOOTSTRAP_TOKEN_TTL_SECONDS } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';

const URL_KEY = 'acme';
const RECORDED_OWNER = 'account-A';
const RECORDED_WORKSPACE = 'ws-recorded';
// The poster: the proxy token's `createdBy`, the session account, the chat's
// `dispatchedBy`. It differs from the recorded owner on purpose — on a
// declared resume it must never become the mint owner.
const POSTER = 'poster-B';
const POSTER_WORKSPACE = 'ws-poster';

const RECORD = Object.freeze({
  grants: ['dispatch'],
  ownerAccountId: RECORDED_OWNER,
  workspaceId: RECORDED_WORKSPACE,
  profile: 'worker',
  site: 'proxy-kickoff',
  declaredAt: '2026-09-29T00:00:00.000Z'
});

const PROXY_MARKER = '## Workspace API access (auto-appended)';
// routes/proxy.js:293 (not exported). The existing transient relay is
// status-only (NB1): the body stays exactly this.
const PROXY_ATTACH_FAILED_MESSAGE = 'Proxy context was requested but a proxy token could not be created (LIN-1175) — refusing to launch a credential-less session; you may have hit the token rate limit, wait a minute and retry.';
const SESSION_ATTACH_FAILED_MESSAGE = 'Proxy context was requested but a proxy token could not be created — you may have hit the token rate limit; wait a minute and try again.';

const sha256 = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
// World: real stores, owner-check stub, mint spy, lookup fault seam
// ─────────────────────────────────────────────────────────────────────────────

async function makeWorld({ proxyTokenStore: tokenStoreOverride } = {}) {
  const tokenCollection = createMockCollection();
  const tokenStore = new ProxyTokenStore({ collection: tokenCollection });
  const dispatchStore = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });

  const world = {
    tokenStore,
    tokenCollection,
    dispatchStore,
    // workspaceId -> the account the owner check says owns it (the LIVE owner).
    owners: { [RECORDED_WORKSPACE]: RECORDED_OWNER, [POSTER_WORKSPACE]: POSTER },
    ownerCheckFault: false,
    lookupFault: false,
    lookupCalls: [],
    // Every mint attempt, and every token actually issued.
    spy: { grant: [], plain: [], issued: [] },
    posterToken: null,
    sessionRows: []
  };

  tokenStore.setOwnerCheck(async ({ workspaceId, accountId }) => {
    if (world.ownerCheckFault) throw new Error('owner check backend down');
    const owner = world.owners[workspaceId];
    if (!owner) return { status: 'no-owner' };
    return { status: owner === accountId ? 'owner' : 'not-owner' };
  });

  // The poster holds a `dispatch`-granted working token (the leaf cells prove
  // it is never inherited). Minted before the spy is installed.
  const posterBoot = await tokenStore.mintGrantBootstrap({
    urlKey: URL_KEY, workspaceId: POSTER_WORKSPACE, ownerAccountId: POSTER,
    grants: ['dispatch'], label: 'poster', profile: 'worker'
  });
  world.posterToken = (await tokenStore.exchangeBootstrapToken(posterBoot.token)).token;

  const realGrant = tokenStore.mintGrantBootstrap.bind(tokenStore);
  tokenStore.mintGrantBootstrap = async (args) => {
    world.spy.grant.push(args);
    const minted = await realGrant(args);
    world.spy.issued.push({ via: 'grant', token: minted.token });
    return minted;
  };
  const realCreate = tokenStore.createToken.bind(tokenStore);
  tokenStore.createToken = async (urlKey, opts) => {
    world.spy.plain.push({ urlKey, opts });
    const minted = await realCreate(urlKey, opts);
    world.spy.issued.push({ via: 'plain', token: minted.token });
    return minted;
  };

  // Lookup seam: the REAL store read, with its collections made to throw while
  // `lookupFault` is set (so the store's own log-and-rethrow runs).
  const realLookup = dispatchStore.getGrantDeclaration.bind(dispatchStore);
  dispatchStore.getGrantDeclaration = async (urlKey, itemId) => {
    world.lookupCalls.push({ urlKey, itemId });
    if (!world.lookupFault) return realLookup(urlKey, itemId);
    const cols = [dispatchStore.collection, dispatchStore.historyCollection];
    const saved = cols.map(c => c.findOne);
    for (const c of cols) c.findOne = async () => { throw new Error('mongo read timeout'); };
    try {
      return await realLookup(urlKey, itemId);
    } finally {
      cols.forEach((c, i) => { c.findOne = saved[i]; });
    }
  };

  // Session discovery for approve-follow-up / send_follow_up (the only
  // synthetic seam): one finished session whose tail is the parent row.
  dispatchStore.listItems = async () => [];
  dispatchStore.listHistory = async () => {
    const items = withFreshDigests(world.sessionRows);
    return { items, total: items.length };
  };

  if (tokenStoreOverride !== undefined) world.routeTokenStore = tokenStoreOverride;
  else world.routeTokenStore = tokenStore;
  return world;
}

/** Seeds a finished parent row (taken, so it lives in history). */
async function seedParent(world, { record = null, harness = 'claude-code', issueIdentifier = 'TEST-1' } = {}) {
  const parent = await world.dispatchStore.addItem(URL_KEY, {
    prompt: 'parent beat',
    promptName: 'Parent',
    kind: 'implementation',
    issueIdentifier,
    harness,
    target: 'cli',
    dispatchedBy: RECORDED_OWNER,
    ...(record ? { grantDeclaration: record } : {})
  });
  await world.dispatchStore.takeItem(parent._id, URL_KEY, 'runner');
  const tIso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  world.sessionRows = [{
    id: parent._id, promptName: 'implementation', prompt: 'parent beat', issueId: 'uuid-500',
    issueIdentifier: 'LIN-500', issueTitle: 'A task', issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: URL_KEY }, dispatchedAt: tIso(60), dispatchedBy: RECORDED_OWNER, target: 'cli',
    repo: null, status: 'taken', resolvedAt: tIso(30), kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: tIso(30) }]
  }];
  return parent._id;
}

function rowById(world, id) {
  return world.dispatchStore.collection._docs.find(d => d._id === id)
    || world.dispatchStore.historyCollection._docs.find(d => d._id === id)
    || null;
}

function tokenDoc(world, token) {
  return world.tokenCollection._docs.find(d => d.tokenHash === sha256(token)) || null;
}

async function callRoute(app, method, path, body, bearer = 'anything') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: `Bearer ${bearer}` } };
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
// Real routes / executor
// ─────────────────────────────────────────────────────────────────────────────

function proxyApp(world) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: world.routeTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 3600000 }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: world.dispatchStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

function sessionApp(world) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: world.dispatchStore,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: 'linear' };
      req.session = { accountId: POSTER, linearUserId: POSTER };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: world.routeTokenStore
  }));
  return app;
}

function fcApp(world) {
  const app = express();
  app.use(express.json());
  app.use(createFlightCompanionRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY }; req.session = { accountId: POSTER, features: { flightCompanion: true } }; next(); },
    getOpenRouterSource: () => null, getDeployInfo: () => ({}), observerStateStore: null, freeTierStore: null,
    workspacePreferencesStore: null, recapCacheStore: null, briefCacheStore: null,
    dispatchQueueStore: world.dispatchStore,
    agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
    proxyTokenStore: world.routeTokenStore
  }));
  return app;
}

function chatExecutor(world) {
  const { executeTool } = createChatToolCatalog({
    provider: {
      fetchRecommendationContext: async () => ({}),
      search: async () => [],
      relations: async () => ({ trashed: false, relations: { nodes: [] }, inverseRelations: { nodes: [] } }),
      fetchProjects: async () => ({ projects: [], issues: [] })
    },
    scope: 'workspace-token-abc', urlKey: URL_KEY,
    dispatchQueueStore: world.dispatchStore,
    agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
    sessionIsTerminal: (session) => (session.loops || []).some((l) => l.terminalStatus === 'done'),
    followUpEnabled: true,
    dispatchedBy: POSTER,
    proxyTokenStore: world.routeTokenStore,
    baseUrl: 'https://harbour.test'
  });
  return executeTool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch table
// ─────────────────────────────────────────────────────────────────────────────

const DISPATCH = '/api/proxy/dispatch';
const RECOMMEND = '/api/proxy/recommend-and-dispatch';
const SESSION_PATH = '/workspace/acme/api/dispatch';
const FC_PATH = '/workspace/acme/api/flight-companion/approve-follow-up';

// Normalised outcome: { ok, status, body, itemId, error }.
async function viaProxy(world, path, body) {
  const res = await callRoute(proxyApp(world), 'post', path, body, world.posterToken);
  return { ok: res.status === 201, status: res.status, body: res.body, itemId: res.body?.id ?? null };
}
async function viaSession(world, body) {
  const res = await callRoute(sessionApp(world), 'post', SESSION_PATH, body);
  return { ok: res.status === 201, status: res.status, body: res.body, itemId: res.body?.item?.id ?? null };
}
async function viaFc(world, parentId) {
  const res = await callRoute(fcApp(world), 'post', FC_PATH, { sessionId: parentId, prompt: 'next beat' });
  return { ok: res.status === 200, status: res.status, body: res.body, itemId: res.body?.itemId ?? null };
}
async function viaChat(world, parentId) {
  try {
    const result = await chatExecutor(world)({ name: 'send_follow_up', arguments: { sessionId: parentId, prompt: 'next beat' } });
    return { ok: result?.queued === true, status: 'returned', body: result, itemId: result?.itemId ?? null };
  } catch (err) {
    return { ok: false, status: 'threw', error: err.message };
  }
}

// `family` selects the refusal table; `plainCreatedBy` is the leaf mint's
// `createdBy` (today's value at that site).
const BRANCHES = [
  { id: 'B1', name: 'proxy-dispatch POST /dispatch (pbt)', mode: 'pbt', family: 'proxy', plainCreatedBy: POSTER,
    run: (w, followUpTo, extra = {}) => viaProxy(w, DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', target: 'cli', followUpTo, ...extra }) },
  { id: 'A1', name: 'proxy-dispatch POST /dispatch (attach)', mode: 'attach', family: 'proxy', plainCreatedBy: POSTER,
    brief: 'TEST-1', providerLine: 'currently backed by Linear',
    run: (w, followUpTo, extra = {}) => viaProxy(w, DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', target: 'cli', followUpTo, appendProxyContext: true, harness: 'claude-code', ...extra }),
    runDefault: (w, followUpTo) => viaProxy(w, DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', target: 'cli', followUpTo }) },
  { id: 'B2', name: 'recommend-and-dispatch override arm (pbt)', mode: 'pbt', family: 'proxy', plainCreatedBy: POSTER,
    run: (w, followUpTo, extra = {}) => viaProxy(w, RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo, ...extra }) },
  { id: 'A2', name: 'recommend-and-dispatch override arm (attach)', mode: 'attach', family: 'proxy', plainCreatedBy: POSTER,
    brief: 'TEST-1', providerLine: 'currently backed by Linear',
    run: (w, followUpTo, extra = {}) => viaProxy(w, RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo, appendProxyContext: true, harness: 'claude-code', ...extra }),
    runDefault: (w, followUpTo) => viaProxy(w, RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo }) },
  { id: 'B3', name: 'recommend-and-dispatch LLM arm (pbt)', mode: 'pbt', family: 'proxy', plainCreatedBy: POSTER,
    run: (w, followUpTo, extra = {}) => viaProxy(w, RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo, ...extra }) },
  { id: 'A3', name: 'recommend-and-dispatch LLM arm (attach)', mode: 'attach', family: 'proxy', plainCreatedBy: POSTER,
    // Test-mode descent: TEST-1 defers to its open child TEST-2, so the
    // brief must name the descended terminal identifier, not the posted one.
    brief: 'TEST-2', providerLine: 'currently backed by Linear',
    run: (w, followUpTo, extra = {}) => viaProxy(w, RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo, appendProxyContext: true, harness: 'claude-code', ...extra }),
    runDefault: (w, followUpTo) => viaProxy(w, RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo }) },
  { id: 'B4', name: 'dispatch.js session route (pbt)', mode: 'pbt', family: 'session', plainCreatedBy: POSTER,
    run: (w, followUpTo, extra = {}) => viaSession(w, { prompt: 'next beat', followUpTo, target: 'cli', ...extra }) },
  { id: 'A4', name: 'dispatch.js session route (attach)', mode: 'attach', family: 'session', plainCreatedBy: POSTER,
    brief: 'TEST-7', providerLine: 'currently backed by Linear',
    run: (w, followUpTo, extra = {}) => viaSession(w, { prompt: 'next beat', issueIdentifier: 'TEST-7', followUpTo, target: 'cli', attachProxy: true, harness: 'claude-code', ...extra }),
    runDefault: (w, followUpTo) => viaSession(w, { prompt: 'next beat', followUpTo, target: 'cli' }) },
  { id: 'B5', name: 'flight-companion approve-follow-up (pbt)', mode: 'pbt', family: 'fc', plainCreatedBy: POSTER,
    run: (w, followUpTo) => viaFc(w, followUpTo) },
  { id: 'B6', name: 'chat-tools send_follow_up (pbt)', mode: 'pbt', family: 'chat', plainCreatedBy: POSTER,
    run: (w, followUpTo) => viaChat(w, followUpTo) }
];

const ATTACH_BRANCHES = BRANCHES.filter(b => b.mode === 'attach');

// ─────────────────────────────────────────────────────────────────────────────
// Shared assertions
// ─────────────────────────────────────────────────────────────────────────────

function assertNothingEnqueued(world, out) {
  assert.equal(out.ok, false, `expected a refusal, got ${JSON.stringify(out)}`);
  assert.equal(world.dispatchStore.collection._docs.length, 0, 'nothing enqueued (the parent is in history)');
  assert.equal(world.spy.issued.length, 0, 'mint spy 0: no token issued');
  assert.equal(world.spy.plain.length, 0, 'no plain mint attempted');
}

function assertDeclaredMint(world, out, label = 'dispatch-bootstrap') {
  assert.equal(out.ok, true, `expected success, got ${JSON.stringify(out)}`);
  assert.equal(world.spy.plain.length, 0,
    `a declared resume never mints plain; saw ${JSON.stringify(world.spy.plain)} and grant mints ${JSON.stringify(world.spy.grant)}; row grantDeclaration=${JSON.stringify(rowById(world, out.itemId)?.grantDeclaration ?? null)}`);
  assert.equal(world.spy.grant.length, 1, 'exactly one grant mint');
  assert.deepEqual(world.spy.grant[0], {
    urlKey: URL_KEY, workspaceId: RECORDED_WORKSPACE, ownerAccountId: RECORDED_OWNER,
    grants: ['dispatch'], label, profile: 'worker'
  });
  assert.notEqual(world.spy.grant[0].ownerAccountId, POSTER, 'never the poster');
  assert.notEqual(world.spy.grant[0].workspaceId, POSTER_WORKSPACE, 'never the poster\'s workspace');
  assert.equal(world.spy.issued.length, 1);
  const issued = world.spy.issued[0].token;
  const doc = tokenDoc(world, issued);
  assert.ok(doc, 'the issued token is persisted');
  assert.deepEqual(doc.grants, ['dispatch'], 'grant-bearing resume');
  assert.equal(doc.createdBy, RECORDED_OWNER);
  assert.equal(doc.workspaceId, RECORDED_WORKSPACE);
  assert.equal(doc.lifetimeProfile, 'worker');
  const row = rowById(world, out.itemId);
  assert.ok(row, 'the follow-up row is enqueued');
  assert.deepEqual(row.grantDeclaration, RECORD, 'the record is carried forward onto the row (C4)');
  return { row, issued };
}

function assertPlainMint(world, out, createdBy) {
  assert.equal(out.ok, true, `expected success, got ${JSON.stringify(out)}`);
  assert.equal(world.spy.grant.length, 0, 'a leaf resume never mints a grant');
  assert.equal(world.spy.plain.length, 1, 'exactly one plain mint');
  assert.deepEqual(world.spy.plain[0], {
    urlKey: URL_KEY,
    opts: { kind: 'bootstrap', scope: 'readWrite', label: 'dispatch-bootstrap', ttl: BOOTSTRAP_TOKEN_TTL_SECONDS, createdBy }
  });
  const issued = world.spy.issued[0].token;
  assert.deepEqual(tokenDoc(world, issued).grants, [], 'grant-less even though the poster holds dispatch');
  const row = rowById(world, out.itemId);
  assert.ok(row, 'the follow-up row is enqueued');
  assert.equal('grantDeclaration' in row, false, 'a leaf row carries no record');
  return { row, issued };
}

function assertBriefAndProvider(branch, prompt, { mcp }) {
  const base = mcp ? '\\$HARBOUR_LOCAL_BASE' : 'http://127\\.0\\.0\\.1:\\d+';
  assert.match(prompt, new RegExp(`Start from the distilled brief: GET ${base}/api/proxy/brief/${branch.brief}\\b`),
    `${branch.id} brief names ${branch.brief}`);
  assert.match(prompt, new RegExp(`You have a workspace API proxy for this workspace \\(source-neutral; ${branch.providerLine}\\)\\. Base: ${base}/api/proxy`),
    `${branch.id} provider line`);
}

const TRANSIENT = {
  proxy: (out) => {
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { error: PROXY_ATTACH_FAILED_MESSAGE }, 'status-only relay (NB1)');
  },
  session: (out) => {
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { error: SESSION_ATTACH_FAILED_MESSAGE }, 'status-only relay (NB1)');
  },
  fc: (out) => {
    assert.equal(out.status, 503);
    assert.equal(out.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(out.body.retryable, true);
    assert.equal(typeof out.body.error, 'string');
    assert.deepEqual(Object.keys(out.body).sort(), ['code', 'error', 'retryable']);
  },
  chat: (out) => {
    assert.equal(out.status, 'threw');
    assert.equal(out.error, 'send_follow_up refused (OWNER_CHECK_UNAVAILABLE): retry once shortly');
  }
};

function structural(code, status) {
  return {
    proxy: (out) => {
      assert.equal(out.status, status);
      assert.deepEqual(out.body, { error: `Grant bootstrap mint refused: ${code}`, code, retryable: false });
    },
    session: (out) => {
      assert.equal(out.status, status);
      assert.deepEqual(out.body, { error: `Grant bootstrap mint refused: ${code}`, code, retryable: false });
    },
    fc: (out) => {
      assert.equal(out.status, 422, 'approve-follow-up maps a structural refusal to 422');
      assert.notEqual(out.status, 403, 'never 403: the client treats 403 as flag-off (LIN-2771)');
      assert.equal(out.body.code, code);
      assert.equal(out.body.retryable, false);
      assert.deepEqual(Object.keys(out.body).sort(), ['code', 'error', 'retryable']);
    },
    chat: (out) => {
      assert.equal(out.status, 'threw');
      assert.equal(out.error, `send_follow_up refused (${code}): the orchestrator's dispatch grant cannot be re-issued; do not retry, tell the user`);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// F2 (4) / B2 matrix: 10 branches x {declared, leaf, transient x2, structural}
// ─────────────────────────────────────────────────────────────────────────────

for (const branch of BRANCHES) {
  describe(`F2(4) matrix — ${branch.id} ${branch.name}`, () => {
    test(`${branch.id} declared: grant-bearing resume from the recorded owner/workspace${branch.mode === 'attach' ? ' (MCP) [B1 pin]' : ''}`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: RECORD });
      const out = await branch.run(world, parentId);
      const { row, issued } = assertDeclaredMint(world, out);
      assert.equal(row.bootstrapToken, issued, 'MCP: the grant token travels as the field');
      if (branch.mode === 'attach') {
        assert.ok(row.prompt.includes(PROXY_MARKER), 'attach appends the block');
        assert.ok(!row.prompt.includes(issued), 'MCP strips the token from prose');
        assertBriefAndProvider(branch, row.prompt, { mcp: true });
      } else {
        assert.ok(!row.prompt.includes(PROXY_MARKER), 'pbt never appends the block');
      }
    });

    test(`${branch.id} leaf: no record, poster holds dispatch -> grant-less, today's exact plain arguments`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: null });
      const out = await branch.run(world, parentId);
      const { row, issued } = assertPlainMint(world, out, branch.plainCreatedBy);
      assert.equal(row.bootstrapToken, issued);
      if (branch.mode === 'attach') {
        assert.ok(row.prompt.includes(PROXY_MARKER));
        assertBriefAndProvider(branch, row.prompt, { mcp: true });
      }
    });

    test(`${branch.id} transient (record read throws): tabled 503, nothing enqueued, spy 0`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: RECORD });
      world.lookupFault = true;
      const out = await branch.run(world, parentId);
      TRANSIENT[branch.family](out);
      assertNothingEnqueued(world, out);
      assert.equal(world.spy.grant.length, 0, 'a failed read never reaches the mint');
    });

    test(`${branch.id} transient (owner check unavailable): tabled 503, nothing enqueued, spy 0`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: RECORD });
      world.ownerCheckFault = true;
      const out = await branch.run(world, parentId);
      TRANSIENT[branch.family](out);
      assertNothingEnqueued(world, out);
    });

    test(`${branch.id} structural (owner transferred A -> B): GRANT_OWNER_ONLY, nothing enqueued, spy 0`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: RECORD });
      world.owners[RECORDED_WORKSPACE] = POSTER;
      const out = await branch.run(world, parentId);
      structural('GRANT_OWNER_ONLY', 403)[branch.family](out);
      assertNothingEnqueued(world, out);
      assert.ok(world.spy.grant.length <= 1);
      for (const call of world.spy.grant) {
        assert.equal(call.ownerAccountId, RECORDED_OWNER, 'the refused attempt still names the recorded owner, never B');
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Attach arms: prose, with and without a record; the reviewer's chain
// ─────────────────────────────────────────────────────────────────────────────

for (const branch of ATTACH_BRANCHES) {
  describe(`attach arm — ${branch.id} ${branch.name}`, () => {
    test(`${branch.id} declared (prose): grant token embedded in prose, no field, record carried`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: RECORD });
      const out = await branch.run(world, parentId, { harness: 'opencode' });
      const { row, issued } = assertDeclaredMint(world, out);
      assert.ok(row.prompt.includes(PROXY_MARKER));
      assert.ok(row.prompt.includes(issued), 'prose embeds the grant token');
      assert.strictEqual(row.bootstrapToken, null, 'one credential, one channel');
      assertBriefAndProvider(branch, row.prompt, { mcp: false });
    });

    test(`${branch.id} leaf (prose): plain token embedded in prose, no record`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: null });
      const out = await branch.run(world, parentId, { harness: 'opencode' });
      const { row, issued } = assertPlainMint(world, out, branch.plainCreatedBy);
      assert.ok(row.prompt.includes(issued));
      assert.strictEqual(row.bootstrapToken, null);
      assertBriefAndProvider(branch, row.prompt, { mcp: false });
    });

    test(`${branch.id} reviewer's chain: declared parent -> attach follow-up -> default follow-up still mints declared`, async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { record: RECORD });
      const first = await branch.run(world, parentId);
      assertDeclaredMint(world, first);

      world.spy.grant.length = 0;
      world.spy.plain.length = 0;
      world.spy.issued.length = 0;
      const second = await branch.runDefault(world, first.itemId);
      const { row } = assertDeclaredMint(world, second);
      assert.ok(!row.prompt.includes(PROXY_MARKER), 'the default follow-up suppresses the prose (LIN-805)');
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Site checks that stay at the site
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch.js proxyAttachFailed guard on the follow-up attach arm (LIN-1162)', () => {
  test('prose attach with no proxy token store is a 503, nothing enqueued', async () => {
    const world = await makeWorld({ proxyTokenStore: null });
    const parentId = await seedParent(world, { record: null });
    const out = await viaSession(world, { prompt: 'next beat', followUpTo: parentId, target: 'cli', attachProxy: true, harness: 'opencode' });
    assert.equal(out.status, 503, JSON.stringify(out.body));
    assert.deepEqual(out.body, { error: SESSION_ATTACH_FAILED_MESSAGE });
    assertNothingEnqueued(world, out);
  });
});

describe('NB2 — approve-follow-up maps only the coded refusal to 503', () => {
  test('an uncoded MCP mint failure carrying proxyAttachFailed stays 500 (catch-all)', async () => {
    const world = await makeWorld();
    const parentId = await seedParent(world, { record: null });
    world.tokenStore.createToken = async () => { throw new Error('insert failed'); };
    const out = await viaFc(world, parentId);
    assert.equal(out.status, 500, JSON.stringify(out.body));
    assert.deepEqual(out.body, { error: 'Failed to approve follow-up' });
    assert.equal(world.dispatchStore.collection._docs.length, 0);
  });

  test('a structural refusal is 422 and never 403 (WORKSPACE_OWNER_UNSET)', async () => {
    const world = await makeWorld();
    const parentId = await seedParent(world, { record: RECORD });
    delete world.owners[RECORDED_WORKSPACE];
    const out = await viaFc(world, parentId);
    structural('WORKSPACE_OWNER_UNSET', 409).fc(out);
    assertNothingEnqueued(world, out);
  });
});
