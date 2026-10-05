/**
 * LIN-2944 P3 beat 1 — witness for the default-copy token-mint allowance
 * (ruling `lin2944-p3-r1-mint-limit`, answered **fix** by John on 2026-10-05).
 *
 * The proxy is on by default (P3), so every copy/download of a task prompt goes
 * through `ProxyToggle.getOrCreateToken` → `POST /workspace/:urlKey/api/proxy/tokens`
 * with `{ label: 'prompt-proxy', scope: 'readWrite', bootstrap: true }`
 * (public/common.js:1957). That route is currently guarded ONLY by the
 * module-scope per-IP `proxyTokenCreationLimiter` (routes/proxy.js:270;
 * 10 requests / 15 min / IP). Ten copies shared across an office / NAT /
 * carrier address is too small for a default-on feature, and the 11th copy
 * currently returns 429 (the shipped fallback then drops the agent-access
 * block with a notice — worse than simply allowing the copy).
 *
 * The fix this file witnesses: the DEFAULT-copy mint gets its own per-account
 * allowance — keyed on `req.session.accountId`, which the session middleware in
 * server.js:937 sets before the proxy router at server.js:2893 — higher than
 * 10/15min and still bounded. Every OTHER token creation keeps the existing
 * per-IP limit.
 *
 * These tests drive the real `createProxyRoutes` chain over a real
 * `ProxyTokenStore`. The module-scope limiter `skip`s under NODE_ENV=test, so
 * the limiter block flips to 'development' to de-inert it (same construction as
 * tests/unit/lin-2534-tokens-admin-extraction.test.js).
 *
 * On the current unfixed head `6608ffe1` this file is RED:
 *   - the 11th default-copy mint for one account gets 429 (per-IP budget);
 *   - the 30th never gets a chance;
 *   - a second account is collateral damage on the same IP;
 *   - there is no per-account allowance at all.
 * Once the fix lands it is GREEN:
 *   - 11 and 30 default-copy mints for one account succeed;
 *   - one account's allowance allows DEFAULT_COPY_TOKEN_LIMIT then 429s;
 *   - a different account is unaffected by another's exhausted count;
 *   - ordinary (non-default-copy) creation still 429s on the 11th per IP.
 */
process.env.NODE_ENV = 'test';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';

// Captured before the limiter block flips NODE_ENV to 'development'.
const realNodeEnv = process.env.NODE_ENV;

// The chosen default-copy per-account allowance. Higher than the per-IP limit
// of 10/15min (the whole point of the ruling) yet bounded, so an account can
// still be stopped. The 61st default-copy mint within the window must 429.
const DEFAULT_COPY_TOKEN_LIMIT = 60;

// The body shape of the default ("prompt-proxy") copy mint. Ordinary
// (per-IP) token creation is witnessed separately in
// tests/unit/lin-2944-p3-ordinary-token-ip-limit.test.js so this file sees a
// fresh per-IP budget and its RED reads as the literal 11th-request 429.
const DEFAULT_COPY_BODY = { label: 'prompt-proxy', scope: 'readWrite', bootstrap: true };

function createMockCollection() {
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
    find(query = {}) { return { toArray: async () => docs.filter(d => matches(d, query)) }; }
  };
}

function harness() {
  const proxyTokenStore = new ProxyTokenStore({ collection: createMockCollection() });
  return { proxyTokenStore };
}

// A per-request session is read from the x-test-account header so one running
// server can be driven as several accounts (the real production session object
// is set globally before the proxy router — server.js:937 vs :2893).
function buildApp({ proxyTokenStore }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      accountId: req.headers['x-test-account'] || null,
      features: { proxy: true }
    };
    next();
  });
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: 'acme', id: 'ws-1', provider: 'local' };
      next();
    },
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {}, freeTierStore: {}
  }));
  return app;
}

// Drive `count` POSTs against ONE running server, carrying the account header.
async function postMany(app, count, body, account) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const statuses = [];
  try {
    for (let i = 0; i < count; i++) {
      const res = await fetch(`http://127.0.0.1:${port}${TOKENS_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(account ? { 'x-test-account': account } : {})
        },
        body: JSON.stringify(body)
      });
      statuses.push(res.status);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  return statuses;
}

function summarise(statuses) {
  return statuses
    .map((s, i) => `${i + 1}:${s}`)
    .filter((_, i) => i < 12 || statuses[i] === 429)
    .join(' ');
}

describe('LIN-2944 P3 — the default-copy token mint gets its own higher per-account allowance', () => {
  // De-inert the module-scope limiter(s); restored afterwards.
  process.env.NODE_ENV = 'development';
  after(() => {
    if (realNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = realNodeEnv;
  });

  test('the 11th default-copy mint for one account succeeds (no 429)', async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore });
    const statuses = await postMany(app, 11, DEFAULT_COPY_BODY, 'acct-eleven');
    assert.ok(statuses.every(s => s === 201),
      `all 11 default-copy mints for one account must succeed; got ${summarise(statuses)}`);
  });

  test('the 30th default-copy mint for one account succeeds (no 429)', async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore });
    const statuses = await postMany(app, 30, DEFAULT_COPY_BODY, 'acct-thirty');
    assert.ok(statuses.every(s => s === 201),
      `all 30 default-copy mints for one account must succeed; got ${summarise(statuses)}`);
  });

  test(`the per-account allowance allows ${DEFAULT_COPY_TOKEN_LIMIT}, then 429s the ${DEFAULT_COPY_TOKEN_LIMIT + 1}th (bounded, no unbounded minting)`, async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore });
    const statuses = await postMany(app, DEFAULT_COPY_TOKEN_LIMIT + 1, DEFAULT_COPY_BODY, 'acct-allowance');
    const firstLimited = statuses.findIndex(s => s === 429);
    assert.equal(firstLimited, DEFAULT_COPY_TOKEN_LIMIT,
      `the default-copy allowance must allow ${DEFAULT_COPY_TOKEN_LIMIT} mints then 429; ` +
      `first 429 at request #${firstLimited === -1 ? 'none (unbounded!)' : firstLimited + 1} ` +
      `(statuses ${summarise(statuses)})`);
  });

  test("a different account is unaffected by another account's exhausted default-copy count", async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore });

    // Account A drives its own allowance to the wall.
    const aStatuses = await postMany(app, DEFAULT_COPY_TOKEN_LIMIT + 1, DEFAULT_COPY_BODY, 'acct-a');
    assert.ok(aStatuses.includes(429), `account A must eventually 429 (statuses ${summarise(aStatuses)})`);

    // Account B shares the same IP and is still fresh.
    const bStatuses = await postMany(app, 1, DEFAULT_COPY_BODY, 'acct-b');
    assert.equal(bStatuses[0], 201,
      `account B must be unaffected by account A's exhausted allowance (got ${bStatuses[0]})`);
  });
});
