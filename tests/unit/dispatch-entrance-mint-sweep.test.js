/**
 * LIN-3601 — the mint sweep (replaces the exact credential-mint counts in
 * lin-3134-declared-mint-census for the dispatch entrances).
 *
 * The census keyed every mint to `file | route | arm | helper` and counted each.
 * That fixed which file and registration a mint sat in, so the three entrances
 * could not share one authority. Here the property moves to the store boundary:
 * the REAL ProxyTokenStore is wrapped so `createToken` and `mintGrantBootstrap`
 * are spied, the REAL DispatchQueueStore (mock collections) supplies the
 * persisted declaration record, and each origin is driven over HTTP.
 *
 * Bound for "what mints in E": the injected `*TokenStore.*(` calls in the four
 * entrance files plus the callbacks E builds. Spied here: `proxyTokenStore.createToken`,
 * `proxyTokenStore.mintGrantBootstrap`, `dispatchTokenStore.createToken`.
 * NOT spied, with reasons:
 *   - `harbourFeedbackTokenStore.mintToken` (routes/dispatch.js `host`): only the
 *     `local` target reaches it, and that target writes an escape sequence to the
 *     developer's /dev/tty (lib/harbour-spawn.js). Guarded by the B census
 *     (`.mintToken(` is a sink kind) and lin-3134's C pins, not driven here.
 *   - the wake callback built at routes/dispatch.js `buildWakeCredentialProvisioner`:
 *     it fires only inside `dispatchQueueStore.addFeedback`, mints through
 *     `provisionResumeCredential` -> `mintGrantBootstrap` (already spied) and is
 *     covered by lin-3134-wake-declared.test.js, which stays where it is.
 *
 * Origins of a mint (what each row of the table below must show):
 *
 *   World N, no declaration record on the parent row:
 *     kickoff POST                      one `mintGrantBootstrap`, ['dispatch'], the caller token's owner and workspace
 *     session POST, autopilot (M2)      one `mintGrantBootstrap`, ['dispatch'], the session account and workspace
 *     session POST, other kind          one `createToken`, no `grants`
 *     proxy-dispatch launch arms (M3)   one `createToken`, no `grants`
 *     follow-up arms (4 x attach, pbt)  at most one `createToken`, never `mintGrantBootstrap`
 *     refire broker, no row / none      one `createToken` with exactly {kind, scope, label, ttl, createdBy}
 *   World R, a record present (owner and workspace differ from caller and poster):
 *     follow-up arms                    one `mintGrantBootstrap`, the RECORD's grants, owner and workspace; never `createToken`
 *     refire broker                     the same from the record, and only for the recorded owner who took the live row
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { ProxyTokenStore, BOOTSTRAP_TOKEN_TTL_SECONDS } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { BASE_DEPS } from './lib/proxy-fake-deps.js';
import { enumerateRoutes, sampleUrl, request, makeSpy } from './lib/entrance-route-sweep.js';

const URL_KEY = 'acme';
const POSTER = 'poster-B';
const POSTER_WORKSPACE = 'ws-poster';
const RECORDED_OWNER = 'acct-recorded';
const RECORDED_WORKSPACE = 'ws-recorded';
const TAKER_LABEL = 'sd-runner';
const UUID = '11111111-2222-4333-8444-555555555555';

// World R's follow-up record grants ['take'], not ['dispatch']: a path that
// minted the poster's grant or widened to ['dispatch'] then fails on `grants`
// equality, so "echoed, never widened" is tested directly rather than inferred.
const FOLLOWUP_RECORD = Object.freeze({
  grants: ['take'], ownerAccountId: RECORDED_OWNER, workspaceId: RECORDED_WORKSPACE,
  profile: 'worker', site: 'proxy-kickoff', declaredAt: '2026-09-29T00:00:00.000Z'
});
// The refire broker keeps the lin-3135 shape: ['dispatch'], and a caller who IS the recorded owner.
const BROKER_RECORD = Object.freeze({ ...FOLLOWUP_RECORD, grants: ['dispatch'] });

const RUNNER_MOUNT = String.raw`^\/api\/proxy\/runner\/?(?=\/|$)`;
const TOKENS_MOUNT = String.raw`^\/workspace(?:\/([^/]+?))\/api\/proxy\/tokens\/?(?=\/|$)`;
const ALLOWED_LAYERS = [
  { mount: RUNNER_MOUNT, names: ['<anonymous>', 'authenticateProxyToken', 'requireGrantMiddleware'] },
  { mount: TOKENS_MOUNT, names: ['<anonymous>'] }
];

// ── the world ───────────────────────────────────────────────────────────────

async function makeWorld() {
  const spy = makeSpy();
  const tokenCollection = createMockCollection();
  const tokenStore = new ProxyTokenStore({ collection: tokenCollection });
  const dispatchStore = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
  const owners = { [RECORDED_WORKSPACE]: RECORDED_OWNER, [POSTER_WORKSPACE]: POSTER };
  tokenStore.setOwnerCheck(async ({ workspaceId, accountId }) => {
    const owner = owners[workspaceId];
    if (!owner) return { status: 'no-owner' };
    return { status: owner === accountId ? 'owner' : 'not-owner' };
  });

  // The poster holds a dispatch-granted working token (minted before the spies).
  const posterBoot = await tokenStore.mintGrantBootstrap({
    urlKey: URL_KEY, workspaceId: POSTER_WORKSPACE, ownerAccountId: POSTER, grants: ['dispatch'], label: 'poster', profile: 'worker'
  });
  const posterToken = (await tokenStore.exchangeBootstrapToken(posterBoot.token)).token;

  const realGrant = tokenStore.mintGrantBootstrap.bind(tokenStore);
  tokenStore.mintGrantBootstrap = spy.wrap('mintGrantBootstrap', realGrant);
  const realCreate = tokenStore.createToken.bind(tokenStore);
  tokenStore.createToken = async (urlKey, opts) => { spy.calls.push(['createToken', urlKey, opts]); return realCreate(urlKey, opts); };

  const realLookup = dispatchStore.getGrantDeclaration.bind(dispatchStore);
  dispatchStore.getGrantDeclaration = async (...args) => { spy.calls.push(['getGrantDeclaration', ...args]); return realLookup(...args); };

  const dispatchTokens = {
    validateToken: async (token) => ({
      'owner-token': { urlKey: URL_KEY, label: TAKER_LABEL, createdBy: RECORDED_OWNER },
      'owner-other-label': { urlKey: URL_KEY, label: 'other-runner', createdBy: RECORDED_OWNER },
      'member-token': { urlKey: URL_KEY, label: TAKER_LABEL, createdBy: 'account-M' }
    })[token] ?? null,
    listTokens: async () => [],
    createToken: spy.wrap('dispatchToken.createToken', async () => ({ tokenId: UUID, token: 'dispatch-token-fixture', label: 'x' }))
  };

  const proxyDeps = {
    ...BASE_DEPS(),
    proxyTokenStore: tokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 3600000 }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: dispatchStore,
    dispatchTokenStore: dispatchTokens,
    workspaceFromUrl: (req, _res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  };
  const proxyRouter = () => createProxyRoutes(proxyDeps);
  const sessionRouter = ({ accountId = POSTER } = {}) => createDispatchRoutes({
    workspaceOwnerCheck: async ({ accountId: a }) => ({ status: a === POSTER ? 'owner' : 'not-owner' }),
    dispatchQueueStore: dispatchStore,
    dispatchTokenStore: dispatchTokens,
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: req.params.urlKey || URL_KEY, id: POSTER_WORKSPACE, provider: 'linear' };
      req.session = { accountId };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: tokenStore,
    // LIN-1952: the heartbeat route writes only here, so the owner-call scenario gets a stub rather than relying on a 500.
    consumerHeartbeatStore: { record: async () => {}, listLive: async () => [] }
  });
  const app = (router) => { const a = express(); a.use(express.json()); a.use(router); return a; };

  const grants = () => spy.calls.filter(c => c[0] === 'mintGrantBootstrap').map(c => c[1]);
  const plains = () => spy.calls.filter(c => c[0] === 'createToken').map(c => ({ urlKey: c[1], opts: c[2] }));
  const lookups = () => spy.calls.filter(c => c[0] === 'getGrantDeclaration').map(c => c.slice(1));
  const dispatchTokenMints = () => spy.count('dispatchToken.createToken');
  const reset = () => { spy.calls.length = 0; };

  /** A finished parent row (taken, so it lives in history); `record` is its declaration. */
  async function seedParent({ record = null } = {}) {
    const parent = await dispatchStore.addItem(URL_KEY, {
      prompt: 'parent beat', promptName: 'Parent', kind: 'implementation', issueIdentifier: 'TEST-1', harness: 'claude-code',
      target: 'cli', dispatchedBy: RECORDED_OWNER, ...(record ? { grantDeclaration: record } : {})
    });
    await dispatchStore.takeItem(parent._id, URL_KEY, TAKER_LABEL);
    return parent._id;
  }

  return {
    spy, tokenStore, tokenCollection, dispatchStore, posterToken, seedParent,
    proxyApp: () => app(proxyRouter()),
    sessionApp: (options) => app(sessionRouter(options)),
    proxyRouter, sessionRouter, grants, plains, lookups, dispatchTokenMints, reset,
    viaProxy: (path, body) => request(app(proxyRouter()), 'POST', path, { body, headers: { Authorization: `Bearer ${posterToken}` } }),
    viaSession: (body, options) => request(app(sessionRouter(options)), 'POST', `/workspace/${URL_KEY}/api/dispatch`, { body }),
    viaBroker: (token, body) => request(app(sessionRouter()), 'POST', '/api/dispatch/broker-token', { body, headers: { Authorization: `Bearer ${token}` } })
  };
}

const grantlessCreate = (label, createdBy) => ({
  kind: 'bootstrap', scope: 'readWrite', label, ttl: BOOTSTRAP_TOKEN_TTL_SECONDS, createdBy
});

// ── the follow-up arms: 3 x proxy-dispatch, 1 x session, attach and pbt ────

const DISPATCH = '/api/proxy/dispatch';
const RECOMMEND = '/api/proxy/recommend-and-dispatch';
const ARMS = [
  { id: 'proxy POST /dispatch (pbt)', run: (w, followUpTo) => w.viaProxy(DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', target: 'cli', followUpTo }) },
  { id: 'proxy POST /dispatch (attach)', run: (w, followUpTo) => w.viaProxy(DISPATCH, { prompt: 'next beat', issueIdentifier: 'TEST-1', target: 'cli', followUpTo, appendProxyContext: true, harness: 'claude-code' }) },
  { id: 'recommend-and-dispatch override arm (pbt)', run: (w, followUpTo) => w.viaProxy(RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo }) },
  { id: 'recommend-and-dispatch override arm (attach)', run: (w, followUpTo) => w.viaProxy(RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo, appendProxyContext: true, harness: 'claude-code' }) },
  { id: 'recommend-and-dispatch LLM arm (pbt)', run: (w, followUpTo) => w.viaProxy(RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo }) },
  { id: 'recommend-and-dispatch LLM arm (attach)', run: (w, followUpTo) => w.viaProxy(RECOMMEND, { issueIdentifier: 'TEST-1', followUpTo, appendProxyContext: true, harness: 'claude-code' }) },
  { id: 'session POST (pbt)', run: (w, followUpTo) => w.viaSession({ prompt: 'next beat', followUpTo, target: 'cli', harness: 'claude-code' }) },
  { id: 'session POST (attach)', run: (w, followUpTo) => w.viaSession({ prompt: 'next beat', issueIdentifier: 'TEST-7', followUpTo, target: 'cli', attachProxy: true, harness: 'claude-code' }) }
];

describe('LIN-3601 mint sweep — World N (no declaration record)', () => {
  test('kickoff POST: one declared mint for the caller token\'s own owner and workspace, no plain mint (M1)', async () => {
    const w = await makeWorld();
    w.reset();
    const res = await w.viaProxy('/api/proxy/autopilot/kickoff', { goal: 'walk the stack', target: 'cli' });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(w.grants(), [{
      urlKey: URL_KEY, workspaceId: POSTER_WORKSPACE, ownerAccountId: POSTER, grants: ['dispatch'], label: 'kickoff-bootstrap', profile: 'worker'
    }]);
    assert.deepEqual(w.plains(), []);
  });

  test('session POST, kind autopilot + attachProxy: one declared mint for the session account and workspace (M2)', async () => {
    const w = await makeWorld();
    w.reset();
    const res = await w.viaSession({ prompt: 'Run the autopilot on LIN-1.', promptName: 'Autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1', attachProxy: true, target: 'cli', harness: 'claude-code' });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(w.grants(), [{
      urlKey: URL_KEY, workspaceId: POSTER_WORKSPACE, ownerAccountId: POSTER, grants: ['dispatch'], label: 'dispatch-bootstrap', profile: 'worker'
    }]);
    assert.deepEqual(w.plains(), []);
  });

  test('session POST, a non-orchestrator kind + attachProxy: one grant-less mint, no declared mint', async () => {
    const w = await makeWorld();
    w.reset();
    const res = await w.viaSession({ prompt: 'Do the thing.', kind: 'custom', attachProxy: true, target: 'cli', harness: 'claude-code' });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(w.grants(), []);
    assert.deepEqual(w.plains(), [{ urlKey: URL_KEY, opts: grantlessCreate('dispatch-bootstrap', POSTER) }]);
  });

  test('session POST without attachProxy mints nothing', async () => {
    const w = await makeWorld();
    w.reset();
    const res = await w.viaSession({ prompt: 'Do the thing.', target: 'cli' });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual([w.grants(), w.plains()], [[], []]);
  });

  for (const arm of ARMS.filter(a => a.id.startsWith('proxy POST') || a.id.includes('arm'))) {
    if (!arm.id.includes('(attach)')) continue;
    test(`${arm.id}, a launch (no followUpTo): one grant-less mint (M3, LIN-3099 deferred), no declared mint`, async () => {
      const w = await makeWorld();
      w.reset();
      const body = { prompt: 'a launch', issueIdentifier: 'TEST-1', target: 'cli', appendProxyContext: true, harness: 'claude-code', kind: 'implementation' };
      const res = arm.id.startsWith('proxy POST') ? await w.viaProxy(DISPATCH, body) : await w.viaProxy(RECOMMEND, arm.id.includes('override') ? body : { issueIdentifier: 'TEST-1', appendProxyContext: true, harness: 'claude-code' });
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(w.grants(), [], 'a proxy-dispatch launch never declares');
      assert.equal(w.plains().length, 1);
      assert.equal(w.plains()[0].opts.grants, undefined, 'no grants key');
      assert.equal(w.lookups().length, 0, 'a launch never reads a declaration');
    });
  }

  for (const arm of ARMS) {
    test(`${arm.id}, follow-up of a row with no record: never a declared mint, at most one grant-less mint`, async () => {
      const w = await makeWorld();
      const parent = await w.seedParent();
      w.reset();
      const res = await arm.run(w, parent);
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(w.grants(), [], 'no record, no declared mint');
      assert.ok(w.plains().length <= 1, `${w.plains().length} plain mints`);
      for (const p of w.plains()) assert.equal(p.opts.grants, undefined);
    });
  }

  for (const [name, setup] of [['no itemId', () => undefined], ['itemId of a row with no record', async (w) => ({ itemId: await w.seedParent() })], ['itemId of a missing row', () => ({ itemId: UUID })]]) {
    test(`refire broker, ${name}: one grant-less mint with exactly {kind, scope, label, ttl, createdBy}`, async () => {
      const w = await makeWorld();
      const body = await setup(w);
      w.reset();
      const res = await w.viaBroker('owner-token', body);
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(w.grants(), []);
      assert.deepEqual(w.plains(), [{ urlKey: URL_KEY, opts: grantlessCreate('refire-broker', RECORDED_OWNER) }]);
      assert.deepEqual(Object.keys(w.plains()[0].opts), ['kind', 'scope', 'label', 'ttl', 'createdBy']);
    });
  }
});

describe('LIN-3601 mint sweep — World R (a record present; owner and workspace differ from the caller and the poster)', () => {
  for (const arm of ARMS) {
    test(`${arm.id}: echoes the record, never widened, never re-owned, never a plain mint`, async () => {
      const w = await makeWorld();
      const parent = await w.seedParent({ record: FOLLOWUP_RECORD });
      w.reset();
      const res = await arm.run(w, parent);
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(w.plains(), [], 'a declared resume never mints plain');
      assert.deepEqual(w.grants(), [{
        urlKey: URL_KEY, workspaceId: RECORDED_WORKSPACE, ownerAccountId: RECORDED_OWNER, grants: ['take'], label: 'dispatch-bootstrap', profile: 'worker'
      }]);
      assert.notEqual(w.grants()[0].ownerAccountId, POSTER, 'never the poster');
      assert.notEqual(w.grants()[0].workspaceId, POSTER_WORKSPACE, 'never the poster\'s workspace');
    });
  }

  test('refire broker: the recorded owner who took the live row is re-minted from the record (two reads)', async () => {
    const w = await makeWorld();
    const id = await w.seedParent({ record: BROKER_RECORD });
    w.reset();
    const res = await w.viaBroker('owner-token', { itemId: id });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(w.plains(), []);
    assert.deepEqual(w.grants(), [{
      urlKey: URL_KEY, workspaceId: RECORDED_WORKSPACE, ownerAccountId: RECORDED_OWNER, grants: ['dispatch'], label: 'refire-broker', profile: 'worker'
    }]);
    assert.deepEqual(w.lookups(), [[URL_KEY, id], [URL_KEY, id]], 'the route\'s read and the helper\'s re-read');
  });

  for (const [name, token] of [['a caller other than the recorded owner (B1)', 'member-token'], ['the recorded owner with a different label (B2)', 'owner-other-label']]) {
    test(`refire broker, ${name}: 403 REFIRE_CALLER_NOT_PERMITTED and every spy reads 0`, async () => {
      const w = await makeWorld();
      const id = await w.seedParent({ record: BROKER_RECORD });
      w.reset();
      const res = await w.viaBroker(token, { itemId: id });
      assert.equal(res.status, 403, res.text);
      assert.equal(res.body.code, 'REFIRE_CALLER_NOT_PERMITTED');
      assert.deepEqual([w.grants(), w.plains(), w.dispatchTokenMints()], [[], [], 0]);
    });
  }
});

// ── the owner-only dispatch-token mint (LIN-3137) ───────────────────────────

describe('LIN-3601 mint sweep — the owner-only dispatch-token mint (LIN-3137)', () => {
  test('the owner mints through dispatchTokenStore.createToken; a non-owner never reaches it', async () => {
    const w = await makeWorld();
    w.reset();
    const owner = await request(w.sessionApp(), 'POST', `/workspace/${URL_KEY}/api/dispatch/tokens`, { body: { label: 'x' } });
    assert.equal(owner.status, 201, owner.text);
    assert.equal(w.dispatchTokenMints(), 1);
    w.reset();
    const member = await request(w.sessionApp({ accountId: 'account-M' }), 'POST', `/workspace/${URL_KEY}/api/dispatch/tokens`, { body: { label: 'x' } });
    assert.equal(member.status, 403, member.text);
    assert.equal(member.body.code, 'GRANT_OWNER_ONLY');
    assert.equal(w.dispatchTokenMints(), 0);
  });
});

// ── the table: one row per enumerated route, every mint accounted for ──────

const SESSION = '/workspace/:urlKey/api/dispatch';
/**
 * Mint kinds a route may reach: `none`, `plain-bootstrap` (createToken),
 * `declared-bootstrap` (mintGrantBootstrap), `dispatch-token` (the legacy take
 * credential), `feedback-token` (undriven: the `local` target, see the header).
 */
const SESSION_TABLE = {
  [`POST ${SESSION}`]: { kinds: ['declared-bootstrap', 'plain-bootstrap', 'feedback-token'], reason: 'M2 launch (orchestrator kinds), leaf attach, follow-up resume (LIN-3134), and the local-target feedback token' },
  [`GET ${SESSION}`]: { kinds: ['none'], reason: 'queue list' },
  [`GET ${SESSION}/count`]: { kinds: ['none'], reason: 'queue count' },
  [`GET ${SESSION}/quota`]: { kinds: ['none'], reason: 'free-tier usage read' },
  [`GET ${SESSION}/preview`]: { kinds: ['none'], reason: 'LIN-3833: the read-only routing answer; resolves a setting, mints nothing' },
  [`GET ${SESSION}/decision-panel`]: { kinds: ['none'], reason: 'LIN-3962: the run panel\'s read-only body; prices a history read, mints nothing' },
  [`GET ${SESSION}/history`]: { kinds: ['none'], reason: 'history list' },
  [`GET ${SESSION}/recent-prompts`]: { kinds: ['none'], reason: 'recent prompts read' },
  [`POST ${SESSION}/recent-prompts`]: { kinds: ['none'], reason: 'recent prompts write' },
  [`GET ${SESSION}/favorite-prompts`]: { kinds: ['none'], reason: 'favourites read' },
  [`POST ${SESSION}/favorite-prompts`]: { kinds: ['none'], reason: 'favourites write' },
  [`DELETE ${SESSION}/favorite-prompts`]: { kinds: ['none'], reason: 'favourites delete' },
  [`GET ${SESSION}/halt`]: { kinds: ['none'], reason: 'halt read' },
  [`POST ${SESSION}/halt`]: { kinds: ['none'], reason: 'halt set' },
  [`DELETE ${SESSION}/halt`]: { kinds: ['none'], reason: 'halt clear' },
  [`DELETE ${SESSION}/:itemId`]: { kinds: ['none'], reason: 'queue-item delete' },
  [`PATCH ${SESSION}/:sessionId/trim`]: { kinds: ['none'], reason: 'run trim' },
  [`POST ${SESSION}/tokens`]: { kinds: ['dispatch-token'], reason: 'LIN-3137 owner-only legacy dispatch-token mint' },
  [`GET ${SESSION}/tokens`]: { kinds: ['none'], reason: 'token metadata read' },
  [`DELETE ${SESSION}/tokens/:tokenId`]: { kinds: ['none'], reason: 'token revoke' },
  [`GET ${SESSION}/presets`]: { kinds: ['none'], reason: 'preset list' },
  [`POST ${SESSION}/presets`]: { kinds: ['none'], reason: 'preset create' },
  [`PATCH ${SESSION}/presets/:presetId`]: { kinds: ['none'], reason: 'preset update' },
  [`DELETE ${SESSION}/presets/:presetId`]: { kinds: ['none'], reason: 'preset delete' },
  'GET /api/dispatch/poll': { kinds: ['none'], reason: 'runner poll' },
  'POST /api/dispatch/broker-token': { kinds: ['plain-bootstrap', 'declared-bootstrap'], reason: 'LIN-3135 refire broker: grant-less inline mint, or the declared re-mint through the helper' },
  'POST /api/dispatch/take/:itemId': { kinds: ['none'], reason: 'runner take' },
  'POST /api/dispatch/heartbeat': { kinds: ['none'], reason: 'LIN-1952 consumer heartbeat: writes only to the consumer-heartbeats store, mints nothing' },
  'POST /api/dispatch/feedback/:itemId': { kinds: ['declared-bootstrap'], reason: 'the wake callback built here mints through provisionResumeCredential when addFeedback invokes it; covered by lin-3134-wake-declared.test.js' }
};

const PROXY_E_TABLE = {
  'POST /api/proxy/autopilot/kickoff': { kinds: ['declared-bootstrap'], reason: 'M1: the child orchestrator holds the dispatch grant' },
  'GET /api/proxy/autopilot/kickoff': { kinds: ['none'], reason: 'kickoff preview' },
  'GET /api/proxy/autopilot/manual': { kinds: ['none'], reason: 'manual' },
  'GET /api/proxy/passage-runner/prompt': { kinds: ['none'], reason: 'prompt read' },
  'POST /api/proxy/dispatch': { kinds: ['plain-bootstrap', 'declared-bootstrap'], reason: 'M3 launch (grant-less, LIN-3099) and follow-up resume' },
  'POST /api/proxy/recommend-and-dispatch': { kinds: ['plain-bootstrap', 'declared-bootstrap'], reason: 'M3 launch arms (override and LLM) and follow-up resume' },
  'GET /api/proxy/dispatch': { kinds: ['none'], reason: 'list' },
  'GET /api/proxy/dispatch/:id': { kinds: ['none'], reason: 'watch' },
  'GET /api/proxy/dispatch/:id/prompt': { kinds: ['none'], reason: 'prompt read: the in-route plant witness makes this mint' },
  'GET /api/proxy/wake-shadow': { kinds: ['none'], reason: 'wake-shadow tally' }
};

const KINDS = ['none', 'plain-bootstrap', 'declared-bootstrap', 'dispatch-token', 'feedback-token'];
// Kinds the scenarios above drive; `feedback-token` is the one undriven kind (header).
const DRIVEN_KINDS = ['plain-bootstrap', 'declared-bootstrap', 'dispatch-token'];

describe('LIN-3601 mint sweep — the table', () => {
  test('the session router enumerates 29 routes (LIN-3962 adds the decision panel), each with one row naming its mint kinds and a reason', async () => {
    const w = await makeWorld();
    const routes = enumerateRoutes(w.sessionRouter());
    assert.equal(routes.length, 29);
    const keys = routes.map(r => `${r.method} ${r.path}`);
    assert.deepEqual(keys.filter(k => !SESSION_TABLE[k]), [], 'an enumerated route without a row');
    assert.deepEqual(Object.keys(SESSION_TABLE).filter(k => !keys.includes(k)), [], 'a row for a route that is not enumerated');
  });

  test('every proxy-entrance route (6 + 4) is enumerated from the composer and has a row; every row has a reason', async () => {
    const w = await makeWorld();
    const keys = enumerateRoutes(w.proxyRouter(), { allowedLayers: ALLOWED_LAYERS }).map(r => `${r.method} ${r.path}`);
    assert.deepEqual(Object.keys(PROXY_E_TABLE).filter(k => !keys.includes(k)), [], 'a row for a route the composer no longer registers');
    assert.equal(Object.keys(PROXY_E_TABLE).length, 10);
    for (const table of [SESSION_TABLE, PROXY_E_TABLE]) {
      for (const [key, row] of Object.entries(table)) {
        assert.ok(row.reason, `${key}: a row needs a recorded reason`);
        assert.ok(row.kinds.length && row.kinds.every(k => KINDS.includes(k)), key);
      }
    }
  });

  test('a kind claimed by a row that no scenario in this file drives fails (under-driving), except the documented undriven kind', () => {
    const claimed = new Set([...Object.values(SESSION_TABLE), ...Object.values(PROXY_E_TABLE)].flatMap(r => r.kinds).filter(k => k !== 'none'));
    for (const kind of claimed) assert.ok(kind === 'feedback-token' || DRIVEN_KINDS.includes(kind), `${kind} is claimed but never driven`);
  });
});

// ── no unlisted minter: every route called, every mint attributed ───────────

/** The mints one request made, by kind. */
function mintKinds(w) {
  const kinds = [];
  if (w.plains().length) kinds.push('plain-bootstrap');
  if (w.grants().length) kinds.push('declared-bootstrap');
  if (w.dispatchTokenMints()) kinds.push('dispatch-token');
  return kinds;
}

describe('LIN-3601 mint sweep — no route mints a kind its row does not list', () => {
  test('the session router: every route, called as the owner, mints only what its row lists', async () => {
    const probe = await makeWorld();
    const routes = enumerateRoutes(probe.sessionRouter());
    const offenders = [];
    for (const route of routes) {
      const w = await makeWorld();
      const parent = await w.seedParent();
      w.reset();
      const url = sampleUrl(route.path, { urlKey: URL_KEY, itemId: parent, sessionId: parent, id: parent });
      const body = route.method === 'GET' ? undefined : { prompt: 'p', mode: 'stop', maxTasks: 1, label: 'l', name: 'n', itemId: parent, target: 'cli' };
      await request(w.sessionApp(), route.method, url, { body, headers: { Authorization: 'Bearer owner-token' } });
      const listed = SESSION_TABLE[`${route.method} ${route.path}`].kinds;
      for (const kind of mintKinds(w)) if (!listed.includes(kind)) offenders.push(`${route.method} ${route.path} minted ${kind}`);
    }
    assert.deepEqual(offenders, []);
  });

  test('the composer: every route, called with a dispatch-holding token, mints only what its row lists (unlisted routes mint nothing)', async () => {
    const probe = await makeWorld();
    const routes = enumerateRoutes(probe.proxyRouter(), { allowedLayers: ALLOWED_LAYERS });
    const offenders = [];
    for (const route of routes) {
      const w = await makeWorld();
      const parent = await w.seedParent();
      w.reset();
      const url = sampleUrl(route.path, { id: parent, itemId: parent, identifier: 'TEST-1' });
      const body = route.method === 'GET' ? undefined : { prompt: 'p', issueIdentifier: 'TEST-1', goal: 'g', target: 'cli' };
      await request(w.proxyApp(), route.method, url, { body, headers: { Authorization: `Bearer ${w.posterToken}` } });
      const row = PROXY_E_TABLE[`${route.method} ${route.path}`];
      const listed = row ? row.kinds : OUTSIDE_E_MINTERS[`${route.method} ${route.path}`] || ['none'];
      for (const kind of mintKinds(w)) if (!listed.includes(kind)) offenders.push(`${route.method} ${route.path} minted ${kind}`);
    }
    assert.deepEqual(offenders, []);
  });
});

// Composer routes OUTSIDE the dispatch entrances that legitimately mint, found by running the sweep once.
const OUTSIDE_E_MINTERS = {};
