/**
 * LIN-3135 (LIN-2884 T2c) S1 — R2: `POST /api/dispatch/broker-token` accepts an
 * optional JSON `itemId` and re-mints declared-or-plain.
 *
 * Revision-2 plan, "Acceptance mapping and tests" 1-16, one describe per case:
 *  - no `itemId` → today's inline grant-less `createToken`, byte-identical, and
 *    the dispatch queue store is never touched;
 *  - `itemId` present but malformed → 400 before any lookup;
 *  - lookup `none` / `row-missing` → today's grant-less mint for ANY caller;
 *  - lookup fault → 503, never a fallback mint;
 *  - lookup `record` → caller bound B1 (the caller's dispatch token was created
 *    by the RECORDED owner) + B2 (the caller took the live row, non-terminal on
 *    its own feedback); mismatch → 403 `REFIRE_CALLER_NOT_PERMITTED`, one
 *    generic body for every reason;
 *  - both hold → `provisionResumeCredential` → `mintGrantBootstrap` from the
 *    RECORDED owner, `profile: 'worker'`; response `{ token }` only (no
 *    `expiresAt`, F2); structural refusals relayed with their code, transient
 *    faults 503, never a grant-less mint.
 *
 * Real `DispatchQueueStore` on mock collections and a real `ProxyTokenStore`
 * with a stubbed owner-check seam (the lin-3134-wake-declared.test.js world),
 * with spies on the two mints and the two store reads. Test servers bind
 * 127.0.0.1 (LIN-2023).
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { ProxyTokenStore, BOOTSTRAP_TOKEN_TTL_SECONDS } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';

const PATH = '/api/dispatch/broker-token';
const URL_KEY = 'acme';
const OTHER_URL_KEY = 'globex';
const RECORDED_OWNER = 'account-A';
const RECORDED_WORKSPACE = 'ws-recorded';
const TAKER_LABEL = 'sd-runner';
const REFUSED_CODE = 'REFIRE_CALLER_NOT_PERMITTED';
const REFUSAL_LOG_TAG = '[dispatch] broker-declared-remint-refused';
const COMPAT_ENV = 'DISPATCH_OWNERLESS_BROKER_COMPAT';

const RECORD = Object.freeze({
  grants: ['dispatch'],
  ownerAccountId: RECORDED_OWNER,
  workspaceId: RECORDED_WORKSPACE,
  profile: 'worker',
  site: 'proxy-kickoff',
  declaredAt: '2026-09-29T00:00:00.000Z'
});

// Dispatch tokens as authenticateDispatchToken sees them (validateToken result).
const TOKENS = {
  // The recorded owner's own token, and the label that took the row.
  'owner-token': { urlKey: URL_KEY, label: TAKER_LABEL, createdBy: RECORDED_OWNER },
  // The recorded owner's own token, but a different label (did not take the row).
  'owner-other-label': { urlKey: URL_KEY, label: 'other-runner', createdBy: RECORDED_OWNER },
  // A member-minted token (open until T4) carrying the TAKER's label.
  'member-token': { urlKey: URL_KEY, label: TAKER_LABEL, createdBy: 'account-M' },
  // A pre-LIN-1397 ownerless token (compat lane) carrying the taker's label.
  'ownerless-token': { urlKey: URL_KEY, label: TAKER_LABEL, createdBy: null }
};

// Exactly today's inline mint options (routes/dispatch.js broker route).
const grantlessOpts = (createdBy) => ({
  kind: 'bootstrap',
  scope: 'readWrite',
  label: 'refire-broker',
  ttl: BOOTSTRAP_TOKEN_TTL_SECONDS,
  createdBy
});

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
    spy: { grant: [], plain: [], lookup: [], status: [] }
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
    return realGrant(args);
  };
  const realCreate = tokenStore.createToken.bind(tokenStore);
  tokenStore.createToken = async (urlKey, opts) => {
    world.spy.plain.push({ urlKey, opts });
    return realCreate(urlKey, opts);
  };

  const realLookup = store.getGrantDeclaration.bind(store);
  store.getGrantDeclaration = async (...args) => {
    world.spy.lookup.push(args);
    return realLookup(...args);
  };
  const realStatus = store.getItemStatus.bind(store);
  store.getItemStatus = async (...args) => {
    world.spy.status.push(args);
    return realStatus(...args);
  };
  return world;
}

/**
 * A dispatch queue store that throws on ANY property access once armed — proves
 * the no-`itemId` path performs no store read at all (plan Risk 1).
 */
function trapStore() {
  const trap = { armed: false, touched: [] };
  trap.store = new Proxy({}, {
    get(_target, prop) {
      if (!trap.armed) return undefined;
      trap.touched.push(String(prop));
      throw new Error(`dispatchQueueStore.${String(prop)} touched on the no-itemId path`);
    }
  });
  return trap;
}

function buildApp(world, { dispatchQueueStore = world.store } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore,
    dispatchTokenStore: { validateToken: async (token) => TOKENS[token] ?? null },
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    proxyTokenStore: world.tokenStore
  }));
  return app;
}

/**
 * POSTs to the broker route. `body === undefined` sends today's exact request
 * (no body, no content-type, as SD's `mintBrokerToken` does); anything else is
 * sent as JSON.
 */
async function call(app, token, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method: 'POST', headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${PATH}`, init);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** Adds a row, takes it under `label`, then applies `patch` to the persisted history doc. */
async function seedTaken(world, { record = RECORD, label = TAKER_LABEL, urlKey = URL_KEY, patch = null } = {}) {
  const item = await world.store.addItem(urlKey, {
    prompt: 'orchestrate the lineage', kind: 'autopilot', harness: 'claude-code',
    ...(record != null ? { grantDeclaration: record } : {})
  });
  const taken = await world.store.takeItem(item._id, urlKey, label, null);
  assert.ok(taken, 'seed: row taken');
  if (patch) {
    const doc = world.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(doc, 'seed: taken row is in history');
    Object.assign(doc, patch);
  }
  return item._id;
}

async function seedQueued(world, { record = RECORD } = {}) {
  const item = await world.store.addItem(URL_KEY, {
    prompt: 'orchestrate the lineage', kind: 'autopilot', harness: 'claude-code',
    ...(record != null ? { grantDeclaration: record } : {})
  });
  return item._id;
}

const feedback = (...messages) => messages.map((message, i) => ({
  message, timestamp: new Date(Date.UTC(2026, 8, 29, 12, i)).toISOString()
}));

function resetSpy(world) {
  for (const list of Object.values(world.spy)) list.length = 0;
}

/** Captures console.warn/error/log lines while `fn` runs. */
async function captureLogs(fn) {
  const lines = [];
  const saved = { warn: console.warn, error: console.error, log: console.log };
  const sink = (...args) => {
    lines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  console.warn = sink; console.error = sink; console.log = sink;
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    Object.assign(console, saved);
  }
}

/** No credential of any kind was issued and no grant mint was attempted. */
function assertNoMintAttempt(world, why) {
  assert.equal(world.spy.grant.length, 0, `${why}: mintGrantBootstrap never called`);
  assert.equal(world.spy.plain.length, 0, `${why}: no grant-less createToken fallback`);
  assert.equal(world.tokenCollection._docs.length, 0, `${why}: no token persisted`);
}

/** Nothing persisted and no grant-less fallback (a refused grant mint attempt is allowed). */
function assertNothingMinted(world, why) {
  assert.equal(world.spy.plain.length, 0, `${why}: no grant-less createToken fallback`);
  assert.equal(world.tokenCollection._docs.length, 0, `${why}: no token persisted`);
}

/** Today's grant-less inline mint, exactly. */
function assertGrantless(res, world, createdBy, why) {
  assert.equal(res.status, 201, `${why}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(Object.keys(res.body).sort(), ['expiresAt', 'token'], `${why}: today's response shape`);
  assert.equal(typeof res.body.token, 'string');
  assert.equal(world.spy.plain.length, 1, `${why}: exactly one inline createToken`);
  assert.equal(world.spy.plain[0].urlKey, URL_KEY, `${why}: the dispatch token's own urlKey`);
  assert.deepEqual(world.spy.plain[0].opts, grantlessOpts(createdBy), `${why}: byte-identical mint options`);
  assert.equal(world.spy.grant.length, 0, `${why}: no grant mint`);
  assert.equal(world.tokenCollection._docs.length, 1);
  const doc = world.tokenCollection._docs[0];
  assert.ok(!Array.isArray(doc.grants) || doc.grants.length === 0, `${why}: the persisted bootstrap carries no grant`);
}

/** The declared re-mint from the RECORDED authority. */
function assertDeclared(res, world, id, why) {
  assert.equal(res.status, 201, `${why}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(Object.keys(res.body), ['token'], `${why}: declared response omits expiresAt (F2)`);
  assert.equal(typeof res.body.token, 'string');
  assert.equal(world.spy.plain.length, 0, `${why}: createToken not called on the declared branch`);
  assert.equal(world.spy.grant.length, 1, `${why}: one mintGrantBootstrap`);
  assert.deepEqual(world.spy.grant[0], {
    urlKey: URL_KEY,
    workspaceId: RECORD.workspaceId,
    ownerAccountId: RECORD.ownerAccountId,
    grants: RECORD.grants,
    label: 'refire-broker',
    profile: 'worker'
  }, `${why}: minted from the recorded owner/workspace/grants, worker profile`);
  // Two reads, both keyed by the token's urlKey and the body id: the route's own
  // (to branch and gate B1/B2) and the helper's re-read, from which it mints.
  // Beat 1 pinned ONE read (plan step 6 passed the record in); ruling
  // `lin3135-f3c4-census-conflict` = option B (helper-lookup) keeps the census
  // F3/C4 blocks unchanged by never holding the record in a route, like the
  // sibling follow-up arms, so the helper reads it again.
  assert.deepEqual(world.spy.lookup, [[URL_KEY, id], [URL_KEY, id]], `${why}: route read + helper re-read, token urlKey and body id`);
  assert.equal(world.tokenCollection._docs.length, 1);
  const doc = world.tokenCollection._docs[0];
  assert.deepEqual(doc.grants, ['dispatch'], `${why}: the persisted bootstrap carries the recorded grant`);
  assert.equal(doc.createdBy, RECORDED_OWNER, `${why}: stamped with the recorded owner`);
  assert.equal(doc.label, 'refire-broker');
  assert.equal(doc.lifetimeProfile, 'worker');
}

function assertCallerRefused(res, world, why) {
  assert.equal(res.status, 403, `${why}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, REFUSED_CODE, `${why}: coded refusal`);
  assert.equal(res.body.retryable, false, `${why}: not retryable`);
  assert.equal('token' in res.body, false, `${why}: no token in the body`);
  assertNoMintAttempt(world, why);
}

let savedCompat;
beforeEach(() => {
  savedCompat = process.env[COMPAT_ENV];
  delete process.env[COMPAT_ENV]; // default: ownerless compat lane ON
});
afterEach(() => {
  if (savedCompat === undefined) delete process.env[COMPAT_ENV];
  else process.env[COMPAT_ENV] = savedCompat;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. No itemId → today's mint, byte-identical, no store read
// ─────────────────────────────────────────────────────────────────────────────

describe('1 — no itemId (old SD): today\'s grant-less mint, byte-identical, no store read', () => {
  for (const [name, body] of [['no body', undefined], ['{}', {}], ['{"x":1}', { x: 1 }]]) {
    for (const [token, createdBy] of [['owner-token', RECORDED_OWNER], ['ownerless-token', null]]) {
      test(`${name}, ${token} -> 201 {token, expiresAt}, createdBy ${createdBy}, dispatchQueueStore untouched`, async () => {
        const world = makeWorld();
        const trap = trapStore();
        const app = buildApp(world, { dispatchQueueStore: trap.store });
        trap.armed = true;
        const res = await call(app, token, body);
        assertGrantless(res, world, createdBy, name);
        assert.equal(res.body.expiresAt, world.tokenCollection._docs[0].expiresAt.toISOString(), 'the minted row\'s own expiry');
        assert.deepEqual(trap.touched, [], 'the no-itemId path performs no store read');
      });
    }
  }

  test('strict lane (compat off) + ownerless token + itemId -> 503 BEFORE any lookup', async () => {
    process.env[COMPAT_ENV] = 'off';
    const world = makeWorld();
    const id = await seedTaken(world);
    resetSpy(world);
    const res = await call(buildApp(world), 'ownerless-token', { itemId: id });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.match(JSON.stringify(res.body), /LIN-1448/);
    assert.equal(world.spy.lookup.length, 0, 'no lookup');
    assert.equal(world.spy.status.length, 0, 'no status read');
    assertNoMintAttempt(world, 'strict lane');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('2 — declared re-mint when both bounds hold', () => {
  test('owner token A, record owner A, row taken by this label, non-terminal -> 201 {token} from the recorded authority', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    resetSpy(world);
    const res = await call(buildApp(world), 'owner-token', { itemId: id });
    assertDeclared(res, world, id, 'happy path');
  });

  test('the declared bootstrap exchanges for a working token that carries the recorded grant', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    const res = await call(buildApp(world), 'owner-token', { itemId: id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const exchanged = await world.tokenStore.exchangeBootstrapToken(res.body.token);
    assert.ok(exchanged?.token, 'exchange succeeds');
    const working = world.tokenCollection._docs.find(d => d.kind !== 'bootstrap');
    assert.deepEqual(working.grants, ['dispatch']);
    assert.equal(working.createdBy, RECORDED_OWNER);
  });
});

describe('2b — the helper re-reads the record (ruling lin3135-f3c4-census-conflict = B)', () => {
  test('row vanishes between the route read and the helper re-read -> today\'s grant-less mint for this caller, never declared, never ownerless', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    const realLookup = world.store.getGrantDeclaration;
    let calls = 0;
    world.store.getGrantDeclaration = async (...args) => {
      calls++;
      if (calls === 2) {
        world.spy.lookup.push(args);
        return { state: 'row-missing' };
      }
      return realLookup(...args);
    };
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls, 2, 'route read + helper re-read');
    assert.equal(world.spy.grant.length, 0, 'no grant mint: the helper found no record');
    assert.equal(world.spy.plain.length, 1, 'one grant-less mint');
    assert.deepEqual(world.spy.plain[0].opts, grantlessOpts(RECORDED_OWNER), 'exactly today\'s grant-less options, stamped with the caller');
    assert.equal(world.tokenCollection._docs.length, 1);
    const doc = world.tokenCollection._docs[0];
    assert.ok(!Array.isArray(doc.grants) || doc.grants.length === 0, 'the persisted bootstrap carries no grant');
    assert.deepEqual(Object.keys(res.body), ['token'], 'the body names nothing about a declaration');
  });

  test('the helper re-read faults -> 503, nothing minted, no fallback', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    const realLookup = world.store.getGrantDeclaration;
    let calls = 0;
    world.store.getGrantDeclaration = async (...args) => {
      calls++;
      if (calls === 2) {
        const err = new Error('mongo re-read timeout');
        err.declarationLookupFailed = true;
        throw err;
      }
      return realLookup(...args);
    };
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal('token' in (res.body || {}), false);
    assertNoMintAttempt(world, 're-read fault');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. none / row-missing → grant-less for any caller, no oracle
// ─────────────────────────────────────────────────────────────────────────────

describe('3 — lookup none / row-missing: today\'s grant-less mint for ANY caller', () => {
  const callers = [['owner-token', RECORDED_OWNER], ['member-token', 'account-M'], ['ownerless-token', null]];
  for (const [token, createdBy] of callers) {
    test(`none (row without a record), ${token} -> grant-less, same shape as no itemId, no status read`, async () => {
      const world = makeWorld();
      const id = await seedTaken(world, { record: null });
      resetSpy(world);
      const res = await call(buildApp(world), token, { itemId: id });
      assertGrantless(res, world, createdBy, 'none');
      assert.deepEqual(world.spy.lookup, [[URL_KEY, id]], 'the declaration was consulted');
      assert.equal(world.spy.status.length, 0, 'no caller bound on the grant-less path');
    });

    test(`row-missing (unknown id), ${token} -> grant-less, same shape as no itemId, no status read`, async () => {
      const world = makeWorld();
      const id = crypto.randomUUID();
      const { result: res } = await captureLogs(() => call(buildApp(world), token, { itemId: id }));
      assertGrantless(res, world, createdBy, 'row-missing');
      assert.deepEqual(world.spy.lookup, [[URL_KEY, id]], 'the declaration was consulted');
      assert.equal(world.spy.status.length, 0, 'no caller bound on the grant-less path');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Lookup fault → 503
// ─────────────────────────────────────────────────────────────────────────────

describe('4 — lookup throws: 503, nothing minted, no fallback', () => {
  for (const flagged of [true, false]) {
    test(`getGrantDeclaration throws ${flagged ? 'with' : 'without'} declarationLookupFailed -> 503`, async () => {
      const world = makeWorld();
      const id = await seedTaken(world);
      world.store.getGrantDeclaration = async (...args) => {
        world.spy.lookup.push(args);
        const err = new Error('mongo read timeout');
        if (flagged) err.declarationLookupFailed = true;
        throw err;
      };
      resetSpy(world);
      const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.equal('token' in (res.body || {}), false);
      assert.equal(world.spy.lookup.length, 1, 'the lookup ran');
      assertNoMintAttempt(world, 'lookup fault');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Malformed itemId → 400 before any lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('5 — present-but-malformed itemId: 400, no lookup, no mint', () => {
  const bad = [
    ['null', null], ['empty string', ''], ['number', 123], ['array', ['x']], ['object', {}],
    ['non-UUID string', 'not-a-uuid'], ['UUID with trailing junk', `${crypto.randomUUID()}x`], ['boolean', true]
  ];
  for (const [name, itemId] of bad) {
    test(`${name} -> 400 'Invalid item ID format'`, async () => {
      const world = makeWorld();
      const res = await call(buildApp(world), 'owner-token', { itemId });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error, 'Invalid item ID format');
      assert.equal(world.spy.lookup.length, 0, 'no lookup');
      assertNoMintAttempt(world, name);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Owner-seam refusals relayed; corrupt record
// ─────────────────────────────────────────────────────────────────────────────

describe('6 — ownership change and owner-seam faults: relayed, never a grant-less mint', () => {
  test('recorded owner A, workspace now owned by B -> 403 GRANT_OWNER_ONLY; the attempt named A, never B', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    world.owners[RECORDED_WORKSPACE] = 'account-B';
    resetSpy(world);
    const res = await call(buildApp(world), 'owner-token', { itemId: id });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNER_ONLY');
    assert.equal(res.body.retryable, false);
    assert.equal(world.spy.grant.length, 1, 'the owner-checked mint was attempted');
    assert.equal(world.spy.grant[0].ownerAccountId, RECORDED_OWNER, 'with the recorded owner');
    assertNothingMinted(world, 'ownership change');
  });

  test('workspace has no owner edge -> 409 WORKSPACE_OWNER_UNSET relayed', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    world.owners = {};
    resetSpy(world);
    const res = await call(buildApp(world), 'owner-token', { itemId: id });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'WORKSPACE_OWNER_UNSET');
    assertNothingMinted(world, 'owner unset');
  });

  test('owner seam unavailable -> 503, no fallback', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    world.ownerCheckFault = true;
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal('token' in (res.body || {}), false);
    assertNothingMinted(world, 'seam unavailable');
  });

  test('corrupt record (grants: []) -> 400 INVALID_GRANTS relayed, no mint attempted', async () => {
    const world = makeWorld();
    const id = await seedTaken(world, { patch: { grantDeclaration: { ...RECORD, grants: [] } } });
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, 'INVALID_GRANTS');
    assert.equal(res.body.retryable, false);
    assertNoMintAttempt(world, 'corrupt record');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Ownerless RECORD (distinct from 10, an ownerless dispatch TOKEN)
// ─────────────────────────────────────────────────────────────────────────────

describe('7 — ownerless RECORD: B1 skipped, the helper refuses GRANT_OWNERLESS; nothing minted', () => {
  const ownerlessRecords = [
    ['owner missing', (() => { const r = { ...RECORD }; delete r.ownerAccountId; return r; })()],
    ['owner empty string', { ...RECORD, ownerAccountId: '' }]
  ];
  for (const [name, record] of ownerlessRecords) {
    test(`${name}, owner-stamped live taker -> 503 GRANT_OWNERLESS`, async () => {
      const world = makeWorld();
      const id = await seedTaken(world, { patch: { grantDeclaration: record } });
      resetSpy(world);
      const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.equal(res.body.code, 'GRANT_OWNERLESS');
      assert.equal(res.body.retryable, false);
      assertNoMintAttempt(world, name);
    });

    test(`${name}, ownerless dispatch token that took the row -> refused, nothing minted (null never "matches" a missing owner)`, async () => {
      const world = makeWorld();
      const id = await seedTaken(world, { patch: { grantDeclaration: record } });
      resetSpy(world);
      const { result: res } = await captureLogs(() => call(buildApp(world), 'ownerless-token', { itemId: id }));
      assert.ok(res.status === 503 || res.status === 403, JSON.stringify(res.body));
      assert.ok(res.body.code === 'GRANT_OWNERLESS' || res.body.code === REFUSED_CODE, JSON.stringify(res.body));
      assertNoMintAttempt(world, name);
    });

    // N1 (plan-review bd97e703): B1 is skipped for an ownerless record, but B2
    // still applies before the helper — a non-taker is refused by the bound.
    test(`${name}, caller did NOT take the row -> 403 ${REFUSED_CODE} (B2 still applies)`, async () => {
      const world = makeWorld();
      const id = await seedTaken(world, { patch: { grantDeclaration: record } });
      resetSpy(world);
      const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-other-label', { itemId: id }));
      assertCallerRefused(res, world, name);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Cross-workspace
// ─────────────────────────────────────────────────────────────────────────────

describe('8 — cross-workspace: the lookup is keyed by the token\'s urlKey, a body urlKey is ignored', () => {
  test('a declared row that exists only under another urlKey -> row-missing -> grant-less in the caller\'s workspace', async () => {
    const world = makeWorld();
    const id = await seedTaken(world, { urlKey: OTHER_URL_KEY });
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id, urlKey: OTHER_URL_KEY }));
    assertGrantless(res, world, RECORDED_OWNER, 'cross-workspace');
    assert.deepEqual(world.spy.lookup, [[URL_KEY, id]], 'looked up under the token urlKey, never the body one');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9-14. Caller bound (B1/B2) adversarial cases
// ─────────────────────────────────────────────────────────────────────────────

describe('9 — B2: a record taken by a different label', () => {
  test('owner-created token with a different label -> 403, no mint', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-other-label', { itemId: id }));
    assertCallerRefused(res, world, 'different label');
  });
});

describe('10 — ownerless compat-lane dispatch TOKEN + a record with a usable owner', () => {
  test('compat lane on -> 403 (B1 fails), no mint', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'ownerless-token', { itemId: id }));
    assertCallerRefused(res, world, 'ownerless token');
  });

  test('compat lane off -> 503 before any lookup', async () => {
    process.env[COMPAT_ENV] = 'off';
    const world = makeWorld();
    const id = await seedTaken(world);
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'ownerless-token', { itemId: id }));
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(world.spy.lookup.length, 0, 'lookup spy 0');
    assertNoMintAttempt(world, 'strict lane');
  });
});

describe('11 — B1: a member-owned dispatch token with the taker\'s label + the owner\'s record', () => {
  test('member token (createdBy account-M, label = taker label) -> 403, no mint', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'member-token', { itemId: id }));
    assertCallerRefused(res, world, 'member token');
  });
});

describe('12 — B2: terminal, expired, cancelled and still-queued rows are refused', () => {
  for (const marker of ['[done] shipped', '[failed] crashed', '[aborted] stopped']) {
    test(`row taken by this caller with ${marker.split(' ')[0]} feedback -> 403`, async () => {
      const world = makeWorld();
      const id = await seedTaken(world, { patch: { feedback: feedback('[working] started', marker) } });
      resetSpy(world);
      const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
      assertCallerRefused(res, world, marker);
    });
  }

  for (const status of ['expired', 'cancelled']) {
    test(`${status} history row (this caller's label) -> 403`, async () => {
      const world = makeWorld();
      const id = await seedTaken(world, { patch: { status } });
      resetSpy(world);
      const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
      assertCallerRefused(res, world, status);
    });
  }

  test('still-queued declared row (not taken yet) -> 403', async () => {
    const world = makeWorld();
    const id = await seedQueued(world);
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assertCallerRefused(res, world, 'queued');
  });
});

describe('13 — history-only rows', () => {
  test('history-only, non-terminal, taken by this caller (the normal repoint case) -> declared re-mint', async () => {
    const world = makeWorld();
    const id = await seedTaken(world, { patch: { feedback: feedback('[working] started', '[working] still going') } });
    assert.equal(world.collection._docs.some(d => d._id === id), false, 'absent from the active queue');
    assert.equal(world.historyCollection._docs.some(d => d._id === id), true, 'present in history');
    resetSpy(world);
    const res = await call(buildApp(world), 'owner-token', { itemId: id });
    assertDeclared(res, world, id, 'history-only live row');
  });

  test('history-only row this caller did not take -> 403', async () => {
    const world = makeWorld();
    const id = await seedTaken(world, { label: 'someone-else' });
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assertCallerRefused(res, world, 'not the taker');
  });
});

describe('14 — B2: an unreadable status fails closed', () => {
  test('getItemStatus returns null (miss or swallowed fault) -> 403, no mint', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    world.store.getItemStatus = async (...args) => { world.spy.status.push(args); return null; };
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assertCallerRefused(res, world, 'status unreadable');
    assert.equal(world.spy.status.length, 1, 'the status read ran');
  });

  test('getItemStatus throws -> refused, nothing minted', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    world.store.getItemStatus = async () => { throw new Error('mongo down'); };
    resetSpy(world);
    const { result: res } = await captureLogs(() => call(buildApp(world), 'owner-token', { itemId: id }));
    assert.ok(res.status === 403 || res.status === 503, JSON.stringify(res.body));
    assert.equal('token' in (res.body || {}), false);
    assertNoMintAttempt(world, 'status throws');
  });
});

describe('9-14 — one generic refusal body, the reason only in the server log', () => {
  test('owner-mismatch / not-taker / terminal / status-unreadable -> identical bodies, logged reasons', async () => {
    const cases = [
      ['owner-mismatch', 'member-token', {}],
      ['not-taker', 'owner-other-label', {}],
      ['terminal', 'owner-token', { patch: { feedback: feedback('[done] shipped') } }],
      ['status-unreadable', 'owner-token', { unreadable: true }]
    ];
    const bodies = [];
    for (const [reason, token, opts] of cases) {
      const world = makeWorld();
      const id = await seedTaken(world, opts.patch ? { patch: opts.patch } : {});
      if (opts.unreadable) world.store.getItemStatus = async () => null;
      const { result: res, lines } = await captureLogs(() => call(buildApp(world), token, { itemId: id }));
      assert.equal(res.status, 403, `${reason}: ${JSON.stringify(res.body)}`);
      bodies.push(res.body);
      const hit = lines.find(l => l.includes(REFUSAL_LOG_TAG));
      assert.ok(hit, `${reason}: refusal logged; got ${JSON.stringify(lines)}`);
      assert.ok(hit.includes(reason), `${reason}: the log names the reason`);
      assert.ok(hit.includes(URL_KEY) && hit.includes(id), `${reason}: the log names urlKey and itemId`);
    }
    for (const body of bodies.slice(1)) {
      assert.deepEqual(body, bodies[0], 'the response never says which condition failed');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. The client cannot name authority
// ─────────────────────────────────────────────────────────────────────────────

describe('15 — body fields naming authority are ignored', () => {
  const extras = {
    grants: ['take', 'dispatch'],
    declaredGrants: ['take', 'dispatch'],
    grantOwnerAccountId: 'account-X',
    ownerAccountId: 'account-X',
    workspaceId: 'ws-attacker',
    urlKey: OTHER_URL_KEY,
    verb: 'orchestrator'
  };

  test('with a none row: identical grant-less mint to the same call without the extras', async () => {
    const world = makeWorld();
    const id = await seedTaken(world, { record: null });
    resetSpy(world);
    const res = await call(buildApp(world), 'owner-token', { itemId: id, ...extras });
    assertGrantless(res, world, RECORDED_OWNER, 'none + extras');
  });

  test('with a record: grants/owner/workspace come only from the record', async () => {
    const world = makeWorld();
    const id = await seedTaken(world);
    resetSpy(world);
    const res = await call(buildApp(world), 'owner-token', { itemId: id, ...extras });
    assertDeclared(res, world, id, 'record + extras');
  });

  test('with no itemId: extras alone never select the declared branch', async () => {
    const world = makeWorld();
    const res = await call(buildApp(world), 'owner-token', extras);
    assertGrantless(res, world, RECORDED_OWNER, 'extras, no itemId');
    assert.equal(world.spy.lookup.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Every grant-less path stays grant-less
// ─────────────────────────────────────────────────────────────────────────────

describe('16 — an ordinary child stays grant-less: no grant key on any grant-less mint', () => {
  test('no itemId / none / row-missing / ownerless none: createToken carries no grants, declaredGrants or grantOwnerAccountId', async () => {
    const paths = [
      ['no itemId', 'owner-token', async () => undefined],
      ['none', 'owner-token', async (world) => ({ itemId: await seedTaken(world, { record: null }) })],
      ['row-missing', 'owner-token', async () => ({ itemId: crypto.randomUUID() })],
      ['ownerless none', 'ownerless-token', async (world) => ({ itemId: await seedTaken(world, { record: null }) })]
    ];
    for (const [name, token, makeBody] of paths) {
      const world = makeWorld();
      const body = await makeBody(world);
      resetSpy(world);
      const { result: res } = await captureLogs(() => call(buildApp(world), token, body));
      assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
      assert.equal(world.spy.plain.length, 1, name);
      for (const key of ['grants', 'declaredGrants', 'grantOwnerAccountId']) {
        assert.equal(key in world.spy.plain[0].opts, false, `${name}: no ${key}`);
      }
      assert.equal(world.spy.grant.length, 0, `${name}: no grant mint`);
    }
  });
});
