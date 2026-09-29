/**
 * LIN-3132 (LIN-3059 S1b) — the worker lifetime profile on `mintGrantBootstrap`.
 *
 * One closed profile table governs a grant-bearing mint's boot + working TTLs;
 * the exchange derives the working TTL from the profile STAMPED on the bootstrap
 * and never from a caller/route `ttl`; unknown/missing → runner. Acceptance
 * cases AC1–AC7 from the LIN-3132 description, witnessed through the real
 * `POST /api/proxy/token` route where the AC names it, and through a REAL
 * ProxyTokenStore over an in-memory collection otherwise.
 *
 * Clock-shift idiom (shared with tests/unit/proxy-tokens.test.js): there is no
 * clock seam, so elapsed time is simulated by mutating the stored doc's
 * `createdAt`/`expiresAt` directly. A grant-bearing bootstrap is minted with a
 * fake owner check, exactly as S1's lin-3059-runner-criterion test does.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import {
  RUNNER_GRANTS,
  LIFETIME_PROFILES,
  resolveLifetimeProfile
} from '../../lib/proxy-scopes.js';

const HOUR_MS = 60 * 60 * 1000;
const hoursFromNow = (iso, from = Date.now()) => (new Date(iso).getTime() - from) / HOUR_MS;

// ---------------------------------------------------------------------------
// In-memory collection (MangoDB-compatible), `$or` support for the revoke query.
// ---------------------------------------------------------------------------

function createCollection() {
  let docs = [];
  const matches = (d, query) => Object.keys(query).every(k => {
    if (k === '$or') return query.$or.some(sub => matches(d, sub));
    const val = query[k];
    if (val && typeof val === 'object') {
      if ('$lt' in val && '$ne' in val) {
        return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      }
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

const OWNER = async () => ({ status: 'owner' });

function newStore(ownerCheck = OWNER) {
  const collection = createCollection();
  const store = new ProxyTokenStore({ collection });
  store.setOwnerCheck(ownerCheck);
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

/** Mint a worker/runner grant bootstrap through the real owner-checked path. */
function mintBootstrap(store, profile, extra = {}) {
  return store.mintGrantBootstrap({
    urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A',
    grants: RUNNER_GRANTS, label: `${profile}-bootstrap`,
    ...(profile === undefined ? {} : { profile }),
    ...extra
  });
}

const bootstrapDocFor = (collection, tokenId) => collection._docs().find(d => d._id === tokenId);
const workingDocFor = (collection, token) => {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return collection._docs().find(d => d.tokenHash === hash);
};

/** Rewind a stored doc's timeline by `ms` (simulates that much elapsed time). */
function shiftBack(doc, ms) {
  doc.createdAt = new Date(new Date(doc.createdAt).getTime() - ms);
  if (doc.expiresAt) doc.expiresAt = new Date(new Date(doc.expiresAt).getTime() - ms);
}

/** Seed a grant-bearing bootstrap directly (never through #mint), with an
 *  arbitrary / absent lifetimeProfile — the foreign-doc shape AC5 names. */
async function seedGrantBootstrap(collection, { plain, lifetimeProfile }) {
  const doc = {
    _id: crypto.randomUUID(),
    urlKey: 'acme',
    tokenHash: crypto.createHash('sha256').update(plain).digest('hex'),
    label: 'seeded-bootstrap', scope: 'readWrite', kind: 'bootstrap', singleUse: true,
    createdBy: 'account-A', grants: RUNNER_GRANTS.slice(), parentTokenId: null,
    workspaceId: 'ws-1', createdAt: new Date(), lastUsedAt: null,
    expiresAt: new Date(Date.now() + 48 * HOUR_MS), consumed: false
  };
  if (lifetimeProfile !== undefined) doc.lifetimeProfile = lifetimeProfile;
  await collection.insertOne(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// AC1–AC3 — the worker profile through the exchange route
// ---------------------------------------------------------------------------

describe('LIN-3132 — worker profile (AC1–AC3)', () => {
  test('AC1: worker bootstrap shifted 23h59m exchanges via POST /api/proxy/token → 200, grants copied, working ≈ exchange+48h', async () => {
    const { store, collection } = newStore();
    const app = buildApp(store);

    const bootstrap = await mintBootstrap(store, 'worker');
    assert.equal(bootstrap.lifetimeProfile, 'worker');
    assert.equal(bootstrapDocFor(collection, bootstrap.tokenId).lifetimeProfile, 'worker');

    // 23h59m into the 48h bootstrap: still unexpired by one minute.
    shiftBack(bootstrapDocFor(collection, bootstrap.tokenId), (24 * HOUR_MS) - (60 * 1000));

    const before = Date.now();
    const res = await postExchange(app, bootstrap.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.grants, ['take', 'dispatch'], 'grants copied');
    assert.equal(res.body.scope, 'readWrite');

    const hours = hoursFromNow(res.body.expiresAt, before);
    assert.ok(hours > 47.9 && hours <= 48.02, `expected ~48h, got ${hours}`);
  });

  test('AC2: worker working token shifted 25h into the past still authenticates (a 24h lifetime would fail)', async () => {
    const { store, collection } = newStore();
    const app = buildApp(store);

    const bootstrap = await mintBootstrap(store, 'worker');
    const res = await postExchange(app, bootstrap.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // 48h minted - 25h elapsed leaves 23h; a runner (24h) mint would leave -1h.
    shiftBack(workingDocFor(collection, res.body.token), 25 * HOUR_MS);

    const validated = await store.validateToken(res.body.token);
    assert.ok(validated, 'the worker working token is still valid 25h after exchange');
    assert.deepEqual(validated.grants, ['take', 'dispatch']);
  });

  test('AC3: worker bootstrap at expiry +1s is refused by the exchange route with 401', async () => {
    const { store, collection } = newStore();
    const app = buildApp(store);

    const bootstrap = await mintBootstrap(store, 'worker');
    const doc = bootstrapDocFor(collection, bootstrap.tokenId);
    doc.expiresAt = new Date(Date.now() - 1000); // expiry + 1s

    const res = await postExchange(app, bootstrap.token);
    assert.equal(res.status, 401, JSON.stringify(res.body));
    assert.equal(res.body.code, 'PROXY_TOKEN_INVALID');
  });
});

// ---------------------------------------------------------------------------
// AC4 — runner regression
// ---------------------------------------------------------------------------

describe('LIN-3132 — runner regression (AC4)', () => {
  test('AC4: runner profile stays 1h bootstrap / 24h working, at the store', async () => {
    const { store } = newStore();
    const before = Date.now();
    const bootstrap = await mintBootstrap(store, 'runner');
    const bootHours = hoursFromNow(bootstrap.expiresAt, before);
    assert.ok(bootHours > 0.99 && bootHours <= 1.001, `expected ~1h bootstrap, got ${bootHours}`);

    const beforeWorking = Date.now();
    const working = await store.exchangeBootstrapToken(bootstrap.token);
    const workHours = hoursFromNow(working.expiresAt, beforeWorking);
    assert.ok(workHours > 23.9 && workHours <= 24.01, `expected ~24h working, got ${workHours}`);
  });

  test('AC4: the route returns a ~24h working token for a runner grant (its own 48h ttl is ignored)', async () => {
    const { store } = newStore();
    const app = buildApp(store);
    const bootstrap = await mintBootstrap(store, 'runner');

    const before = Date.now();
    const res = await postExchange(app, bootstrap.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const hours = hoursFromNow(res.body.expiresAt, before);
    assert.ok(hours > 23.9 && hours <= 24.01, `expected ~24h, got ${hours}`);
  });
});

// ---------------------------------------------------------------------------
// AC5 — unknown / missing profile resolves to runner
// ---------------------------------------------------------------------------

describe('LIN-3132 — unknown/missing profile falls back to runner (AC5)', () => {
  test('AC5: resolveLifetimeProfile falls back to runner for unknown, missing and non-string names', () => {
    assert.equal(resolveLifetimeProfile('worker'), 'worker');
    assert.equal(resolveLifetimeProfile('runner'), 'runner');
    for (const bad of [undefined, null, 'bogus', '', 'constructor', '__proto__', 0, true, {}]) {
      assert.equal(resolveLifetimeProfile(bad), 'runner', `expected runner for ${JSON.stringify(bad)}`);
    }
  });

  test('AC5: a stored doc with an unknown or missing lifetimeProfile exchanges at runner lifetimes (store)', async () => {
    for (const lifetimeProfile of ['bogus', undefined]) {
      const { store, collection } = newStore();
      const plain = 'seed-' + crypto.randomUUID();
      await seedGrantBootstrap(collection, { plain, lifetimeProfile });

      const before = Date.now();
      const working = await store.exchangeBootstrapToken(plain);
      const hours = hoursFromNow(working.expiresAt, before);
      assert.ok(hours > 23.9 && hours <= 24.01, `lifetimeProfile=${lifetimeProfile}: expected ~24h, got ${hours}`);
    }
  });

  test('AC5: a stored doc with an unknown lifetimeProfile exchanges via the route at runner lifetimes', async () => {
    const { store, collection } = newStore();
    const app = buildApp(store);
    const plain = 'seed-' + crypto.randomUUID();
    await seedGrantBootstrap(collection, { plain, lifetimeProfile: 'bogus' });

    const before = Date.now();
    const res = await postExchange(app, plain);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const hours = hoursFromNow(res.body.expiresAt, before);
    assert.ok(hours > 23.9 && hours <= 24.01, `expected ~24h, got ${hours}`);
  });
});

// ---------------------------------------------------------------------------
// AC6 — ttl cannot change a grant-bearing document's lifetime
// ---------------------------------------------------------------------------

describe('LIN-3132 — ttl cannot change a grant-bearing lifetime (AC6)', () => {
  test('AC6: a caller ttl cannot change a grant-bearing working TTL (runner→24h, worker→48h)', async () => {
    {
      const { store } = newStore();
      const bootstrap = await mintBootstrap(store, 'runner');
      const before = Date.now();
      const working = await store.exchangeBootstrapToken(bootstrap.token, { ttl: 365 * 24 * 3600 });
      const hours = hoursFromNow(working.expiresAt, before);
      assert.ok(hours > 23.9 && hours <= 24.01, `runner + caller 1y ttl: expected ~24h, got ${hours}`);
    }
    {
      const { store } = newStore();
      const bootstrap = await mintBootstrap(store, 'worker');
      const before = Date.now();
      const working = await store.exchangeBootstrapToken(bootstrap.token, { ttl: 3600 });
      const hours = hoursFromNow(working.expiresAt, before);
      assert.ok(hours > 47.9 && hours <= 48.02, `worker + caller 1h ttl: expected ~48h, got ${hours}`);
    }
  });

  test('AC6: mintGrantBootstrap ignores a caller-supplied ttl key (profile governs the bootstrap TTL)', async () => {
    {
      const { store } = newStore();
      const before = Date.now();
      const bootstrap = await mintBootstrap(store, 'runner', { ttl: 10 });
      const hours = hoursFromNow(bootstrap.expiresAt, before);
      assert.ok(hours > 0.99 && hours <= 1.001, `runner + ttl:10: expected ~1h, got ${hours}`);
    }
    {
      const { store } = newStore();
      const before = Date.now();
      const bootstrap = await mintBootstrap(store, 'worker', { ttl: 10 });
      const hours = hoursFromNow(bootstrap.expiresAt, before);
      assert.ok(hours > 47.9 && hours <= 48.02, `worker + ttl:10: expected ~48h, got ${hours}`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC7 — createToken cannot stamp a lifetime profile
// ---------------------------------------------------------------------------

describe('LIN-3132 — createToken cannot stamp a lifetime profile (AC7)', () => {
  test('AC7: createToken forces lifetimeProfile to null even when one is passed', async () => {
    const { store, collection } = newStore();
    await store.createToken('acme', {
      scope: 'readWrite', createdBy: 'account-A', lifetimeProfile: 'worker'
    });
    const doc = collection._docs()[0];
    assert.equal(doc.lifetimeProfile, null, 'the public grant-less path never stamps a profile');

    // A grant-less exchange ignores the profile anyway: caller ttl still applies.
    const before = Date.now();
    const working = await store.exchangeBootstrapToken(
      (await store.createToken('acme', { kind: 'bootstrap', scope: 'readWrite', createdBy: 'account-A' })).token,
      { ttl: 3600 }
    );
    const hours = hoursFromNow(working.expiresAt, before);
    assert.ok(hours > 0.99 && hours <= 1.001, `grant-less exchange keeps caller ttl, got ${hours}`);
  });
});
